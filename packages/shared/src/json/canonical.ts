// F-306: canonical JSON (sorted keys, no whitespace).
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers can't be serialised");
      return JSON.stringify(value);
    case "object":
      return canonicalObject(value);
    default:
      throw new TypeError(`Can't serialise a value of type ${typeof value}`);
  }
}

function canonicalObject(value: object): string {
  if (Array.isArray(value)) {
    return `[${Array.from(value as unknown[], (item) => canonicalJson(item)).join(",")}]`;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Only plain objects and arrays can be serialised");
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}
