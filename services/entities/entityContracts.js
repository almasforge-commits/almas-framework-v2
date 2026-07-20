// Universal named-entity contracts. Pure — no I/O / Telegram / domain services.
// Never invents values; empty bags are the safe default.

export const ENTITY_TYPES = Object.freeze([
  "people",
  "companies",
  "products",
  "services",
  "brands",
  "currencies",
  "countries",
  "cities",
  "languages",
  "urls",
  "emails",
  "phones",
  "crypto",
  "stocks",
  "platforms",
  "dates",
  "times",
  "locations",
  "documents",
  "websites",
  "hashtags",
  "mentions",
  "numbers",
  "measurements",
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKnownEntityType(value) {
  return typeof value === "string" && ENTITY_TYPES.includes(value);
}

/**
 * Empty entity bag — every known type present as [].
 * @returns {Record<string, unknown[]>}
 */
export function createEmptyEntityBag() {
  const bag = {};
  for (const type of ENTITY_TYPES) {
    bag[type] = [];
  }
  return bag;
}

/**
 * @param {Record<string, unknown[]>|null|undefined} bag
 * @returns {boolean}
 */
export function isEntityBagEmpty(bag) {
  if (!bag || typeof bag !== "object") return true;
  return ENTITY_TYPES.every((type) => {
    const list = bag[type];
    return !Array.isArray(list) || list.length === 0;
  });
}
