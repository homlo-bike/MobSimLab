/**
 * English messages of the timetables (FR-TT-03): the day type choice of the street line tool and the railway
 * tool's service lines. Merged into each language's dictionary; every language has its own file next to this one.
 */
export const timetablesEn = {
  "tt.dayType": "Timetable for",
  "tt.sameAsWeekday": "Same as weekday",
};

/** A language's timetable messages: every key of the English ones. */
export type TimetablesMessages = Record<keyof typeof timetablesEn, string>;
