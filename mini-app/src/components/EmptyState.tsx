export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div
      role="status"
      className="app-card text-center"
      data-testid="empty-state"
    >
      <p className="font-medium text-tg-text">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-tg-hint">{description}</p>
      ) : null}
    </div>
  );
}
