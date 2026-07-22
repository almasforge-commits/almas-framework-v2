import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  buildAuthHeader,
  liveGetJson,
  logMiniAppAuthDiag,
  resolveInitDataForRequest,
} from "../api/liveHttp";
import { ApiError, mapApiErrorToUi } from "../api/apiErrors";
import {
  clearStaleInitDataCache,
  getRawInitData,
  normalizeTelegramInitData,
} from "../telegram/initData";
import { TelegramProvider } from "../telegram/TelegramProvider";
import { HomePage } from "../pages/HomePage";
import liveHttpSource from "../api/liveHttp.ts?raw";
import initDataSource from "../telegram/initData.ts?raw";

export const VALID_INIT_DATA =
  "query_id=AAE&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22A%2BB%22%7D&auth_date=1710000000&hash=abcdef0123456789";

afterEach(() => {
  cleanup();
  delete window.Telegram;
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("normalizeTelegramInitData", () => {
  it("rejects null / undefined / empty / whitespace / junk literals", () => {
    expect(normalizeTelegramInitData(null)).toBe("");
    expect(normalizeTelegramInitData(undefined)).toBe("");
    expect(normalizeTelegramInitData("")).toBe("");
    expect(normalizeTelegramInitData("   ")).toBe("");
    expect(normalizeTelegramInitData("null")).toBe("");
    expect(normalizeTelegramInitData("NULL")).toBe("");
    expect(normalizeTelegramInitData(" undefined ")).toBe("");
    expect(normalizeTelegramInitData("[object Object]")).toBe("");
  });

  it("rejects strings missing hash= or auth_date=", () => {
    expect(normalizeTelegramInitData("auth_date=1&user=x")).toBe("");
    expect(normalizeTelegramInitData("hash=abc&user=x")).toBe("");
    expect(normalizeTelegramInitData("raw-init")).toBe("");
  });

  it("accepts valid raw initData unchanged", () => {
    expect(normalizeTelegramInitData(VALID_INIT_DATA)).toBe(VALID_INIT_DATA);
  });
});

describe("buildAuthHeader guard", () => {
  it("does not build header for null-like / junk values", () => {
    const junk = [
      "null",
      "undefined",
      "",
      "   ",
      "auth_date=1",
      "hash=abc",
      "query_id=1&hash=x",
    ];
    for (const value of junk) {
      expect(() => buildAuthHeader(value)).toThrow(ApiError);
      try {
        buildAuthHeader(value);
      } catch (error) {
        expect(error).toMatchObject({ code: "auth_required" });
      }
    }
  });

  it("builds tma <raw> without mutating initData", () => {
    const header = buildAuthHeader(VALID_INIT_DATA);
    expect(header).toBe(`tma ${VALID_INIT_DATA}`);
    expect(header.slice(4)).toBe(VALID_INIT_DATA);
    expect(header).toContain("%7B");
    expect(header).toContain("A%2BB");
    expect(header.startsWith("tma tma ")).toBe(false);
  });

  it("never uses String(nullable) coercion path in source", () => {
    expect(liveHttpSource).not.toMatch(/`tma \$\{String\(/);
    expect(liveHttpSource).not.toMatch(
      /Authorization:\s*`tma \$\{(?!normalized|initData|authorization)/
    );
    expect(liveHttpSource).toMatch(/return `tma \$\{normalized\}`/);
    expect(initDataSource).toMatch(/normalizeTelegramInitData/);
  });
});

describe("liveGetJson auth gate", () => {
  it("null / undefined / \"null\" never call fetch", async () => {
    for (const value of [null, undefined, "null", "undefined", ""] as const) {
      const fetchFn = vi.fn();
      await expect(
        liveGetJson("/api/dashboard", {
          baseUrl: "http://api.test",
          fetchFn: fetchFn as unknown as typeof fetch,
          getInitData: () => value as string | null,
          initDataRetryMs: 0,
        })
      ).rejects.toMatchObject({ code: "auth_required" });
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("401 missing_hash maps to auth_required UI, not network", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "missing_hash" } }), {
          status: 401,
        })
    );
    await expect(
      liveGetJson("/api/dashboard", {
        baseUrl: "http://api.test",
        fetchFn: fetchFn as unknown as typeof fetch,
        getInitData: () => VALID_INIT_DATA,
        initDataRetryMs: 0,
      })
    ).rejects.toMatchObject({ code: "auth_required", status: 401 });

    const ui = mapApiErrorToUi(
      new ApiError("auth_required", "Unauthorized", { status: 401 })
    );
    expect(ui.title).toBe("Откройте приложение через Telegram");
    expect(ui.title).not.toBe("Нет соединения");
  });

  it("network TypeError maps to network UI", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      liveGetJson("/api/dashboard", {
        baseUrl: "http://api.test",
        fetchFn: fetchFn as unknown as typeof fetch,
        getInitData: () => VALID_INIT_DATA,
        initDataRetryMs: 0,
      })
    ).rejects.toMatchObject({ code: "network" });
    expect(mapApiErrorToUi(new ApiError("network", "x")).title).toBe(
      "Нет соединения"
    );
  });

  it("bounded retry obtains initData after delay", async () => {
    let calls = 0;
    const value = await resolveInitDataForRequest(() => {
      calls += 1;
      return calls >= 3 ? VALID_INIT_DATA : null;
    }, 5, 5);
    expect(value).toBe(VALID_INIT_DATA);
    expect(calls).toBe(3);
  });

  it("bounded retry ends with auth_required when initData never appears", async () => {
    let calls = 0;
    const value = await resolveInitDataForRequest(() => {
      calls += 1;
      return "null";
    }, 5, 4);
    expect(value).toBeNull();
    expect(calls).toBe(4);

    const fetchFn = vi.fn();
    await expect(
      liveGetJson("/api/dashboard", {
        baseUrl: "http://api.test",
        fetchFn: fetchFn as unknown as typeof fetch,
        getInitData: () => "null",
        initDataRetryMs: 5,
        initDataAttempts: 3,
      })
    ).rejects.toMatchObject({ code: "auth_required" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("stale storage cleanup", () => {
  it("clears stale \"null\" from sessionStorage / localStorage", () => {
    window.sessionStorage.setItem("almas.initData", "null");
    window.localStorage.setItem("telegram_initData", "undefined");
    window.sessionStorage.setItem("initData", VALID_INIT_DATA);
    clearStaleInitDataCache();
    expect(window.sessionStorage.getItem("almas.initData")).toBeNull();
    expect(window.localStorage.getItem("telegram_initData")).toBeNull();
    expect(window.sessionStorage.getItem("initData")).toBe(VALID_INIT_DATA);
  });

  it("getRawInitData rejects bridge literal \"null\"", () => {
    window.Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        initData: "null",
      },
    };
    expect(getRawInitData()).toBeNull();
  });
});

describe("safe diagnostics", () => {
  it("logs never contain raw initData or Authorization", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((msg?: unknown) => {
      lines.push(String(msg));
    });
    logMiniAppAuthDiag({
      telegramSdkPresent: true,
      webAppPresent: true,
      initDataType: "string",
      initDataPresent: true,
      initDataLength: VALID_INIT_DATA.length,
      hashMarkerPresent: true,
      authDateMarkerPresent: true,
      authHeaderBuilt: true,
      launchPlatform: "ios",
    });
    spy.mockRestore();
    const joined = lines.join("\n");
    expect(joined).toContain("initDataPresent=true");
    expect(joined).toContain(`initDataLength=${VALID_INIT_DATA.length}`);
    expect(joined).not.toContain(VALID_INIT_DATA);
    expect(joined).not.toMatch(/tma /);
    expect(joined).not.toContain("Authorization");
    expect(joined).not.toContain("hash=abcdef");
  });
});

describe("Dashboard bootstrap gate", () => {
  it("does not fetch dashboard while auth bootstrap is pending", async () => {
    vi.stubEnv("VITE_ALMAS_API_MODE", "live");
    window.Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        // Never appears → bootstrap ends missing after retries
        initData: "",
        platform: "tdesktop",
      },
    };

    const apiClientMod = await import("../api/apiClient");
    const spy = vi.spyOn(apiClientMod.apiClient, "getDashboard");

    render(
      <TelegramProvider>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </TelegramProvider>
    );

    // While pending / missing, spy must not be called with a live fetch path
    // that would send Authorization: tma null.
    await waitFor(() => {
      expect(
        screen.getByText("Откройте приложение через Telegram")
      ).toBeInTheDocument();
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});
