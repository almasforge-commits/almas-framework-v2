// Shared cleanup for a mixed message like "Потратил 40000 на кофе и
// завтра купить батарейки": parseFinanceMessage()'s own cleanup leaves
// the description as "кофе и завтра купить батарейки" — everything
// after the amount, including a second, unrelated action clause. Since
// Finance remains the deterministic/legacy owner of its own part of a
// mixed message (see D-012) while the AI router owns the task/memory
// clause separately, the Finance description must not leak that second
// clause.
//
// Deliberately narrow: only strips a trailing " и <clause>" when the
// clause itself starts with a recognizable task/reminder trigger word —
// never touches a genuine part of the purchase description (e.g. "кофе
// и печенье" is left untouched, since "печенье" isn't a task trigger).

const TASK_CLAUSE_TRIGGERS = [
  "завтра",
  "послезавтра",
  "сегодня вечером",
  "потом",
  "затем",
  "ещё",
  "еще",
  "купи",
  "купить",
  "позвони",
  "позвонить",
  "сделать",
  "напомни",
  "напомнить",
  "нужно",
];

/**
 * @param {string} description
 * @returns {string}
 */
export function stripTrailingActionClause(description) {
  if (!description) return description;

  const match = description.match(/^(.*?)\s+и\s+(.+)$/i);

  if (!match) return description;

  const [, head, tail] = match;
  const tailLower = tail.trim().toLowerCase();

  const looksLikeSeparateAction = TASK_CLAUSE_TRIGGERS.some((trigger) =>
    tailLower.startsWith(trigger)
  );

  if (!looksLikeSeparateAction) return description;

  const cleanedHead = head.trim();

  return cleanedHead || description;
}
