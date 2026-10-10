// F-212 toasts (Kobalte's Toast region). TP-11.29.
import { fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadToaster } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function mount() {
  const m = await loadToaster();
  renderWithI18n(() => <m.Toaster />);
  return m;
}

const live = (el: HTMLElement) => el.closest("[aria-live]")?.getAttribute("aria-live");

/** The element holding `text`, or null. */
const shown = (text: string) => screen.queryByText(text, { exact: false });

describe("TP-11.29: toasts (F-212)", () => {
  it("TP-11.29: an info toast is shown in a polite region; hovered, it stays past 7 s; after the pointer leaves, it closes within 6 s", async () => {
    const { showToast } = await mount();

    showToast({ message: "Saved the budget", tone: "info" });
    await vi.advanceTimersByTimeAsync(0);
    const toast = shown("Saved the budget");
    expect(toast).not.toBeNull();
    expect(live(toast as HTMLElement)).toBe("polite");

    const target = toast as HTMLElement;
    fireEvent.pointerEnter(target);
    fireEvent.pointerMove(target);
    fireEvent.mouseEnter(target);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(shown("Saved the budget")).not.toBeNull();

    fireEvent.pointerLeave(target);
    fireEvent.mouseLeave(target);
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(500);
    expect(shown("Saved the budget")).toBeNull();
  });

  it("TP-11.29: an un-hovered info toast closes after 6 s", async () => {
    const { showToast } = await mount();

    showToast({ message: "Copied", tone: "success" });
    await vi.advanceTimersByTimeAsync(5_500);
    expect(shown("Copied")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shown("Copied")).toBeNull();
  });

  it("TP-11.29: tone error renders in the assertive region", async () => {
    const { showToast } = await mount();

    showToast({ message: "Couldn't save", tone: "error" });
    await vi.advanceTimersByTimeAsync(0);
    const toast = shown("Couldn't save");

    expect(toast).not.toBeNull();
    expect(live(toast as HTMLElement)).toBe("assertive");
  });

  it("TP-11.29: a persistent toast is still shown after 60 s; dismissToast(id) removes it", async () => {
    const { showToast, dismissToast } = await mount();

    const id = showToast({ message: "Stays put", tone: "info", persistent: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shown("Stays put")).not.toBeNull();

    dismissToast(id);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shown("Stays put")).toBeNull();
  });

  it("TP-11.29: an action renders as a button calling onClick", async () => {
    const { showToast } = await mount();
    const onClick = vi.fn();

    showToast({ message: "Updated", tone: "info", action: { label: "Reload", onClick } });
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
