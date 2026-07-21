import type { TelegramUser } from "../telegram/telegramTypes";

export type InboxStatus =
  | "received"
  | "normalized"
  | "analyzed"
  | "executed"
  | "partially_executed"
  | "clarification_required"
  | "failed"
  | "skipped";

export type InformationKind =
  | "finance"
  | "task"
  | "memory"
  | "idea"
  | "health"
  | "knowledge"
  | "project"
  | "investment"
  | "news"
  | "unknown";

export type ActivityKind = "expense" | "task" | "idea" | "knowledge";

export interface DashboardSummary {
  greetingName: string | null;
  inboxToday: number;
  expensesToday: number;
  expensesTodayCurrency: string;
  activeTasks: number;
  newKnowledge: number;
  statusLabel: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  subtitle: string;
  time: string;
}

export interface InboxItem {
  id: string;
  sourceType: "telegram_text" | "telegram_voice" | "youtube" | "note";
  originalText: string;
  normalizedText: string;
  informationKinds: InformationKind[];
  status: InboxStatus;
  time: string;
  extractedItems: Array<{ kind: string; content: string }>;
  entities: Record<string, string[]>;
  relationships: Array<{
    type: string;
    sourceKind: string;
    targetKind: string;
  }>;
  executionSummary: string;
}

export type FinancePeriod = "today" | "week" | "month";

export interface FinanceSummary {
  balance: number;
  incomeMonth: number;
  expensesMonth: number;
  currency: string;
  period: FinancePeriod;
  demo: boolean;
}

export interface FinanceTransaction {
  id: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  category: string;
  description: string;
  date: string;
}

export interface Task {
  id: string;
  title: string;
  group: "today" | "upcoming" | "done";
  completed: boolean;
  dueLabel: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  sourceType: "youtube" | "pdf" | "note" | "website";
  summary: string;
  tags: string[];
  createdAt: string;
}

export interface MemoryItem {
  id: string | null;
  content: string;
  createdAt: string | null;
  type: string | null;
}

export interface IdeaItem {
  id: string | null;
  title: string | null;
  text: string;
  content: string;
  category: string | null;
  tags: string[];
  createdAt: string | null;
}

export interface CaptureAction {
  type: string;
  confidence?: number;
  payload?: Record<string, unknown>;
  requiresConfirmation?: boolean;
  index?: number;
  content?: string;
}

export interface CaptureSessionDetail {
  sessionId: string | null;
  status: string | null;
  source: string | null;
  originalText: string;
  counts: {
    expenses: number;
    income: number;
    ideas: number;
    tasks: number;
    memory: number;
    knowledge: number;
    total: number;
  };
  actions: CaptureAction[];
  groups: {
    expenses: CaptureAction[];
    income: CaptureAction[];
    ideas: CaptureAction[];
    tasks: CaptureAction[];
    memory: CaptureAction[];
    knowledge: CaptureAction[];
  };
  expiresAt: number | null;
  createdAt: number | null;
}

export interface CaptureConfirmResult {
  confirmed: boolean;
  reason: string;
  executedCount: number;
}

export interface HomePayload {
  summary: DashboardSummary;
  todayActivity: ActivityItem[];
  recentTasks: Task[];
  recentKnowledge: KnowledgeItem[];
  recentActions: ActivityItem[];
}

export interface AlmasApiClient {
  getDashboard(greetingName: string | null): Promise<HomePayload>;
  getInbox(): Promise<InboxItem[]>;
  getFinanceSummary(period: FinancePeriod): Promise<FinanceSummary>;
  getFinanceTransactions(period: FinancePeriod): Promise<FinanceTransaction[]>;
  getTasks(): Promise<Task[]>;
  patchTask(id: string, patch: { completed: boolean }): Promise<Task | null>;
  getKnowledge(): Promise<KnowledgeItem[]>;
  getMemory(): Promise<MemoryItem[]>;
  getIdeas(opts?: { category?: string | null; q?: string | null }): Promise<IdeaItem[]>;
  getIdea(ideaId: string): Promise<IdeaItem>;
  getCaptureSession(sessionId: string): Promise<CaptureSessionDetail>;
  patchCaptureSession(
    sessionId: string,
    body: { actions: CaptureAction[] }
  ): Promise<CaptureSessionDetail>;
  confirmCaptureSession(sessionId: string): Promise<CaptureConfirmResult>;
  cancelCaptureSession(sessionId: string): Promise<{ cancelled: boolean }>;
}

export type { TelegramUser };
