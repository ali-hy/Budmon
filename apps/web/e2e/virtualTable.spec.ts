// The virtualised table on /__fixtures/virtual-table, grid "Synthetic rows" (F-219, D-7, A-341,
// A-342). TP-12.3 and TP-12.4.
import { expect, test, type Page } from "./fixtures.js";

const ROUTE = "/__fixtures/virtual-table";

/** The focused element's row aria-rowindex and (for a cell) aria-colindex. */
async function focused(page: Page): Promise<{ row: number; col: number | null; inView: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    const row = el?.closest('[role="row"]');
    const scroller = document.querySelector("div[data-scroll]");
    const r = el?.getBoundingClientRect();
    const v = scroller?.getBoundingClientRect();
    const col = el?.getAttribute("role") === "gridcell" ? el.getAttribute("aria-colindex") : null;
    return {
      row: Number(row?.getAttribute("aria-rowindex") ?? "NaN"),
      col: col === null ? null : Number(col),
      inView: r !== undefined && v !== undefined && r.top >= v.top - 1 && r.bottom <= v.bottom + 1,
    };
  });
}

async function open(page: Page): Promise<void> {
  await page.goto(ROUTE);
  await page.getByRole("grid", { name: "Synthetic rows" }).waitFor();
  await page.locator('[role="row"][aria-rowindex="2"]').waitFor();
}

test("TP-12.3: Tab lands on row 2; ArrowDown ×3 and End move focus in view; Enter activates; ArrowRight enters cell 1", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await open(page);

  await page.keyboard.press("Tab");
  expect((await focused(page)).row).toBe(2);

  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowDown");
  expect(await focused(page)).toMatchObject({ row: 5, col: null, inView: true });

  await page.keyboard.press("End");
  const last = await focused(page);
  expect(last.row).toBeGreaterThan(5);
  expect(last.inView).toBe(true);
  const lastLoaded = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll('[role="row"]:not([data-placeholder])')].map((r) =>
        Number(r.getAttribute("aria-rowindex") ?? "0"),
      ),
    ),
  );
  expect(last.row).toBe(lastLoaded);

  await page.keyboard.press("Enter");
  // A-373: located by its text; the offline banner's status region is always mounted too.
  await expect(page.getByRole("status").filter({ hasText: "Activated row" })).toHaveText(
    `Activated row ${String(last.row - 2)}`,
  );

  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toMatchObject({ row: last.row, col: 1 });
});

test("TP-12.3: in ar-XB, Tab then ArrowLeft enters cell 1, ArrowLeft again goes to cell 2 (keys reversed)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pseudo-rtl", "pseudo-rtl project only");
  await open(page);

  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toMatchObject({ row: 2, col: 1 });

  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toMatchObject({ row: 2, col: 2 });
});

test("TP-12.4 @perf: D-7 targets on 100,000 rows", async ({ page }) => {
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // 5 fresh loads: first rows visible − first page response (A-342 marks).
  const firstRows: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.goto(ROUTE);
    await page.waitForFunction(
      () => performance.getEntriesByName("budmon:first-rows-visible").length > 0,
    );
    firstRows.push(
      await page.evaluate(() => {
        const [response] = performance.getEntriesByName("budmon:first-page-response");
        const [visible] = performance.getEntriesByName("budmon:first-rows-visible");
        return (visible?.startTime ?? Infinity) - (response?.startTime ?? Infinity);
      }),
    );
  }
  firstRows.sort((a, b) => a - b);
  expect(firstRows[2]).toBeLessThanOrEqual(300);

  const topBefore = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("div[data-scroll]");
    const s = scroller?.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')];
    const top = rows.find(
      (r) =>
        Number(r.getAttribute("aria-rowindex")) >= 2 &&
        r.getBoundingClientRect().top >= (s?.top ?? 0) - 1,
    );
    return { id: top?.textContent ?? "", index: top?.getAttribute("aria-rowindex") ?? "" };
  });

  // Scroll 36 px per frame through 5,000 rows, past them and back, sampling as it goes.
  const result = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>("div[data-scroll]");
    if (scroller === null) throw new Error("no div[data-scroll]");
    const frames: number[] = [];
    let longTasks = 0;
    let maxRows = 0;
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().filter((e) => e.duration > 100).length;
    });
    observer.observe({ type: "longtask" });
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    const firstRow = scroller.querySelector<HTMLElement>(
      '[role="row"]:not([data-placeholder])[aria-rowindex="2"]',
    );
    const rowHeight = firstRow?.offsetHeight ?? 36;
    const busyInView = () => {
      const v = scroller.getBoundingClientRect();
      return [...scroller.querySelectorAll<HTMLElement>('[aria-busy="true"]')].some((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > v.top && b.top < v.bottom;
      });
    };
    let last = await frame();
    const step = async (target: number, dir: 1 | -1) => {
      while (dir === 1 ? scroller.scrollTop < target : scroller.scrollTop > target) {
        if (!busyInView()) scroller.scrollTop += 36 * dir;
        const now = await frame();
        frames.push(now - last);
        last = now;
        maxRows = Math.max(maxRows, document.querySelectorAll('[role="row"]').length);
      }
    };
    await step(5_000 * rowHeight, 1);
    await step(5_200 * rowHeight, 1);
    await step(0, -1);
    observer.disconnect();
    frames.sort((a, b) => a - b);
    return { p95: frames[Math.floor(frames.length * 0.95)] ?? Infinity, longTasks, maxRows };
  });

  expect(result.p95).toBeLessThanOrEqual(33);
  expect(result.longTasks).toBeLessThanOrEqual(5);
  expect(result.maxRows).toBeLessThan(200);

  const after = await page
    .locator(`[role="row"][aria-rowindex="${topBefore.index}"]`)
    .textContent();
  expect(after).toBe(topBefore.id);
});
