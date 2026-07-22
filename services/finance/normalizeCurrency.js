/**
 * Normalize currency codes from DB / parsers for FX aggregation.
 */
export function normalizeCurrencyCode(raw) {
  const original = String(raw ?? "").trim();
  if (!original) return "VND";
  const t = original.toUpperCase().replace(/\s+/g, "");

  if (
    t === "USD" ||
    t === "US$" ||
    t === "$" ||
    t === "DOLLAR" ||
    t === "DOLLARS" ||
    t.includes("ДОЛЛАР")
  ) {
    return "USD";
  }
  if (t === "KZT" || t === "₸" || t.includes("ТЕНГ")) return "KZT";
  if (t === "VND" || t === "₫" || t.includes("ДОНГ") || t === "DONG") return "VND";
  if (t === "EUR" || t === "€" || t.includes("ЕВРО")) return "EUR";
  if (t === "RUB" || t === "RUR" || t === "₽" || t.includes("РУБ")) return "RUB";

  if (/^[A-Z]{3}$/.test(t)) return t;
  return "VND";
}
