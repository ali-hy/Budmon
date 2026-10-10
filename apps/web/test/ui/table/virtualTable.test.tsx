// F-219 VirtualTable: grid semantics, placeholders and end-aligned columns. TP-12.2 and TP-12.5,
// plus extra cases TP-12.6x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// jsdom has no layout, so every element reports an 800 × 800 box and ResizeObserver is a stub:
// with rowHeight 40 the viewport holds 20 rows, and overscan 10 renders rows 0..29.
import { fireEvent, screen } from "@solidjs/testing-library";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppError } from "../../support/s11b.js";
import { renderWithI18n } from "../../support/render.js";
import { type Column, type InfiniteListSource, loadVirtualTable } from "../../support/s12.js";

interface Row {
  id: string;
  amount: string;
}

const ROW_HEIGHT = 40;
const TOTAL = 1000;
/** Page 2 of 10-row pages (rows 20..29) isn't in memory. */
const DROPPED = { from: 20, to: 29 };

function fakeSource(): InfiniteListSource<Row> {
  return {
    pageSize: 10,
    rowCount: () => TOTAL,
    totalCount: () => TOTAL,
    hasMore: () => false,
    retry: vi.fn<() => void>(),
    rowAt: (index: number) =>
      index < 0 || index >= TOTAL || (index >= DROPPED.from && index <= DROPPED.to)
        ? undefined
        : { id: `r${String(index)}`, amount: `${String(index)}.00` },
    ensurePage: vi.fn<(pageIndex: number) => void>(),
    loading: () => false,
    error: () => null,
  };
}

const COLUMNS: readonly Column<Row>[] = [
  { id: "id", header: "Row", cell: (row) => <span>{row.id}</span> },
  { id: "amount", header: "Amount", cell: (row) => <span>{row.amount}</span>, align: "end" },
];

const box = { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 800, width: 800, height: 800 };

beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...box,
    toJSON: () => box,
  });
  for (const prop of ["clientHeight", "offsetHeight", "clientWidth", "offsetWidth"] as const) {
    vi.spyOn(HTMLElement.prototype, prop, "get").mockReturnValue(800);
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        // jsdom has no layout to observe.
      }
      unobserve(): void {
        // As above.
      }
      disconnect(): void {
        // As above.
      }
    },
  );
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(source = fakeSource()) {
  const { VirtualTable } = await loadVirtualTable();
  const result = renderWithI18n(() => (
    <VirtualTable<Row>
      label="Transactions"
      columns={COLUMNS}
      source={source}
      rowHeight={ROW_HEIGHT}
      getRowId={(row) => row.id}
    />
  ));
  const grid = await screen.findByRole("grid");
  return { ...result, grid, source };
}

/** The data and placeholder rows (aria-rowindex ≥ 2). */
function bodyRows(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>('[role="row"]')].filter(
    (r) => Number(r.getAttribute("aria-rowindex")) >= 2,
  );
}

describe("TP-12.2: grid semantics and placeholders (F-219)", () => {
  it("TP-12.2: role=grid with aria-label, aria-rowcount = totalCount and aria-colcount = the column count", async () => {
    const { grid } = await mount();

    expect(grid.getAttribute("aria-label")).toBe("Transactions");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(TOTAL));
    expect(grid.getAttribute("aria-colcount")).toBe("2");
  });

  it("TP-12.2: the header row is aria-rowindex 1; each rendered row has aria-rowindex = index + 2 and gridcells", async () => {
    const { grid } = await mount();

    const header = [...grid.querySelectorAll('[role="row"]')].find(
      (r) => r.getAttribute("aria-rowindex") === "1",
    );
    expect(header?.textContent).toContain("Row");
    expect(header?.textContent).toContain("Amount");

    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const id = row.querySelector('[role="gridcell"]')?.textContent ?? "";
      const index = Number(id.replace(/^r/, ""));
      expect(row.getAttribute("aria-rowindex")).toBe(String(index + 2));
      expect(row.querySelectorAll('[role="gridcell"]')).toHaveLength(2);
    }
  });

  it("TP-12.2: rows of the dropped page render as placeholders: aria-busy=true, data-placeholder, the same height as data rows, with the right aria-rowindex", async () => {
    const { grid } = await mount();

    const placeholders = bodyRows(grid).filter((r) => r.hasAttribute("data-placeholder"));
    const data = bodyRows(grid).find((r) => !r.hasAttribute("data-placeholder"));

    expect(
      placeholders.map((p) => Number(p.getAttribute("aria-rowindex"))).sort((a, b) => a - b),
    ).toEqual(
      Array.from({ length: DROPPED.to - DROPPED.from + 1 }, (_, i) => DROPPED.from + i + 2),
    );
    for (const p of placeholders) {
      expect(p.getAttribute("aria-busy")).toBe("true");
      // A-343: inline heights on both kinds of row.
      expect(p.style.height).toBe(`${String(ROW_HEIGHT)}px`);
      expect(p.style.height).toBe(data?.style.height);
    }
  });

  it("TP-12.6x: fewer than 200 rows are in the DOM for 1,000 rows", async () => {
    const { grid } = await mount();

    const count = bodyRows(grid).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
  });

  it("TP-12.2 (A-341): header cells are columnheaders and every cell has aria-colindex = column + 1", async () => {
    const { grid } = await mount();

    const headers = [...grid.querySelectorAll('[role="columnheader"]')];
    expect(headers.map((h) => h.getAttribute("aria-colindex"))).toEqual(["1", "2"]);
    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    for (const row of rows) {
      expect(
        [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.getAttribute("aria-colindex")),
      ).toEqual(["1", "2"]);
    }
  });

  it('TP-12.2 (A-341): exactly one row has tabindex="0", the first data row', async () => {
    const { grid } = await mount();

    const stops = [...grid.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute("role")).toBe("row");
    expect(stops[0]?.getAttribute("aria-rowindex")).toBe("2");
  });

  it("TP-12.2 (A-338): with error() set, an error row shows the read message and Try again calls retry(); no ensurePage call", async () => {
    const error: AppError = { kind: "unknown" };
    const source = { ...fakeSource(), error: () => error, hasMore: () => true };
    const { grid } = await mount(source);

    const errorRow = [...grid.querySelectorAll<HTMLElement>('[role="row"]')].find((r) =>
      r.textContent.includes("Something went wrong on our side. Try again in a moment."),
    );
    expect(errorRow).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(source.retry).toHaveBeenCalledTimes(1);
    expect(source.ensurePage).not.toHaveBeenCalled();
  });

  it("TP-12.6x (A-340): a placeholder page in view is requested as ensurePage(floor(index / pageSize))", async () => {
    const source = fakeSource();
    await mount(source);

    expect(source.ensurePage).toHaveBeenCalledWith(2);
  });

  it("TP-12.6x: an unknown totalCount gives aria-rowcount -1", async () => {
    const source = { ...fakeSource(), totalCount: () => null };
    const { grid } = await mount(source);

    expect(grid.getAttribute("aria-rowcount")).toBe("-1");
  });
});

describe("TP-12.5: end-aligned numeric columns (F-219)", () => {
  it("TP-12.5: cells of the align:\"end\" column have the class text-end; the other column's don't", async () => {
    const { grid } = await mount();

    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [idCell, amountCell] = [...row.querySelectorAll('[role="gridcell"]')];
      expect(amountCell?.classList.contains("text-end")).toBe(true);
      expect(idCell?.classList.contains("text-end")).toBe(false);
    }
  });
});
