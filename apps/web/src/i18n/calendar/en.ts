/**
 * English messages of the project calendar and the multi-year runs (ADR-0020): the Preferences section with the
 * simulation years, public holidays and day counts, and the Simulator's multi-year, single-date and multi-day
 * runs. Merged into each language's dictionary; every language has its own file next to this one.
 */
export const calendarEn = {
  "cal.title": "Calendar and years",
  "cal.intro":
    "A run simulates one typical day of each day type. A year's figures are each day type's figures times the number of its days in that year.",
  "cal.years": "Simulation years",
  "cal.first": "First year",
  "cal.last": "Last year",
  "cal.yearsDefault": "Default: {first} to {last}. At most {max} years.",
  "cal.reset": "Back to the default",
  "cal.country": "Country of the public holidays",
  "cal.countryHint": "Two-letter code, such as DE. Empty: the country at the project's location ({code}).",
  "cal.countryUnknown":
    "Two-letter code, such as DE. Empty: the country at the project's location (not known yet).",
  "cal.region": "Region with its own holidays (optional)",
  "cal.regionHint": "Code such as DE-BY. Holidays of other regions do not count.",
  "cal.holidays": "Public holidays in {year}",
  "cal.year": "Year",
  "cal.noCountry": "Set the country to fetch the public holidays.",
  "cal.loading": "Fetching the public holidays…",
  "cal.fetchFailed": "The public holidays could not be fetched: {error}",
  "cal.retry": "Try again",
  "cal.noneYet": "No public holidays for this year yet.",
  "cal.added": "added",
  "cal.otherRegion": "only in {regions}",
  "cal.delete": "Remove",
  "cal.remove": "Don't count",
  "cal.restore": "Count again",
  "cal.addDate": "Date",
  "cal.addName": "Name",
  "cal.add": "Add day off",
  "cal.source":
    "Public holidays from Nager.Date (date.nager.at). The project keeps its own copy with your changes.",
  "cal.counts": "Days per day type",
  "cal.countsIntro":
    "Counted from the calendar. Type a number to use your own; it is outlined and ↺ goes back to the counted one.",
  "cal.total": "Total",
  "cal.noHolidaysYear": "No public holidays fetched yet",
  "cal.resetCount": "back to the counted {value}",
  "cal.day.weekday": "Weekday",
  "cal.day.saturday": "Saturday",
  "cal.day.sunday": "Sunday",
  "cal.day.holiday": "Public holiday",
};

/** A language's calendar messages: every key of the English ones. */
export type CalendarMessages = Record<keyof typeof calendarEn, string>;
