import type { ReactNode } from "react";

export function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="app-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-tg-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
