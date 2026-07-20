import { Link } from "react-router-dom";
import { MORE_LINKS } from "../app/navigation";
import { DemoNotice } from "../components/DemoNotice";
import { Header } from "../components/Header";

export function MorePage() {
  return (
    <div>
      <Header title="Ещё" subtitle="Разделы ALMAS" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        <ul className="grid grid-cols-2 gap-3">
          {MORE_LINKS.map((link) => (
            <li key={link.path}>
              <Link
                to={link.path}
                className="app-card tap-target flex min-h-[5.5rem] flex-col justify-between"
              >
                <span aria-hidden className="text-2xl">
                  {link.icon}
                </span>
                <span className="text-sm font-semibold">{link.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
