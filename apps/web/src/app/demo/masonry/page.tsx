import { MasonryGrid } from "@/components/cards/MasonryGrid";

const HEIGHTS = [180, 240, 140, 300, 200, 160, 260, 220, 190];

/** Demo of the responsive masonry layout (used by the Playwright breakpoint test). */
export default function MasonryDemoPage() {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <MasonryGrid>
        {HEIGHTS.map((h, i) => (
          <div key={i} className="rounded-xl bg-slate-200 dark:bg-slate-800" style={{ height: h }}>
            <span className="sr-only">Card {i + 1}</span>
          </div>
        ))}
      </MasonryGrid>
    </main>
  );
}
