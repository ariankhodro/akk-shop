import { toLatinDigits } from "./normalize-digits.js";

const TEHRAN_TIME_ZONE = "Asia/Tehran";
const PERSIAN_CALENDAR_LOCALE = "en-US-u-ca-persian-nu-latn";
const PERSIAN_DISPLAY_LOCALE = "fa-IR-u-ca-persian-nu-arabext";
const GREGORIAN_LOCALE = "en-US-u-ca-gregory-nu-latn";
const DAY_MS = 24 * 60 * 60 * 1000;

const persianCalendarParts = new Intl.DateTimeFormat(PERSIAN_CALENDAR_LOCALE, {
  timeZone: TEHRAN_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
});
const tehranGregorianParts = new Intl.DateTimeFormat(GREGORIAN_LOCALE, {
  timeZone: TEHRAN_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function numericParts(formatter, date) {
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => ["year", "month", "day", "hour", "minute"].includes(part.type))
      .map((part) => [part.type, Number(part.value)])
  );
}

function getJalaliYearStart(year) {
  const guess = Date.UTC(year + 621, 2, 20, 8, 30);
  for (let offset = -4; offset <= 4; offset += 1) {
    const candidate = new Date(guess + offset * DAY_MS);
    const persian = numericParts(persianCalendarParts, candidate);
    if (persian.year === year && persian.month === 1 && persian.day === 1) {
      const gregorian = numericParts(tehranGregorianParts, candidate);
      return Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day);
    }
  }
  throw new RangeError("Unable to resolve the start of the requested Persian year.");
}

function jalaliMonthLength(year, month) {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  if (month === 12) {
    return Math.round((getJalaliYearStart(year + 1) - getJalaliYearStart(year)) / DAY_MS) - 336;
  }
  return 0;
}

function jalaliToGregorian(year, month, day) {
  if (!Number.isInteger(year) || year < 1200 || year > 1600
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > jalaliMonthLength(year, month)) {
    return null;
  }
  let days = day - 1;
  for (let currentMonth = 1; currentMonth < month; currentMonth += 1) {
    days += jalaliMonthLength(year, currentMonth);
  }
  const date = new Date(getJalaliYearStart(year) + days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export { toLatinDigits };

export function toPersianDigits(value) {
  return String(value ?? "").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

export function formatIranianDate(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
    timeZone: TEHRAN_TIME_ZONE, dateStyle: "medium", ...options,
  }).format(date);
}

export function formatIranianDateTime(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
    timeZone: TEHRAN_TIME_ZONE, dateStyle: "medium", timeStyle: "short", ...options,
  }).format(date);
}

export function formatIranianTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
    timeZone: TEHRAN_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function formatIranianYear(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return toPersianDigits(numericParts(persianCalendarParts, date).year);
}

export function formatIranianDateTimeInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = numericParts(tehranGregorianParts, date);
  const jalali = numericParts(persianCalendarParts, date);
  const pad = (number) => String(number).padStart(2, "0");
  return toPersianDigits(
    String(jalali.year).padStart(4, "0") + "/" + pad(jalali.month) + "/" + pad(jalali.day) +
    " " + pad(time.hour) + ":" + pad(time.minute)
  );
}

export function parseIranianDateTime(value) {
  const normalized = toLatinDigits(value).trim().replace(/[-.]/g, "/");
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const gregorian = jalaliToGregorian(year, month, day);
  if (!gregorian) return null;

  const wallClock = Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day, hour, minute);
  const local = numericParts(tehranGregorianParts, new Date(wallClock));
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const result = new Date(wallClock - (localAsUtc - wallClock));
  const roundTrip = numericParts(tehranGregorianParts, result);
  if (roundTrip.year !== gregorian.year || roundTrip.month !== gregorian.month
    || roundTrip.day !== gregorian.day || roundTrip.hour !== hour || roundTrip.minute !== minute) return null;
  return result;
}

export function formatIranianChartDate(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
      timeZone: "UTC", month: "short", day: "numeric",
    }).format(date);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
    timeZone: TEHRAN_TIME_ZONE, month: "short", day: "numeric",
  }).format(date);
}


export function getIranianDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    ...numericParts(persianCalendarParts, date),
    ...((({ hour, minute }) => ({ hour, minute }))(numericParts(tehranGregorianParts, date))),
  };
}

export function getIranianMonthLength(year, month) {
  return jalaliMonthLength(year, month);
}

export function getIranianWeekdayOffset(year, month) {
  const gregorian = jalaliToGregorian(year, month, 1);
  if (!gregorian) return 0;
  // Iranian weeks begin on Saturday; JavaScript starts the week on Sunday.
  return (new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day, 12)).getUTCDay() + 1) % 7;
}

export function formatIranianMonthTitle(year, month) {
  const gregorian = jalaliToGregorian(year, month, 1);
  if (!gregorian) return "";
  const date = new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day, 12));
  return new Intl.DateTimeFormat(PERSIAN_DISPLAY_LOCALE, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function createIranianDateTimeInputValue(year, month, day, hour, minute) {
  const pad = (number) => String(number).padStart(2, "0");
  return toPersianDigits(
    String(year).padStart(4, "0") + "/" + pad(month) + "/" + pad(day) +
    " " + pad(hour) + ":" + pad(minute)
  );
}
