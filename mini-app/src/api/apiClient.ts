import type { AlmasApiClient } from "./apiTypes";
import { mockApi } from "./mockApi";
import { createRealApi } from "./realApi";
import { getApiMode, type ApiMode } from "../config/env";
import { logApiDiag } from "./apiDiagnostics";

export type { AlmasApiClient };

const mockClient: AlmasApiClient = {
  getDashboard: (greetingName) => mockApi.getDashboard(greetingName),
  getInbox: () => mockApi.getInbox(),
  getFinanceSummary: (period) => mockApi.getFinanceSummary(period),
  getFinanceTransactions: (period) => mockApi.getFinanceTransactions(period),
  getFinanceSettings: () => mockApi.getFinanceSettings(),
  getTasks: () => mockApi.getTasks(),
  patchTask: (id, patch) => mockApi.patchTask(id, patch),
  getKnowledge: () => mockApi.getKnowledge(),
  getMemory: () => mockApi.getMemory(),
  getIdeas: (opts) => mockApi.getIdeas(opts),
  getIdea: (ideaId) => mockApi.getIdea(ideaId),
  getCaptureSession: (sessionId) => mockApi.getCaptureSession(sessionId),
  patchCaptureSession: (sessionId, body) =>
    mockApi.patchCaptureSession(sessionId, body),
  confirmCaptureSession: (sessionId) => mockApi.confirmCaptureSession(sessionId),
  cancelCaptureSession: (sessionId) => mockApi.cancelCaptureSession(sessionId),
};

export function resolveApiClient(mode: ApiMode = getApiMode()): AlmasApiClient {
  // Explicit only: live → realApi; anything else (including unset) → mock.
  // No silent production override — missing VITE_ALMAS_API_MODE means mock.
  return mode === "live" ? createRealApi() : mockClient;
}

export const apiClientMode: ApiMode = getApiMode();
export const apiClient: AlmasApiClient = resolveApiClient(apiClientMode);

/** Which implementation the singleton selected (for tests / diagnostics). */
export function getResolvedClientKind(
  mode: ApiMode = apiClientMode
): "real" | "mock" {
  return mode === "live" ? "real" : "mock";
}

export const API_ROUTES = {
  dashboard: "GET /api/dashboard",
  inbox: "GET /api/inbox",
  financeSummary: "GET /api/finance/summary",
  financeTransactions: "GET /api/finance/transactions",
  tasks: "GET /api/tasks",
  knowledge: "GET /api/knowledge",
  memory: "GET /api/memory",
  capture: "GET /api/capture/:sessionId",
  ideas: "GET /api/ideas",
} as const;

// Boot diagnostic once (safe in production; no secrets).
logApiDiag({
  apiMode: apiClientMode,
});
