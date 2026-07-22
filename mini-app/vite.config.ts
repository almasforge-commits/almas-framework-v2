import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiMode = String(env.VITE_ALMAS_API_MODE || "mock")
    .toLowerCase()
    .trim();
  const apiUrl = String(env.VITE_ALMAS_API_URL || "").trim();

  // Fail fast on misconfigured live builds (e.g. Vercel Production without URL).
  if (mode === "production" && apiMode === "live" && !apiUrl) {
    throw new Error(
      "VITE_ALMAS_API_MODE=live requires VITE_ALMAS_API_URL at build time"
    );
  }

  return {
    // Deployed at domain root (https://….vercel.app/), not under /almas.
    base: "/",
    plugins: [react()],
    // Ensure Vite only exposes the intended public prefix (default is VITE_).
    envPrefix: "VITE_",
    server: {
      port: 5173,
      host: true,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      globals: true,
    },
  };
});
