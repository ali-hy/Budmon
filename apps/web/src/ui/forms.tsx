// F-213: form error helpers (J-2).
import type { MessageDescriptor } from "@formatjs/intl";
import { createEffect, For, on, Show, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { Icon } from "./icons/Icon.js";

export interface Issue {
  code: string;
  path: readonly (string | number)[];
  message: string;
}

type Translate = (d: MessageDescriptor, v?: Record<string, unknown>) => string;
type SummaryEntry = { fieldId?: string; text: string };

/** An icon and the message; the id is the input's aria-describedby target. */
export function FieldError(props: { id: string; message?: string | undefined }): JSX.Element {
  return (
    <p id={props.id} class="flex items-center gap-1">
      <Show when={props.message}>
        {(message) => (
          <>
            <Icon name="alert" />
            {message()}
          </>
        )}
      </Show>
    </p>
  );
}

/** role="alert", focused when its messages change; each entry links to its field. */
export function FormErrorSummary(props: { messages: readonly SummaryEntry[] }): JSX.Element {
  let el: HTMLDivElement | undefined;
  createEffect(
    on(
      () => props.messages,
      (list) => {
        if (list.length > 0) el?.focus();
      },
    ),
  );
  return (
    <div ref={el} role="alert" tabindex="-1">
      <Show when={props.messages.length > 0}>
        <ul>
          <For each={props.messages}>
            {(m) => (
              <li>
                <Show when={m.fieldId} fallback={m.text}>
                  {(fieldId) => <a href={`#${fieldId()}`}>{m.text}</a>}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

const VALIDATION: Readonly<Record<string, MessageDescriptor>> = {
  invalid_type: messages.validationInvalidType,
  too_small: messages.validationTooSmall,
  too_big: messages.validationTooBig,
  invalid_format: messages.validationInvalidFormat,
  unrecognized_keys: messages.validationUnrecognizedKeys,
};

/** Field issues go to their fields; the summary holds the form message and unmapped issues. */
export function applyServerIssues(
  issues: readonly Issue[],
  fields: Readonly<Record<string, { id: string; label: string; setError: (m: string) => void }>>,
  t: Translate,
): { summary: SummaryEntry[] } {
  const summary: SummaryEntry[] = [{ text: t(messages.errorValidationForm) }];
  for (const issue of issues) {
    const path = issue.path.join(".");
    const field = Object.hasOwn(fields, path) ? fields[path] : undefined;
    if (field !== undefined) {
      field.setError(t(VALIDATION[issue.code] ?? messages.validationInvalid));
    } else {
      summary.push({ text: t(messages.errorValidationUnknownField, { label: path }) });
    }
  }
  return { summary };
}
