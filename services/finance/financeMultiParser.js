import { parseFinanceMessage } from "./financeParser.js";

export function parseFinanceMessages(text = "") {

  if (!text) return [];

  const original = text.trim();
  const lines = original
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

if (lines.length > 1) {

  const operations = [];

  for (const line of lines) {

    const parsed = parseFinanceMessage(`Потратил ${line}`);

    if (parsed) {
      operations.push(parsed);
    }

  }

  if (operations.length > 1) {
    return operations;
  }

}
const commaParts = original
  .split(",")
  .map(p => p.trim())
  .filter(Boolean);

if (commaParts.length > 1) {

  const operations = [];

  for (const part of commaParts) {

    let parsed = parseFinanceMessage(part);

    if (!parsed) {
      parsed = parseFinanceMessage(`Потратил ${part}`);
    }

    if (parsed) {
      operations.push(parsed);
    }

  }

  if (operations.length > 1) {
    return operations;
  }

}
  const amountRegex =
    /(\d+(?:[.,]\d+)?)(?:\s*)(k|m|тыс|тысяч|тысячи|млн|миллион(?:а|ов)?)?/gi;

  const matches = [...original.matchAll(amountRegex)];

  if (matches.length <= 1) {
    return [];
  }

  const operations = [];

  const firstAmount = matches[0];

  const action = original
    .slice(0, firstAmount.index)
    .trim();

  for (let i = 0; i < matches.length; i++) {

    const current = matches[i];

    const next = matches[i + 1];

    const amountText = current[0];

    const start = current.index + amountText.length;

    const end = next ? next.index : original.length;

    let description = original
      .slice(start, end)
      .trim();

    description = description
      .replace(/^и\s+/i, "")
      .replace(/^,\s*/i, "")
      .trim();

    const message =
      `${action} ${amountText} ${description}`.trim();

    const parsed = parseFinanceMessage(message);

    if (parsed) {
      operations.push(parsed);
    }

  }

  return operations;

}