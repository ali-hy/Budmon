// F-212: toasts through Kobalte's Toast region; non-persistent ones close after 6 s, paused on
// hover or focus. Errors are announced assertively, the rest politely.
import { Toast, toaster } from "@kobalte/core/toast";
import { Show, type JSX } from "solid-js";

const DURATION_MS = 6000;

export interface ToastOptions {
  message: string;
  tone: "info" | "error" | "success";
  action?: { label: string; onClick: () => void };
  persistent?: boolean;
}

/**
 * A non-persistent toast's 6 s, paused while the pointer is over it or it holds focus. Kobalte
 * pauses only for pointer events on its region, so each toast keeps its own timer (Kobalte sees
 * every toast as persistent). Capture-phase listeners also see the non-bubbling enter and leave
 * events of the toast's children.
 */
function autoDismiss(id: number): {
  attach: (el: HTMLElement) => void;
} {
  let remaining = DURATION_MS;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resume = () => {
    if (timer !== undefined) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      toaster.dismiss(id);
    }, remaining);
  };
  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  resume();
  return {
    attach(el) {
      for (const type of ["pointerenter", "pointermove", "mouseenter", "focusin"]) {
        el.addEventListener(type, pause, { capture: true });
      }
      for (const type of ["pointerleave", "mouseleave", "focusout"]) {
        el.addEventListener(
          type,
          (event) => {
            const next = (event as MouseEvent | FocusEvent).relatedTarget;
            if (next instanceof Node && el.contains(next)) return;
            resume();
          },
          { capture: true },
        );
      }
    },
  };
}

export function showToast(t: ToastOptions): string {
  let attach: ((el: HTMLElement) => void) | undefined;
  let rendered: HTMLElement | undefined;
  const id = toaster.show((props) => (
    <Toast
      ref={(el: HTMLElement) => {
        rendered = el;
        attach?.(el);
      }}
      toastId={props.toastId}
      priority={t.tone === "error" ? "high" : "low"}
      persistent
      data-tone={t.tone}
      class="flex items-center gap-4 rounded p-3 shadow"
    >
      <Toast.Description>{t.message}</Toast.Description>
      <Show when={t.action}>
        {(action) => (
          <button
            type="button"
            onClick={() => {
              action().onClick();
            }}
          >
            {action().label}
          </button>
        )}
      </Show>
    </Toast>
  ));
  if (t.persistent !== true) {
    attach = autoDismiss(id).attach;
    // The toast may already have rendered inside show().
    if (rendered !== undefined) attach(rendered);
  }
  return String(id);
}

export function dismissToast(id: string): void {
  toaster.dismiss(Number.parseInt(id, 10));
}

export function Toaster(): JSX.Element {
  return (
    <Toast.Region>
      <Toast.List class="fixed bottom-4 end-4 flex flex-col gap-2" />
    </Toast.Region>
  );
}
