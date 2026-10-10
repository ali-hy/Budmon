// The router's error boundary (F-216, §8.1 S-2). TP-11.8 on /__fixtures/flaky-loader (A-328), whose
// loader throws on its first run after a page load and then renders <h1> "Recovered".
import { catalogText, expect, test } from "./fixtures.js";

test("TP-11.8: a loader that throws shows the error fallback; Try again re-runs the loader and shows Recovered", async ({
  page,
}) => {
  await page.goto("/__fixtures/flaky-loader");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    catalogText("Something went wrong on our side"),
  );
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recovered");
  await expect(page.getByText("Something went wrong on our side")).toHaveCount(0);
});
