export function ErrorState({
  title = "Не удалось загрузить данные",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="app-card"
      data-testid="error-state"
    >
      <p className="font-medium text-tg-text">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-tg-hint">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="tap-target mt-3 rounded-xl bg-tg-button px-4 py-2 text-sm font-medium text-tg-button-text"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}
