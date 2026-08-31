import { createElement, Suspense } from "react";
import { SearchPageClient } from "./SearchPageClient";

export default function SearchPage(): any {
  return createElement(
    Suspense as any,
    {
      fallback: <div className="mx-auto max-w-5xl px-4 py-10">Loading search...</div>,
    },
    <SearchPageClient />
  );
}
