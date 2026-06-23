import { Suspense } from "react";
import { SearchPageClient } from "./SearchPageClient";

type BoundaryProps = {
  fallback: JSX.Element;
  children: JSX.Element;
};

const SuspenseBoundary = Suspense as unknown as (props: BoundaryProps) => JSX.Element;

export default function SearchPage() {
  return (
    <SuspenseBoundary fallback={<div className="mx-auto max-w-5xl px-4 py-10">Loading search...</div>}>
      <SearchPageClient />
    </SuspenseBoundary>
  );
}
