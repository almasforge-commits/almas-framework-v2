import { NavLink } from "react-router-dom";
import { PRIMARY_TABS } from "../app/navigation";

export function BottomNavigation() {
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-tg-bg/95 pb-safe-b backdrop-blur"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 px-1 pt-1">
        {PRIMARY_TABS.map((tab) => (
          <li key={tab.path}>
            <NavLink
              to={tab.path}
              end={tab.path === "/"}
              aria-label={tab.ariaLabel}
              className={({ isActive }) =>
                [
                  "tap-target flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-medium",
                  isActive ? "text-tg-link" : "text-tg-hint",
                ].join(" ")
              }
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
