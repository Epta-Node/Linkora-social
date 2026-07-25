"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type FeedTab = "following" | "explore";

interface MobileHeaderProps {
  activeTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
}

const LINK_PILLS = [
  { href: "/pools", label: "Pools" },
  { href: "/governance", label: "Governance" },
] as const;

function pillClass(active: boolean): string {
  return `shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors min-h-[36px] ${
    active
      ? "border-[var(--color-info)] bg-[var(--color-info)] text-white"
      : "border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]"
  }`;
}

export function MobileHeader({ activeTab, onTabChange }: MobileHeaderProps) {
  const pathname = usePathname();

  return (
    <div
      className="md:hidden -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1"
      role="tablist"
      aria-label="Feed sections"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "explore"}
        onClick={() => onTabChange("explore")}
        className={pillClass(activeTab === "explore")}
      >
        Explore
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "following"}
        onClick={() => onTabChange("following")}
        className={pillClass(activeTab === "following")}
      >
        Following
      </button>
      {LINK_PILLS.map((pill) => (
        <Link
          key={pill.href}
          href={pill.href}
          className={pillClass(pathname.startsWith(pill.href))}
        >
          {pill.label}
        </Link>
      ))}
    </div>
  );
}
