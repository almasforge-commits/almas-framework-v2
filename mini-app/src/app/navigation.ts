export type AppRoute =
  | "/"
  | "/inbox"
  | "/finance"
  | "/tasks"
  | "/more"
  | "/knowledge"
  | "/ideas"
  | "/projects"
  | "/health"
  | "/investments"
  | "/news"
  | "/settings";

export const PRIMARY_TABS = [
  { path: "/" as const, label: "Главная", icon: "🏠", ariaLabel: "Главная" },
  { path: "/inbox" as const, label: "Inbox", icon: "📥", ariaLabel: "Inbox" },
  {
    path: "/finance" as const,
    label: "Финансы",
    icon: "💰",
    ariaLabel: "Финансы",
  },
  { path: "/tasks" as const, label: "Задачи", icon: "📋", ariaLabel: "Задачи" },
  { path: "/more" as const, label: "Ещё", icon: "☰", ariaLabel: "Ещё" },
];

export const MORE_LINKS = [
  { path: "/knowledge" as const, title: "Знания", icon: "📚" },
  { path: "/ideas" as const, title: "Идеи", icon: "💡" },
  { path: "/projects" as const, title: "Проекты", icon: "🚀" },
  { path: "/health" as const, title: "Здоровье", icon: "❤️" },
  { path: "/investments" as const, title: "Инвестиции", icon: "📈" },
  { path: "/news" as const, title: "Новости", icon: "📰" },
  { path: "/settings" as const, title: "Настройки", icon: "⚙️" },
];

export function normalizePath(pathname: string): AppRoute {
  const known: AppRoute[] = [
    "/",
    "/inbox",
    "/finance",
    "/tasks",
    "/more",
    "/knowledge",
    "/ideas",
    "/projects",
    "/health",
    "/investments",
    "/news",
    "/settings",
  ];
  return (known.includes(pathname as AppRoute) ? pathname : "/") as AppRoute;
}

export function isPrimaryTab(pathname: string): boolean {
  return PRIMARY_TABS.some((tab) => tab.path === pathname);
}
