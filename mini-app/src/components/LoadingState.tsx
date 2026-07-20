export function LoadingState({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="app-card text-sm text-tg-hint"
      data-testid="loading-state"
    >
      {label}
    </div>
  );
}
