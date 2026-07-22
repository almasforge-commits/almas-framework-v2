import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { logLaunchDiagnostics } from "./api/apiDiagnostics";
import { initTelegramWebApp } from "./telegram/telegramWebApp";
import "./styles/globals.css";

// Initialize Telegram bridge before first auth evaluation / diagnostics.
initTelegramWebApp();
logLaunchDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
