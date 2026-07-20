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

export interface FinanceSummary {
  balance: number;
  incomeMonth: number;
  expensesMonth: number;
  currency: string;
  period: FinancePeriod;
  demo: true;
}

export type FinancePeriod = "today" | "week" | "month";

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

export interface HomePayload {
  summary: DashboardSummary;
  todayActivity: ActivityItem[];
  recentTasks: Task[];
  recentKnowledge: KnowledgeItem[];
  recentActions: ActivityItem[];
}

export type { TelegramUser };
