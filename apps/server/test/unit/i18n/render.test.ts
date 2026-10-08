// F-160 renderMessage. TP-4.20, plus extra cases TP-4.33x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
// TP-4.20 needs `test.hello` = "Hello {name}" in apps/server/src/i18n/messages/en.json and no
// ar catalog (raised: a test message in the shipped catalog).
import { describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/i18n/render.js";

describe("TP-4.20: renderMessage", () => {
  it("TP-4.20: en, test.hello with name Ali isolates the value", () => {
    expect(renderMessage("en", "test.hello", { name: "Ali" })).toBe("Hello ⁨Ali⁩");
  });

  it("TP-4.20: ar-EG falls back to en", () => {
    expect(renderMessage("ar-EG", "test.hello", { name: "Ali" })).toBe("Hello ⁨Ali⁩");
  });

  it("TP-4.20: an unknown id throws Error('unknown message id')", () => {
    expect(() => renderMessage("en", "test.nope")).toThrow(new Error("unknown message id"));
  });
});

describe("TP-4.33x: renderMessage, further cases (F-160)", () => {
  it("TP-4.33x: a number value isn't isolated", () => {
    expect(renderMessage("en", "test.hello", { name: 7 })).toBe("Hello 7");
  });

  it("TP-4.33x: a value with markup-like text is isolated and left as text", () => {
    expect(renderMessage("en", "test.hello", { name: "<b>x</b>" })).toBe("Hello ⁨<b>x</b>⁩");
  });
});
