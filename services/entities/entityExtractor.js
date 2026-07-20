import { createEmptyEntityBag } from "./entityContracts.js";
import {
  validateEntityBag,
  mergeDomainAndUniversalEntities,
} from "./entityValidator.js";

// Deterministic universal entity extractor. Never invents values that are
// not grounded in the source text. No Telegram / OpenAI / domain services.

const KNOWN_COMPANIES = [
  "kaspi",
  "kaspi.kz",
  "apple",
  "google",
  "amazon",
  "microsoft",
  "openai",
  "spacex",
  "tesla",
  "samsung",
  "huawei",
  "wildberries",
  "ozon",
  "yandex",
  "сбер",
  "сбербанк",
  "тинькофф",
  "tinkoff",
];

const KNOWN_BRANDS = [
  "xbox",
  "playstation",
  "nintendo",
  "iphone",
  "ipad",
  "macbook",
  "airpods",
  "nike",
  "adidas",
  "sony",
  "lg",
  "bmw",
  "toyota",
];

const KNOWN_PLATFORMS = [
  "telegram",
  "whatsapp",
  "instagram",
  "youtube",
  "tiktok",
  "twitter",
  "x.com",
  "facebook",
  "linkedin",
  "discord",
  "slack",
  "kaspi",
];

const KNOWN_COUNTRIES = [
  "kazakhstan",
  "казахстан",
  "vietnam",
  "вьетнам",
  "russia",
  "россия",
  "usa",
  "сша",
  "thailand",
  "тайланд",
];

const KNOWN_CITIES = [
  "almaty",
  "алматы",
  "astana",
  "астана",
  "moscow",
  "москва",
  "hanoi",
  "ханой",
  "saigon",
  "хошимин",
];

const KNOWN_LANGUAGES = [
  "russian",
  "english",
  "kazakh",
  "русский",
  "английский",
  "казахский",
];

const CURRENCY_PATTERNS = [
  { re: /\bUSD\b|\$|доллар(?:ов|а|ы)?/gi, value: "USD" },
  { re: /\bEUR\b|€|евро/gi, value: "EUR" },
  { re: /\bKZT\b|₸|тенге/gi, value: "KZT" },
  { re: /\bVND\b|₫|донг(?:ов|а)?/gi, value: "VND" },
  { re: /\bRUB\b|₽|руб(?:л(?:ей|я|ь))?/gi, value: "RUB" },
];

const DATE_PATTERNS = [
  /(?:^|[\s,.;:!?])(сегодня)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(завтра)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(послезавтра)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(today)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(tomorrow)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(бүгін)(?=$|[\s,.;:!?])/gi,
  /(?:^|[\s,.;:!?])(ертең)(?=$|[\s,.;:!?])/gi,
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  /\b(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\b/g,
];

const CRYPTO_TICKERS = ["BTC", "ETH", "USDT", "USDC", "SOL", "BNB", "XRP", "TON"];
const STOCK_TICKERS = ["AAPL", "TSLA", "MSFT", "GOOGL", "AMZN", "NVDA", "META"];

function pushUnique(list, value) {
  if (value == null || value === "") return;
  const key = typeof value === "number" ? `n:${value}` : `s:${String(value).toLowerCase()}`;
  if (list._seen?.has(key)) return;
  if (!list._seen) list._seen = new Set();
  list._seen.add(key);
  list.push(value);
}

function finalize(bag) {
  for (const type of Object.keys(bag)) {
    if (bag[type]?._seen) delete bag[type]._seen;
  }
  return validateEntityBag(bag);
}

function textContainsToken(text, token) {
  const lower = text.toLowerCase();
  const needle = String(token).toLowerCase();
  // Escape regex specials in token
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(
    lower
  );
}

function matchKnownList(text, list, target) {
  for (const entry of list) {
    if (textContainsToken(text, entry)) {
      // Preserve a canonical display form: prefer original casing from list
      // only when it appears; otherwise use the known spelling.
      const re = new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const m = text.match(re);
      pushUnique(target, m ? m[0] : entry);
    }
  }
}

/**
 * Extracts a universal entity bag from free text. Deterministic only.
 * Values must appear in the text (or be a canonical form of a matched token).
 *
 * @param {string} text
 * @returns {Record<string, unknown[]>}
 */
export function extractEntities(text) {
  const source = String(text ?? "");
  const bag = createEmptyEntityBag();
  if (!source.trim()) return bag;

  // URLs / websites
  for (const m of source.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) {
    pushUnique(bag.urls, m[0].replace(/[),.;]+$/, ""));
    pushUnique(bag.websites, m[0].replace(/[),.;]+$/, ""));
  }
  for (const m of source.matchAll(/\b(?:www\.)[^\s<>"']+/gi)) {
    pushUnique(bag.websites, m[0].replace(/[),.;]+$/, ""));
  }

  // Emails
  for (const m of source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    pushUnique(bag.emails, m[0]);
  }

  // Phones (conservative international / local digit runs with separators)
  for (const m of source.matchAll(
    /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{2,4}[\s-]?\d{2,4}\b/g
  )) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      pushUnique(bag.phones, m[0].trim());
    }
  }

  // Hashtags / mentions
  for (const m of source.matchAll(/#[\p{L}\p{N}_]{2,40}/gu)) {
    pushUnique(bag.hashtags, m[0]);
  }
  for (const m of source.matchAll(/@[\p{L}\p{N}_]{2,40}/gu)) {
    pushUnique(bag.mentions, m[0]);
  }

  // Currencies
  for (const { re, value } of CURRENCY_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(source)) pushUnique(bag.currencies, value);
  }

  // Dates / times
  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) {
      pushUnique(bag.dates, m[1] || m[0]);
    }
  }
  for (const m of source.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    pushUnique(bag.times, m[0]);
  }

  // Numbers (standalone amounts; skip years already captured as dates when possible)
  for (const m of source.matchAll(/\b(\d{1,3}(?:[ \u00a0]\d{3})+|\d+(?:[.,]\d+)?)\b/g)) {
    const raw = m[1].replace(/[ \u00a0]/g, "").replace(",", ".");
    const num = Number(raw);
    if (Number.isFinite(num)) pushUnique(bag.numbers, num);
  }

  // Measurements
  for (const m of source.matchAll(
    /\b(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g|км|km|м|m|см|cm|л|l|час(?:а|ов)?|hours?|мин(?:ут(?:ы|а)?)?|min(?:utes?)?|шаг(?:а|ов)?|steps?)\b/gi
  )) {
    pushUnique(bag.measurements, `${m[1]} ${m[2]}`.trim());
  }

  // Crypto / stocks — only exact known tickers present in text
  for (const ticker of CRYPTO_TICKERS) {
    if (new RegExp(`(?:^|[^A-Za-z])\\$?${ticker}(?:$|[^A-Za-z])`).test(source)) {
      pushUnique(bag.crypto, ticker);
    }
  }
  for (const ticker of STOCK_TICKERS) {
    if (new RegExp(`(?:^|[^A-Za-z])\\$?${ticker}(?:$|[^A-Za-z])`).test(source)) {
      pushUnique(bag.stocks, ticker);
    }
  }

  matchKnownList(source, KNOWN_COMPANIES, bag.companies);
  matchKnownList(source, KNOWN_BRANDS, bag.brands);
  matchKnownList(source, KNOWN_PLATFORMS, bag.platforms);
  matchKnownList(source, KNOWN_COUNTRIES, bag.countries);
  matchKnownList(source, KNOWN_CITIES, bag.cities);
  matchKnownList(source, KNOWN_LANGUAGES, bag.languages);

  // Products after buy verbs (conservative short capture)
  const productMatch = source.match(
    /(?:купить|купи|buy|бастау|сатып\s+ал)\s+([^\s,.;!?]{2,40})(?:\s+для|\s+in|\s+в|\s+за|\s*$|,)/i
  );
  if (productMatch?.[1]) {
    pushUnique(bag.products, productMatch[1]);
  }

  // Documents: explicit file-like tokens only
  for (const m of source.matchAll(/\b[\w.-]+\.(?:pdf|docx?|xlsx?|pptx?|txt|csv)\b/gi)) {
    pushUnique(bag.documents, m[0]);
  }

  // People: only explicit @mentions already captured, or "с/with <Name>"
  for (const m of source.matchAll(
    /(?:^|[\s,.;:!?])(?:с|with)\s+([A-ZА-ЯЁ][\p{L}'-]{1,30})(?=$|[\s,.;:!?])/gu
  )) {
    pushUnique(bag.people, m[1]);
  }

  return finalize(bag);
}

/**
 * Enriches one extracted item with universal entities from source text
 * (and optional item.content). Does not mutate the input item.
 *
 * @param {object} item
 * @param {string} sourceText
 * @returns {object}
 */
export function enrichExtractedItemWithEntities(item, sourceText) {
  const textParts = [sourceText, item?.content, item?.entities?.title, item?.entities?.description]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");

  const bag = extractEntities(textParts);
  const merged = mergeDomainAndUniversalEntities(item?.entities ?? {}, bag);

  return {
    ...item,
    entities: merged,
  };
}

/**
 * @param {object[]} items
 * @param {string} sourceText
 * @returns {object[]}
 */
export function enrichExtractedItemsWithEntities(items, sourceText) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => enrichExtractedItemWithEntities(item, sourceText));
}
