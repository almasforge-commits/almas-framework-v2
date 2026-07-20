import { mockApi } from "./mockApi";
import type {
  FinancePeriod,
  FinanceSummary,
  FinanceTransaction,
  HomePayload,
  InboxItem,
  KnowledgeItem,
  Task,
} from "./apiTypes";

/**
 * ALMAS Mini App API boundary.
 *
 * Future production client must:
 * - call ALMAS backend HTTPS endpoints (not privileged Supabase from the browser);
 * - send Telegram WebApp `initData` (raw signed string) for server-side validation;
 * - never treat `initDataUnsafe` as authenticated identity.
 *
 * Current implementation delegates to mockApi only.
 */
export interface AlmasApiClient {
  getDashboard(greetingName: string | null): Promise<HomePayload>;
  getInbox(): Promise<InboxItem[]>;
  getFinanceSummary(period: FinancePeriod): Promise<FinanceSummary>;
  getFinanceTransactions(period: FinancePeriod): Promise<FinanceTransaction[]>;
  getTasks(): Promise<Task[]>;
  patchTask(id: string, patch: { completed: boolean }): Promise<Task | null>;
  getKnowledge(): Promise<KnowledgeItem[]>;
}

export const apiClient: AlmasApiClient = {
  getDashboard: (greetingName) => mockApi.getDashboard(greetingName),
  getInbox: () => mockApi.getInbox(),
  getFinanceSummary: (period) => mockApi.getFinanceSummary(period),
  getFinanceTransactions: (period) => mockApi.getFinanceTransactions(period),
  getTasks: () => mockApi.getTasks(),
  patchTask: (id, patch) => mockApi.patchTask(id, patch),
  getKnowledge: () => mockApi.getKnowledge(),
};

/** Planned backend routes (not called yet). */
export const FUTURE_API_ROUTES = {
  dashboard: "GET /api/dashboard",
  inbox: "GET /api/inbox",
  financeSummary: "GET /api/finance/summary",
  financeTransactions: "GET /api/finance/transactions",
  tasks: "GET /api/tasks",
  patchTask: "PATCH /api/tasks/:id",
  knowledge: "GET /api/knowledge",
} as const;
