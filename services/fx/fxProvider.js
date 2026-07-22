/**
 * FX provider interface + implementations.
 *
 * Env:
 * - FX_PROVIDER=none|test|frankfurter (default: none)
 * - FX_TEST_RATES=USD:KZT:450,USD:VND:25000,KZT:VND:55 (optional overrides for test)
 * - FINANCE_DEFAULT_BASE_CURRENCY / FX_DEFAULT_BASE_CURRENCY (default VND)
 *
 * No API secrets are required for `none` or `test`.
 * Frankfurter is optional and server-side only; never called from Mini App.
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
      // Bridge via USD when possible.
      const toUsd = table[`${src}:USD`] ?? (table[`USD:${src}`] ? 1 / table[`USD:${src}`] : null);
      const fromUsd = table[`USD:${dst}`] ?? (table[`${dst}:USD`] ? 1 / table[`${dst}:USD`] : null);
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

/**
 * Optional live provider (Frankfurter — no API key).
 * Disabled unless FX_PROVIDER=frankfurter.
 */
export function createFrankfurterFxProvider(fetchFn = globalThis.fetch) {
  return {
    name: "frankfurter",
    async getRate(from, to, at = new Date()) {
      const src = String(from).toUpperCase();
      const dst = String(to).toUpperCase();
      if (src === dst) return quote(1, "frankfurter", src, dst, at);
      if (typeof fetchFn !== "function") return null;
      const day = (at instanceof Date ? at : new Date(at)).toISOString().slice(0, 10);
      const url = `https://api.frankfurter.app/${day}?from=${encodeURIComponent(src)}&to=${encodeURIComponent(dst)}`;
      const res = await fetchFn(url);
      if (!res?.ok) return null;
      const body = await res.json();
      const rate = body?.rates?.[dst];
      if (!Number.isFinite(Number(rate))) return null;
      return quote(Number(rate), "frankfurter", src, dst, at);
    },
  };
}

/**
 * Cached wrapper around a provider.
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
      if (cached) return cached;
      const fresh = await provider.getRate(src, dst, at);
      if (fresh) {
        setCachedFxRate(key, fresh);
        return { ...fresh, cacheHit: false };
      }
      return null;
    },
  };
}

/**
 * Resolve provider from env (server-side only).
 * @param {object} [overrides]
 */
export function createFxProviderFromEnv(overrides = {}) {
  const name = String(
    overrides.provider || process.env.FX_PROVIDER || "none"
  ).toLowerCase();
  let inner;
  if (name === "test") {
    inner = createTestFxProvider(overrides.rateTable || null);
  } else if (name === "frankfurter") {
    inner = createFrankfurterFxProvider(overrides.fetchFn);
  } else {
    inner = createNoneFxProvider();
  }
  return withFxCache(inner, overrides);
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
