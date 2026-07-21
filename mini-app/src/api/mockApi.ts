import type {
  CaptureAction,
  CaptureSessionDetail,
  FinancePeriod,
  FinanceSummary,
  FinanceTransaction,
  HomePayload,
  IdeaItem,
  InboxItem,
  KnowledgeItem,
  MemoryItem,
  Task,
} from "./apiTypes";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_NOTICE =
  "Данные пока демонстрационные. Подключение к ALMAS API будет следующим этапом.";

export const MOCK_DEMO_NOTICE = DEMO_NOTICE;

const HOME: HomePayload = {
  summary: {
    greetingName: null,
    inboxToday: 4,
    expensesToday: 186_000,
    expensesTodayCurrency: "VND",
    activeTasks: 3,
    newKnowledge: 2,
    statusLabel: "Демо-режим",
  },
  todayActivity: [
    {
      id: "a1",
      kind: "expense",
      title: "Расход 120 000 ₫",
      subtitle: "Кофе и перекус",
      time: "09:40",
    },
    {
      id: "a2",
      kind: "task",
      title: "Позвонить поставщику",
      subtitle: "Задача на сегодня",
      time: "10:15",
    },
    {
      id: "a3",
      kind: "idea",
      title: "Семейный финансовый кабинет",
      subtitle: "Идея",
      time: "11:02",
    },
    {
      id: "a4",
      kind: "knowledge",
      title: "YouTube: монетизация",
      subtitle: "Новое знание",
      time: "12:20",
    },
  ],
  recentTasks: [
    {
      id: "t1",
      title: "Купить батарейки",
      group: "today",
      completed: false,
      dueLabel: "Сегодня",
    },
    {
      id: "t2",
      title: "Проверить баланс Kaspi",
      group: "upcoming",
      completed: false,
      dueLabel: "Завтра",
    },
  ],
  recentKnowledge: [
    {
      id: "k1",
      title: "Монетизация Telegram-ботов",
      sourceType: "youtube",
      summary: "Краткий конспект о подписках и мини-приложениях.",
      tags: ["telegram", "бизнес"],
      createdAt: "2026-07-18",
    },
  ],
  recentActions: [
    {
      id: "ra1",
      kind: "task",
      title: "Задача сохранена",
      subtitle: "AI shadow observation",
      time: "10:16",
    },
    {
      id: "ra2",
      kind: "expense",
      title: "Финансы: расход записан",
      subtitle: "Демо",
      time: "09:41",
    },
  ],
};

const INBOX: InboxItem[] = [
  {
    id: "i1",
    sourceType: "telegram_text",
    originalText:
      "Сегодня заплатил 500 долларов за рекламу и завтра нужно позвонить поставщику.",
    normalizedText:
      "Сегодня заплатил 500 долларов за рекламу и завтра нужно позвонить поставщику.",
    informationKinds: ["finance", "task"],
    status: "analyzed",
    time: "09:12",
    extractedItems: [
      { kind: "finance", content: "реклама 500 USD" },
      { kind: "task", content: "позвонить поставщику" },
    ],
    entities: {
      currencies: ["USD"],
      numbers: ["500"],
      dates: ["завтра"],
    },
    relationships: [
      {
        type: "related_to",
        sourceKind: "finance",
        targetKind: "task",
      },
    ],
    executionSummary: "Shadow: execution not applied (demo).",
  },
  {
    id: "i2",
    sourceType: "telegram_voice",
    originalText: "Идея: сделать семейный финансовый кабинет",
    normalizedText: "Идея: сделать семейный финансовый кабинет",
    informationKinds: ["idea"],
    status: "received",
    time: "08:50",
    extractedItems: [{ kind: "idea", content: "семейный финансовый кабинет" }],
    entities: {},
    relationships: [],
    executionSummary: "Нет исполнения (идея пока не активирована).",
  },
  {
    id: "i3",
    sourceType: "youtube",
    originalText: "https://youtube.com/watch?v=demo",
    normalizedText: "https://youtube.com/watch?v=demo",
    informationKinds: ["knowledge"],
    status: "executed",
    time: "Вчера",
    extractedItems: [{ kind: "knowledge", content: "Монетизация Telegram-ботов" }],
    entities: { urls: ["https://youtube.com/watch?v=demo"] },
    relationships: [],
    executionSummary: "Knowledge saved (demo).",
  },
  {
    id: "i4",
    sourceType: "telegram_text",
    originalText: "вес 82 кг",
    normalizedText: "вес 82 кг",
    informationKinds: ["health"],
    status: "clarification_required",
    time: "Вчера",
    extractedItems: [{ kind: "health", content: "weight 82 kg" }],
    entities: { measurements: ["82 кг"] },
    relationships: [],
    executionSummary: "Health domain not executable yet.",
  },
  {
    id: "i5",
    sourceType: "note",
    originalText: "Проект ALMAS: подключили голос",
    normalizedText: "Проект ALMAS: подключили голос",
    informationKinds: ["project"],
    status: "skipped",
    time: "Пн",
    extractedItems: [{ kind: "project", content: "подключили голос" }],
    entities: {},
    relationships: [],
    executionSummary: "Project storage not enabled.",
  },
  {
    id: "i6",
    sourceType: "telegram_text",
    originalText: "Запомни, что мне нравится работать ночью",
    normalizedText: "Запомни, что мне нравится работать ночью",
    informationKinds: ["memory"],
    status: "partially_executed",
    time: "Пн",
    extractedItems: [{ kind: "memory", content: "нравится работать ночью" }],
    entities: {},
    relationships: [],
    executionSummary: "Memory planned; demo only.",
  },
  {
    id: "i7",
    sourceType: "telegram_text",
    originalText: "???",
    normalizedText: "???",
    informationKinds: ["unknown"],
    status: "failed",
    time: "Вс",
    extractedItems: [],
    entities: {},
    relationships: [],
    executionSummary: "routing_failed (demo).",
  },
];

const TRANSACTIONS: FinanceTransaction[] = [
  {
    id: "f1",
    type: "expense",
    amount: 120_000,
    currency: "VND",
    category: "Кафе",
    description: "Кофе",
    date: "2026-07-20",
  },
  {
    id: "f2",
    type: "expense",
    amount: 66_000,
    currency: "VND",
    category: "Продукты",
    description: "Магазин",
    date: "2026-07-20",
  },
  {
    id: "f3",
    type: "income",
    amount: 5_000_000,
    currency: "VND",
    category: "Зарплата",
    description: "Аванс",
    date: "2026-07-15",
  },
];

let tasksState: Task[] = [
  {
    id: "t1",
    title: "Купить батарейки",
    group: "today",
    completed: false,
    dueLabel: "Сегодня",
  },
  {
    id: "t2",
    title: "Позвонить поставщику",
    group: "today",
    completed: false,
    dueLabel: "Сегодня",
  },
  {
    id: "t3",
    title: "Обновить README мини-приложения",
    group: "upcoming",
    completed: false,
    dueLabel: "Завтра",
  },
  {
    id: "t4",
    title: "Проверить Inbox shadow",
    group: "done",
    completed: true,
    dueLabel: "Выполнено",
  },
];

const KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "k1",
    title: "Монетизация Telegram-ботов",
    sourceType: "youtube",
    summary: "Подписки, мини-приложения и B2B интеграции.",
    tags: ["telegram", "бизнес"],
    createdAt: "2026-07-18",
  },
  {
    id: "k2",
    title: "Заметки по архитектуре Inbox",
    sourceType: "note",
    summary: "Inbox — audit-слой, не исполнитель доменных действий.",
    tags: ["inbox", "архитектура"],
    createdAt: "2026-07-19",
  },
  {
    id: "k3",
    title: "PDF: личный бюджет",
    sourceType: "pdf",
    summary: "Демо-карточка PDF-источника (ингест ещё не подключён).",
    tags: ["finance", "pdf"],
    createdAt: "2026-07-10",
  },
  {
    id: "k4",
    title: "Статья: Mini Apps",
    sourceType: "website",
    summary: "Обзор Telegram Mini Apps UX-паттернов.",
    tags: ["telegram", "ux"],
    createdAt: "2026-07-12",
  },
];

export const mockApi = {
  async getDashboard(greetingName: string | null): Promise<HomePayload> {
    await delay(180);
    return {
      ...HOME,
      summary: { ...HOME.summary, greetingName },
    };
  },

  async getInbox(): Promise<InboxItem[]> {
    await delay(160);
    return INBOX.map((item) => ({ ...item }));
  },

  async getFinanceSummary(period: FinancePeriod): Promise<FinanceSummary> {
    await delay(140);
    const factor = period === "today" ? 0.2 : period === "week" ? 0.55 : 1;
    return {
      balance: 12_450_000,
      incomeMonth: Math.round(5_000_000 * factor),
      expensesMonth: Math.round(1_240_000 * factor),
      currency: "VND",
      period,
      demo: true,
    };
  },

  async getFinanceTransactions(
    _period: FinancePeriod
  ): Promise<FinanceTransaction[]> {
    await delay(140);
    return TRANSACTIONS.map((tx) => ({ ...tx }));
  },

  async getTasks(): Promise<Task[]> {
    await delay(120);
    return tasksState.map((task) => ({ ...task }));
  },

  async patchTask(
    id: string,
    patch: { completed: boolean }
  ): Promise<Task | null> {
    await delay(80);
    tasksState = tasksState.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        completed: patch.completed,
        group: patch.completed ? "done" : task.group === "done" ? "today" : task.group,
        dueLabel: patch.completed ? "Выполнено" : task.dueLabel === "Выполнено" ? "Сегодня" : task.dueLabel,
      };
    });
    return tasksState.find((task) => task.id === id) ?? null;
  },

  async getKnowledge(): Promise<KnowledgeItem[]> {
    await delay(150);
    return KNOWLEDGE.map((item) => ({ ...item }));
  },

  async getMemory(): Promise<MemoryItem[]> {
    await delay(120);
    return [
      {
        id: "m1",
        content: "Мне нравится работать ночью.",
        createdAt: new Date().toISOString(),
        type: "preference",
      },
      {
        id: "m2",
        content: "Мне нравится вьетнамский яичный кофе.",
        createdAt: new Date().toISOString(),
        type: "preference",
      },
    ];
  },

  async getIdeas(_opts?: {
    category?: string | null;
    q?: string | null;
  }): Promise<IdeaItem[]> {
    await delay(120);
    return [
      {
        id: "i1",
        title: "Кофейня во Вьетнаме",
        text: "Открыть небольшую кофейню во Вьетнаме",
        content: "Открыть небольшую кофейню во Вьетнаме",
        category: "business",
        tags: ["vietnam", "coffee"],
        createdAt: new Date().toISOString(),
      },
    ];
  },

  async getIdea(ideaId: string): Promise<IdeaItem> {
    await delay(80);
    const items = await this.getIdeas();
    return (
      items.find((i) => i.id === ideaId) || {
        id: ideaId,
        title: "Идея",
        text: "Демо-идея",
        content: "Демо-идея",
        category: "other",
        tags: [],
        createdAt: new Date().toISOString(),
      }
    );
  },

  async getCaptureSession(sessionId: string): Promise<CaptureSessionDetail> {
    await delay(100);
    return {
      sessionId,
      status: "pending",
      source: "text",
      originalText: "Потратил 50000 на обед и идея открыть кофейню",
      counts: {
        expenses: 1,
        income: 0,
        ideas: 1,
        tasks: 0,
        memory: 0,
        knowledge: 0,
        total: 2,
      },
      actions: [
        {
          type: "finance_expense",
          index: 0,
          payload: { amount: 50000, currency: "VND", description: "обед" },
        },
        {
          type: "idea_create",
          index: 1,
          payload: { content: "открыть кофейню", category: "business" },
        },
      ],
      groups: {
        expenses: [
          {
            type: "finance_expense",
            payload: { amount: 50000, currency: "VND", description: "обед" },
          },
        ],
        income: [],
        ideas: [
          {
            type: "idea_create",
            payload: { content: "открыть кофейню", category: "business" },
          },
        ],
        tasks: [],
        memory: [],
        knowledge: [],
      },
      expiresAt: Date.now() + 600_000,
      createdAt: Date.now(),
    };
  },

  async patchCaptureSession(
    sessionId: string,
    body: { actions: CaptureAction[] }
  ): Promise<CaptureSessionDetail> {
    await delay(80);
    const current = await this.getCaptureSession(sessionId);
    const actions = Array.isArray(body.actions) ? body.actions : [];
    return {
      ...current,
      actions: actions.map((a, index) => ({ ...a, index })),
      counts: {
        ...current.counts,
        total: actions.length,
        expenses: actions.filter((a) => a.type === "finance_expense").length,
        income: actions.filter((a) => a.type === "finance_income").length,
        ideas: actions.filter((a) => a.type === "idea_create").length,
        tasks: actions.filter(
          (a) => a.type === "task_create" || a.type === "reminder"
        ).length,
        memory: actions.filter(
          (a) => a.type === "memory_save" || a.type === "preference"
        ).length,
        knowledge: actions.filter((a) => a.type === "knowledge_candidate")
          .length,
      },
    };
  },

  async confirmCaptureSession(sessionId: string) {
    await delay(80);
    void sessionId;
    return { confirmed: true, reason: "confirmed", executedCount: 2 };
  },

  async cancelCaptureSession(sessionId: string) {
    await delay(40);
    void sessionId;
    return { cancelled: true };
  },

  /** Test helper: reset mutable mock task state. */
  __resetTasksForTests(next?: Task[]) {
    tasksState = (next ?? [
      {
        id: "t1",
        title: "Купить батарейки",
        group: "today",
        completed: false,
        dueLabel: "Сегодня",
      },
      {
        id: "t4",
        title: "Проверить Inbox shadow",
        group: "done",
        completed: true,
        dueLabel: "Выполнено",
      },
    ]).map((task) => ({ ...task }));
  },
};
