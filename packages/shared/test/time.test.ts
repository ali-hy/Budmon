// F-310 time. TP-1.11, plus the extra cases TP-1.21x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { fixedClock, isValidTimeZone, systemClock, todayIn, utcDateOf } from "../src/time/clock.js";
import { Temporal } from "../src/time/temporal.js";

describe("F-310 todayIn and utcDateOf", () => {
  it("TP-1.11: 22:30Z on 2026-10-05 is already 2026-10-06 in Africa/Cairo", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(todayIn(clock, "Africa/Cairo").toString()).toBe("2026-10-06");
  });

  it("TP-1.11: the same instant is 2026-10-05 in UTC", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(todayIn(clock, "UTC").toString()).toBe("2026-10-05");
  });

  it('TP-1.11: an invalid zone throws RangeError("Invalid time zone")', () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(() => todayIn(clock, "Mars/Base")).toThrow(new RangeError("Invalid time zone"));
  });

  it("TP-1.11: advancing 2 hours crosses the UTC date to 2026-10-06", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    clock.advance({ hours: 2 });

    expect(utcDateOf(clock.now()).toString()).toBe("2026-10-06");
  });

  it('TP-1.21x: todayIn with "Etc/Unknown" throws RangeError("Invalid time zone")', () => {
    expect(() => todayIn(fixedClock("2026-10-05T22:30:00Z"), "Etc/Unknown")).toThrow(
      new RangeError("Invalid time zone"),
    );
  });

  it("TP-1.21x: todayIn west of UTC is the previous date", () => {
    expect(todayIn(fixedClock("2026-10-06T02:00:00Z"), "America/New_York").toString()).toBe(
      "2026-10-05",
    );
  });
});

describe("F-310 clocks", () => {
  it("TP-1.21x: a fixed clock returns the same instant until it's moved", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    expect(clock.now().toString()).toBe("2026-10-05T22:30:00Z");
    expect(clock.now().toString()).toBe("2026-10-05T22:30:00Z");
  });

  it("TP-1.21x: set moves a fixed clock to a string or an Instant", () => {
    const clock = fixedClock(Temporal.Instant.from("2026-01-01T00:00:00Z"));

    clock.set("2026-03-01T12:00:00Z");
    expect(clock.now().toString()).toBe("2026-03-01T12:00:00Z");

    clock.set(Temporal.Instant.from("2027-01-01T00:00:00Z"));
    expect(clock.now().toString()).toBe("2027-01-01T00:00:00Z");
  });

  it("TP-1.21x: advance accepts a duration with several units", () => {
    const clock = fixedClock("2026-10-05T22:30:00Z");

    clock.advance({ minutes: 45, seconds: 30 });

    expect(clock.now().toString()).toBe("2026-10-05T23:15:30Z");
  });

  it.each([["not a date"], [""], ["2026-13-01T00:00:00Z"]])(
    "TP-1.21x: fixedClock(%j) throws RangeError",
    (at) => {
      expect(() => fixedClock(at)).toThrow(RangeError);
    },
  );

  it("TP-1.21x: systemClock reads the current time", () => {
    const before = Date.now();
    const now = systemClock.now().epochMilliseconds;
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("F-310 isValidTimeZone", () => {
  it.each([["Africa/Cairo"], ["UTC"], ["America/New_York"], ["Asia/Kuwait"]])(
    "TP-1.21x: %s is valid",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each([["Mars/Base"], ["Etc/Unknown"], [""], ["Not A Zone"]])(
    "TP-1.21x: %j is not valid",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});
