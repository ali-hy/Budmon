// F-220 createInfiniteList: paging, dropping and refetching pages. TP-12.1, plus extra cases
// TP-12.6x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Pages are requested with ensurePage(i), one after another: F-220 has no other way to ask for the
// next page (question raised with the planner on whether the list also fetches by itself).
import { describe, expect, it, vi } from "vitest";
import { type InfiniteListSource, loadInfiniteList } from "../../support/s12.js";

interface Row {
  id: string;
  index: number;
}

const PAGE = 100;
const PAGES = 100;

/** 100 pages of 100 rows; the cursor for page n is "c<n>". `failOn` pages reject while listed. */
function fakeFetchPage(failOn: Set<number> = new Set()) {
  return vi.fn((cursor: string | null) => {
    const page = cursor === null ? 0 : Number(cursor.slice(1));
    if (failOn.has(page)) return Promise.reject(new TypeError("Failed to fetch"));
    const items = Array.from({ length: PAGE }, (_, i) => ({
      id: `r${String(page * PAGE + i)}`,
      index: page * PAGE + i,
    }));
    return Promise.resolve({
      items,
      nextCursor: page + 1 < PAGES ? `c${String(page + 1)}` : null,
    });
  });
}

/** Lets pending fetches settle. */
async function settle(list: InfiniteListSource<Row>): Promise<void> {
  await vi.waitFor(() => {
    expect(list.loading()).toBe(false);
  });
  await new Promise((r) => setTimeout(r, 0));
}

async function loadPages(list: InfiniteListSource<Row>, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    list.ensurePage(i);
    await settle(list);
  }
}

describe("TP-12.1: paging, dropping and refetching (F-220)", () => {
  it("TP-12.1: after 60 pages, pages 0..9 are dropped (rowAt(5) undefined) and rowCount stays 6000", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const fetchPage = fakeFetchPage();
    const list = createInfiniteList<Row>({ fetchPage, pageSize: PAGE });

    await loadPages(list, 60);

    expect(list.rowCount()).toBe(6000);
    expect(list.rowAt(5)).toBeUndefined();
    expect(list.rowAt(999)).toBeUndefined();
    expect(list.rowAt(1000)).toEqual({ id: "r1000", index: 1000 });
    expect(list.rowAt(5999)).toEqual({ id: "r5999", index: 5999 });
    expect(list.error()).toBeNull();
  });

  it("TP-12.1: ensurePage(0) refetches page 0 from its recorded cursor (null); rowAt(5) is the original row at the same index", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const fetchPage = fakeFetchPage();
    const list = createInfiniteList<Row>({ fetchPage, pageSize: PAGE });
    await loadPages(list, 60);
    const callsBefore = fetchPage.mock.calls.length;

    list.ensurePage(0);
    await settle(list);

    expect(fetchPage.mock.calls.length).toBe(callsBefore + 1);
    expect(fetchPage.mock.calls.at(-1)?.[0]).toBeNull();
    expect(list.rowAt(5)).toEqual({ id: "r5", index: 5 });
    expect(list.rowCount()).toBe(6000);
  });

  it("TP-12.6x: refetching a middle page uses that page's own cursor", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const fetchPage = fakeFetchPage();
    const list = createInfiniteList<Row>({ fetchPage, pageSize: PAGE });
    await loadPages(list, 60);

    list.ensurePage(7);
    await settle(list);

    expect(fetchPage.mock.calls.at(-1)?.[0]).toBe("c7");
    expect(list.rowAt(750)).toEqual({ id: "r750", index: 750 });
  });

  it("TP-12.6x: refetching page 0 keeps at most 50 pages: the page farthest from it (59) is dropped", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const list = createInfiniteList<Row>({ fetchPage: fakeFetchPage(), pageSize: PAGE });
    await loadPages(list, 60);

    list.ensurePage(0);
    await settle(list);

    expect(list.rowAt(5)).toBeDefined();
    expect(list.rowAt(5999)).toBeUndefined();
    expect(list.rowAt(5899)).toBeDefined();
  });

  it("TP-12.6x: maxPagesInMemory is honoured: with 3, loading 5 pages keeps pages 2..4", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const list = createInfiniteList<Row>({
      fetchPage: fakeFetchPage(),
      pageSize: PAGE,
      maxPagesInMemory: 3,
    });

    await loadPages(list, 5);

    expect(list.rowCount()).toBe(500);
    expect([0, 100, 200, 300, 400].map((i) => list.rowAt(i) !== undefined)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("TP-12.1: a fetch error sets error() and stops fetching until ensurePage is called again", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    const failOn = new Set([3]);
    const fetchPage = fakeFetchPage(failOn);
    const list = createInfiniteList<Row>({ fetchPage, pageSize: PAGE });
    await loadPages(list, 3);

    list.ensurePage(3);
    await settle(list);

    expect(list.error()).not.toBeNull();
    expect(list.rowCount()).toBe(300);
    const callsAfterError = fetchPage.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchPage.mock.calls.length).toBe(callsAfterError);

    failOn.clear();
    list.ensurePage(3);
    await settle(list);

    expect(fetchPage.mock.calls.length).toBe(callsAfterError + 1);
    expect(fetchPage.mock.calls.at(-1)?.[0]).toBe("c3");
    expect(list.rowAt(350)).toEqual({ id: "r350", index: 350 });
  });

  it("TP-12.6x: loading() is true while a page is being fetched", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    let release: () => void = () => undefined;
    const fetchPage = vi.fn(
      () =>
        new Promise<{ items: Row[]; nextCursor: string | null }>((resolve) => {
          release = () => {
            resolve({ items: [{ id: "r0", index: 0 }], nextCursor: null });
          };
        }),
    );
    const list = createInfiniteList<Row>({ fetchPage, pageSize: 1 });

    list.ensurePage(0);
    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalled();
    });

    expect(list.loading()).toBe(true);
    release();
    await settle(list);
    expect(list.rowAt(0)).toEqual({ id: "r0", index: 0 });
  });
});
