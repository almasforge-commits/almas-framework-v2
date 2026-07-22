import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const PACKAGE_ENV_PATH = path.join(PACKAGE_ROOT, ".env");

/**
 * Canonical server-side Supabase env names (exact).
 * Do not invent aliases (SUPABASE_KEY, SERVICE_ROLE, NEXT_PUBLIC_*, etc.).
 */
export const SUPABASE_ENV = Object.freeze({
  url: "SUPABASE_URL",
  anonKey: "SUPABASE_ANON_KEY",
});

export const SUPABASE_REASON = Object.freeze({
  missing_url: "missing_url",
  missing_key: "missing_key",
  invalid_url: "invalid_url",
  invalid_key: "invalid_key",
  malformed_env_value: "malformed_env_value",
  create_client_exception: "create_client_exception",
  ok: "ok",
});

/**
 * Local .env only. Railway/Render inject process.env before boot.
 * dotenv never overrides existing values by default — hosted vars win.
 * Never require a local .env file on Railway.
 */
function loadLocalDotenvIfPresent() {
  const hosted = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME
  );
  if (hosted) return;
  if (!fs.existsSync(PACKAGE_ENV_PATH)) return;
  dotenv.config({ path: PACKAGE_ENV_PATH });
}

loadLocalDotenvIfPresent();

/**
 * @param {unknown} raw
 * @returns {{ value: string, malformed: boolean, malformation: string|null }}
 */
export function normalizeSupabaseEnvValue(raw) {
  if (raw == null) {
    return { value: "", malformed: false, malformation: null };
  }
  let value = String(raw).trim();
  if (!value) {
    return { value: "", malformed: false, malformation: null };
  }

  if (/\$\{\{/.test(value) || /\$\{[A-Z0-9_]+\}/.test(value)) {
    return { value, malformed: true, malformation: "template_placeholder" };
  }
  if (/^(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=/i.test(value)) {
    return { value, malformed: true, malformation: "key_equals_prefix" };
  }

  const matchedQuotes =
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
  if (matchedQuotes) {
    value = value.slice(1, -1).trim();
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    value.includes('"') ||
    value.includes("'")
  ) {
    return { value, malformed: true, malformation: "quotes" };
  }
  if (/\$\{\{/.test(value) || /\$\{[A-Z0-9_]+\}/.test(value)) {
    return { value, malformed: true, malformation: "template_placeholder" };
  }
  if (/^(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=/i.test(value)) {
    return { value, malformed: true, malformation: "key_equals_prefix" };
  }

  return { value, malformed: false, malformation: null };
}

/**
 * @param {string} key
 * @returns {"jwt"|"publishable"|"unknown"}
 */
export function detectSupabaseKeyFormat(key) {
  const k = String(key || "");
  if (k.startsWith("sb_publishable_") || k.startsWith("sb_secret_")) {
    return "publishable";
  }
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(k)) {
    return "jwt";
  }
  // Legacy anon JWTs sometimes omit strict third segment checks in the wild;
  // still classify eyJ… three-part blobs as jwt when reasonably shaped.
  if (k.startsWith("eyJ") && k.split(".").length >= 2) {
    return "jwt";
  }
  return "unknown";
}

/**
 * Short non-reversible fingerprint — never the key itself.
 * @param {string} key
 */
export function supabaseKeyFingerprint(key) {
  const k = String(key || "");
  if (!k) return "";
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 8);
}

/**
 * @param {string} url
 * @returns {{ valid: boolean, host: string }}
 */
export function validateSupabaseUrl(url) {
  const value = String(url || "");
  if (!value.startsWith("https://")) {
    return { valid: false, host: "" };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, host: "" };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, host: "" };
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host) {
    return { valid: false, host: "" };
  }
  const allowed =
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.in") ||
    host === "localhost" ||
    host === "127.0.0.1";
  if (!allowed) {
    // Custom domains are uncommon here — treat as invalid unless clearly local.
    return { valid: false, host };
  }
  return { valid: true, host };
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function validateSupabaseKey(key) {
  const k = String(key || "");
  if (!k || k.length < 20) return false;
  const format = detectSupabaseKeyFormat(k);
  return format === "jwt" || format === "publishable";
}

function emptyStatus(overrides = {}) {
  return {
    urlPresent: false,
    keyPresent: false,
    urlValid: false,
    keyFormatValid: false,
    keyFormat: "unknown",
    keyLength: 0,
    keyFingerprint: "",
    urlHost: "",
    clientCreated: false,
    reasonCode: SUPABASE_REASON.missing_url,
    errorName: "",
    errorMessage: "",
    ...overrides,
  };
}

/**
 * Controlled unavailable stand-in — not a lazy Proxy, not a silent fake.
 * Any data-plane call fails closed with the real reasonCode.
 * @param {ReturnType<typeof emptyStatus>} status
 */
export function createUnavailableSupabaseClient(status) {
  const reason = status?.reasonCode || SUPABASE_REASON.create_client_exception;
  const fail = () => {
    const err = new Error(`Supabase unavailable: ${reason}`);
    err.code = reason;
    throw err;
  };
  return Object.freeze({
    __almasUnavailable: true,
    reasonCode: reason,
    from: fail,
    rpc: fail,
    schema: fail,
    storage: fail,
    functions: fail,
    auth: Object.freeze({
      getSession: fail,
      signOut: fail,
    }),
  });
}

/**
 * Explicit one-shot client creation from env.
 * Never logs secret values.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ client: object|null, status: object }}
 */
export function createSupabaseClientFromEnv(env = process.env) {
  const urlRaw = env?.SUPABASE_URL;
  const keyRaw = env?.SUPABASE_ANON_KEY;

  const urlNorm = normalizeSupabaseEnvValue(urlRaw);
  const keyNorm = normalizeSupabaseEnvValue(keyRaw);

  const urlPresent = Boolean(String(urlRaw ?? "").trim());
  const keyPresent = Boolean(String(keyRaw ?? "").trim());

  if (urlNorm.malformed || keyNorm.malformed) {
    const status = emptyStatus({
      urlPresent,
      keyPresent,
      reasonCode: SUPABASE_REASON.malformed_env_value,
      errorMessage: urlNorm.malformation || keyNorm.malformation || "malformed",
    });
    return { client: null, status };
  }

  if (!urlNorm.value) {
    return {
      client: null,
      status: emptyStatus({
        urlPresent: false,
        keyPresent,
        reasonCode: SUPABASE_REASON.missing_url,
      }),
    };
  }
  if (!keyNorm.value) {
    return {
      client: null,
      status: emptyStatus({
        urlPresent: true,
        keyPresent: false,
        reasonCode: SUPABASE_REASON.missing_key,
      }),
    };
  }

  const urlCheck = validateSupabaseUrl(urlNorm.value);
  const keyFormat = detectSupabaseKeyFormat(keyNorm.value);
  const keyFormatValid = validateSupabaseKey(keyNorm.value);
  const keyFingerprint = supabaseKeyFingerprint(keyNorm.value);
  const keyLength = keyNorm.value.length;

  if (!urlCheck.valid) {
    return {
      client: null,
      status: emptyStatus({
        urlPresent: true,
        keyPresent: true,
        urlValid: false,
        keyFormatValid,
        keyFormat,
        keyLength,
        keyFingerprint,
        urlHost: urlCheck.host || "",
        reasonCode: SUPABASE_REASON.invalid_url,
      }),
    };
  }

  if (!keyFormatValid) {
    return {
      client: null,
      status: emptyStatus({
        urlPresent: true,
        keyPresent: true,
        urlValid: true,
        keyFormatValid: false,
        keyFormat,
        keyLength,
        keyFingerprint,
        urlHost: urlCheck.host,
        reasonCode: SUPABASE_REASON.invalid_key,
      }),
    };
  }

  try {
    const client = createClient(urlNorm.value, keyNorm.value, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return {
      client,
      status: emptyStatus({
        urlPresent: true,
        keyPresent: true,
        urlValid: true,
        keyFormatValid: true,
        keyFormat,
        keyLength,
        keyFingerprint,
        urlHost: urlCheck.host,
        clientCreated: true,
        reasonCode: SUPABASE_REASON.ok,
      }),
    };
  } catch (error) {
    const errorName = error?.name ? String(error.name) : "Error";
    const errorMessage = String(error?.message || "createClient failed")
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9._-]{8,}/g, "[token]")
      .replace(/\bsb_(publishable|secret)_[A-Za-z0-9_]+/g, "[key]")
      .slice(0, 160);
    return {
      client: null,
      status: emptyStatus({
        urlPresent: true,
        keyPresent: true,
        urlValid: true,
        keyFormatValid: true,
        keyFormat,
        keyLength,
        keyFingerprint,
        urlHost: urlCheck.host,
        clientCreated: false,
        reasonCode: SUPABASE_REASON.create_client_exception,
        errorName,
        errorMessage,
      }),
    };
  }
}

/** @type {{ client: object|null, status: object }} */
let boot = createSupabaseClientFromEnv(process.env);

/**
 * Live status snapshot (no secrets).
 */
export let supabaseStatus = boot.status;

/**
 * Shared client: real SupabaseClient when valid, controlled unavailable facade otherwise.
 */
export let supabase = boot.client
  ? boot.client
  : createUnavailableSupabaseClient(boot.status);

/**
 * @returns {object|null} Real client or null.
 */
export function getSupabaseClient() {
  return boot.client;
}

/**
 * @returns {object} Real client; throws with reasonCode when unavailable.
 */
export function requireSupabaseClient() {
  if (!boot.client) {
    const reason = supabaseStatus?.reasonCode || SUPABASE_REASON.create_client_exception;
    const err = new Error(`Supabase unavailable: ${reason}`);
    err.code = reason;
    throw err;
  }
  return boot.client;
}

/**
 * Safe config snapshot — booleans / codes only, never values.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getSupabaseEnvStatus(env) {
  if (env && env !== process.env) {
    return createSupabaseClientFromEnv(env).status;
  }
  return {
    urlPresent: Boolean(supabaseStatus.urlPresent),
    keyPresent: Boolean(supabaseStatus.keyPresent),
    urlValid: Boolean(supabaseStatus.urlValid),
    keyFormatValid: Boolean(supabaseStatus.keyFormatValid),
    keyFormat: supabaseStatus.keyFormat || "unknown",
    keyLength: Number(supabaseStatus.keyLength) || 0,
    keyFingerprint: supabaseStatus.keyFingerprint || "",
    urlHost: supabaseStatus.urlHost || "",
    clientCreated: Boolean(supabaseStatus.clientCreated),
    reasonCode: supabaseStatus.reasonCode || SUPABASE_REASON.missing_url,
    createErrorCode:
      supabaseStatus.clientCreated
        ? null
        : supabaseStatus.reasonCode || SUPABASE_REASON.create_client_exception,
    errorName: supabaseStatus.errorName || "",
    errorMessage: supabaseStatus.errorMessage || "",
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, url: string, key: string } | { ok: false, code: string }}
 */
export function readSupabaseConfig(env = process.env) {
  const { client, status } = createSupabaseClientFromEnv(env);
  if (!client) {
    return { ok: false, code: status.reasonCode };
  }
  const urlNorm = normalizeSupabaseEnvValue(env.SUPABASE_URL);
  const keyNorm = normalizeSupabaseEnvValue(env.SUPABASE_ANON_KEY);
  return { ok: true, url: urlNorm.value, key: keyNorm.value };
}

/**
 * @deprecated Prefer createSupabaseClientFromEnv. Kept for older call sites.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function createSupabaseClient(env = process.env) {
  const { client, status } = createSupabaseClientFromEnv(env);
  if (!client) {
    const err = new Error(`Supabase unavailable: ${status.reasonCode}`);
    err.code = status.reasonCode;
    throw err;
  }
  return client;
}

/**
 * Reset + optionally re-bind module singleton (tests only).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resetSupabaseClientForTests(env = process.env) {
  boot = createSupabaseClientFromEnv(env);
  supabaseStatus = boot.status;
  supabase = boot.client
    ? boot.client
    : createUnavailableSupabaseClient(boot.status);
  return boot;
}

/**
 * Log safe startup diagnostics (no secrets).
 * @param {(line: string) => void} [log]
 */
export function logSupabaseStartupDiagnostics(log = console.log) {
  const status = getSupabaseEnvStatus();
  log(`[supabase] urlPresent=${status.urlPresent ? "true" : "false"}`);
  log(`[supabase] keyPresent=${status.keyPresent ? "true" : "false"}`);
  log(`[supabase] urlValid=${status.urlValid ? "true" : "false"}`);
  if (status.urlHost) {
    log(`[supabase] urlHost=${status.urlHost}`);
  }
  log(`[supabase] keyFormat=${status.keyFormat || "unknown"}`);
  log(`[supabase] keyLength=${status.keyLength || 0}`);
  if (status.keyFingerprint) {
    log(`[supabase] keyFingerprint=${status.keyFingerprint}`);
  }
  log(`[supabase] clientCreated=${status.clientCreated ? "true" : "false"}`);
  if (!status.clientCreated) {
    log(`[supabase] reason=${status.reasonCode || SUPABASE_REASON.create_client_exception}`);
    if (status.errorName) {
      log(`[supabase] errorName=${status.errorName}`);
    }
    if (status.errorMessage) {
      log(`[supabase] errorMessage=${status.errorMessage}`);
    }
  }
}

/**
 * @returns {boolean}
 */
export function isSupabaseReady() {
  return Boolean(boot.client && supabaseStatus.clientCreated);
}
