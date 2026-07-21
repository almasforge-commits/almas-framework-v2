import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { InboxPage } from "../pages/InboxPage";
import { FinancePage } from "../pages/FinancePage";
import { TasksPage } from "../pages/TasksPage";
import { MorePage } from "../pages/MorePage";
import { KnowledgePage } from "../pages/KnowledgePage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { CaptureSessionPage } from "../pages/CaptureSessionPage";
import { MemoryPage } from "../pages/MemoryPage";
import { IdeasPage } from "../pages/IdeasPage";

/** Strip legacy /almas prefix used by older Telegram deep links. */
function LegacyAlmasRedirect() {
  const params = useParams();
  const rest = params["*"] ? `/${params["*"]}` : "/";
  return <Navigate to={rest} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/finance" element={<FinancePage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route path="/memory" element={<MemoryPage />} />
      <Route path="/ideas" element={<IdeasPage />} />
      <Route path="/ideas/:ideaId" element={<IdeasPage />} />
      <Route path="/capture/:sessionId" element={<CaptureSessionPage />} />
      <Route
        path="/projects"
        element={<PlaceholderPage title="Проекты" icon="🚀" />}
      />
      <Route
        path="/health"
        element={<PlaceholderPage title="Здоровье" icon="❤️" />}
      />
      <Route
        path="/investments"
        element={<PlaceholderPage title="Инвестиции" icon="📈" />}
      />
      <Route
        path="/news"
        element={<PlaceholderPage title="Новости" icon="📰" />}
      />
      <Route
        path="/settings"
        element={<PlaceholderPage title="Настройки" icon="⚙️" />}
      />
      {/* Temporary compat for Telegram buttons generated before root migration */}
      <Route path="/almas" element={<Navigate to="/" replace />} />
      <Route path="/almas/*" element={<LegacyAlmasRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
