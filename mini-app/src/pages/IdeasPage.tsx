import { Link, useParams } from "react-router-dom";
import { Header } from "../components/Header";
import { DemoNotice } from "../components/DemoNotice";

/**
 * Ideas list/detail shell — full Ideas UI lands in a later stage.
 * Deep links /ideas and /ideas/:id are wired now.
 */
export function IdeasPage() {
  const { ideaId } = useParams();
  return (
    <div>
      <Header
        title="Идеи"
        subtitle={ideaId ? `Идея ${ideaId.slice(0, 8)}…` : "Список и поиск"}
      />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        <div className="app-card space-y-2">
          <p className="text-sm text-tg-text">
            {ideaId
              ? "Карточка идеи готовится. API уже доступен: GET /api/ideas/:id."
              : "Список идей готовится. API уже доступен: GET /api/ideas."}
          </p>
          <p className="text-xs text-tg-hint">
            Сохраняйте идеи через Telegram — детали и правки откроются здесь.
          </p>
          <Link
            to="/more"
            className="mt-2 inline-flex tap-target items-center rounded-xl bg-tg-button px-4 py-2 text-sm font-medium text-tg-button-text"
          >
            Назад
          </Link>
        </div>
      </div>
    </div>
  );
}
