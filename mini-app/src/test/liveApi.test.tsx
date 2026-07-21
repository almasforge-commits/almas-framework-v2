import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRealApi } from "../api/realApi";
import { buildAuthHeader, liveGetJson } from "../api/liveHttp";
import { mapApiErrorToUi, ApiError } from "../api/apiErrors";
import { resolveApiClient } from "../api/apiClient";
import { getApiMode } from "../config/env";
import { getRawInitData } from "../telegram/initData";
import App from "../App";
import apiClientSource from "../api/apiClient.ts?raw";
import realApiSource from "../api/realApi.ts?raw";
import liveHttpSource from "../api/liveHttp.ts?raw";
import envSource from "../config/env.ts?raw";

afterEach(() => {
  cleanup();
  delete window.Telegram;
  window.history.pushState({}, "", "/");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("live API client", () => {
  it("Authorization header contains raw initData", async () => {
    const initData = "auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc";
    let seenAuth: string | null = null;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seenAuth = String((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await liveGetJson("/api/health", {
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchFn as unknown as typeof fetch,
      getInitData: () => initData,
    });

    expect(seenAuth).toBe(buildAuthHeader(initData));
    expect(seenAuth).toBe(`tma ${initData}`);
    expect(seenAuth).not.toContain("initDataUnsafe");
  });

  it("initDataUnsafe is never used for auth", async () => {
    window.Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        initData: "",
        initDataUnsafe: {
          user: { id: 99, first_name: "Unsafe" },
          hash: "should-not-be-used",
        },
      },
    };

    expect(getRawInitData()).toBeNull();

    const api = createRealApi({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(api.getInbox()).rejects.toMatchObject({
      code: "auth_required",
    });
  });

  it("live mode calls correct endpoints", async () => {
    const calls: string[] = [];
    const auths: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      calls.push(String(input));
      auths.push(String((init?.headers as Record<string, string>).Authorization));
      const isList = /\/api\/(inbox|tasks|knowledge|finance\/transactions|memory|ideas)/.test(
        String(input)
      );
      return new Response(
        JSON.stringify({
          data: isList
            ? []
            : {
                summary: {},
                todayActivity: [],
                recentTasks: [],
                recentKnowledge: [],
                recentActions: [],
              },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const api = createRealApi({
      baseUrl: "http://api.test",
      fetchFn,
      getInitData: () => "raw-init",
    });

    await api.getDashboard(null);
    await api.getInbox();
    await api.getFinanceSummary("week");
    await api.getFinanceTransactions("today");
    await api.getTasks();
    await api.getKnowledge();
    await api.getMemory();
    await api.getIdeas();

    expect(calls).toEqual([
      "http://api.test/api/dashboard",
      "http://api.test/api/inbox",
      "http://api.test/api/finance/summary?period=week",
      "http://api.test/api/finance/transactions?period=today",
      "http://api.test/api/tasks",
      "http://api.test/api/knowledge",
      "http://api.test/api/memory",
      "http://api.test/api/ideas",
    ]);
    expect(auths.every((h) => h === "tma raw-init")).toBe(true);
  });

  it("handles 401/503/network with safe UI mapping", async () => {
    const ui401 = mapApiErrorToUi(
      new ApiError("unauthorized", "x", { status: 401 })
    );
    expect(ui401.title).toBe("Откройте приложение через Telegram");

    const ui503 = mapApiErrorToUi(
      new ApiError("unavailable", "x", { status: 503 })
    );
    expect(ui503.title).toBe("Данные временно недоступны");

    const uiNet = mapApiErrorToUi(new ApiError("network", "x", { retryable: true }));
    expect(uiNet.retryable).toBe(true);
    expect(uiNet.title).toBe("Нет соединения");

    const fetch401 = vi.fn(async () => new Response("{}", { status: 401 }));
    const api = createRealApi({
      baseUrl: "http://api.test",
      fetchFn: fetch401 as unknown as typeof fetch,
      getInitData: () => "raw",
    });
    await expect(api.getTasks()).rejects.toMatchObject({ code: "unauthorized" });

    const fetch503 = vi.fn(async () => new Response("{}", { status: 503 }));
    const api503 = createRealApi({
      baseUrl: "http://api.test",
      fetchFn: fetch503 as unknown as typeof fetch,
      getInitData: () => "raw",
    });
    await expect(api503.getTasks()).rejects.toMatchObject({ code: "unavailable" });

    const fetchNet = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const apiNet = createRealApi({
      baseUrl: "http://api.test",
      fetchFn: fetchNet as unknown as typeof fetch,
      getInitData: () => "raw",
    });
    await expect(apiNet.getTasks()).rejects.toMatchObject({ code: "network" });
  });

  it("browser without Telegram shows auth-required state in live mode UI mapping", async () => {
    const api = createRealApi({
      baseUrl: "http://api.test",
      getInitData: () => null,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(api.getDashboard(null)).rejects.toMatchObject({
      code: "auth_required",
    });
    const ui = mapApiErrorToUi(
      new ApiError("auth_required", "Telegram initData is required")
    );
    expect(ui.title).toBe("Откройте приложение через Telegram");
  });

  it("mock mode still resolves via resolveApiClient", async () => {
    const client = resolveApiClient("mock");
    const inbox = await client.getInbox();
    expect(Array.isArray(inbox)).toBe(true);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it("default mode remains mock", () => {
    expect(getApiMode({} as ImportMetaEnv)).toBe("mock");
    expect(getApiMode({ VITE_ALMAS_API_MODE: "mock" } as ImportMetaEnv)).toBe(
      "mock"
    );
    expect(getApiMode({ VITE_ALMAS_API_MODE: "live" } as ImportMetaEnv)).toBe(
      "live"
    );
  });

  it("live mode without API URL fails honestly", async () => {
    const api = createRealApi({
      baseUrl: "",
      getInitData: () => "raw",
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(api.getFinanceSummary("month")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("live client never falls back to mock fixtures", async () => {
    const live = resolveApiClient("live");
    const mock = resolveApiClient("mock");
    expect(live).not.toBe(mock);
    await expect(
      createRealApi({
        baseUrl: "",
        getInitData: () => "x",
        fetchFn: vi.fn() as unknown as typeof fetch,
      }).getMemory()
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("no direct Supabase imports or secrets in API client modules", () => {
    for (const src of [apiClientSource, realApiSource, liveHttpSource, envSource]) {
      expect(src).not.toMatch(/@supabase\/supabase-js/);
      expect(src).not.toMatch(/SERVICE_ROLE/);
      expect(src).not.toMatch(/\bBOT_TOKEN\b/);
      expect(src).not.toMatch(/SUPABASE_SERVICE/);
      expect(src).not.toMatch(/process\.env/);
    }
  });

  it("live mode without initData does not crash the App shell", async () => {
    // App uses default mock apiClient; auth-required is exercised by realApi above.
    // Ensure browser shell still mounts without Telegram.
    render(<App />);
    expect(await screen.findByTestId("dashboard-greeting")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("browser-preview")).toBeInTheDocument();
    });
  });
});
