import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { InboxPage } from "../pages/InboxPage";
import { FinancePage } from "../pages/FinancePage";
import { TasksPage } from "../pages/TasksPage";
import { MorePage } from "../pages/MorePage";
import { KnowledgePage } from "../pages/KnowledgePage";
import { PlaceholderPage } from "../pages/PlaceholderPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/finance" element={<FinancePage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route
        path="/ideas"
        element={<PlaceholderPage title="Идеи" icon="💡" />}
      />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
