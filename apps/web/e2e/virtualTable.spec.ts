// The virtualised table on /__fixtures/virtual-table (F-219, D-7). TP-12.3 and TP-12.4. Both wait
// for the planner (see the questions in each case); their bodies are drafted against F-219.
import { expect, test, type Page } from "./fixtures.js";

const ROUTE = "/__fixtures/virtual-table";

async function focusedRowIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.activeElement?.closest('[role="row"]');
    return Number(row?.getAttribute("aria-rowindex") ?? "NaN");
  });
}

async function focusedInView(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement?.closest('[role="row"]');
    const grid = document.querySelector('[role="grid"]');
    if (el === null || el === undefined || grid === null) return false;
    const r = el.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    return r.top >= g.top - 1 && r.bottom <= g.bottom + 1;
  });
}

// Questions: where does keyboard focus start in the grid (Tab to the first row?), how does the
// fixture show that onRowActivate ran, and does ArrowLeft/Right move from a focused row into its
// cells?
test.fixme("TP-12.3: ArrowDown ×3 and End move focus between rows, scrolled into view; Enter activates the row", async ({
  page,
}) => {
  await page.goto(ROUTE);
  await page.getByRole("grid").waitFor();
  await page.keyboard.press("Tab");
  const start = await focusedRowIndex(page);

  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowDown");
  expect(await focusedRowIndex(page)).toBe(start + 3);
  expect(await focusedInView(page)).toBe(true);

  await page.keyboard.press("End");
  expect(await focusedRowIndex(page)).toBeGreaterThan(start + 3);
  expect(await focusedInView(page)).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Activated");
});

test.fixme("TP-12.3: in ar-XB, ArrowLeft moves to the next cell (reversed)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pseudo-rtl", "pseudo-rtl project only");
  await page.goto(ROUTE);
  await page.getByRole("grid").waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  const colIndex = await page.evaluate(() =>
    Number(document.activeElement?.getAttribute("aria-colindex") ?? "NaN"),
  );

  expect(colIndex).toBe(2);
});

// Questions: what marks "first rows visible" and "the first page response" (a request path, or
// performance marks the fixture sets), and how frames and long tasks are sampled.
test.fixme("TP-12.4 @perf: D-7 targets on 100,000 rows", async ({ page }) => {
  const firstRows: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.goto(ROUTE);
    await page.locator('[role="row"][aria-rowindex="2"]').waitFor();
    firstRows.push(
      await page.evaluate(() => {
        const [response] = performance.getEntriesByName("budmon:first-page-response");
        const [visible] = performance.getEntriesByName("budmon:first-rows-visible");
        return (visible?.startTime ?? Infinity) - (response?.startTime ?? 0);
      }),
    );
  }
  firstRows.sort((a, b) => a - b);
  expect(firstRows[2]).toBeLessThanOrEqual(300);

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __longTasks: number };
    w.__frames = [];
    w.__longTasks = 0;
    new PerformanceObserver((list) => {
      w.__longTasks += list.getEntries().filter((e) => e.duration > 100).length;
    }).observe({ type: "longtask", buffered: false });
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const grid = page.getByRole("grid");
  const rowAt5000Before = await grid.evaluate(async (g) => {
    const scroller = (g.closest("[data-scroll]") ?? g) as HTMLElement;
    let maxRows = 0;
    for (let y = 0; y <= 5_100 * 40; y += 2_000) {
      scroller.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(r));
      maxRows = Math.max(maxRows, g.querySelectorAll('[role="row"]').length);
    }
    return maxRows;
  });
  expect(rowAt5000Before).toBeLessThan(200);

  const stats = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __longTasks: number };
    const frames = [...w.__frames].sort((a, b) => a - b);
    return {
      p95: frames[Math.floor(frames.length * 0.95)] ?? Infinity,
      longTasks: w.__longTasks,
    };
  });
  expect(stats.p95).toBeLessThanOrEqual(33);
  expect(stats.longTasks).toBeLessThanOrEqual(5);
});
