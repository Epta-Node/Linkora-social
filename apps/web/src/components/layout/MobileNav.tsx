import React from "react";
import Link from "next/link";
import { Logo } from "@/components/branding/Logo";

interface MobileNavProps {
  className?: string;
  activePath?: string;
  unreadCount?: number;
  onComposeClick?: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  className = "",
  activePath = "/",
  unreadCount = 0,
  onComposeClick,
}) => {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-md px-4 py-2 md:hidden flex justify-around items-center shadow-lg ${className}`}
    >
      <div className="hidden">
        <Logo variant="icon" size="sm" />
      </div>

      <Link
        href="/feed"
        className={`flex flex-col items-center justify-center p-1.5 transition-colors ${
          activePath === "/" || activePath === "/feed"
            ? "text-[#6366F1]"
            : "text-[var(--text-muted)] hover:text-violet-400"
        }`}
        aria-label="Home Feed"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
          />
        </svg>
        <span className="text-[10px] mt-0.5">Home</span>
      </Link>

      <Link
        href="/explore"
        className={`flex flex-col items-center justify-center p-1.5 transition-colors ${
          activePath === "/explore"
            ? "text-[#6366F1]"
            : "text-[var(--text-muted)] hover:text-violet-400"
        }`}
        aria-label="Explore"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.602 10.602Z"
          />
        </svg>
        <span className="text-[10px] mt-0.5">Explore</span>
      </Link>

      {onComposeClick && (
        <button
          onClick={onComposeClick}
          className="flex items-center justify-center rounded-full bg-gradient-to-r from-[#1E3A5F] to-[#6366F1] text-white p-3 shadow-lg -mt-5 border-4 border-[var(--background)] transition-transform active:scale-95 hover:opacity-90"
          aria-label="Compose new post"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      )}

      <Link
        href="/notifications"
        className={`relative flex flex-col items-center justify-center p-1.5 transition-colors ${
          activePath === "/notifications"
            ? "text-[#6366F1]"
            : "text-[var(--text-muted)] hover:text-violet-400"
        }`}
        aria-label="Notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-2 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#6366F1] text-[9px] font-bold text-white border border-[var(--background)]">
            {unreadCount > 99 ? "99" : unreadCount}
          </span>
        )}
        <span className="text-[10px] mt-0.5">Notifications</span>
      </Link>

      <Link
        href="/analytics"
        className={`flex flex-col items-center justify-center p-1.5 transition-colors ${
          activePath === "/analytics"
            ? "text-[#6366F1]"
            : "text-[var(--text-muted)] hover:text-violet-400"
        }`}
        aria-label="Analytics"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
        <span className="text-[10px] mt-0.5">Analytics</span>
      </Link>
    </div>
  );
};

export default MobileNav;
