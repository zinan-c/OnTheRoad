const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

/**
 * @typedef {{
 *   id?: string;
 *   dayNumber: number;
 *   date: string;
 *   dayOfWeek: number;
 *   isWorkday: boolean;
 * }} TripDay
 * @typedef {{ type: string; id: string }} DayContent
 */

export class DateChangeRequiresConfirmationError extends Error {
  /** @param {unknown} preview */
  constructor(preview) {
    super("Date change removes days with content and requires explicit confirmation");
    this.name = "DateChangeRequiresConfirmationError";
    this.code = "DATE_CHANGE_CONFIRMATION_REQUIRED";
    this.status = 409;
    this.preview = preview;
  }
}

/** @param {unknown} value @param {string} field @returns {number} */
function epochDay(value, field) {
  if (typeof value !== "string" || !LOCAL_DATE.test(value)) {
    throw new TypeError(`${field} must be YYYY-MM-DD`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`${field} is not a calendar date`);
  }
  return Math.floor(timestamp / DAY_MS);
}

/** @param {number} day @returns {string} */
function isoDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** @param {string} startDate @param {string} endDate @returns {TripDay[]} */
export function generateDateRange(startDate, endDate) {
  const first = epochDay(startDate, "startDate");
  const last = epochDay(endDate, "endDate");
  if (last < first) throw new RangeError("endDate must be on or after startDate");
  if (last - first > 3_650) throw new RangeError("date range cannot exceed 3651 days");
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const day = first + index;
    const dayOfWeek = new Date(day * DAY_MS).getUTCDay();
    return {
      dayNumber: index + 1,
      date: isoDay(day),
      dayOfWeek,
      isWorkday: dayOfWeek >= 1 && dayOfWeek <= 5,
    };
  });
}

/**
 * @param {{
 *   current: TripDay[];
 *   nextStartDate: string;
 *   nextEndDate: string;
 *   contentByDate?: Record<string, DayContent[]>;
 * }} input
 */
export function previewDateRangeChange({
  current,
  nextStartDate,
  nextEndDate,
  contentByDate = {},
}) {
  const next = generateDateRange(nextStartDate, nextEndDate);
  const currentByDate = new Map(current.map((day) => [day.date, day]));
  const nextDates = new Set(next.map(({ date }) => date));
  const currentDates = new Set(currentByDate.keys());
  const added = next.filter(({ date }) => !currentDates.has(date));
  const retained = next.filter(({ date }) => currentDates.has(date));
  const removed = current.filter(({ date }) => !nextDates.has(date));
  const blockers = removed.flatMap(({ date }) => {
    const content = contentByDate[date] ?? [];
    return content.length > 0 ? [{ date, content }] : [];
  });
  return {
    startDate: nextStartDate,
    endDate: nextEndDate,
    totalDays: next.length,
    added,
    retained,
    removed,
    blockers,
  };
}
