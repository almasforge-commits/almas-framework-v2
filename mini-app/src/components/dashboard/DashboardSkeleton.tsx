export function DashboardSkeleton() {
  return (
    <div
      className="space-y-5 px-4 pt-2"
      data-testid="dashboard-skeleton"
      aria-busy="true"
      aria-label="Загрузка дашборда"
    >
      <div className="space-y-2">
        <div className="skeleton-block h-7 w-48" />
        <div className="skeleton-block h-4 w-36" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="app-card min-h-[7.5rem] space-y-3">
            <div className="skeleton-block h-10 w-10 rounded-xl" />
            <div className="skeleton-block h-3 w-20" />
            <div className="skeleton-block h-6 w-24" />
            <div className="skeleton-block h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="skeleton-block h-4 w-32" />
        <div className="app-card space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <div className="skeleton-block h-9 w-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton-block h-4 w-[75%]" />
                <div className="skeleton-block h-3 w-[50%]" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="skeleton-block h-4 w-28" />
        <div className="app-card space-y-3">
          <div className="skeleton-block h-4 w-full" />
          <div className="skeleton-block h-4 w-[85%]" />
          <div className="skeleton-block h-4 w-[65%]" />
        </div>
      </div>
    </div>
  );
}
