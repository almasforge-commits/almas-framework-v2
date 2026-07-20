import type { ReactNode } from "react";
import { BottomNavigation } from "./BottomNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col bg-tg-bg text-tg-text">
      <main className="flex-1 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>
      <BottomNavigation />
    </div>
  );
}
