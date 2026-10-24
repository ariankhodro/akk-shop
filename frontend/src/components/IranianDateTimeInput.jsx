import { useState } from "react";
import { useDialog } from "../lib/use-dialog";
import { CalendarDays, CalendarClock, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import {
  createIranianDateTimeInputValue,
  formatIranianMonthTitle,
  getIranianDateParts,
  getIranianMonthLength,
  getIranianWeekdayOffset,
  parseIranianDateTime,
  toLatinDigits,
} from "../lib/iranian-date";

const weekdays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const IranianDateTimeInput = ({ id, label, value, onChange, required = false }) => {
  const [touched, setTouched] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useDialog({ open: showPicker, onClose: () => setShowPicker(false), modal: false });
  const [visibleMonth, setVisibleMonth] = useState(null);
  const parsed = parseIranianDateTime(value);
  const parts = getIranianDateParts(parsed || new Date()) || { year: 1405, month: 1, day: 1, hour: 12, minute: 0 };
  const shownYear = visibleMonth?.year ?? parts.year;
  const shownMonth = visibleMonth?.month ?? parts.month;
  const monthDays = getIranianMonthLength(shownYear, shownMonth);
  const firstWeekday = getIranianWeekdayOffset(shownYear, shownMonth);
  const timeMatch = toLatinDigits(value).match(/\s+(\d{1,2}):(\d{2})$/);
  const hour = timeMatch ? Math.min(23, Number(timeMatch[1])) : parts.hour;
  const minute = timeMatch ? Math.min(59, Number(timeMatch[2])) : parts.minute;
  const showError = touched && Boolean(value) && !parsed;

  const openPicker = () => {
    setVisibleMonth({ year: parts.year, month: parts.month });
    setShowPicker((open) => !open);
  };

  const shiftMonth = (amount) => {
    let year = shownYear;
    let month = shownMonth + amount;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    setVisibleMonth({ year, month });
  };

  const chooseDay = (day) => {
    onChange(createIranianDateTimeInputValue(shownYear, shownMonth, day, hour, minute));
    setTouched(true);
  };

  const updateTime = (nextHour, nextMinute) => {
    const selectedDay = parts.year === shownYear && parts.month === shownMonth && parts.day <= monthDays
      ? parts.day
      : 1;
    onChange(createIranianDateTimeInputValue(shownYear, shownMonth, selectedDay, nextHour, nextMinute));
    setTouched(true);
  };

  return (
    <div className="relative block text-sm text-gray-300">
      <label htmlFor={id} className="flex items-center gap-2">
        <CalendarClock size={15} className="text-[#68745f]" aria-hidden="true" />
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          required={required}
          maxLength={20}
          placeholder="۱۴۰۵/۰۷/۲۳ ۱۴:۳۰"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError}
          aria-describedby={showError ? id + "-error" : id + "-hint"}
          className={"min-w-0 flex-1 rounded-lg border bg-gray-700 px-3 py-2 text-center text-sm tabular-nums text-white outline-none transition focus:ring-2 " +
            (showError
              ? "border-red-500 focus:border-red-400 focus:ring-red-500/20"
              : "border-gray-600 focus:border-[#68745f] focus:ring-[#68745f]/30")}
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label={showPicker ? "بستن تقویم شمسی" : "انتخاب تاریخ و ساعت شمسی"}
          aria-expanded={showPicker}
          aria-controls={id + "-jalali-picker"}
          className="inline-flex min-w-11 items-center justify-center rounded-lg border border-gray-600 bg-gray-700 px-3 text-gray-100 transition hover:bg-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#68745f]"
        >
          <CalendarDays size={18} aria-hidden="true" />
        </button>
      </div>
      {showError ? (
        <span id={id + "-error"} role="alert" className="mt-1 block text-xs leading-5 text-red-300">
          تاریخ و ساعت را به‌شکل شمسی «سال/ماه/روز ساعت:دقیقه» وارد کنید.
        </span>
      ) : (
        <span id={id + "-hint"} className="mt-1 block text-[11px] leading-5 text-gray-400">
          تقویم شمسی · ساعت ایران (تهران) · نمونه: ۱۴۰۵/۰۷/۲۳ ۱۴:۳۰
        </span>
      )}

      {showPicker && (
        <div
          id={id + "-jalali-picker"}
          ref={pickerRef}
          role="dialog"
          aria-label={label + " - تقویم شمسی"}
          className="absolute right-0 top-full z-50 mt-2 w-[min(100%,22rem)] rounded-2xl border border-gray-600 bg-gray-900 p-4 text-gray-100 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="ماه قبل" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-700 hover:bg-gray-800">
              <ChevronRight size={17} aria-hidden="true" />
            </button>
            <h3 className="text-sm font-semibold">{formatIranianMonthTitle(shownYear, shownMonth)}</h3>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="ماه بعد" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-700 hover:bg-gray-800">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] text-gray-400">
            {weekdays.map((weekday, index) => <span key={weekday + index} className="py-1">{weekday}</span>)}
            {Array.from({ length: firstWeekday }, (_, index) => <span key={"blank-" + index} aria-hidden="true" />)}
            {Array.from({ length: monthDays }, (_, index) => {
              const day = index + 1;
              const selected = parts.year === shownYear && parts.month === shownMonth && parts.day === day && Boolean(parsed);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => chooseDay(day)}
                  aria-pressed={selected}
                  aria-label={day + " " + formatIranianMonthTitle(shownYear, shownMonth)}
                  className={"inline-flex h-9 items-center justify-center rounded-lg text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#68745f] " +
                    (selected ? "bg-[#68745f] font-bold text-white" : "hover:bg-gray-800")}
                >
                  {day.toLocaleString("fa-IR")}
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-gray-700 pt-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-300">
              <Clock3 size={14} aria-hidden="true" />
              ساعت ایران (۲۴ ساعته)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-400">
                ساعت
                <input type="number" min="0" max="23" value={hour} onChange={(event) => updateTime(Math.max(0, Math.min(23, Number(event.target.value) || 0)), minute)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-[#68745f]" />
              </label>
              <label className="text-xs text-gray-400">
                دقیقه
                <input type="number" min="0" max="59" value={minute} onChange={(event) => updateTime(hour, Math.max(0, Math.min(59, Number(event.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-[#68745f]" />
              </label>
            </div>
            <button type="button" onClick={() => setShowPicker(false)} className="mt-4 w-full rounded-lg bg-[#68745f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#41443b]">
              تأیید تاریخ و ساعت
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default IranianDateTimeInput;
