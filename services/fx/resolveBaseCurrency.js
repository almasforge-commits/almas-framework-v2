/**
 * Resolve actor reporting / base currency.
 * Priority:
 * 1. saved user preference (actor_finance_settings / injected resolver)
 * 2. existing finance profile setting (deps.profileBaseCurrency)
 * 3. documented default (VND)
 *
 * Never infer solely from the last transaction.
 */

export const DEFAULT_BASE_CURRENCY = "VND";

/**
 * @param {object} [actor]
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function resolveBaseCurrency(actor, options = {}) {
  const preferenceFn = options.getPreferenceFn;
  if (typeof preferenceFn === "function") {
    try {
      const preferred = await preferenceFn(actor);
      if (preferred && /^[A-Z]{3}$/i.test(String(preferred))) {
        return String(preferred).toUpperCase();
      }
    } catch {
      // fall through
    }
  }

  if (
    options.profileBaseCurrency &&
    /^[A-Z]{3}$/i.test(String(options.profileBaseCurrency))
  ) {
    return String(options.profileBaseCurrency).toUpperCase();
  }

  const fromEnv =
    process.env.FINANCE_DEFAULT_BASE_CURRENCY ||
    process.env.FX_DEFAULT_BASE_CURRENCY ||
    "";
  if (/^[A-Z]{3}$/i.test(fromEnv.trim())) {
    return fromEnv.trim().toUpperCase();
  }

  return DEFAULT_BASE_CURRENCY;
}
