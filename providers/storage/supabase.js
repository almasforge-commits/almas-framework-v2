import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Package-local .env (Code/telegram-bot/.env). Railway injects process.env
// directly — dotenv never overrides existing values by default.
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

/**
 * Canonical server-side Supabase env names (exact).
 * Do not invent aliases (SUPABASE_KEY, SERVICE_ROLE, NEXT_PUBLIC_*, etc.).
 */
export const SUPABASE_ENV = Object.freeze({
  url: "SUPABASE_URL",
  anonKey: "SUPABASE_ANON_KEY",
});

let realClient = null;
let lastCreateError = null;

/**
 * Safe config snapshot — booleans only, never values.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getSupabaseEnvStatus(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const key = String(env.SUPABASE_ANON_KEY || "").trim();
  return {
    urlPresent: Boolean(url),
    keyPresent: Boolean(key),
    clientCreated: Boolean(realClient),
    createErrorCode: lastCreateError,
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, url: string, key: string } | { ok: false, code: string }}
 */
export function readSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const key = String(env.SUPABASE_ANON_KEY || "").trim();
  if (!url && !key) {
    return { ok: false, code: "missing_supabase_config" };
  }
  if (!url || !key) {
    return { ok: false, code: "missing_supabase_config" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, code: "missing_supabase_config" };
    }
  } catch {
    return { ok: false, code: "missing_supabase_config" };
  }
  return { ok: true, url, key };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function createSupabaseClient(env = process.env) {
  const cfg = readSupabaseConfig(env);
  if (!cfg.ok) {
    lastCreateError = cfg.code;
    const err = new Error("Supabase is not configured");
    err.code = cfg.code;
    throw err;
  }
  try {
    const client = createClient(cfg.url, cfg.key);
    lastCreateError = null;
    return client;
  } catch (error) {
    lastCreateError = "missing_supabase_config";
    const err = new Error("Supabase client could not be created");
    err.code = "missing_supabase_config";
    err.cause = error;
    throw err;
  }
}

function getRealClient() {
  if (!realClient) {
    realClient = createSupabaseClient();
  }
  return realClient;
}

/**
 * Reset singleton (tests only).
 */
export function resetSupabaseClientForTests() {
  realClient = null;
  lastCreateError = null;
}

/**
 * Log safe startup diagnostics (no secrets).
 * @param {(line: string) => void} [log]
 */
export function logSupabaseStartupDiagnostics(log = console.log) {
  const status = getSupabaseEnvStatus();
  log(`[supabase] urlPresent=${status.urlPresent ? "true" : "false"}`);
  log(`[supabase] keyPresent=${status.keyPresent ? "true" : "false"}`);
  try {
    getRealClient();
    log(`[supabase] clientCreated=true`);
  } catch {
    log(`[supabase] clientCreated=false`);
  }
}

// Lazily constructed Proxy — preserves existing `supabase.from(...)` call sites.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getRealClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
