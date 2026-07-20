import { Link } from "react-router-dom";
import { DemoNotice } from "../components/DemoNotice";
import { Header } from "../components/Header";

export function PlaceholderPage({
  title,
  icon,
}: {
  title: string;
  icon: string;
}) {
  return (
    <div>
      <Header title={`${icon} ${title}`} subtitle="Раздел готовится" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        <div className="app-card">
          <p className="text-sm text-tg-text">
            Раздел «{title}» пока является заглушкой. Доменная модель и API
            появятся отдельными этапами.
          </p>
          <Link
            to="/more"
            className="mt-4 inline-flex tap-target items-center rounded-xl bg-tg-button px-4 py-2 text-sm font-medium text-tg-button-text"
          >
            Назад к «Ещё»
          </Link>
        </div>
      </div>
    </div>
  );
}
