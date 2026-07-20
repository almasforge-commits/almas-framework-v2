import type { ReactNode } from "react";

export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-black/5 bg-tg-bg/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-tg-text">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-tg-hint">{subtitle}</p>
          ) : null}
        </div>
        {right}
      </div>
    </header>
  );
}
