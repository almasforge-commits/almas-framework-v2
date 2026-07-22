import type { AlmasApiClient } from "./apiTypes";
import type {
  CaptureAction,
  CaptureConfirmResult,
  CaptureSessionDetail,
  FinancePeriod,
  FinanceSettings,
  FinanceSummary,
  FinanceTransaction,
  HomePayload,
  IdeaItem,
  InboxItem,
  KnowledgeItem,
  MemoryItem,
  Task,
} from "./apiTypes";
import { ApiError } from "./apiErrors";
import { liveGetJson, liveSendJson, type LiveHttpDeps } from "./liveHttp";
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
 * Live API client. Capture review supports PATCH/POST; other domains stay GET.
 */
export function createRealApi(deps: Partial<LiveHttpDeps> = {}): AlmasApiClient {
  const httpDeps: LiveHttpDeps = {
    baseUrl: deps.baseUrl ?? getApiBaseUrl(),
    fetchFn: deps.fetchFn,
    getInitData: deps.getInitData,
    initDataRetryMs: deps.initDataRetryMs,
    initDataAttempts: deps.initDataAttempts,
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

    async getFinanceSettings(): Promise<FinanceSettings> {
      return liveGetJson<FinanceSettings>("/api/finance/settings", httpDeps);
    },

    async getTasks(): Promise<Task[]> {
      const data = await liveGetJson<Task[]>("/api/tasks", httpDeps);
      return assertArray<Task>(data, "tasks");
    },

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

    async getMemory(): Promise<MemoryItem[]> {
      const data = await liveGetJson<MemoryItem[]>("/api/memory", httpDeps);
      return assertArray<MemoryItem>(data, "memory");
    },

    async getIdeas(opts: { category?: string | null; q?: string | null } = {}): Promise<IdeaItem[]> {
      const params = new URLSearchParams();
      if (opts.category) params.set("category", opts.category);
      if (opts.q) params.set("q", opts.q);
      const qs = params.toString();
      const data = await liveGetJson<IdeaItem[]>(
        `/api/ideas${qs ? `?${qs}` : ""}`,
        httpDeps
      );
      return assertArray<IdeaItem>(data, "ideas");
    },

    async getIdea(ideaId: string): Promise<IdeaItem> {
      return liveGetJson<IdeaItem>(
        `/api/ideas/${encodeURIComponent(ideaId)}`,
        httpDeps
      );
    },

    async getCaptureSession(sessionId: string): Promise<CaptureSessionDetail> {
      return liveGetJson<CaptureSessionDetail>(
        `/api/capture/${encodeURIComponent(sessionId)}`,
        httpDeps
      );
    },

    async patchCaptureSession(
      sessionId: string,
      body: { actions: CaptureAction[] }
    ): Promise<CaptureSessionDetail> {
      return liveSendJson<CaptureSessionDetail>(
        `/api/capture/${encodeURIComponent(sessionId)}`,
        "PATCH",
        body,
        httpDeps
      );
    },

    async confirmCaptureSession(
      sessionId: string
    ): Promise<CaptureConfirmResult> {
      return liveSendJson<CaptureConfirmResult>(
        `/api/capture/${encodeURIComponent(sessionId)}/confirm`,
        "POST",
        {},
        httpDeps
      );
    },

    async cancelCaptureSession(
      sessionId: string
    ): Promise<{ cancelled: boolean }> {
      return liveSendJson<{ cancelled: boolean }>(
        `/api/capture/${encodeURIComponent(sessionId)}/cancel`,
        "POST",
        {},
        httpDeps
      );
    },
  };
}

export const realApi = createRealApi();
