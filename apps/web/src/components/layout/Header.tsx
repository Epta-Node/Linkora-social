"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CreatePostModal } from "../modals/CreatePostModal";
import { Plus } from "lucide-react";

export interface HeaderProps {
  userAddress?: string;
  onPostCreated?: () => void;
}

export function Header({ userAddress, onPostCreated }: HeaderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm px-4 py-3">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tight text-violet-500 hover:text-violet-400 transition-colors"
        >
          Linkora
        </Link>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
            aria-label="Create Post"
          >
            <Plus className="h-4 w-4" />
            <span>Create</span>
          </button>
        </div>
      </div>

      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async () => {
          if (onPostCreated) onPostCreated();
        }}
        author={userAddress}
      />
    </header>
  );
}
