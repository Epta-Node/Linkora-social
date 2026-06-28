"use client";

import { useState } from "react";
import SearchBar from "../../components/SearchBar";
import { PostCard } from "@/components/PostCard";
import { ProfileCard } from "@/components/ProfileCard";

type Post = Parameters<typeof PostCard>[0]["post"];
type Profile = Parameters<typeof ProfileCard>[0]["profile"];

const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3001";

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    setQuery(trimmed);
    setLoading(true);
    setError(null);

    try {
      const [postsResponse, profilesResponse] = await Promise.all([
        fetch(
          `${INDEXER_API_URL}/api/search/posts?q=${encodeURIComponent(trimmed)}&limit=12&offset=0`
        ),
        fetch(
          `${INDEXER_API_URL}/api/profiles/search?q=${encodeURIComponent(trimmed)}&limit=6&offset=0`
        ),
      ]);

      if (!postsResponse.ok || !profilesResponse.ok) {
        throw new Error("Discovery request failed.");
      }

      const postsData = (await postsResponse.json()) as { posts?: Post[] };
      const profilesData = (await profilesResponse.json()) as { profiles?: Profile[] };

      setPosts(postsData.posts ?? []);
      setProfiles(profilesData.profiles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
      setPosts([]);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-10 rounded-3xl border border-[var(--border)] bg-[linear-gradient(135deg,rgba(124,58,237,0.18),rgba(6,182,212,0.10))] p-6 shadow-2xl shadow-violet-950/10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-violet-300">
          Explore
        </p>
        <h1 className="max-w-2xl text-4xl font-black tracking-tight text-[var(--foreground)] sm:text-5xl">
          Discover posts and people with full-text search.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-[var(--text-muted)]">
          Search across post content and profile names, then jump straight into the most relevant
          matches.
        </p>

        <div className="mt-6 max-w-2xl">
          <SearchBar
            onSearch={handleSearch}
            placeholder="Search posts, profiles, or topics"
            className="w-full"
          />
        </div>
      </div>

      {error && (
        <div
          className="mb-6 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {!query && !loading && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Search what people are saying
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Find posts by keywords, phrases, and topic names. Full-text ranking brings the most
              relevant matches to the top.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Find creators faster</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Profile discovery now searches usernames and creator tokens, so people are easier to
              find without memorizing addresses.
            </p>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
          Searching discovery index...
        </div>
      )}

      {!loading && query && (
        <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--foreground)]">Top posts</h2>
              <span className="text-sm text-[var(--text-muted)]">{posts.length} results</span>
            </div>
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} query={query} />
              ))}
              {!posts.length && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
                  No posts matched &quot;{query}&quot;.
                </div>
              )}
            </div>
          </section>

          <aside>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--foreground)]">People</h2>
              <span className="text-sm text-[var(--text-muted)]">{profiles.length} results</span>
            </div>
            <div className="space-y-4">
              {profiles.map((profile) => (
                <ProfileCard key={profile.address} profile={profile} />
              ))}
              {!profiles.length && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-[var(--text-muted)]">
                  No profiles matched &quot;{query}&quot;.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
