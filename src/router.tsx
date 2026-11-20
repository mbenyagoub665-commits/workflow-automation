import { createRouter } from "@tanstack/react-router";
import { ErrorPage, NotFoundPage } from "@/client/components/ErrorPage";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });
}
