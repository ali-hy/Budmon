// F-4 the stylelint configuration (D-38, A-14). TP-11.20, plus extra cases TP-11.31x. IDs ending
// in "x" are test-architect additions, not LLD test-plan IDs.
//
// stylelint and packages/config/stylelint/index.js arrive with S-11a; until then they load through
// variable specifiers so typecheck passes.
import { describe, expect, it } from "vitest";

interface Warning {
  rule: string;
  severity: string;
}
interface Stylelint {
  lint: (options: { code: string; config: unknown; codeFilename?: string }) => Promise<{
    results: { warnings: Warning[] }[];
  }>;
}

const STYLELINT = "stylelint";
const CONFIG = "../stylelint/index.js";

async function lintCss(code: string): Promise<Warning[]> {
  const stylelint = ((await import(/* @vite-ignore */ STYLELINT)) as { default: Stylelint })
    .default;
  const config = ((await import(/* @vite-ignore */ CONFIG)) as { default: unknown }).default;
  const { results } = await stylelint.lint({ code, config, codeFilename: "apps/web/src/x.css" });
  return results.flatMap((r) => r.warnings);
}

describe("TP-11.20: physical CSS properties (F-4)", () => {
  it("TP-11.20: margin-left: 1px is an error (csstools/use-logical)", async () => {
    const warnings = await lintCss(".a { margin-left: 1px; }\n");

    expect(warnings).toContainEqual(
      expect.objectContaining({ rule: "csstools/use-logical", severity: "error" }),
    );
  });

  it("TP-11.20: margin-inline-start: 1px is ok", async () => {
    expect(await lintCss(".a { margin-inline-start: 1px; }\n")).toEqual([]);
  });

  it("TP-11.31x: a declaration after stylelint-disable-next-line csstools/use-logical with a reason is ignored", async () => {
    const code =
      ".a {\n  /* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: logo */\n  margin-left: 1px;\n}\n";

    expect(await lintCss(code)).toEqual([]);
  });
});

describe("TP-11.31x: the stylelint configuration's wiring (F-4, §2.1, A-14)", () => {
  const ROOT_CONFIG = "../../../stylelint.config.js";
  const PACKAGE_CONFIG = "@budmon/config/stylelint";

  it("TP-11.31x: F-4 uses the stylelint-use-logical plugin with csstools/use-logical always, no exceptions", async () => {
    const config = ((await import(/* @vite-ignore */ CONFIG)) as { default: unknown }).default as {
      plugins?: unknown;
      rules?: Record<string, unknown>;
    };

    expect(config.plugins).toEqual(["stylelint-use-logical"]);
    expect(config.rules?.["csstools/use-logical"]).toEqual(["always", { except: [] }]);
  });

  it("TP-11.31x: the root stylelint.config.js default-exports @budmon/config/stylelint", async () => {
    const root = ((await import(/* @vite-ignore */ ROOT_CONFIG)) as { default: unknown }).default;
    const exported = ((await import(/* @vite-ignore */ PACKAGE_CONFIG)) as { default: unknown })
      .default;

    expect(root).toBe(exported);
  });
});
