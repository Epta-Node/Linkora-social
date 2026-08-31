"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CreatePostModal } from "../modals/CreatePostModal";
import { Plus } from "lucide-react";

export interface SidebarProps {
  userAddress?: string;
  onPostCreated?: () => void;
}

export function Sidebar({ userAddress, onPostCreated }: SidebarProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <aside className="hidden lg:block w-64 shrink-0 px-4 py-6">
      <div className="space-y-4 sticky top-24">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-500 transition-colors shadow-lg shadow-violet-950/20 cursor-pointer"
        >
          <Plus className="h-5 w-5" />
          <span>Create Post</span>
        </button>

        <nav className="space-y-1">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            Home Feed
          </Link>
          <Link
            href="/explore"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            Explore
          </Link>
        </nav>
      </div>

      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async () => {
          if (onPostCreated) onPostCreated();
        }}
        author={userAddress}
      />
    </aside>
  );
}
