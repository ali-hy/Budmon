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
 * The raw value, its URL-encoded form and its base64 forms, without repeats.
 *
 * Inside a longer base64 payload the canary can start at any byte offset, and its encoding depends
 * on that offset modulo 3. For each of the three alignments this encodes the canary after 0, 1 or
 * 2 filler bytes and keeps only the characters that depend on the canary's bytes alone: it drops
 * the leading characters that mix in the filler and the trailing ones that would mix in whatever
 * follows the canary.
 */
function forms(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  const base64Forms = [0, 1, 2].map((pad) => {
    const encoded = Buffer.concat([Buffer.alloc(pad), bytes]).toString("base64");
    const start = [0, 2, 3][pad] ?? 0;
    const end = Math.floor((bytes.length + pad) / 3) * 4;
    return encoded.slice(start, end);
  });
  return [...new Set([value, encodeURIComponent(value), ...base64Forms])].filter(
    (form) => form.length >= 4,
  );
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
