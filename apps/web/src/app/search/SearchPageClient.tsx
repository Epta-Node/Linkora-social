"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Post, PostCard, PostCardSkeleton, getPostDate, getPostTipTotal } from "@/components/PostCard";
import { Profile, ProfileCard } from "@/components/ProfileCard";
import SearchBar from "@/components/SearchBar";

type Tab = "posts" | "profiles";
type Sort = "relevance" | "recent" | "most_tipped";

const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3001";

function readTab(value: string | null): Tab {
  return value === "profiles" ? "profiles" : "posts";
}

function readSort(value: string | null): Sort {
  if (value === "recent" || value === "most_tipped") return value;
  return "relevance";
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

function readPosts(data: unknown): Post[] {
  if (Array.isArray(data)) return data as Post[];
  if (data && typeof data === "object" && Array.isArray((data as { posts?: unknown }).posts)) {
    return (data as { posts: Post[] }).posts;
  }
  return [];
}

function readProfiles(data: unknown): Profile[] {
  if (Array.isArray(data)) return data as Profile[];
  if (data && typeof data === "object" && Array.isArray((data as { profiles?: unknown }).profiles)) {
    return (data as { profiles: Profile[] }).profiles;
  }
  return [];
}

export function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = searchParams.get("q") ?? "";
  const activeTab = readTab(searchParams.get("tab"));
  const sort = readSort(searchParams.get("sort"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });

    router.replace(`/search?${next.toString()}`, { scroll: false });
  };

  const submitSearch = (nextQuery: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("q", nextQuery);
    next.delete("from");
    next.delete("to");
    router.push(`/search?${next.toString()}`);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPosts([]);
      setProfiles([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const path = activeTab === "profiles" ? "/api/profiles/search" : "/api/search";

    setLoading(true);
    setError(null);

    fetch(`${INDEXER_API_URL}${path}?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Search request failed.");
        return response.json();
      })
      .then((data) => {
        if (activeTab === "profiles") {
          setProfiles(readProfiles(data));
        } else {
          setPosts(readPosts(data));
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search request failed.");
        if (activeTab === "profiles") setProfiles([]);
        else setPosts([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [activeTab, query]);

  const visiblePosts = useMemo(() => {
    const fromTime = toDateStart(from);
    const toTime = toDateEnd(to);

    const filtered = posts.filter((post) => {
      const date = getPostDate(post);
      if (!date) return !fromTime && !toTime;
      const time = date.getTime();
      return (fromTime === null || time >= fromTime) && (toTime === null || time <= toTime);
    });

    if (sort === "recent") {
      return [...filtered].sort((a, b) => (getPostDate(b)?.getTime() ?? 0) - (getPostDate(a)?.getTime() ?? 0));
    }

    if (sort === "most_tipped") {
      return [...filtered].sort((a, b) => getPostTipTotal(b) - getPostTipTotal(a));
    }

    return filtered;
  }, [from, posts, sort, to]);

  const hasQuery = query.trim().length > 0;
  const hasPostResults = visiblePosts.length > 0;
  const hasProfileResults = profiles.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-4 text-3xl font-bold">Search</h1>
        <SearchBar
          onSearch={submitSearch}
          initialValue={query}
          placeholder="Search posts and profiles"
          className="w-full max-w-2xl"
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
          <button
            type="button"
            onClick={() => updateParams({ tab: "posts" })}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${activeTab === "posts" ? "bg-violet-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--foreground)]"}`}
          >
            Posts
          </button>
          <button
            type="button"
            onClick={() => updateParams({ tab: "profiles" })}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${activeTab === "profiles" ? "bg-violet-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--foreground)]"}`}
          >
            Profiles
          </button>
        </div>

        {activeTab === "posts" && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-[var(--text-muted)]">
              Sort
              <select
                value={sort}
                onChange={(event) => updateParams({ sort: event.target.value })}
                className="ml-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)]"
              >
                <option value="relevance">Relevance</option>
                <option value="recent">Recent</option>
                <option value="most_tipped">Most Tipped</option>
              </select>
            </label>
            <label className="text-sm text-[var(--text-muted)]">
              From
              <input
                type="date"
                value={from}
                onChange={(event) => updateParams({ from: event.target.value })}
                className="ml-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)]"
              />
            </label>
            <label className="text-sm text-[var(--text-muted)]">
              To
              <input
                type="date"
                value={to}
                onChange={(event) => updateParams({ to: event.target.value })}
                className="ml-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)]"
              />
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/50 bg-red-950/40 p-4 text-red-200">
          {error}
        </div>
      )}

      {!hasQuery && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
          Enter a search term to find posts and profiles.
        </div>
      )}

      {hasQuery && activeTab === "posts" && (
        <div className="space-y-4" aria-live="polite">
          {loading && Array.from({ length: 5 }, (_, index) => <PostCardSkeleton key={index} />)}
          {!loading && !error && hasPostResults && visiblePosts.map((post) => (
            <PostCard key={post.id} post={post} query={query} />
          ))}
          {!loading && !error && !hasPostResults && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
              No posts found for "{query}".
            </div>
          )}
        </div>
      )}

      {hasQuery && activeTab === "profiles" && (
        <div className="space-y-4" aria-live="polite">
          {loading && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
              Loading profiles...
            </div>
          )}
          {!loading && !error && hasProfileResults && profiles.map((profile) => (
            <ProfileCard key={profile.address} profile={profile} />
          ))}
          {!loading && !error && !hasProfileResults && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
              No profiles found for "{query}".
            </div>
          )}
        </div>
      )}
    </div>
  );
}
