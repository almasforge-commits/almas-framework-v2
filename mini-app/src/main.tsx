import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getApiBaseUrl, getApiMode } from "./config/env";
import "./styles/globals.css";

// Non-secret diagnostics only — never log initData or tokens.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  console.info(
    `[mini-app] apiMode=${getApiMode()} apiUrl=${getApiBaseUrl() ? "set" : "unset"}`
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
