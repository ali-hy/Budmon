// F-311 IDs. TP-1.12, plus the extra cases TP-1.22x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { isUuid, uuidv7Generator } from "../src/ids/ids.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("F-311 uuidv7Generator", () => {
  it("TP-1.12: 1000 IDs are lower-case UUIDv7s in non-decreasing order", () => {
    const ids = Array.from({ length: 1000 }, () => uuidv7Generator.next());

    expect(ids.filter((id) => !UUID_V7.test(id))).toEqual([]);
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i - 1] ?? "") <= (ids[i] ?? "")).toBe(true);
    }
  });

  it("TP-1.22x: generated IDs pass isUuid", () => {
    expect(isUuid(uuidv7Generator.next())).toBe(true);
  });
});

describe("F-311 isUuid", () => {
  it.each([
    ["a v4", "f47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["a v7", "01927f3a-6b1c-7d2e-8f00-123456789abc"],
  ])("TP-1.22x: accepts %s in lower case", (_label, value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ["upper case", "F47AC10B-58CC-4372-A567-0E02B2C3D479"],
    ["no dashes", "f47ac10b58cc4372a5670e02b2c3d479"],
    ["too short", "f47ac10b-58cc-4372-a567-0e02b2c3d47"],
    ["braces", "{f47ac10b-58cc-4372-a567-0e02b2c3d479}"],
    ["non-hex", "g47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["empty", ""],
  ])("TP-1.22x: rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
