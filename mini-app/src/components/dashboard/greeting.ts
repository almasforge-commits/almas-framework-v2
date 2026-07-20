/**
 * Time-of-day greeting in Russian. Pure display helper — no data fetching.
 */
export function getDaypartGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 17) return "Добрый день";
  if (hour >= 17 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

export function formatDashboardDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function buildGreetingLine(
  firstName: string | undefined | null,
  date: Date = new Date()
): string {
  const daypart = getDaypartGreeting(date);
  const name = firstName?.trim();
  if (name) return `${daypart}, ${name}`;
  return daypart;
}
