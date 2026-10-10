// F-206 the i18n provider. TP-11.6 (A-309, A-310, A-311, A-315), in web-unit with pseudo-locales on.
import { Money, Temporal, asCurrencyCode } from "@budmon/shared";
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../src/i18n/I18nProvider.js";
import { useI18n, type I18n } from "../../src/i18n/useI18n.js";

const NOW = Temporal.Instant.from("2026-10-07T12:00:00Z");

/** Renders the provider and hands back its context. */
function provider(initialLocale = "en"): I18n {
  let captured: I18n | undefined;
  function Probe() {
    captured = useI18n();
    return null;
  }
  render(() => (
    <I18nProvider initialLocale={initialLocale}>
      <Probe />
    </I18nProvider>
  ));
  if (captured === undefined) throw new Error("the provider rendered no context");
  return captured;
}

describe("TP-11.6: the i18n provider (F-206)", () => {
  it('TP-11.6: setLocale("ar-XB") sets <html lang="ar-XB" dir="rtl">', async () => {
    const i18n = provider();

    await i18n.setLocale("ar-XB");

    expect(document.documentElement.lang).toBe("ar-XB");
    expect(document.documentElement.dir).toBe("rtl");
    expect(i18n.locale()).toBe("ar-XB");
    expect(i18n.dir()).toBe("rtl");
  });

  it.each([
    ["2 h", { hours: 2 }, "2 hours ago"],
    ["24 h", { hours: 24 }, "yesterday"],
    ["30 s", { seconds: 30 }, "now"],
  ] as const)(
    "TP-11.6 (A-311): formatRelative(now − %s, now, UTC) is %j",
    async (_label, ago, text) => {
      const i18n = provider();
      await i18n.setLocale("ar-XB");

      expect(i18n.formatRelative(NOW.subtract(ago), NOW, "UTC")).toBe(text);
    },
  );

  it("TP-11.6 (A-309): beyond 7 days, formatRelative gives the date in the caller's zone: 2026-09-29T23:30Z is 2026-09-30 in Asia/Tokyo", async () => {
    const i18n = provider();
    await i18n.setLocale("ar-XB");

    const text = i18n.formatRelative(
      Temporal.Instant.from("2026-09-29T23:30:00Z"),
      NOW,
      "Asia/Tokyo",
    );

    expect(text).toBe(i18n.formatDate(Temporal.PlainDate.from("2026-09-30")));
    expect(text).not.toBe(i18n.formatDate(Temporal.PlainDate.from("2026-09-29")));
  });

  it("TP-11.6: t wraps a value in U+2068 and U+2069", async () => {
    const i18n = provider();
    await i18n.setLocale("ar-XB");

    const text = i18n.t({ id: "test.greeting", defaultMessage: "Hello {name}" }, { name: "Ada" });

    expect(text).toContain("⁨Ada⁩");
  });

  // A-315: pseudo-locales format through Intl as en; only the catalog, lang and dir change.
  it("TP-11.6 (A-315): formatMoney(EGP 1234.50, 2) and formatDate(2026-10-07) under ar-XB and en-XA equal en's, with Latin digits", async () => {
    const money = Money.of(123450n, asCurrencyCode("EGP"));
    const date = Temporal.PlainDate.from("2026-10-07");
    const formatted: Record<string, { money: string; date: string }> = {};
    for (const locale of ["en", "ar-XB", "en-XA"]) {
      const i18n = provider();
      await i18n.setLocale(locale);
      formatted[locale] = { money: i18n.formatMoney(money, 2), date: i18n.formatDate(date) };
    }

    expect(formatted["ar-XB"]).toEqual(formatted["en"]);
    expect(formatted["en-XA"]).toEqual(formatted["en"]);
    expect(formatted["en"]?.money).toMatch(/1,234\.50/);
    expect(formatted["en"]?.date).toMatch(/2026/);
    for (const { money: m, date: d } of Object.values(formatted)) {
      // No Arabic-Indic (U+0660..U+0669) or Extended Arabic-Indic (U+06F0..U+06F9) digits.
      expect(`${m}${d}`).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
    }
  });
});
