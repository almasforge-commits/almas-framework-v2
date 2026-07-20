import type { AlmasApiClient } from "./apiTypes";
import { mockApi } from "./mockApi";
import { createRealApi } from "./realApi";
import { getApiMode, type ApiMode } from "../config/env";

export type { AlmasApiClient };

const mockClient: AlmasApiClient = {
  getDashboard: (greetingName) => mockApi.getDashboard(greetingName),
  getInbox: () => mockApi.getInbox(),
  getFinanceSummary: (period) => mockApi.getFinanceSummary(period),
  getFinanceTransactions: (period) => mockApi.getFinanceTransactions(period),
  getTasks: () => mockApi.getTasks(),
  patchTask: (id, patch) => mockApi.patchTask(id, patch),
  getKnowledge: () => mockApi.getKnowledge(),
};

export function resolveApiClient(mode: ApiMode = getApiMode()): AlmasApiClient {
  return mode === "live" ? createRealApi() : mockClient;
}

export const apiClient: AlmasApiClient = resolveApiClient();

export const API_ROUTES = {
  dashboard: "GET /api/dashboard",
  inbox: "GET /api/inbox",
  financeSummary: "GET /api/finance/summary",
  financeTransactions: "GET /api/finance/transactions",
  tasks: "GET /api/tasks",
  knowledge: "GET /api/knowledge",
} as const;
