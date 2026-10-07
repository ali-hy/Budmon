// F-312: locale resolution and text direction.
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi", "dv"]);

function languageOf(locale: string): string {
  return (locale.split("-")[0] ?? "").toLowerCase();
}

export function resolveLocale(
  requested: string | null,
  supported: readonly string[],
  fallback?: string,
): string {
  const wanted = (requested ?? "").toLowerCase();
  const exact = supported.find((tag) => tag.toLowerCase() === wanted);
  const byLanguage = supported.find((tag) => tag.toLowerCase() === languageOf(wanted));
  return exact ?? byLanguage ?? fallback ?? "en";
}

export function directionOf(locale: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(languageOf(locale)) ? "rtl" : "ltr";
}
