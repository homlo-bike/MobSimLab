import { createContext, useContext } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { type DayTypeId, SATURDAY_SUNDAY, type Weekend } from "./calendar";

/** The project's weekend (Project preferences → Calendar), for the day type names in every tool. */
export const WeekendContext = createContext<Weekend>(SATURDAY_SUNDAY);

const KEY: Record<"weekday" | "holiday", MessageKey> = {
  weekday: "cal.day.weekday",
  holiday: "cal.day.holiday",
};

/**
 * Purpose: the name of a day of the week (0 Sunday to 6 Saturday) in a language: the app's own words for
 * Saturday and Sunday, the browser's for the other days.
 */
export function weekdayName(day: number, language: string, t: (key: MessageKey) => string): string {
  if (day === 6) return t("cal.day.saturday");
  if (day === 0) return t("cal.day.sunday");
  try {
    // 1 January 2023 was a Sunday.
    const name = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2023, 0, 1 + day)),
    );
    return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  } catch {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? String(day);
  }
}

/**
 * Purpose: the name of a day type with the project's weekend: the "sunday" day type is named after the main rest
 * day and the "saturday" one after the other weekend day (Friday and Saturday in Syria).
 */
export function dayTypeName(
  dt: DayTypeId,
  weekend: Weekend,
  language: string,
  t: (key: MessageKey) => string,
): string {
  if (dt === "saturday")
    return weekend.second === undefined ? t("cal.day.saturday") : weekdayName(weekend.second, language, t);
  if (dt === "sunday") return weekdayName(weekend.rest, language, t);
  return t(KEY[dt]);
}

/** Purpose: the day type names of the project's weekend, in the page's language. */
export function useDayTypeLabel(): (dt: DayTypeId) => string {
  const { t, language } = useI18n();
  const weekend = useContext(WeekendContext);
  return (dt) => dayTypeName(dt, weekend, language, t);
}

/**
 * Purpose: a day type's text from a tool's own messages (`keys`), unless the project's weekend moves the Saturday
 * or Sunday day type to another day of the week: then that day's name.
 */
export function useDayTypeText(): (dt: DayTypeId, keys: Record<DayTypeId, MessageKey>) => string {
  const { t, language } = useI18n();
  const weekend = useContext(WeekendContext);
  return (dt, keys) =>
    (dt === "saturday" && weekend.second !== undefined && weekend.second !== 6) ||
    (dt === "sunday" && weekend.rest !== 0)
      ? dayTypeName(dt, weekend, language, t)
      : t(keys[dt]);
}

const ENGLISH_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Purpose: the day type names in English with the project's weekend, for downloads that stay in English. */
export function englishDayTypeNames(weekend: Weekend): Record<DayTypeId, string> {
  return {
    weekday: "Weekday",
    saturday: (weekend.second === undefined ? undefined : ENGLISH_DAYS[weekend.second]) ?? "Saturday",
    sunday: ENGLISH_DAYS[weekend.rest] ?? "Sunday",
    holiday: "Public holiday",
  };
}
