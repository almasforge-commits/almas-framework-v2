import { memo, useMemo } from "react";
import type { DashboardSummary } from "../../api/apiTypes";
import { SectionTitle } from "./SectionTitle";

/**
 * Renders insight lines from backend summary fields only — no client-side totals.
 */
export const WhatsNew = memo(function WhatsNew({
  summary,
}: {
  summary: DashboardSummary;
}) {
  const lines = useMemo(() => {
    return [
      `${summary.inboxToday} новых объектов сегодня`,
      `${summary.activeTasks} активных задач`,
      `${summary.newKnowledge} новых знаний`,
    ];
  }, [summary.inboxToday, summary.activeTasks, summary.newKnowledge]);

  return (
    <section data-testid="dashboard-whats-new" aria-labelledby="whats-new-title">
      <div id="whats-new-title">
        <SectionTitle title="Что нового" />
      </div>
      <ul className="app-card space-y-3">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-sm text-tg-text">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tg-link"
              aria-hidden
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
