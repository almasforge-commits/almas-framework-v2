import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createRealApi } from "../api/realApi";
import {
  buildAuthHeader,
  liveGetJson,
  resolveInitDataForRequest,
} from "../api/liveHttp";
import { mapApiErrorToUi, ApiError } from "../api/apiErrors";
import {
  getResolvedClientKind,
  resolveApiClient,
} from "../api/apiClient";
import {
  getApiBaseUrl,
  getApiHost,
  getApiMode,
  joinApiUrl,
} from "../config/env";
import {
  formatApiDiagLine,
  getApiDiagSnapshot,
  resetApiDiagForTests,
} from "../api/apiDiagnostics";
import { getRawInitData } from "../telegram/initData";
import { FinancePage } from "../pages/FinancePage";
import App from "../App";
import apiClientSource from "../api/apiClient.ts?raw";
import realApiSource from "../api/realApi.ts?raw";
import liveHttpSource from "../api/liveHttp.ts?raw";
import envSource from "../config/env.ts?raw";

afterEach(() => {
  cleanup();
  delete window.Telegram;
  window.history.pushState({}, "", "/");
  resetApiDiagForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("env selection (VITE_ALMAS_*)", () => {
  it("reads exact names VITE_ALMAS_API_MODE and VITE_ALMAS_API_URL", () => {
    expect(envSource).toMatch(/import\.meta\.env\.VITE_ALMAS_API_MODE/);
    expect(envSource).toMatch(/import\.meta\.env\.VITE_ALMAS_API_URL/);
    expect(envSource).not.toMatch(/VITE_API_URL/);
    expect(envSource).not.toMatch(/ALMAS_API_BASE/);
  });

  it("VITE_ALMAS_API_MODE=live selects live / real", () => {
    expect(getApiMode({ VITE_ALMAS_API_MODE: "live" })).toBe("live");
    expect(getResolvedClientKind("live")).toBe("real");
    expect(resolveApiClient("live")).not.toBe(resolveApiClient("mock"));
  });

  it("VITE_ALMAS_API_URL is normalized and host-parsed", () => {
    const env = {
      VITE_ALMAS_API_URL: "https://web-production-6d53b.up.railway.app/",
    };
    expect(getApiBaseUrl(env)).toBe(
      "https://web-production-6d53b.up.railway.app"
    );
    expect(getApiHost(env)).toBe("web-production-6d53b.up.railway.app");
  });

  it("default / invalid mode is mock (explicit, testable)", () => {
    expect(getApiMode({} as ImportMetaEnv)).toBe("mock");
    expect(getApiMode({ VITE_ALMAS_API_MODE: "MOCK" } as ImportMetaEnv)).toBe(
      "mock"
    );
    expect(getApiMode({ VITE_ALMAS_API_MODE: "prod" } as ImportMetaEnv)).toBe(
      "mock"
    );
    expect(getResolvedClientKind("mock")).toBe("mock");
  });

  it("joinApiUrl builds absolute /api paths without duplicate slash", () => {
    expect(
      joinApiUrl("https://web-production-6d53b.up.railway.app/", "/api/finance")
    ).toBe("https://web-production-6d53b.up.railway.app/api/finance");
    expect(
      joinApiUrl(
        "https://web-production-6d53b.up.railway.app",
        "api/finance/summary?period=month"
      )
    ).toBe(
      "https://web-production-6d53b.up.railway.app/api/finance/summary?period=month"
    );
    expect(() => joinApiUrl("", "/api/finance")).toThrow(/not configured/);
    expect(() => joinApiUrl("web-production-6d53b.up.railway.app", "/api/x")).toThrow(
      /protocol/
    );
  });
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
      initDataRetryMs: 0,
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

    const fetchFn = vi.fn();
    const api = createRealApi({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchFn as unknown as typeof fetch,
      initDataRetryMs: 0,
    });

    await expect(api.getInbox()).rejects.toMatchObject({
      code: "auth_required",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("missing initData does not call mock and shows auth-required UI", async () => {
    const fetchFn = vi.fn();
    const api = createRealApi({
      baseUrl: "http://api.test",
      getInitData: () => null,
      fetchFn: fetchFn as unknown as typeof fetch,
      initDataRetryMs: 0,
    });
    await expect(api.getFinanceSummary("month")).rejects.toMatchObject({
      code: "auth_required",
    });
    expect(fetchFn).not.toHaveBeenCalled();
    const ui = mapApiErrorToUi(
      new ApiError("auth_required", "Telegram initData is required")
    );
    expect(ui.code).toBe("auth_required");
    expect(ui.title).toBe("Откройте приложение через Telegram");
    expect(getApiDiagSnapshot().fetchAttempted).toBe(false);
    expect(getApiDiagSnapshot().errorCategory).toBe("auth_required");
  });

  it("retries once when initData appears after WebApp ready", async () => {
    let calls = 0;
    const initData = await resolveInitDataForRequest(() => {
      calls += 1;
      return calls >= 2 ? "raw-later" : null;
    }, 5);
    expect(initData).toBe("raw-later");
    expect(calls).toBe(2);
  });

  it("live mode calls correct endpoints including finance", async () => {
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
            : String(input).includes("/api/finance/summary")
              ? {
                  balance: 1,
                  incomeMonth: 2,
                  expensesMonth: 3,
                  currency: "VND",
                  period: "month",
                  demo: false,
                }
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
      baseUrl: "https://web-production-6d53b.up.railway.app",
      fetchFn,
      getInitData: () => "raw-init",
      initDataRetryMs: 0,
    });

    await api.getDashboard(null);
    await api.getInbox();
    await api.getFinanceSummary("month");
    await api.getFinanceTransactions("month");
    await api.getTasks();
    await api.getKnowledge();
    await api.getMemory();
    await api.getIdeas();

    expect(calls).toEqual([
      "https://web-production-6d53b.up.railway.app/api/dashboard",
      "https://web-production-6d53b.up.railway.app/api/inbox",
      "https://web-production-6d53b.up.railway.app/api/finance/summary?period=month",
      "https://web-production-6d53b.up.railway.app/api/finance/transactions?period=month",
      "https://web-production-6d53b.up.railway.app/api/tasks",
      "https://web-production-6d53b.up.railway.app/api/knowledge",
      "https://web-production-6d53b.up.railway.app/api/memory",
      "https://web-production-6d53b.up.railway.app/api/ideas",
    ]);
    expect(auths.every((h) => h === "tma raw-init")).toBe(true);
    expect(getApiDiagSnapshot().fetchAttempted).toBe(true);
  });

  it("final finance summary URL is exactly /api/finance/summary on the API host", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            balance: 0,
            incomeMonth: 0,
            expensesMonth: 0,
            currency: "VND",
            period: "month",
            demo: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const api = createRealApi({
      baseUrl: "https://web-production-6d53b.up.railway.app",
      fetchFn: fetchFn as unknown as typeof fetch,
      getInitData: () => "raw",
      initDataRetryMs: 0,
    });
    await api.getFinanceSummary("month");
    expect(fetchFn).toHaveBeenCalled();
    const calledUrl = String(
      (fetchFn.mock.calls as unknown as Array<[unknown]>)[0]?.[0]
    );
    expect(calledUrl).toBe(
      "https://web-production-6d53b.up.railway.app/api/finance/summary?period=month"
    );
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
      initDataRetryMs: 0,
    });
    await expect(api.getTasks()).rejects.toMatchObject({ code: "unauthorized" });

    const fetch503 = vi.fn(async () => new Response("{}", { status: 503 }));
    const api503 = createRealApi({
      baseUrl: "http://api.test",
      fetchFn: fetch503 as unknown as typeof fetch,
      getInitData: () => "raw",
      initDataRetryMs: 0,
    });
    await expect(api503.getTasks()).rejects.toMatchObject({ code: "unavailable" });

    const fetchNet = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const apiNet = createRealApi({
      baseUrl: "http://api.test",
      fetchFn: fetchNet as unknown as typeof fetch,
      getInitData: () => "raw",
      initDataRetryMs: 0,
    });
    await expect(apiNet.getTasks()).rejects.toMatchObject({ code: "network" });
    expect(getApiDiagSnapshot().errorCategory).toBe("network");
  });

  it("mock mode only when explicitly configured / default unset", async () => {
    const client = resolveApiClient("mock");
    const inbox = await client.getInbox();
    expect(Array.isArray(inbox)).toBe(true);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it("live mode without API URL fails honestly (no mock fallback)", async () => {
    const fetchFn = vi.fn();
    const api = createRealApi({
      baseUrl: "",
      getInitData: () => "raw",
      fetchFn: fetchFn as unknown as typeof fetch,
      initDataRetryMs: 0,
    });
    await expect(api.getFinanceSummary("month")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(fetchFn).not.toHaveBeenCalled();
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
        initDataRetryMs: 0,
      }).getMemory()
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("diagnostics line never includes secrets", () => {
    const line = formatApiDiagLine({
      apiMode: "live",
      apiHost: "web-production-6d53b.up.railway.app",
      initDataPresent: true,
      endpoint: "/api/finance/summary",
      fetchAttempted: true,
      responseStatus: 200,
      errorCategory: null,
    });
    expect(line).toContain("apiMode=live");
    expect(line).toContain("apiHost=web-production-6d53b.up.railway.app");
    expect(line).toContain("initDataPresent=true");
    expect(line).not.toMatch(/tma /);
    expect(line).not.toMatch(/BOT_TOKEN/);
    expect(line).not.toMatch(/auth_date=/);
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
    render(<App />);
    expect(await screen.findByTestId("dashboard-greeting")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("browser-preview")).toBeInTheDocument();
    });
  });
});

describe("FinancePage mount → API", () => {
  it("FinancePage mount calls apiClient finance getters (spy)", async () => {
    const apiClientMod = await import("../api/apiClient");
    const summarySpy = vi
      .spyOn(apiClientMod.apiClient, "getFinanceSummary")
      .mockResolvedValue({
        balance: 100,
        incomeMonth: 50,
        expensesMonth: 20,
        currency: "VND",
        period: "month",
        demo: false,
      });
    const txSpy = vi
      .spyOn(apiClientMod.apiClient, "getFinanceTransactions")
      .mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/finance"]}>
        <Routes>
          <Route path="/finance" element={<FinancePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(summarySpy).toHaveBeenCalledWith("month");
      expect(txSpy).toHaveBeenCalledWith("month");
    });

    expect(await screen.findByText("Финансы")).toBeInTheDocument();
    summarySpy.mockRestore();
    txSpy.mockRestore();
  });

  it("FinancePage in live path with realApi issues Railway finance URLs", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      const url = String(input);
      if (url.includes("/summary")) {
        return new Response(
          JSON.stringify({
            data: {
              balance: 1,
              incomeMonth: 1,
              expensesMonth: 1,
              currency: "VND",
              period: "month",
              demo: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const live = createRealApi({
      baseUrl: "https://web-production-6d53b.up.railway.app",
      fetchFn: fetchFn as unknown as typeof fetch,
      getInitData: () => "query_id=1&hash=x",
      initDataRetryMs: 0,
    });

    const apiClientMod = await import("../api/apiClient");
    const summarySpy = vi
      .spyOn(apiClientMod.apiClient, "getFinanceSummary")
      .mockImplementation((period) => live.getFinanceSummary(period));
    const txSpy = vi
      .spyOn(apiClientMod.apiClient, "getFinanceTransactions")
      .mockImplementation((period) => live.getFinanceTransactions(period));

    render(
      <MemoryRouter initialEntries={["/finance"]}>
        <Routes>
          <Route path="/finance" element={<FinancePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(calls).toContain(
      "https://web-production-6d53b.up.railway.app/api/finance/summary?period=month"
    );
    expect(calls).toContain(
      "https://web-production-6d53b.up.railway.app/api/finance/transactions?period=month"
    );
    const firstCall = fetchFn.mock.calls[0] as
      | [RequestInfo | URL, RequestInit?]
      | undefined;
    const auth = (firstCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(auth.Authorization).toBe("tma query_id=1&hash=x");

    summarySpy.mockRestore();
    txSpy.mockRestore();
  });

  it("FinancePage surfaces network error (no silent mock data)", async () => {
    const apiClientMod = await import("../api/apiClient");
    vi.spyOn(apiClientMod.apiClient, "getFinanceSummary").mockRejectedValue(
      new ApiError("network", "Network request failed", { retryable: true })
    );
    vi.spyOn(apiClientMod.apiClient, "getFinanceTransactions").mockRejectedValue(
      new ApiError("network", "Network request failed", { retryable: true })
    );

    render(
      <MemoryRouter initialEntries={["/finance"]}>
        <Routes>
          <Route path="/finance" element={<FinancePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Нет соединения")).toBeInTheDocument();
    expect(screen.queryByText("Демо")).not.toBeInTheDocument();
  });

  it("FinancePage missing initData shows auth-required, not demo fixtures", async () => {
    const apiClientMod = await import("../api/apiClient");
    vi.spyOn(apiClientMod.apiClient, "getFinanceSummary").mockRejectedValue(
      new ApiError("auth_required", "Telegram initData is required", {
        status: 401,
        retryable: false,
      })
    );
    vi.spyOn(apiClientMod.apiClient, "getFinanceTransactions").mockRejectedValue(
      new ApiError("auth_required", "Telegram initData is required", {
        status: 401,
        retryable: false,
      })
    );

    render(
      <MemoryRouter initialEntries={["/finance"]}>
        <Routes>
          <Route path="/finance" element={<FinancePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByTestId("auth-required-state")
    ).toBeInTheDocument();
    expect(screen.getByText("Откройте приложение через Telegram")).toBeInTheDocument();
  });
});
