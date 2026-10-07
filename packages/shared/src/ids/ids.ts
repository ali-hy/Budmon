// F-311: identifiers.
import { v7 } from "uuid";

export interface IdGenerator {
  next(): string;
}

export const uuidv7Generator: IdGenerator = { next: () => v7() };

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
