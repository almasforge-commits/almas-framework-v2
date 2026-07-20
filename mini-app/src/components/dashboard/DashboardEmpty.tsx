export function DashboardEmpty() {
  return (
    <div
      className="app-card flex flex-col items-center px-4 py-10 text-center"
      data-testid="dashboard-empty"
      role="status"
    >
      <span
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-tg-bg text-3xl"
        aria-hidden
      >
        🌱
      </span>
      <h2 className="mt-4 text-base font-semibold text-tg-text">Пока тихо</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-tg-hint">
        Здесь появится картина дня: расходы, задачи, знания и события. Напишите
        боту первое сообщение — и дашборд оживёт.
      </p>
    </div>
  );
}
