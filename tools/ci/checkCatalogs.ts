// F-9: every message ID the web app uses is in every shipped catalog (D-37).
import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "@formatjs/cli-lib";

/** For each shipped locale, the used IDs it lacks, sorted; `[]` when complete (A-312). */
export function checkCatalogs(input: {
  usedIds: ReadonlySet<string>;
  catalogs: Record<string, Record<string, string>>;
}): { missing: Record<string, string[]> } {
  const missing: Record<string, string[]> = {};
  for (const [locale, catalog] of Object.entries(input.catalogs)) {
    missing[locale] = [...input.usedIds].filter((id) => !Object.hasOwn(catalog, id)).sort();
  }
  return { missing };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MESSAGES_DIR = path.join(ROOT, "apps/web/src/i18n/messages");
/** Shipped catalogs; pseudo-locales are generated, not shipped (F-207). */
const SHIPPED_LOCALES = ["en"];

/** The IDs used in `apps/web/src/**\/*.{ts,tsx}`, as F-1's formatjs settings see them (A-12). */
export async function usedMessageIds(root: string = ROOT): Promise<Set<string>> {
  const files = globSync("apps/web/src/**/*.{ts,tsx}", { cwd: root }).map((f) =>
    path.join(root, f),
  );
  if (files.length === 0) return new Set();
  const extracted = JSON.parse(
    await extract(files, { additionalFunctionNames: ["t"], throws: true }),
  ) as Record<string, unknown>;
  return new Set(Object.keys(extracted));
}

// CLI: tsx checkCatalogs.ts (exit 1 when any shipped catalog lacks a used ID).
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const catalogs = Object.fromEntries(
    SHIPPED_LOCALES.map((locale) => [
      locale,
      JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Record<
        string,
        string
      >,
    ]),
  );
  const { missing } = checkCatalogs({ usedIds: await usedMessageIds(), catalogs });
  const problems = Object.entries(missing).filter(([, ids]) => ids.length > 0);
  for (const [locale, ids] of problems) {
    process.stderr.write(`${locale}.json is missing: ${ids.join(", ")}\n`);
  }
  process.exitCode = problems.length > 0 ? 1 : 0;
}
