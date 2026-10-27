import type { DaySchedule, SpecialClosure } from "@/models/company-settings";

import type { Language } from "./types";

/** Business-hours calculations in the company's timezone (default Asia/Dubai). */

const DAY_NAMES: Record<Language, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
};

interface ZonedNow {
  day: number;
  minutes: number;
  date: string;
}

export function zonedNow(now: Date, timezone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    day: weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isOpenNow(
  schedule: readonly DaySchedule[],
  closures: readonly SpecialClosure[],
  timezone: string,
  now: Date,
): boolean | null {
  if (schedule.length === 0) return null;
  const zoned = zonedNow(now, timezone);
  if (closures.some((closure) => closure.date === zoned.date)) return false;
  const today = schedule.find((entry) => entry.day === zoned.day);
  if (!today || today.closed) return false;
  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  // Supports hours past midnight (e.g. 18:00–02:00) by treating close < open as next day.
  return close > open ? zoned.minutes >= open && zoned.minutes < close : zoned.minutes >= open || zoned.minutes < close;
}

export function formatHours(schedule: readonly DaySchedule[], language: Language): string | null {
  if (schedule.length === 0) return null;
  const names = DAY_NAMES[language];
  const closed = language === "ar" ? "مغلق" : "Closed";
  return [...schedule]
    .sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))
    .map((entry) => `${names[entry.day] ?? entry.day}: ${entry.closed ? closed : `${entry.open}–${entry.close}`}`)
    .join("\n");
}
