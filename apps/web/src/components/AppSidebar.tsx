"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sidebarLinks = [
  {
    href: "/pools",
    label: "Pools",
    tourId: "pools",
    description: "Community reward pools",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375M3.75 16.5h16.5"
      />
    ),
  },
  {
    href: "/explore",
    label: "Mini Apps",
    tourId: "mini-apps",
    description: "Discover integrations",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
      />
    ),
  },
] as const;

import { useState } from "react";
import { CreatePostModal } from "@/components/modals/CreatePostModal";

export function AppSidebar() {
  const pathname = usePathname();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <aside className="hidden w-56 shrink-0 lg:block" aria-label="App sidebar" data-tour="sidebar">
      <div className="sticky top-24 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/60 p-3">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-md"
        >
          Create Post
        </button>

        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Discover
        </p>
        <nav className="space-y-1">
          {sidebarLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                data-tour={link.tourId}
                className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                  isActive
                    ? "bg-violet-600/15 text-violet-300"
                    : "text-[var(--foreground)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  aria-hidden="true"
                >
                  {link.icon}
                </svg>
                <span>
                  <span className="block text-sm font-semibold">{link.label}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{link.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <CreatePostModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </aside>
  );
}
