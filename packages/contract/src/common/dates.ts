// F-340: calendar dates and instants on the wire.
import { z } from "zod";

function isCalendarDate(value: string): boolean {
  const [y = "", m = "", d = ""] = value.split("-");
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(m, 10);
  const day = Number.parseInt(d, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const PlainDateWire = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "Invalid date" });

/** RFC 3339 in UTC with "Z", e.g. 2026-10-05T12:00:00.000Z. */
export const InstantWire = z.iso.datetime();
