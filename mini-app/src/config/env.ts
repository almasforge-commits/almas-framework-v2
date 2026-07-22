export type ApiMode = "mock" | "live";

/**
 * Build-time Vite env for ALMAS API.
 *
 * IMPORTANT: property access MUST stay as static `import.meta.env.VITE_*`
 * identifiers so Vite inlines them into the production bundle. Do not rename
 * these keys; do not read them only via dynamic bracket access.
 *
 * Defaults: mode=mock when unset/invalid. Never reads backend secrets.
 */
function readBuildEnv(): Pick<
  ImportMetaEnv,
  "VITE_ALMAS_API_MODE" | "VITE_ALMAS_API_URL"
> {
  return {
    VITE_ALMAS_API_MODE: import.meta.env.VITE_ALMAS_API_MODE,
    VITE_ALMAS_API_URL: import.meta.env.VITE_ALMAS_API_URL,
  };
}

export function getApiMode(
  env: Pick<ImportMetaEnv, "VITE_ALMAS_API_MODE"> = readBuildEnv()
): ApiMode {
  const raw = String(env.VITE_ALMAS_API_MODE || "mock")
    .toLowerCase()
    .trim();
  return raw === "live" ? "live" : "mock";
}

export function getApiBaseUrl(
  env: Pick<ImportMetaEnv, "VITE_ALMAS_API_URL"> = readBuildEnv()
): string {
  const raw = String(env.VITE_ALMAS_API_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return raw;
}

export function isMockMode(
  env: Pick<ImportMetaEnv, "VITE_ALMAS_API_MODE"> = readBuildEnv()
): boolean {
  return getApiMode(env) === "mock";
}

/** Hostname only — safe for logs / diagnostics (no secrets). */
export function getApiHost(
  env: Pick<ImportMetaEnv, "VITE_ALMAS_API_URL"> = readBuildEnv()
): string | null {
  const base = getApiBaseUrl(env);
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

/**
 * Join API origin + absolute path (`/api/...`).
 * Rejects relative-only bases that would hit the Vercel origin by mistake.
 */
export function joinApiUrl(baseUrl: string, path: string): string {
  const base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    throw new Error("API URL is not configured");
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("API URL must include http(s) protocol");
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
