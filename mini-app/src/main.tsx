import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { logApiDiag } from "./api/apiDiagnostics";
import { getApiHost, getApiMode } from "./config/env";
import { getRawInitData } from "./telegram/initData";
import "./styles/globals.css";

// Production-safe boot log (no initData / tokens). Visible in Telegram WebView consoles.
logApiDiag({
  apiMode: getApiMode(),
  apiHost: getApiHost(),
  initDataPresent: Boolean(getRawInitData()),
  endpoint: null,
  fetchAttempted: false,
  responseStatus: null,
  errorCategory: null,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
