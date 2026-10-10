// F-216: the router (TanStack Router, code-based).
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type AnyRoute,
  type ErrorComponentProps,
} from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { toAppError } from "./api/errors.js";
import { HomePlaceholder } from "./pages/HomePlaceholder.js";
import { NotFound } from "./pages/NotFound.js";
import { announce } from "./ui/a11y.js";
import { ErrorFallback } from "./ui/ErrorFallback.js";

function RootLayout(): JSX.Element {
  return (
    <>
      <header />
      <main id="main" class="mx-auto max-w-[40rem] p-4">
        <Outlet />
      </main>
    </>
  );
}

export async function createAppRouter() {
  // Assigned below; the error component only runs once the router exists.
  let invalidate: () => Promise<void> = () => Promise.resolve();
  const rootRoute = createRootRoute({
    component: RootLayout,
    errorComponent: (props: ErrorComponentProps) => (
      <ErrorFallback error={toAppError(props.error)} onRetry={() => invalidate()} />
    ),
    notFoundComponent: NotFound,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePlaceholder,
  });

  const children: AnyRoute[] = [indexRoute];
  // A-332: fixtures are only reachable in fixture builds; a normal build folds this away.
  if (import.meta.env.VITE_FIXTURES === "1") {
    const { createFixtureRoutes } = await import("./fixtures/routes.js");
    children.push(...createFixtureRoutes(rootRoute));
  }

  const router = createRouter({ routeTree: rootRoute.addChildren(children) });
  invalidate = () => router.invalidate();

  // A-333: after a client-side navigation (never the first load), focus the new page's h1 and
  // announce its text.
  let firstLoad = true;
  router.subscribe("onResolved", () => {
    if (firstLoad) {
      firstLoad = false;
      return;
    }
    setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>("main h1");
      if (h1 === null) return;
      h1.focus();
      announce(h1.textContent);
    }, 0);
  });
  return router;
}
