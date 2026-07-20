export type ApiMode = "mock" | "live";

/**
 * Mini App runtime config from Vite env.
 * Defaults: mode=mock. Never reads backend secrets or privileged storage keys.
 */
export function getApiMode(
  env: ImportMetaEnv = import.meta.env
): ApiMode {
  const raw = String(env.VITE_ALMAS_API_MODE || "mock").toLowerCase().trim();
  return raw === "live" ? "live" : "mock";
}

export function getApiBaseUrl(
  env: ImportMetaEnv = import.meta.env
): string {
  const raw = String(env.VITE_ALMAS_API_URL || "").trim().replace(/\/+$/, "");
  return raw;
}

export function isMockMode(env: ImportMetaEnv = import.meta.env): boolean {
  return getApiMode(env) === "mock";
}
