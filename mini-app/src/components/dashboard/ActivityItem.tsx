import { memo } from "react";
import type { ActivityItem, ActivityKind } from "../../api/apiTypes";

const KIND_ICON: Record<ActivityKind, string> = {
  expense: "💸",
  income: "💵",
  task: "✅",
  idea: "💡",
  knowledge: "📚",
};

const KIND_BADGE: Record<ActivityKind, string> = {
  expense: "Финансы",
  income: "Финансы",
  task: "Задача",
  idea: "Идея",
  knowledge: "Знание",
};

export const ActivityItemView = memo(function ActivityItemView({
  item,
}: {
  item: ActivityItem;
}) {
  const badge = KIND_BADGE[item.kind] ?? item.kind;
  const subtitle = String(item.subtitle || "").trim();
  // Avoid "Финансы Финансы" / "Идея Идея" double labels.
  const showSubtitle =
    Boolean(subtitle) &&
    subtitle.toLowerCase() !== badge.toLowerCase() &&
    subtitle.toLowerCase() !== String(item.kind).toLowerCase();

  return (
    <li className="dashboard-activity flex min-h-11 items-start gap-3 rounded-xl px-1 py-2 transition-colors duration-200">
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tg-bg text-base"
        aria-hidden
      >
        {KIND_ICON[item.kind] ?? "•"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-tg-text">{item.title}</p>
          <time className="shrink-0 text-xs tabular-nums text-tg-hint">
            {item.time || "—"}
          </time>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-md bg-tg-bg px-1.5 py-0.5 text-[10px] font-medium text-tg-hint">
            {badge}
          </span>
          {showSubtitle ? (
            <span className="truncate text-xs text-tg-hint">{subtitle}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
});
