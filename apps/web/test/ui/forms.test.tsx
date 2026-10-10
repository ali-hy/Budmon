// F-213 form error helpers (J-2). TP-11.9, plus extra cases TP-11.32x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type FormField, type FormsModule, type Issue, loadForms, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

const ISSUES: readonly Issue[] = [
  { code: "too_small", path: ["amount"], message: "Too small: expected number to be >0" },
  { code: "invalid_value", path: ["unknown", "path"], message: "Invalid input" },
];

/**
 * A two-field form wired the way J-2 describes: each input has aria-invalid and
 * aria-describedby pointing at its FieldError, and the summary above.
 */
function harness(forms: FormsModule) {
  const [amountError, setAmountError] = createSignal<string>();
  const [noteError, setNoteError] = createSignal<string>();
  const [summary, setSummary] = createSignal<readonly { fieldId?: string; text: string }[]>([]);
  const fields: Record<string, FormField> = {
    amount: { id: "amount", label: "Amount", setError: setAmountError },
    note: { id: "note", label: "Note", setError: setNoteError },
  };
  const Form = (): JSX.Element => (
    <form>
      <forms.FormErrorSummary messages={summary()} />
      <label for="amount">Amount</label>
      <input
        id="amount"
        aria-invalid={amountError() === undefined ? undefined : "true"}
        aria-describedby="amount-error"
      />
      <forms.FieldError id="amount-error" message={amountError()} />
      <label for="note">Note</label>
      <input
        id="note"
        aria-invalid={noteError() === undefined ? undefined : "true"}
        aria-describedby="note-error"
      />
      <forms.FieldError id="note-error" message={noteError()} />
    </form>
  );
  return { fields, Form, setSummary, amountError, noteError };
}

describe("TP-11.9: server validation issues on a form (F-213)", () => {
  it("TP-11.9: [amount too_small] sets amount's error to validation.too_small; [unknown.path invalid_value] goes to the summary as error.validation.unknownField with the path, after error.validation.form; the summary takes focus", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n, container } = renderWithI18n(() => <h.Form />);
    const noteSpy = vi.spyOn(h.fields.note as FormField, "setError");

    const { summary } = forms.applyServerIssues(ISSUES, h.fields, i18n.t);
    h.setSummary(summary);

    expect(h.amountError()).toBe("This is too short or too small.");
    expect(noteSpy).not.toHaveBeenCalled();
    expect(summary.map((m) => ({ ...m, text: plain(m.text) }))).toEqual([
      { text: "Some details need fixing." },
      { text: "Something in this form isn't valid: unknown.path" },
    ]);

    const amount = container.querySelector<HTMLInputElement>("#amount");
    expect(amount?.getAttribute("aria-invalid")).toBe("true");
    const fieldError = container.querySelector("#amount-error");
    expect(plain(fieldError?.textContent)).toContain("This is too short or too small.");

    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Some details need fixing.");
    expect(plain(alert.textContent)).toContain("Something in this form isn't valid: unknown.path");
    await waitFor(() => {
      expect(alert.contains(document.activeElement)).toBe(true);
    });
  });

  it("TP-11.32x: an issue code without a validation.<code> message falls back to validation.invalid", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    forms.applyServerIssues(
      [{ code: "custom_rule", path: ["note"], message: "x" }],
      h.fields,
      i18n.t,
    );

    expect(h.noteError()).toBe("Enter a valid value.");
  });

  it("TP-11.32x: the summary holds only error.validation.form when every issue names a field", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    const { summary } = forms.applyServerIssues([ISSUES[0] as Issue], h.fields, i18n.t);

    expect(summary.map((m) => plain(m.text))).toEqual(["Some details need fixing."]);
  });

  it("TP-11.32x: FieldError renders its message with the given id; without a message it renders no text", async () => {
    const forms = await loadForms();
    const { container } = renderWithI18n(() => (
      <>
        <forms.FieldError id="with" message="Check the format." />
        <forms.FieldError id="without" />
      </>
    ));

    expect(plain(container.querySelector("#with")?.textContent)).toContain("Check the format.");
    expect(plain(container.querySelector("#without")?.textContent ?? "")).toBe("");
  });
});
