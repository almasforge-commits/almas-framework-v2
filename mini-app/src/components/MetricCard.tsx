export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <article className="app-card min-w-0">
      <p className="text-xs text-tg-hint">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-tg-text">{value}</p>
      {hint ? <p className="mt-1 text-xs text-tg-hint">{hint}</p> : null}
    </article>
  );
}
