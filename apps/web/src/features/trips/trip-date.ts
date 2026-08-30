const TRIP_TIME_ZONE = "Asia/Shanghai";

export function formatTripDate(value?: string): string {
  if (!value) return "Date not set";
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  const monthDay = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone: TRIP_TIME_ZONE,
  }).format(date);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    timeZone: TRIP_TIME_ZONE,
  }).format(date);
  return `${monthDay} · ${weekday}`;
}
