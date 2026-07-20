import type { ApiErrorUi } from "../api/apiErrors";

export function ErrorState({
  title = "Не удалось загрузить данные",
  description,
  onRetry,
  errorUi,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** Prefer mapped API error UI when available. */
  errorUi?: ApiErrorUi | null;
}) {
  const resolvedTitle = errorUi?.title ?? title;
  const resolvedDescription = errorUi?.description ?? description;
  const retryable = errorUi ? errorUi.retryable : Boolean(onRetry);
  const testId =
    errorUi?.code === "auth_required" || errorUi?.code === "unauthorized"
      ? "auth-required-state"
      : "error-state";

  return (
    <div role="alert" className="app-card" data-testid={testId}>
      <p className="font-medium text-tg-text">{resolvedTitle}</p>
      {resolvedDescription ? (
        <p className="mt-1 text-sm text-tg-hint">{resolvedDescription}</p>
      ) : null}
      {retryable && onRetry ? (
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
