// F-198: the privacy canaries and the scanner (LLD §10.1, delivered in S-3). Owned by the
// test-architect; the rehearsal harness (S-16) imports it read-only.
//
// Each privacy flow puts these values into every sensitive field, captures what the system
// writes (logs, spans, metrics, error reports, job output) and asserts `scanForCanaries` finds
// nothing.

export interface Canaries {
  amountMinor: string;
  payee: string;
  email: string;
  token: string;
  message: string;
}

export interface CanaryHit {
  source: string;
  canary: keyof Canaries;
  offset: number;
}

export const CANARIES: Canaries = Object.freeze({
  amountMinor: "987654321",
  payee: "CANARYPAYEE7f3a",
  email: "canary.7f3a@example.invalid",
  token: "ya29.CANARYTOKEN7f3a",
  message: "CANARYMESSAGE7f3a",
});

/**
 * The raw value, its base64 form and its URL-encoded form, without repeats. The base64 form covers
 * only the whole 3-byte groups, so it also matches when the canary starts a longer encoded payload
 * (the last, partial group depends on the bytes that follow).
 */
function forms(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  const base64 = bytes.subarray(0, bytes.length - (bytes.length % 3)).toString("base64");
  return [...new Set([value, base64, encodeURIComponent(value)])].filter((f) => f !== "");
}

/**
 * Case-sensitive substring search for every canary, raw, base64-encoded and URL-encoded, in every
 * source. Returns one hit per occurrence, ordered by source, then offset.
 */
export function scanForCanaries(
  sources: readonly { name: string; text: string }[],
  canaries: Canaries,
): CanaryHit[] {
  const hits: CanaryHit[] = [];
  const names = Object.keys(canaries) as (keyof Canaries)[];
  for (const source of sources) {
    const found: CanaryHit[] = [];
    for (const canary of names) {
      const seen = new Set<number>();
      for (const form of forms(canaries[canary])) {
        let offset = source.text.indexOf(form);
        while (offset !== -1) {
          if (!seen.has(offset)) {
            seen.add(offset);
            found.push({ source: source.name, canary, offset });
          }
          offset = source.text.indexOf(form, offset + 1);
        }
      }
    }
    found.sort((a, b) => a.offset - b.offset || a.canary.localeCompare(b.canary));
    hits.push(...found);
  }
  return hits;
}
