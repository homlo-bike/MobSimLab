import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarSection } from "../src/workspace/CalendarSection";
import type { PreferencesDoc } from "../src/workspace/preferences";
import {
  calendarApi,
  calendarFrom,
  countDays,
  datesOf,
  dayCounts,
  dayTypeOf,
  holidayRows,
  holidaysFor,
  serviceDayFor,
  simulationYearsFrom,
  withCalendar,
  withDayCount,
  withFetched,
  withHolidayAdded,
  withHolidayRemoved,
  withServiceWindow,
  withSimulationYears,
  DEFAULT_WINDOW,
  parseClock,
  yearList,
  countryWeekend,
  eidHolidays,
  FRIDAY_SATURDAY,
  weekendOf,
  withCountryCustoms,
  withEid,
  withWeekend,
  type CalendarApi,
  type ServiceCalendar,
} from "../src/workspace/calendar";
import { DEFAULT_SERVICE_DAY } from "../src/features/journey-planner/network";

const DE_2027 = [
  { date: "2027-01-01", name: "New Year's Day", localName: "Neujahr" },
  { date: "2027-01-06", name: "Epiphany", regions: ["DE-BW", "DE-BY"] },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-05-01", name: "Labour Day" }, // a Saturday
  { date: "2027-12-25", name: "Christmas Day" }, // a Saturday
  { date: "2027-12-26", name: "St. Stephen's Day" }, // a Sunday
];

describe("project calendar", () => {
  it("knows every date's day type, with holidays before weekdays", () => {
    expect(datesOf(2027)).toHaveLength(365);
    expect(datesOf(2028)).toHaveLength(366);
    expect(dayTypeOf("2027-01-04", {}, [])).toBe("weekday"); // Monday
    expect(dayTypeOf("2027-01-02", {}, [])).toBe("saturday");
    expect(dayTypeOf("2027-01-03", {}, [])).toBe("sunday");
    expect(dayTypeOf("2027-05-01", {}, ["2027-05-01"])).toBe("holiday");
  });

  it("counts the national holidays, the region's, and the planner's changes", () => {
    let cal: ServiceCalendar = withFetched({}, 2027, DE_2027);
    expect(holidaysFor(cal, 2027)).toEqual([
      "2027-01-01",
      "2027-03-26",
      "2027-03-29",
      "2027-05-01",
      "2027-12-25",
      "2027-12-26",
    ]);
    expect(holidaysFor({ ...cal, region: "DE-BY" }, 2027)).toContain("2027-01-06");
    cal = withHolidayRemoved(cal, "2027-03-29");
    cal = withHolidayAdded(cal, { date: "2027-11-17", name: "Town festival" });
    expect(holidaysFor(cal, 2027)).not.toContain("2027-03-29");
    expect(holidaysFor(cal, 2027)).toContain("2027-11-17");
    expect(holidaysFor(cal, 2028)).toEqual([]);
    // Restoring a fetched day takes it off the removed list instead of adding a copy.
    const back = withHolidayAdded(cal, { date: "2027-03-29", name: "x" });
    expect(back.removed).toEqual([]);
    expect(back.added?.map((h) => h.date)).toEqual(["2027-11-17"]);
    // Removing an added day drops it.
    expect(withHolidayRemoved(cal, "2027-11-17").added).toEqual([]);
    const rows = holidayRows({ ...cal }, 2027);
    expect(rows.find((r) => r.date === "2027-01-06")).toMatchObject({ counts: false, reason: "region" });
    expect(rows.find((r) => r.date === "2027-03-29")).toMatchObject({ counts: false, reason: "removed" });
    expect(rows.find((r) => r.date === "2027-11-17")).toMatchObject({ counts: true, origin: "added" });
  });

  it("counts the days of each day type in a year, and keeps the planner's own counts", () => {
    // 2027 starts on a Friday: 52 Saturdays, 52 Sundays, 261 weekdays without holidays.
    expect(countDays(2027, {}, [])).toEqual({ weekday: 261, saturday: 52, sunday: 52, holiday: 0 });
    const cal = withFetched({}, 2027, DE_2027);
    const c = dayCounts(2027, cal);
    // Holidays on Friday, Monday, Saturday (2) and Sunday.
    expect(c.counted).toEqual({ weekday: 258, saturday: 50, sunday: 51, holiday: 6 });
    expect(c.hasHolidays).toBe(true);
    expect(dayCounts(2028, cal).hasHolidays).toBe(false);
    const own = withDayCount(cal, 2027, "holiday", 10);
    expect(dayCounts(2027, own).used.holiday).toBe(10);
    expect(dayCounts(2027, own).own).toEqual({ holiday: true });
    expect(withDayCount(own, 2027, "holiday", null).counts).toEqual({});
  });

  it("keeps the years and the calendar in the preferences document", () => {
    const today = new Date("2026-11-16T12:00:00Z");
    expect(simulationYearsFrom(null, today)).toEqual({ first: 2026, last: 2035 });
    const doc = withSimulationYears(null, { first: 2030, last: 2032 });
    expect(simulationYearsFrom(doc, today)).toEqual({ first: 2030, last: 2032 });
    expect(yearList({ first: 2030, last: 2032 })).toEqual([2030, 2031, 2032]);
    expect(() => withSimulationYears(null, { first: 2030, last: 2029 })).toThrow();
    expect(withSimulationYears(doc, null).simulationYears).toBeUndefined();
    // Broken values fall back to the defaults.
    expect(simulationYearsFrom({ values: {}, simulationYears: { first: 3, last: 2 } }, today).first).toBe(
      2026,
    );

    expect(calendarFrom(null)).toEqual({});
    const withCal = withCalendar(doc, { country: "DE", added: [], removed: [] });
    expect(withCal.calendar).toEqual({ country: "DE" });
    expect(withCalendar(withCal, {}).calendar).toBeUndefined();
  });

  it("gives each day type's service day, or the default one", () => {
    expect(serviceDayFor({}, "sunday")).toBe(DEFAULT_SERVICE_DAY);
    const cal: ServiceCalendar = { days: { sunday: { firstMin: 360, lastMin: 1440, peaks: [] } } };
    expect(serviceDayFor(cal, "sunday")).toEqual({ firstS: 21600, lastS: 86400, peaks: [] });
  });

  it("keeps a day type's own service day, and drops one that is the default or makes no sense", () => {
    const sunday = { firstMin: 7 * 60, lastMin: 23 * 60, peaks: [] as [number, number][] };
    const cal = withServiceWindow({}, "sunday", sunday);
    expect(cal.days).toEqual({ sunday });
    expect(withServiceWindow(cal, "sunday", { ...sunday, lastMin: 6 * 60 })).toBe(cal);
    expect(withServiceWindow(cal, "sunday", DEFAULT_WINDOW).days).toBeUndefined();
    expect(withServiceWindow(cal, "sunday", null).days).toBeUndefined();
    expect(parseClock("24:30")).toBe(1470);
    expect(parseClock("7.05")).toBe(425);
    expect(parseClock("31:00")).toBeNull();
  });

  it("fetches a year's holidays once through the API", async () => {
    const calls: string[] = [];
    const api = calendarApi((async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ holidays: DE_2027 }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(await api.holidays("DE", 2027)).toHaveLength(7);
    await api.holidays("de", 2027);
    expect(calls).toEqual(["/api/calendar/holidays?country=DE&year=2027"]);
  });
});

describe("weekend and Eid", () => {
  it("runs the Sunday service on Fridays and the Saturday one on Saturdays in a Friday and Saturday weekend", () => {
    const cal = withWeekend({}, FRIDAY_SATURDAY);
    expect(dayTypeOf("2027-01-01", cal, [])).toBe("sunday"); // Friday
    expect(dayTypeOf("2027-01-02", cal, [])).toBe("saturday");
    expect(dayTypeOf("2027-01-03", cal, [])).toBe("weekday"); // Sunday
    const c = countDays(2027, cal, []);
    expect(c).toEqual({ weekday: 260, saturday: 52, sunday: 53, holiday: 0 });
  });

  it("takes the country's usual weekend unless the planner chose one", () => {
    expect(countryWeekend("sy")).toEqual(FRIDAY_SATURDAY);
    expect(countryWeekend("DE")).toEqual({ rest: 0, second: 6 });
    expect(weekendOf({ country: "SY" })).toEqual(FRIDAY_SATURDAY);
    expect(weekendOf({ country: "SY", weekend: { rest: 0, second: 6 } })).toEqual({ rest: 0, second: 6 });
    // A broken value falls back to the country's.
    expect(weekendOf({ country: "SY", weekend: { rest: 3, second: 3 } })).toEqual(FRIDAY_SATURDAY);
  });

  it("dates Eid al-Fitr and Eid al-Adha from the Umm al-Qura calendar", () => {
    expect(eidHolidays(2026).map((h) => h.date)).toEqual([
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]);
    expect(eidHolidays(2026)[0]).toMatchObject({ name: "Eid al-Fitr", localName: "عيد الفطر" });
  });

  it("adds the Eid days only where the country observes Eid and the list lacks them", () => {
    const sy = [{ date: "2026-01-01", name: "New Year's Day" }];
    expect(withEid("SY", 2026, sy)).toHaveLength(8);
    expect(withEid("DE", 2026, sy)).toHaveLength(1);
    // A list with Eid al-Fitr on another day (moon sighting) keeps its own; Eid al-Adha is still added.
    const tr = [{ date: "2026-03-19", name: "Ramadan Feast" }];
    expect(withEid("TR", 2026, tr).map((h) => h.date)).toEqual([
      "2026-03-19",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]);
  });

  it("fills in a saved calendar's weekend and Eid days once, and leaves other countries alone", () => {
    const cal: ServiceCalendar = { fetched: { "2026": [{ date: "2026-01-01", name: "New Year's Day" }] } };
    const sy = withCountryCustoms(cal, "SY");
    expect(sy.weekend).toEqual(FRIDAY_SATURDAY);
    expect(sy.fetched?.["2026"]).toHaveLength(8);
    expect(withCountryCustoms(sy, "SY")).toBe(sy);
    expect(withCountryCustoms(cal, "DE")).toBe(cal);
    // The planner's own weekend stays.
    expect(withCountryCustoms({ weekend: { rest: 0, second: 6 } }, "SY").weekend).toEqual({
      rest: 0,
      second: 6,
    });
  });
});

describe("calendar section", () => {
  afterEach(cleanup);
  const today = new Date("2027-03-01T12:00:00Z");
  const api: CalendarApi = {
    holidays: vi.fn(async (_c: string, y: number) => (y === 2027 ? DE_2027 : [])),
  };

  it("fetches the missing years' holidays into the project and counts the days", async () => {
    let doc: PreferencesDoc = withSimulationYears(null, { first: 2027, last: 2028 });
    const onPreferences = vi.fn((d: PreferencesDoc) => {
      doc = d;
    });
    const { rerender } = render(
      <CalendarSection
        preferences={doc}
        editable
        onPreferences={onPreferences}
        detectedCountry="de"
        api={api}
        today={today}
      />,
    );
    await waitFor(() => expect(onPreferences).toHaveBeenCalled());
    expect(api.holidays).toHaveBeenCalledWith("DE", 2027);
    expect(Object.keys(doc.calendar?.fetched ?? {})).toEqual(["2027", "2028"]);
    rerender(
      <CalendarSection
        preferences={doc}
        editable
        onPreferences={onPreferences}
        detectedCountry="de"
        api={api}
        today={today}
      />,
    );
    expect(screen.getByLabelText("2027 · Public holiday")).toHaveProperty("value", "6");
    expect(screen.getByLabelText("2028 · Weekday")).toHaveProperty("value", "260");
    // Not counting Good Friday turns it into a weekday.
    fireEvent.click(screen.getAllByRole("button", { name: "Don't count" })[1]!);
    expect(doc.calendar?.removed).toEqual(["2027-03-26"]);
    rerender(
      <CalendarSection
        preferences={doc}
        editable
        onPreferences={onPreferences}
        detectedCountry="de"
        api={api}
        today={today}
      />,
    );
    expect(screen.getByLabelText("2027 · Weekday")).toHaveProperty("value", "259");
    // An own count is kept and marked.
    fireEvent.change(screen.getByLabelText("2027 · Sunday"), { target: { value: "40" } });
    expect(doc.calendar?.counts).toEqual({ "2027": { sunday: 40 } });
  });

  it("gives a Syrian project a Friday and Saturday weekend and the Eid days", async () => {
    const syApi: CalendarApi = {
      holidays: vi.fn(async () => [{ date: "2026-01-01", name: "New Year's Day" }]),
    };
    let doc: PreferencesDoc = withSimulationYears(null, { first: 2026, last: 2026 });
    const onPreferences = vi.fn((d: PreferencesDoc) => {
      doc = d;
    });
    const props = { editable: true, onPreferences, detectedCountry: "sy", api: syApi, today };
    const { rerender } = render(<CalendarSection preferences={doc} {...props} />);
    await waitFor(() => expect(doc.calendar?.fetched?.["2026"]).toHaveLength(8));
    expect(doc.calendar?.weekend).toEqual(FRIDAY_SATURDAY);
    rerender(<CalendarSection preferences={doc} {...props} />);
    expect(screen.getByLabelText("Weekend")).toHaveProperty("value", "1");
    expect(screen.getByText("Eid al-Adha (day 4)", { exact: false })).toBeTruthy();
    // Friday is the Sunday day type: 52 Fridays in 2026 less two Eid days (20 March, 29 May).
    expect(screen.getByLabelText("2026 · Friday")).toHaveProperty("value", "50");
    // The planner can go back to a Saturday and Sunday weekend.
    fireEvent.change(screen.getByLabelText("Weekend"), { target: { value: "0" } });
    expect(doc.calendar?.weekend).toEqual({ rest: 0, second: 6 });
  });

  it("sets a day type's service hours and peaks, and goes back to the default", () => {
    let doc: PreferencesDoc = withSimulationYears(null, { first: 2027, last: 2027 });
    const onPreferences = vi.fn((d: PreferencesDoc) => {
      doc = d;
    });
    const view = () => (
      <CalendarSection preferences={doc} editable onPreferences={onPreferences} api={api} today={today} />
    );
    const { rerender } = render(view());
    expect(screen.getByLabelText("Weekday · First departure")).toHaveProperty("value", "05:00");
    // Saturday: service from 06:00 and no evening peak.
    fireEvent.change(screen.getByLabelText("Saturday · First departure"), { target: { value: "06:00" } });
    expect(doc.calendar?.days?.saturday?.firstMin).toBe(360);
    rerender(view());
    fireEvent.change(screen.getByLabelText("Saturday · Evening peak from"), { target: { value: "" } });
    // Half a peak is not saved yet.
    expect(doc.calendar?.days?.saturday?.peaks).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Saturday · Evening peak to"), { target: { value: "" } });
    expect(doc.calendar?.days?.saturday).toEqual({ firstMin: 360, lastMin: 1470, peaks: [[420, 540]] });
    rerender(view());
    // A last departure before the first is not saved, and says why.
    fireEvent.change(screen.getByLabelText("Saturday · Last departure"), { target: { value: "04:00" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(doc.calendar?.days?.saturday?.lastMin).toBe(1470);
    fireEvent.click(screen.getByRole("button", { name: "Saturday: Back to the default" }));
    expect(doc.calendar?.days).toBeUndefined();
  });

  it("lets viewers see the holidays without saving them", async () => {
    const onPreferences = vi.fn();
    render(
      <CalendarSection
        preferences={withSimulationYears(null, { first: 2027, last: 2027 })}
        editable={false}
        onPreferences={onPreferences}
        detectedCountry="DE"
        api={api}
        today={today}
      />,
    );
    expect(await screen.findByText(/Karfreitag|Good Friday/)).toBeTruthy();
    expect(onPreferences).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Don't count" })).toBeNull();
  });
});
