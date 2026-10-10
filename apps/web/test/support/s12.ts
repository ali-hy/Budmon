// S-12 loaders (test-architect). F-219 VirtualTable and F-220 createInfiniteList don't exist yet,
// so they load through dynamic imports with the LLD's signatures declared here. Once the code lands,
// these become static imports.
import type { JSX } from "solid-js";
import type { AppError } from "./s11b.js";

export interface InfiniteListSource<T> {
  rowCount: () => number;
  totalCount: () => number | null;
  rowAt: (index: number) => T | undefined;
  ensurePage: (pageIndex: number) => void;
  loading: () => boolean;
  error: () => AppError | null;
}

export interface InfiniteListModule {
  createInfiniteList: <T>(opts: {
    fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
    pageSize: number;
    maxPagesInMemory?: number;
  }) => InfiniteListSource<T>;
}

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => JSX.Element;
  align?: "start" | "end";
}

export interface VirtualTableModule {
  VirtualTable: <T>(props: {
    label: string;
    columns: readonly Column<T>[];
    source: InfiniteListSource<T>;
    rowHeight: number;
    getRowId: (row: T) => string;
    onRowActivate?: (row: T) => void;
  }) => JSX.Element;
}

const SRC = "../../src/ui/table";
const SPECS = {
  infiniteList: `${SRC}/infiniteList.ts`,
  virtualTable: `${SRC}/VirtualTable.tsx`,
} as const;

async function load<T>(spec: string): Promise<T> {
  return (await import(/* @vite-ignore */ spec)) as T;
}

export const loadInfiniteList = () => load<InfiniteListModule>(SPECS.infiniteList);
export const loadVirtualTable = () => load<VirtualTableModule>(SPECS.virtualTable);
