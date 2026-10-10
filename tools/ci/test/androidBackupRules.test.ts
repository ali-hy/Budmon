// F-262 backup and device-transfer rules: the database (and preferences) never leave the phone.
// TP-13.11, run here as a static check of the XML (it needs no Android SDK).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const XML = path.join(ROOT, "apps/android/app/src/main/res/xml");

interface Rule {
  kind: "include" | "exclude";
  domain: string;
  path: string;
}

/** The <include>/<exclude> elements inside `section` (or the whole file when no section is given). */
function rules(xml: string, section?: string): Rule[] {
  const body =
    section === undefined
      ? xml
      : (new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? "");
  return [...body.matchAll(/<(include|exclude)\b([^>]*)\/?>/g)].map((m) => {
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[2] ?? "")?.[1] ?? "";
    return { kind: m[1] as Rule["kind"], domain: attr("domain"), path: attr("path") };
  });
}

const excludesDb = (list: Rule[]) =>
  list.some(
    (r) =>
      r.kind === "exclude" && r.domain === "database" && (r.path === "budmon.db" || r.path === "."),
  );

describe("TP-13.11: backup exclusion (F-262)", () => {
  it("TP-13.11: data_extraction_rules.xml excludes budmon.db from cloud-backup and device-transfer", () => {
    const file = path.join(XML, "data_extraction_rules.xml");
    expect(existsSync(file)).toBe(true);
    const xml = readFileSync(file, "utf8");

    expect(excludesDb(rules(xml, "cloud-backup"))).toBe(true);
    expect(excludesDb(rules(xml, "device-transfer"))).toBe(true);
  });

  it("TP-13.11: backup_rules.xml (Android 11 and below) excludes budmon.db", () => {
    const file = path.join(XML, "backup_rules.xml");
    expect(existsSync(file)).toBe(true);

    expect(excludesDb(rules(readFileSync(file, "utf8")))).toBe(true);
  });

  it("TP-13.11: shared preferences and DataStore files are excluded too, in both files", () => {
    const extraction = readFileSync(path.join(XML, "data_extraction_rules.xml"), "utf8");
    const backup = readFileSync(path.join(XML, "backup_rules.xml"), "utf8");
    const excludesPrefs = (list: Rule[]) =>
      list.some((r) => r.kind === "exclude" && r.domain === "sharedpref") &&
      list.some(
        (r) => r.kind === "exclude" && r.domain === "file" && r.path.startsWith("datastore"),
      );

    expect(excludesPrefs(rules(extraction, "cloud-backup"))).toBe(true);
    expect(excludesPrefs(rules(extraction, "device-transfer"))).toBe(true);
    expect(excludesPrefs(rules(backup))).toBe(true);
  });
});
