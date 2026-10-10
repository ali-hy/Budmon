// Focus and announcements on navigation (F-216, F-218, A-333), and the 360 px layout. TP-11.15,
// TP-11.16.
import { expect, test, type Page } from "./fixtures.js";

async function expectFocusedHeading(page: Page, text: string): Promise<void> {
  const h1 = page.locator("main h1");
  await expect(h1).toHaveText(text);
  await expect(h1).toBeFocused();
  await expect(h1).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#live-polite")).toHaveText(text);
}

/** A client-side navigation through the router's history (no page load). */
async function navigate(page: Page, to: string): Promise<void> {
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
  }, to);
}

test("TP-11.15 (A-333): on load focus stays on body and #live-polite is empty; navigating to an unknown path and back to / focuses each h1 and announces its text", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Budmon");
  await expect(page.locator("body")).toBeFocused();
  await expect(page.locator("#live-polite")).toHaveText("");

  await navigate(page, "/this-page-does-not-exist");
  await expectFocusedHeading(page, "Page not found");

  await page.getByRole("link", { name: "Go to home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectFocusedHeading(page, "Budmon");
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
});

test.describe("TP-11.16: 360 px layout", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ["/", "/this-page-does-not-exist", "/__fixtures/rtl-probe"]) {
    test(`TP-11.16: ${route} doesn't overflow horizontally at 360×740`, async ({ page }) => {
      await page.goto(route);
      await page.locator("main h1").first().waitFor();

      const width = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);

      expect(width).toBeLessThanOrEqual(360);
    });
  }
});
