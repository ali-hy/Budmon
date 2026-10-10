// F-209: the S-2 error fallback (§8.1): title, body, an optional reference, Try again and a link
// home (a plain link, so it works without a router).
import { createSignal, Show, type JSX } from "solid-js";
import type { AppError } from "../api/errors.js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

/** Marks where the reference goes inside the translated sentence (private use, never shown). */
const SLOT = "";

export function ErrorFallback(props: {
  error: AppError;
  requestId?: string;
  onRetry: () => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = createSignal(false);
  const [stillFailing, setStillFailing] = createSignal(false);

  const retry = async (): Promise<void> => {
    setBusy(true);
    setStillFailing(false);
    try {
      await props.onRetry();
    } catch {
      setStillFailing(true);
    } finally {
      setBusy(false);
    }
  };

  /** "Reference: {ref}" around a <bdi dir="ltr"> holding the first 8 characters. */
  const reference = (requestId: string) => {
    const [before = "", after = ""] = t(messages.errorReference, { ref: SLOT })
      .replace(/[⁨⁩]/g, "")
      .split(SLOT);
    return (
      <p>
        {before}
        <bdi dir="ltr">{requestId.slice(0, 8)}</bdi>
        {after}
      </p>
    );
  };

  return (
    <section class="mx-auto max-w-[40rem] p-4">
      <h1 tabindex="-1" class="text-xl font-semibold">
        {t(messages.errorFallbackTitle)}
      </h1>
      <p>{t(messages.errorFallbackBody)}</p>
      <Show when={props.requestId}>{(id) => reference(id())}</Show>
      <div class="mt-4 flex gap-4">
        <button
          type="button"
          aria-busy={busy() ? "true" : undefined}
          disabled={busy()}
          onClick={() => void retry()}
        >
          {t(messages.errorFallbackRetry)}
        </button>
        <a href="/">{t(messages.errorFallbackHome)}</a>
      </div>
      <Show when={stillFailing()}>
        <p role="status">{t(messages.errorFallbackStillFailing)}</p>
      </Show>
    </section>
  );
}
