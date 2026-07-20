import { ErrorState } from "../ErrorState";
import type { ApiErrorUi } from "../../api/apiErrors";

export function DashboardError({
  errorUi,
  onRetry,
}: {
  errorUi: ApiErrorUi;
  onRetry: () => void;
}) {
  return (
    <div className="px-4 pt-2" data-testid="dashboard-error">
      <ErrorState errorUi={errorUi} onRetry={onRetry} />
    </div>
  );
}
