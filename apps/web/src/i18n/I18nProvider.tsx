// F-206: locale, direction, message formatting and locale-aware dates, times and money.
import { createIntl, createIntlCache, type IntlShape } from "@formatjs/intl";
import {
  directionOf,
  formatMoney as formatMoneyIn,
  isolate,
  resolveLocale,
  type Temporal,
} from "@budmon/shared";
import { createSignal, onMount, type JSX } from "solid-js";
import en from "./messages/en.json";
import { I18nContext, type I18n } from "./useI18n.js";

type Catalog = Record<string, string>;
type FormatValues = Parameters<IntlShape["formatMessage"]>[1];

const PSEUDO_LOCALES = ["en-XA", "ar-XB"] as const;

/** `en`, plus the pseudo-locales when VITE_PSEUDO_LOCALES=1 (F-207). */
export function supportedLocales(): readonly string[] {
  return import.meta.env.VITE_PSEUDO_LOCALES === "1" ? ["en", ...PSEUDO_LOCALES] : ["en"];
}

/** A-315: every Intl call (relative times, dates, numbers, money, plural rules in t) formats the
 * pseudo-locales as `en`; only the catalog, lang and dir change. */
function intlLocaleOf(locale: string): string {
  return (PSEUDO_LOCALES as readonly string[]).includes(locale) ? "en" : locale;
}

const shipped = import.meta.glob<Catalog>("./messages/*.json", { import: "default" });
// N-2: the generated pseudo catalogs only in pseudo builds; Vite replaces the flag statically, so
// other builds drop the branch and its chunks.
const generated: Record<string, () => Promise<Catalog>> =
  import.meta.env.VITE_PSEUDO_LOCALES === "1"
    ? import.meta.glob<Catalog>("./generated/*.json", { import: "default" })
    : {};

async function loadCatalog(locale: string): Promise<Catalog> {
  if (locale === "en") return en;
  const load = generated[`./generated/${locale}.json`] ?? shipped[`./messages/${locale}.json`];
  return load === undefined ? en : await load();
}

const cache = createIntlCache();

function intlFor(locale: string, messages: Catalog): IntlShape {
  return createIntl({ locale: intlLocaleOf(locale), defaultLocale: "en", messages }, cache);
}

const DAY_MS = 86_400_000;

export function I18nProvider(props: { initialLocale: string; children: JSX.Element }): JSX.Element {
  const [locale, setLocaleSignal] = createSignal("en");
  const [intl, setIntl] = createSignal(intlFor("en", en));
  const dir = () => directionOf(locale());

  // B-1: only the latest setLocale applies; an earlier one whose catalog arrives later is dropped.
  let latestRequest = 0;
  const setLocale = async (requested: string): Promise<void> => {
    latestRequest += 1;
    const request = latestRequest;
    const next = resolveLocale(requested, supportedLocales(), "en");
    const messages = await loadCatalog(next);
    if (request !== latestRequest) return;
    setIntl(intlFor(next, messages));
    setLocaleSignal(next);
    document.documentElement.lang = next;
    document.documentElement.dir = directionOf(next);
  };

  const formatDate = (d: Temporal.PlainDate): string =>
    new Intl.DateTimeFormat(intlLocaleOf(locale()), {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));

  const i18n: I18n = {
    locale,
    dir,
    t: (d, v) =>
      intl().formatMessage(
        d,
        v === undefined
          ? undefined
          : (Object.fromEntries(
              Object.entries(v).map(([k, value]) => [
                k,
                typeof value === "string" ? isolate(value) : value,
              ]),
            ) as FormatValues),
      ) as string,
    formatMoney: (m, minorUnits) =>
      formatMoneyIn(m, { locale: intlLocaleOf(locale()), minorUnits }),
    formatDate,
    formatInstant: (i, timeZone) =>
      new Intl.DateTimeFormat(intlLocaleOf(locale()), {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(new Date(i.epochMilliseconds)),
    formatRelative: (i, now, timeZone) => {
      const diff = now.epochMilliseconds - i.epochMilliseconds;
      if (diff >= 7 * DAY_MS) {
        return formatDate(i.toZonedDateTimeISO(timeZone).toPlainDate());
      }
      // A-311: whole units, truncated toward zero; "now" under a minute.
      const rtf = new Intl.RelativeTimeFormat(intlLocaleOf(locale()), {
        numeric: "auto",
        style: "long",
      });
      const seconds = Math.trunc(diff / 1000);
      if (Math.abs(seconds) < 60) return rtf.format(0, "second");
      const minutes = Math.trunc(seconds / 60);
      if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
      const hours = Math.trunc(minutes / 60);
      if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
      return rtf.format(-Math.trunc(hours / 24), "day");
    },
    setLocale,
  };

  onMount(() => {
    void setLocale(props.initialLocale);
  });

  return <I18nContext.Provider value={i18n}>{props.children}</I18nContext.Provider>;
}
