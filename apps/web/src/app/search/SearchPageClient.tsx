"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Post,
  PostCard,
  getPostDate,
  getPostTipTotal,
} from "@/components/PostCard";
import { FeedSkeleton, PoolCardSkeleton } from "@/components/skeletons";
import { Profile, ProfileCard } from "@/components/ProfileCard";
import SearchBar from "@/components/SearchBar";
import { isAboveTheFold } from "@/lib/responsiveImage";

// Results sit in the max-w-5xl (1024px) container minus page padding.
const SEARCH_POST_IMAGE_SIZES = "(min-width: 1024px) 992px, 100vw";
const SEARCH_DEBOUNCE_MS = 300;
const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "";

/** Stellar amounts carry 7 decimal places. */
const TOKENS_PER_UNIT = BigInt(10_000_000);

const TRENDING_SEARCHES = [
  { label: "Stellar", query: "stellar" },
  { label: "Soroban", query: "soroban" },
  { label: "DeFi", query: "defi" },
  { label: "NFT", query: "nft" },
  { label: "DAO", query: "dao" },
] as const;

const DATE_PRESETS = [
  { id: "any", label: "Any time", days: null },
  { id: "day", label: "Past 24h", days: 1 },
  { id: "week", label: "Past week", days: 7 },
  { id: "month", label: "Past month", days: 30 },
] as const;

type Tab = "posts" | "profiles" | "pools";
type Sort = "relevance" | "recent" | "most_tipped";
type PoolStatus = "all" | "active" | "empty";
type PoolTvlRange = "any" | "under_100" | "100_1000" | "over_1000";

interface PoolResult {
  pool_id: string;
  token: string;
  balance: string | number | bigint;
  admins?: string[];
  threshold?: number;
  created_ledger?: number;
  updated_ledger?: number;
}

function readTab(value: string | null): Tab {
  if (value === "profiles" || value === "pools") return value;
  return "posts";
}

function readSort(value: string | null): Sort {
  if (value === "recent" || value === "most_tipped") return value;
  return "relevance";
}

function readPoolStatus(value: string | null): PoolStatus {
  if (value === "active" || value === "empty") return value;
  return "all";
}

function readPoolTvlRange(value: string | null): PoolTvlRange {
  if (value === "under_100" || value === "100_1000" || value === "over_1000") return value;
  return "any";
}

function readMinFollowers(value: string | null): number {
  if (value === "100") return 100;
  if (value === "1000") return 1000;
  return 0;
}

function toDateStart(value: string): number | null {
  if (!value) return null;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(time) ? null : time;
}

function toDateEnd(value: string): number | null {
  if (!value) return null;
  const time = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(time) ? null : time;
}

function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

function isDatePresetActive(from: string, to: string, days: number | null): boolean {
  if (days === null) return !from && !to;
  return !to && from === dateDaysAgo(days);
}

function readPosts(data: unknown): Post[] {
  if (Array.isArray(data)) return data as Post[];
  if (data && typeof data === "object" && Array.isArray((data as { posts?: unknown }).posts)) {
    return (data as { posts: Post[] }).posts;
  }
  return [];
}

function readProfiles(data: unknown): Profile[] {
  if (Array.isArray(data)) return data as Profile[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { profiles?: unknown }).profiles)
  ) {
    return (data as { profiles: Profile[] }).profiles;
  }
  return [];
}

function readPools(data: unknown): PoolResult[] {
  if (Array.isArray(data)) return data as PoolResult[];
  if (data && typeof data === "object" && Array.isArray((data as { pools?: unknown }).pools)) {
    return (data as { pools: PoolResult[] }).pools;
  }
  return [];
}

function rawPoolBalance(value: string | number | bigint): bigint {
  try {
    return BigInt(value.toString());
  } catch {
    return BigInt(0);
  }
}

function formatPoolBalance(value: string | number | bigint): string {
  const raw = rawPoolBalance(value);
  const whole = raw / TOKENS_PER_UNIT;
  const fraction = (raw % TOKENS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function matchesPoolTvl(value: string | number | bigint, range: PoolTvlRange): boolean {
  if (range === "any") return true;

  const balance = rawPoolBalance(value);
  if (range === "under_100") return balance < TOKENS_PER_UNIT * BigInt(100);
  if (range === "100_1000") {
    return balance >= TOKENS_PER_UNIT * BigInt(100) && balance < TOKENS_PER_UNIT * BigInt(1000);
  }
  return balance >= TOKENS_PER_UNIT * BigInt(1000);
}

function shortenAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
        active
          ? "border-violet-500 bg-violet-600 text-white"
          : "border-[var(--border)] bg-[var(--muted)] text-[var(--text-muted)] hover:border-violet-400 hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyIllustration({ tab }: { tab: Tab }) {
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label="No search results illustration"
      data-testid="search-empty-illustration"
      className="mx-auto mb-4 h-20 w-20 text-[var(--text-muted)]"
    >
      <circle cx="48" cy="48" r="40" fill="currentColor" opacity="0.08" />
      {tab === "posts" && (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <rect x="30" y="24" width="32" height="40" rx="4" />
          <path d="M38 35h16M38 43h16M38 51h10" />
        </g>
      )}
      {tab === "profiles" && (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="46" cy="38" r="10" />
          <path d="M29 66c2-10 9-15 17-15s15 5 17 15" />
        </g>
      )}
      {tab === "pools" && (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M28 42h36v22a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4V42Z" />
          <path d="M25 42h42M34 34l12-8 12 8M39 50v10M47 50v10M55 50v10" />
        </g>
      )}
      <circle
        cx="64"
        cy="64"
        r="12"
        fill="var(--background)"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="m73 73 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchEmptyState({
  tab,
  query,
  filtered,
}: {
  tab: Tab;
  query: string;
  filtered: boolean;
}) {
  return (
    <div
      data-testid="search-empty-state"
      className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] px-6 py-10 text-center"
    >
      <EmptyIllustration tab={tab} />
      <h2 className="text-base font-semibold text-[var(--foreground)]">
        {filtered ? `No ${tab} match these filters` : `No ${tab} found for "${query}".`}
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {filtered
          ? "Try widening the date range or clearing a filter."
          : "Try a different keyword or check the spelling."}
      </p>
    </div>
  );
}

function TrendingSearches({ onSelect }: { onSelect: (query: string) => void }) {
  return (
    <section
      aria-labelledby="trending-searches-heading"
      data-testid="trending-searches"
      className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-5"
    >
      <h2 id="trending-searches-heading" className="text-sm font-semibold text-[var(--foreground)]">
        Trending searches
      </h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Popular topics across the Linkora community.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {TRENDING_SEARCHES.map((term) => (
          <button
            key={term.query}
            type="button"
            onClick={() => onSelect(term.query)}
            className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-violet-400 hover:text-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          >
            {term.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function PoolResultCard({ pool }: { pool: PoolResult }) {
  const admins = Array.isArray(pool.admins) ? pool.admins : [];
  const threshold = pool.threshold ?? 0;
  const isEmpty = rawPoolBalance(pool.balance) <= BigInt(0);

  return (
    <Link
      href={`/pools/${encodeURIComponent(pool.pool_id)}`}
      aria-label={`View pool ${pool.pool_id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
    >
      <article className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 transition-colors hover:border-violet-500/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--foreground)]">
              {pool.pool_id}
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={pool.token}>
              Token {shortenAddress(pool.token)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              isEmpty
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {isEmpty ? "Empty" : "Active"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-[var(--text-muted)]">
            TVL{" "}
            <strong className="text-base font-semibold text-[var(--foreground)]">
              {formatPoolBalance(pool.balance)}
            </strong>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {admins.length} {admins.length === 1 ? "admin" : "admins"} · {threshold}-of-
            {admins.length} threshold
          </p>
        </div>
      </article>
    </Link>
  );
}

export function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = searchParams.get("q") ?? "";
  const activeTab = readTab(searchParams.get("tab"));
  const sort = readSort(searchParams.get("sort"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const author = searchParams.get("author") ?? "";
  const minFollowers = readMinFollowers(searchParams.get("min_followers"));
  const poolStatus = readPoolStatus(searchParams.get("status"));
  const poolTvl = readPoolTvlRange(searchParams.get("tvl"));

  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pools, setPools] = useState<PoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorInput, setAuthorInput] = useState(author);
  const [isPending, startTransition] = useTransition();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest params available to debounced callbacks without re-creating them.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const updateParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(paramsRef.current.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    startTransition(() => {
      router.replace(`/search?${next.toString()}`, { scroll: false });
    });
  };
  const updateParamsRef = useRef(updateParams);
  updateParamsRef.current = updateParams;

  useEffect(() => {
    setAuthorInput(author);
  }, [author]);

  // `/` focuses search from anywhere on the page, unless the user is already typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current);
      if (authorDebounceRef.current) clearTimeout(authorDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPosts([]);
      setProfiles([]);
      setPools([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const path =
      activeTab === "profiles"
        ? "/api/profiles/search"
        : activeTab === "pools"
          ? "/api/pools/search"
          : "/api/search";

    setLoading(true);
    setError(null);

    fetch(`${INDEXER_API_URL}${path}?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Search request failed.");
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        // Results and the end of loading land in the same transition so the
        // list never flashes an empty state between the two updates.
        startTransition(() => {
          setPosts(readPosts(data));
          setProfiles(readProfiles(data));
          setPools(readPools(data));
          setLoading(false);
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Search request failed.");
        setPosts([]);
        setProfiles([]);
        setPools([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [activeTab, query]);

  const submitSearch = (nextQuery: string) => {
    if (queryDebounceRef.current) {
      clearTimeout(queryDebounceRef.current);
      queryDebounceRef.current = null;
    }

    const next = new URLSearchParams(paramsRef.current.toString());
    const trimmed = nextQuery.trim();
    if (trimmed) {
      next.set("q", trimmed);
    } else {
      next.delete("q");
    }
    // A new search should not silently inherit an old date window.
    next.delete("from");
    next.delete("to");

    startTransition(() => {
      router.push(`/search?${next.toString()}`);
    });
  };

  const handleQueryChange = (value: string) => {
    if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current);

    queryDebounceRef.current = setTimeout(() => {
      queryDebounceRef.current = null;
      const nextQuery = value.trim();
      const currentQuery = (paramsRef.current.get("q") ?? "").trim();
      if (nextQuery === currentQuery) return;
      updateParamsRef.current({ q: nextQuery, from: "", to: "" });
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleAuthorChange = (value: string) => {
    setAuthorInput(value);
    if (authorDebounceRef.current) clearTimeout(authorDebounceRef.current);

    authorDebounceRef.current = setTimeout(() => {
      authorDebounceRef.current = null;
      updateParamsRef.current({ author: value.trim() });
    }, SEARCH_DEBOUNCE_MS);
  };

  const clearFilters = () => {
    if (authorDebounceRef.current) {
      clearTimeout(authorDebounceRef.current);
      authorDebounceRef.current = null;
    }
    setAuthorInput("");
    updateParams({
      from: "",
      to: "",
      author: "",
      min_followers: "",
      tvl: "",
      status: "",
    });
  };

  const hasQuery = query.trim().length > 0;

  const visiblePosts = useMemo(() => {
    const fromTime = toDateStart(from);
    const toTime = toDateEnd(to);
    const authorFilter = authorInput.trim().toLowerCase();

    const filtered = posts.filter((post) => {
      if (authorFilter) {
        const authorAddress = post.author.toLowerCase();
        const username = (post.username ?? "").toLowerCase();
        if (!authorAddress.includes(authorFilter) && !username.includes(authorFilter)) {
          return false;
        }
      }

      const postDate = getPostDate(post);
      if (fromTime !== null || toTime !== null) {
        if (!postDate) return false;
        const time = postDate.getTime();
        if (fromTime !== null && time < fromTime) return false;
        if (toTime !== null && time > toTime) return false;
      }

      return true;
    });

    if (sort === "recent") {
      return [...filtered].sort(
        (a, b) => (getPostDate(b)?.getTime() ?? 0) - (getPostDate(a)?.getTime() ?? 0)
      );
    }
    if (sort === "most_tipped") {
      return [...filtered].sort((a, b) => getPostTipTotal(b) - getPostTipTotal(a));
    }
    return filtered;
  }, [authorInput, from, posts, sort, to]);

  const visibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => (profile.followerCount ?? profile.follower_count ?? 0) >= minFollowers
      ),
    [minFollowers, profiles]
  );

  const visiblePools = useMemo(
    () =>
      pools.filter((pool) => {
        const balance = rawPoolBalance(pool.balance);
        if (poolStatus === "active" && balance <= BigInt(0)) return false;
        if (poolStatus === "empty" && balance > BigInt(0)) return false;
        return matchesPoolTvl(pool.balance, poolTvl);
      }),
    [poolStatus, poolTvl, pools]
  );

  const hasPostResults = visiblePosts.length > 0;
  const hasProfileResults = visibleProfiles.length > 0;
  const hasPoolResults = visiblePools.length > 0;
  const filtersActive = Boolean(
    from || to || author || minFollowers > 0 || poolStatus !== "all" || poolTvl !== "any"
  );
  const resultsClassName = `space-y-4 transition-[opacity,filter] duration-200 motion-reduce:transition-none ${
    isPending ? "pointer-events-none opacity-60 blur-[1px]" : "opacity-100"
  }`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Search</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Find posts, creators, and community pools across Linkora.
        </p>
        <div className="mt-4 max-w-2xl">
          <SearchBar
            onSearch={submitSearch}
            onQueryChange={handleQueryChange}
            initialValue={query}
            placeholder="Search posts, profiles, and pools"
            inputRef={searchInputRef}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Press{" "}
          <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px]">
            /
          </kbd>{" "}
          to focus search.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Search result type">
          {(
            [
              { id: "posts", label: "Posts" },
              { id: "profiles", label: "Profiles" },
              { id: "pools", label: "Pools" },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => updateParams({ tab: tab.id })}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
                  active
                    ? "bg-violet-600 text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "posts" && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              Sort
              <select
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value })}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                <option value="relevance">Relevance</option>
                <option value="recent">Most recent</option>
                <option value="most_tipped">Most tipped</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => updateParams({ from: e.target.value })}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => updateParams({ to: e.target.value })}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </label>
          </div>
        )}
      </div>

      {activeTab === "posts" && (
        <div className="mb-6 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Date
            </span>
            {DATE_PRESETS.map((preset) => (
              <FilterChip
                key={preset.id}
                label={preset.label}
                active={isDatePresetActive(from, to, preset.days)}
                onClick={() =>
                  updateParams({
                    from: preset.days === null ? "" : dateDaysAgo(preset.days),
                    to: "",
                  })
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              Author
              <input
                type="search"
                value={authorInput}
                onChange={(e) => handleAuthorChange(e.target.value)}
                placeholder="@username or wallet address"
                className="h-9 w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </label>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === "profiles" && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Followers
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Minimum followers">
            <FilterChip
              label="Any"
              active={minFollowers === 0}
              onClick={() => updateParams({ min_followers: "" })}
            />
            <FilterChip
              label="100+"
              active={minFollowers === 100}
              onClick={() => updateParams({ min_followers: "100" })}
            />
            <FilterChip
              label="1k+"
              active={minFollowers === 1000}
              onClick={() => updateParams({ min_followers: "1000" })}
            />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {activeTab === "pools" && (
        <div className="mb-6 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pool status">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Status
            </span>
            <FilterChip
              label="Any status"
              active={poolStatus === "all"}
              onClick={() => updateParams({ status: "" })}
            />
            <FilterChip
              label="Active"
              active={poolStatus === "active"}
              onClick={() => updateParams({ status: "active" })}
            />
            <FilterChip
              label="Empty"
              active={poolStatus === "empty"}
              onClick={() => updateParams({ status: "empty" })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="TVL range">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              TVL
            </span>
            <FilterChip
              label="Any TVL"
              active={poolTvl === "any"}
              onClick={() => updateParams({ tvl: "" })}
            />
            <FilterChip
              label="Under 100"
              active={poolTvl === "under_100"}
              onClick={() => updateParams({ tvl: "under_100" })}
            />
            <FilterChip
              label="100–1k"
              active={poolTvl === "100_1000"}
              onClick={() => updateParams({ tvl: "100_1000" })}
            />
            <FilterChip
              label="1k+"
              active={poolTvl === "over_1000"}
              onClick={() => updateParams({ tvl: "over_1000" })}
            />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {!hasQuery && (
        <div className="space-y-4">
          <TrendingSearches onSelect={submitSearch} />
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center">
            <EmptyIllustration tab={activeTab} />
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              Search across Linkora
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Enter a search term to find posts, profiles, and pools. Search by keyword, creator
              name or wallet, pool ID, or token.
            </p>
          </div>
        </div>
      )}

      {hasQuery && activeTab === "posts" && (
        <div
          data-testid="search-results"
          aria-busy={isPending || loading}
          aria-live="polite"
          data-pending={isPending ? "true" : undefined}
          className={resultsClassName}
        >
          {loading && <FeedSkeleton count={5} />}
          {!loading && !error && hasPostResults && (
            <p className="text-xs text-[var(--text-muted)]">
              {visiblePosts.length} {visiblePosts.length === 1 ? "result" : "results"}
            </p>
          )}
          {!loading &&
            !error &&
            visiblePosts.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                query={query}
                priority={isAboveTheFold(index)}
                imageSizes={SEARCH_POST_IMAGE_SIZES}
              />
            ))}
          {!loading && !error && !hasPostResults && (
            <SearchEmptyState tab="posts" query={query} filtered={posts.length > 0} />
          )}
        </div>
      )}

      {hasQuery && activeTab === "profiles" && (
        <div
          data-testid="search-results"
          aria-busy={isPending || loading}
          aria-live="polite"
          data-pending={isPending ? "true" : undefined}
          className={resultsClassName}
        >
          {loading && (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">Loading profiles...</p>
          )}
          {!loading && !error && hasProfileResults && (
            <p className="text-xs text-[var(--text-muted)]">
              {visibleProfiles.length} {visibleProfiles.length === 1 ? "profile" : "profiles"}
            </p>
          )}
          {!loading &&
            !error &&
            visibleProfiles.map((profile) => (
              <ProfileCard key={profile.address} profile={profile} />
            ))}
          {!loading && !error && !hasProfileResults && (
            <SearchEmptyState tab="profiles" query={query} filtered={profiles.length > 0} />
          )}
        </div>
      )}

      {hasQuery && activeTab === "pools" && (
        <div
          data-testid="search-results"
          aria-busy={isPending || loading}
          aria-live="polite"
          data-pending={isPending ? "true" : undefined}
          className={resultsClassName}
        >
          {loading && (
            <>
              <PoolCardSkeleton />
              <PoolCardSkeleton />
            </>
          )}
          {!loading && !error && hasPoolResults && (
            <p className="text-xs text-[var(--text-muted)]">
              {visiblePools.length} {visiblePools.length === 1 ? "pool" : "pools"}
            </p>
          )}
          {!loading &&
            !error &&
            visiblePools.map((pool) => <PoolResultCard key={pool.pool_id} pool={pool} />)}
          {!loading && !error && !hasPoolResults && (
            <SearchEmptyState tab="pools" query={query} filtered={pools.length > 0} />
          )}
        </div>
      )}
    </div>
  );
}
