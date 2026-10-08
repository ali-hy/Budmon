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

  it("TP-3.13x: a base64 canary inside a longer base64 payload is found when it starts the payload", () => {
    const text = base64(`${CANARIES.token} and more`);

    const hits = scanForCanaries([{ name: "b64", text }], CANARIES);

    expect(hits.map((h) => h.canary)).toContain("token");
  });
});
