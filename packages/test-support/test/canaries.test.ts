// F-198 CANARIES and scanForCanaries (test tooling, delivered in S-3). TP-16.1, plus extra cases
// TP-3.13x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { CANARIES, scanForCanaries } from "../src/index.js";

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("TP-16.1: scanForCanaries", () => {
  it("TP-16.1: finds a canary raw, base64-encoded and URL-encoded, with the source and offset", () => {
    const raw = CANARIES.email;
    const encoded = base64(raw);
    const url = encodeURIComponent(raw);
    const text = `a ${raw} b ${encoded} c ${url} d`;

    const hits = scanForCanaries([{ name: "log", text }], CANARIES);

    expect(hits).toEqual([
      { source: "log", canary: "email", offset: text.indexOf(raw) },
      { source: "log", canary: "email", offset: text.indexOf(encoded) },
      { source: "log", canary: "email", offset: text.indexOf(url) },
    ]);
  });
});

describe("TP-3.13x: CANARIES and scanForCanaries, further cases", () => {
  it("TP-3.13x: the canaries are F-198's values", () => {
    expect(CANARIES).toEqual({
      amountMinor: "987654321",
      payee: "CANARYPAYEE7f3a",
      email: "canary.7f3a@example.invalid",
      token: "ya29.CANARYTOKEN7f3a",
      message: "CANARYMESSAGE7f3a",
    });
  });

  it("TP-3.13x: clean text has no hits", () => {
    expect(scanForCanaries([{ name: "a", text: "nothing to see 12345" }], CANARIES)).toEqual([]);
  });

  it("TP-3.13x: the search is case-sensitive", () => {
    const text = CANARIES.payee.toLowerCase();

    expect(scanForCanaries([{ name: "a", text }], CANARIES)).toEqual([]);
  });

  it("TP-3.13x: every canary is found, each hit naming its source", () => {
    const sources = [
      { name: "one", text: `x${CANARIES.amountMinor}` },
      { name: "two", text: `${CANARIES.token} ${CANARIES.message}` },
    ];

    const hits = scanForCanaries(sources, CANARIES);

    expect(hits).toEqual([
      { source: "one", canary: "amountMinor", offset: 1 },
      { source: "two", canary: "token", offset: 0 },
      { source: "two", canary: "message", offset: CANARIES.token.length + 1 },
    ]);
  });

  it("TP-3.13x: a canary whose URL-encoded form equals the raw value is reported once per occurrence", () => {
    const text = `${CANARIES.payee}|${CANARIES.payee}`;

    expect(scanForCanaries([{ name: "a", text }], CANARIES)).toEqual([
      { source: "a", canary: "payee", offset: 0 },
      { source: "a", canary: "payee", offset: CANARIES.payee.length + 1 },
    ]);
  });

  // Code review B-3: a canary is found in a base64 payload at every byte offset, not only when its
  // offset is a multiple of 3.
  it.each([0, 1, 2, 3, 4, 5])(
    "TP-3.13x: a canary %i bytes into a base64-encoded JSON payload is found",
    (fillerLength) => {
      const json = JSON.stringify({ [`k${"x".repeat(fillerLength)}`]: CANARIES.payee });
      const text = base64(json);

      expect(scanForCanaries([{ name: "b64", text }], CANARIES).map((h) => h.canary)).toEqual([
        "payee",
      ]);
    },
  );

  it.each([['{"xy":"'], ['{"xyz":"'], ['{"x":"']])(
    "TP-3.13x: the review's payload %s<payee>\"} is found",
    (prefix) => {
      const text = base64(`${prefix}${CANARIES.payee}"}`);

      expect(scanForCanaries([{ name: "b64", text }], CANARIES)).toHaveLength(1);
    },
  );

  it.each([["amountMinor"], ["payee"], ["email"], ["token"], ["message"]] as const)(
    "TP-3.13x: the %s canary is found at each of the three alignments",
    (canary) => {
      for (const filler of ["", "a", "ab"]) {
        const text = base64(`${filler}${CANARIES[canary]}tail`);

        expect(
          scanForCanaries([{ name: "b64", text }], CANARIES).map((h) => h.canary),
          `filler ${JSON.stringify(filler)}`,
        ).toContain(canary);
      }
    },
  );
});
