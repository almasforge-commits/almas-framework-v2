import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AppRoutes } from "./app/routes";
import { TelegramProvider } from "./telegram/TelegramProvider";

export default function App() {
  return (
    <TelegramProvider>
      <BrowserRouter>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </BrowserRouter>
    </TelegramProvider>
  );
}
