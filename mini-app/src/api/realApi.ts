import type { AlmasApiClient } from "./apiTypes";
import type {
  FinancePeriod,
  FinanceSummary,
  FinanceTransaction,
  HomePayload,
  InboxItem,
  KnowledgeItem,
  Task,
} from "./apiTypes";
import { ApiError } from "./apiErrors";
import { liveGetJson, type LiveHttpDeps } from "./liveHttp";
import { getApiBaseUrl } from "../config/env";

function assertArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new ApiError("malformed", `Invalid ${label} payload`, {
      retryable: true,
    });
  }
  return value as T[];
}

/**
 * Live read-only API client. No PATCH/POST/writes.
 */
export function createRealApi(deps: Partial<LiveHttpDeps> = {}): AlmasApiClient {
  const httpDeps: LiveHttpDeps = {
    baseUrl: deps.baseUrl ?? getApiBaseUrl(),
    fetchFn: deps.fetchFn,
    getInitData: deps.getInitData,
  };

  return {
    async getDashboard(_greetingName: string | null): Promise<HomePayload> {
      return liveGetJson<HomePayload>("/api/dashboard", httpDeps);
    },

    async getInbox(): Promise<InboxItem[]> {
      const data = await liveGetJson<InboxItem[]>("/api/inbox", httpDeps);
      return assertArray<InboxItem>(data, "inbox");
    },

    async getFinanceSummary(period: FinancePeriod): Promise<FinanceSummary> {
      return liveGetJson<FinanceSummary>(
        `/api/finance/summary?period=${encodeURIComponent(period)}`,
        httpDeps
      );
    },

    async getFinanceTransactions(
      period: FinancePeriod
    ): Promise<FinanceTransaction[]> {
      const data = await liveGetJson<FinanceTransaction[]>(
        `/api/finance/transactions?period=${encodeURIComponent(period)}`,
        httpDeps
      );
      return assertArray<FinanceTransaction>(data, "transactions");
    },

    async getTasks(): Promise<Task[]> {
      const data = await liveGetJson<Task[]>("/api/tasks", httpDeps);
      return assertArray<Task>(data, "tasks");
    },

    /** Local-only no-op — live API is read-only (no PATCH). */
    async patchTask(): Promise<Task | null> {
      return null;
    },

    async getKnowledge(): Promise<KnowledgeItem[]> {
      const data = await liveGetJson<KnowledgeItem[]>(
        "/api/knowledge",
        httpDeps
      );
      return assertArray<KnowledgeItem>(data, "knowledge");
    },
  };
}

export const realApi = createRealApi();
