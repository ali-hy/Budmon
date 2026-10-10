// F-211: the web offline banner (C-1).
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";
import { Icon } from "./icons/Icon.js";

const BACK_ONLINE_MS = 3000;

export function OfflineBanner(): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = createSignal<"hidden" | "offline" | "back">(
    navigator.onLine ? "hidden" : "offline",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;

  const offline = () => {
    clearTimeout(timer);
    setState("offline");
  };
  const online = () => {
    clearTimeout(timer);
    if (state() !== "offline") return;
    setState("back");
    timer = setTimeout(() => setState("hidden"), BACK_ONLINE_MS);
  };

  onMount(() => {
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (!navigator.onLine) setState("offline");
  });
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
  });

  // Rendered only while shown, so an empty status region doesn't sit on every page.
  return (
    <Show when={state() !== "hidden"}>
      <div role="status" aria-live="polite">
        <p class="flex items-center gap-2 p-2">
          <Icon name={state() === "offline" ? "offline" : "check"} />
          {state() === "offline" ? t(messages.offlineBannerWeb) : t(messages.offlineBack)}
        </p>
      </div>
    </Show>
  );
}
