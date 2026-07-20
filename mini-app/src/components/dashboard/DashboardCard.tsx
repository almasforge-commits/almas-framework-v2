import { memo } from "react";
import { Link } from "react-router-dom";

export interface DashboardCardProps {
  icon: string;
  title: string;
  value: string;
  subtitle: string;
  to?: string;
  ariaLabel?: string;
}

export const DashboardCard = memo(function DashboardCard({
  icon,
  title,
  value,
  subtitle,
  to,
  ariaLabel,
}: DashboardCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-tg-bg text-lg"
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs font-medium text-tg-hint">{title}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums text-tg-text">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] leading-snug text-tg-hint">
        {subtitle}
      </p>
    </>
  );

  const className =
    "dashboard-card app-card block min-h-[7.5rem] w-full text-left transition-transform duration-200 ease-out active:scale-[0.97]";

  if (to) {
    return (
      <Link to={to} className={className} aria-label={ariaLabel ?? title}>
        {content}
      </Link>
    );
  }

  return (
    <article className={className} aria-label={ariaLabel ?? title}>
      {content}
    </article>
  );
});
