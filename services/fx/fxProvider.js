/**
 * FX provider interface + implementations.
 *
 * Root cause of production rateCount=0 / fxStatus=partial with KZT base:
 * - Default was FX_PROVIDER=none (no HTTP, no rates).
 * - Frankfurter (ECB) does NOT support KZT or VND (HTTP 404).
 *   Only major currencies like EUR/USD work there.
 *
 * Fix: default live provider is open.er-api.com (no API key), which supports
 * KZT, VND, USD, etc. One HTTP call loads a full rate table; pairs convert
 * via a USD pivot. Process cache makes the next summary cacheHit=true.
 *
 * Env:
 * - FX_PROVIDER=open-er-api|frankfurter|test|none  (default: open-er-api)
 * - FX_TEST_RATES=USD:KZT:450,... (test provider overrides)
 * - FINANCE_DEFAULT_BASE_CURRENCY / FX_DEFAULT_BASE_CURRENCY (default VND)
 */

import {
  getCachedFxRate,
  makeFxCacheKey,
  setCachedFxRate,
} from "./fxCache.js";

/**
 * @typedef {object} FxQuote
 * @property {number} rate - multiply amount_from by rate to get amount_to
 * @property {string} source
 * @property {string} baseCurrency - from
 * @property {string} quoteCurrency - to
 * @property {string} fetchedAt
 * @property {string} effectiveAt
 * @property {boolean} [cacheHit]
 */

export function createNoneFxProvider() {
  return {
    name: "none",
    async getRate() {
      return null;
    },
  };
}

/**
 * Deterministic test provider — no network.
 * Rates are expressed as: 1 FROM = rate TO
 */
export function createTestFxProvider(rateTable = null) {
  const table = rateTable || parseTestRates(process.env.FX_TEST_RATES) || {
    "USD:KZT": 450,
    "USD:VND": 25000,
    "KZT:VND": 55.5556,
    "EUR:USD": 1.1,
    "EUR:KZT": 495,
    "EUR:VND": 27500,
    "VND:KZT": 0.018,
    "VND:USD": 0.00004,
    "KZT:USD": 1 / 450,
  };

  return {
    name: "test",
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) {
        return quote(1, "test", src, dst, at);
      }
      const direct = table[`${src}:${dst}`];
      if (Number.isFinite(direct)) {
        return quote(direct, "test", src, dst, at);
      }
      const inverse = table[`${dst}:${src}`];
      if (Number.isFinite(inverse) && inverse > 0) {
        return quote(1 / inverse, "test", src, dst, at);
      }
      const toUsd =
        table[`${src}:USD`] ??
        (table[`USD:${src}`] ? 1 / table[`USD:${src}`] : null);
      const fromUsd =
        table[`USD:${dst}`] ??
        (table[`${dst}:USD`] ? 1 / table[`${dst}:USD`] : null);
      if (Number.isFinite(toUsd) && Number.isFinite(fromUsd)) {
        return quote(toUsd * fromUsd, "test", src, dst, at);
      }
      return null;
    },
  };
}

function parseTestRates(raw) {
  if (!raw || typeof raw !== "string") return null;
  const table = {};
  for (const part of raw.split(",")) {
    const bits = part.trim().split(":");
    if (bits.length !== 3) continue;
    const pair = `${bits[0]}:${bits[1]}`.toUpperCase();
    const rate = Number(bits[2]);
    if (Number.isFinite(rate) && rate > 0) table[pair] = rate;
  }
  return Object.keys(table).length ? table : null;
}

function quote(rate, source, base, quoteCurrency, at) {
  const iso = (at instanceof Date ? at : new Date(at || Date.now())).toISOString();
  return {
    rate: Number(rate),
    source,
    baseCurrency: base,
    quoteCurrency,
    fetchedAt: iso,
    effectiveAt: iso,
    cacheHit: false,
  };
}

/** Currencies known unsupported by Frankfurter ECB feed. */
const FRANKFURTER_UNSUPPORTED = new Set([
  "KZT",
  "VND",
  "RUB",
  "UAH",
  "BYN",
  "UZS",
  "GEL",
  "AMD",
  "AZN",
]);

/**
 * Frankfurter — ECB majors only. Returns null for KZT/VND (API 404).
 */
export function createFrankfurterFxProvider(fetchFn = globalThis.fetch) {
  return {
    name: "frankfurter",
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) return quote(1, "frankfurter", src, dst, at);
      if (FRANKFURTER_UNSUPPORTED.has(src) || FRANKFURTER_UNSUPPORTED.has(dst)) {
        return null;
      }
      if (typeof fetchFn !== "function") return null;
      try {
        const day = (at instanceof Date ? at : new Date(at)).toISOString().slice(0, 10);
        const url = `https://api.frankfurter.app/${day}?from=${encodeURIComponent(src)}&to=${encodeURIComponent(dst)}`;
        const res = await fetchFn(url);
        if (!res?.ok) return null;
        const body = await res.json();
        const rate = body?.rates?.[dst];
        if (!Number.isFinite(Number(rate))) return null;
        return quote(Number(rate), "frankfurter", src, dst, at);
      } catch {
        return null;
      }
    },
  };
}

/**
 * open.er-api.com — free, no key, includes KZT + VND.
 * Loads one USD-based rate table per day and converts any pair via USD pivot.
 */
export function createOpenErApiFxProvider(fetchFn = globalThis.fetch) {
  /** @type {Map<string, { rates: Record<string, number>, fetchedAt: string, cacheHit: boolean }>} */
  const tableMemo = new Map();

  async function loadUsdTable(at, allowNetwork) {
    const day = (at instanceof Date ? at : new Date(at || Date.now()))
      .toISOString()
      .slice(0, 10);
    const cacheKey = makeFxCacheKey("open-er-api", "USD", "TABLE", at);
    const cached = getCachedFxRate(cacheKey);
    if (cached?.rates) {
      return { rates: cached.rates, fetchedAt: cached.fetchedAt, cacheHit: true };
    }
    if (tableMemo.has(day)) {
      const hit = tableMemo.get(day);
      return { ...hit, cacheHit: true };
    }
    if (!allowNetwork || typeof fetchFn !== "function") return null;

    try {
      const url = `https://open.er-api.com/v6/latest/USD`;
      const res = await fetchFn(url);
      if (!res?.ok) return null;
      const body = await res.json();
      if (body?.result !== "success" || !body?.rates) return null;
      const rates = { USD: 1 };
      for (const [code, value] of Object.entries(body.rates)) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) rates[String(code).toUpperCase()] = n;
      }
      const fetchedAt = new Date().toISOString();
      const payload = { rates, fetchedAt, source: "open-er-api" };
      setCachedFxRate(cacheKey, payload);
      tableMemo.set(day, payload);
      return { rates, fetchedAt, cacheHit: false };
    } catch {
      return null;
    }
  }

  return {
    name: "open-er-api",
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) return quote(1, "open-er-api", src, dst, at);

      const table = await loadUsdTable(at, true);
      if (!table?.rates) return null;

      const fromUsd = src === "USD" ? 1 : table.rates[src];
      const toUsd = dst === "USD" ? 1 : table.rates[dst];
      if (!Number.isFinite(fromUsd) || !Number.isFinite(toUsd) || fromUsd <= 0) {
        return null;
      }
      // USD table: rates[X] = X per 1 USD → 1 SRC = (1/fromUsd) USD = toUsd/fromUsd DST
      const rate = toUsd / fromUsd;
      if (!Number.isFinite(rate) || rate <= 0) return null;
      return {
        ...quote(rate, "open-er-api", src, dst, at),
        fetchedAt: table.fetchedAt,
        effectiveAt: table.fetchedAt,
        cacheHit: Boolean(table.cacheHit),
      };
    },
  };
}

/**
 * Try providers in order until a quote is returned.
 */
export function createCompositeFxProvider(providers = []) {
  const list = providers.filter(Boolean);
  return {
    name: list.map((p) => p.name).join("+") || "composite",
    async getRate(from, to, at = new Date()) {
      for (const provider of list) {
        const q = await provider.getRate(from, to, at);
        if (q && Number.isFinite(Number(q.rate)) && Number(q.rate) > 0) {
          return q;
        }
      }
      return null;
    },
  };
}

/**
 * Pair-level cache wrapper (also used when table cache already hit).
 */
export function withFxCache(provider, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  return {
    name: provider.name,
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) {
        return quote(1, provider.name, src, dst, at);
      }
      const key = makeFxCacheKey(provider.name, src, dst, at);
      const cached = getCachedFxRate(key, maxAgeMs);
      if (cached) return { ...cached, cacheHit: true };
      const fresh = await provider.getRate(src, dst, at);
      if (fresh) {
        setCachedFxRate(key, fresh);
        return { ...fresh, cacheHit: Boolean(fresh.cacheHit) };
      }
      return null;
    },
  };
}

/**
 * jsDelivr currency-api — CDN fallback when open.er-api is unreachable.
 * Rates are lowercase keys under usd: { kzt: number, vnd: number, ... }
 */
export function createJsDelivrFxProvider(fetchFn = globalThis.fetch) {
  async function loadUsdTable(at) {
    const cacheKey = makeFxCacheKey("jsdelivr", "USD", "TABLE", at);
    const cached = getCachedFxRate(cacheKey);
    if (cached?.rates) {
      return { rates: cached.rates, fetchedAt: cached.fetchedAt, cacheHit: true };
    }
    if (typeof fetchFn !== "function") return null;
    try {
      const url =
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json";
      const res = await fetchFn(url);
      if (!res?.ok) return null;
      const body = await res.json();
      const usd = body?.usd;
      if (!usd || typeof usd !== "object") return null;
      const rates = { USD: 1 };
      for (const [code, value] of Object.entries(usd)) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) {
          rates[String(code).toUpperCase()] = n;
        }
      }
      const fetchedAt = new Date().toISOString();
      const payload = { rates, fetchedAt, source: "jsdelivr" };
      setCachedFxRate(cacheKey, payload);
      return { rates, fetchedAt, cacheHit: false };
    } catch {
      return null;
    }
  }

  return {
    name: "jsdelivr",
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) return quote(1, "jsdelivr", src, dst, at);
      const table = await loadUsdTable(at);
      if (!table?.rates) return null;
      const fromUsd = src === "USD" ? 1 : table.rates[src];
      const toUsd = dst === "USD" ? 1 : table.rates[dst];
      if (!Number.isFinite(fromUsd) || !Number.isFinite(toUsd) || fromUsd <= 0) {
        return null;
      }
      const rate = toUsd / fromUsd;
      if (!Number.isFinite(rate) || rate <= 0) return null;
      return {
        ...quote(rate, "jsdelivr", src, dst, at),
        fetchedAt: table.fetchedAt,
        effectiveAt: table.fetchedAt,
        cacheHit: Boolean(table.cacheHit),
      };
    },
  };
}

/**
 * Production live stack: open.er-api → jsDelivr CDN.
 * Covers KZT/VND; survives single-provider outages.
 */
export function createLiveFxProvider(fetchFn = globalThis.fetch) {
  return createCompositeFxProvider([
    createOpenErApiFxProvider(fetchFn),
    createJsDelivrFxProvider(fetchFn),
  ]);
}

/**
 * Resolve provider from env (server-side only).
 * Default: live composite (open-er-api + jsdelivr).
 * FX_PROVIDER=none is ignored unless FX_ALLOW_NONE=1 (production safety).
 */
export function createFxProviderFromEnv(overrides = {}) {
  let name = String(
    overrides.provider || process.env.FX_PROVIDER || "open-er-api"
  )
    .toLowerCase()
    .trim();

  if (
    name === "none" &&
    String(process.env.FX_ALLOW_NONE || "").trim() !== "1" &&
    !overrides.allowNone
  ) {
    // Railway often still has FX_PROVIDER=none from earlier docs — that
    // caused balance=KZT-only. Force live conversion unless explicitly allowed.
    console.error("[fx] provider=none ignored; using live open-er-api+jsdelivr");
    name = "open-er-api";
  }

  let inner;
  if (name === "test") {
    inner = createTestFxProvider(overrides.rateTable || null);
  } else if (name === "none") {
    inner = createNoneFxProvider();
  } else if (name === "frankfurter") {
    inner = createCompositeFxProvider([
      createLiveFxProvider(overrides.fetchFn),
      createFrankfurterFxProvider(overrides.fetchFn),
    ]);
  } else if (
    name === "open-er-api" ||
    name === "live" ||
    name === "openexchangerates" ||
    name === "jsdelivr"
  ) {
    inner = createLiveFxProvider(overrides.fetchFn);
  } else {
    inner = createLiveFxProvider(overrides.fetchFn);
  }
  return withFxCache(inner, overrides);
}

/**
 * Warm FX cache at process start (non-blocking).
 */
export async function warmFxCache(provider = createFxProviderFromEnv()) {
  try {
    await provider.getRate("USD", "KZT");
    await provider.getRate("VND", "KZT");
    console.error("[fx] warm_ok provider=" + (provider.name || "unknown"));
  } catch (error) {
    console.error("[fx] warm_failed", error?.message || error);
  }
}

/**
 * convertMoney({ amount, from, to, rateDate, provider })
 */
export async function convertMoney({
  amount,
  from,
  to,
  rateDate = new Date(),
  provider,
}) {
  const src = String(from || "").toUpperCase();
  const dst = String(to || "").toUpperCase();
  if (src === dst) {
    return {
      amount: Number(amount),
      from: src,
      to: dst,
      rate: 1,
      fxStatus: "ok",
      quote: quote(1, provider?.name || "identity", src, dst, rateDate),
    };
  }
  const q = await provider.getRate(src, dst, rateDate);
  if (!q) {
    return {
      amount: null,
      from: src,
      to: dst,
      rate: null,
      fxStatus: "unavailable",
      quote: null,
    };
  }
  return {
    amount: Number(amount) * Number(q.rate),
    from: src,
    to: dst,
    rate: Number(q.rate),
    fxStatus: "ok",
    quote: q,
  };
}
