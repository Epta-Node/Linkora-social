"use client";

import { useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { ProfileCard } from "../components/ProfileCard";
import { PostCard, Post } from "../components/PostCard";

export default function ExplorePage() {
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [trendingPosts] = useState<Post[]>([
    {
      id: 3,
      author: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
      username: "charlie",
      content: "Check out my new NFT collection on Stellar! 🎨",
      tip_total: 100000000,
      timestamp: Date.now() / 1000 - 1800,
      like_count: 25,
    },
  ]);

  const [featuredCreators] = useState([
    {
      address: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      username: "alice",
      followerCount: 1234,
    },
    {
      address: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
      username: "bob",
      followerCount: 567,
    },
  ]);

  const handleSearch = async (query: string) => {
    setSearching(true);
    // Simulate API call
    setTimeout(() => {
      if (query.toLowerCase() === "alice") {
        setSearchResult({
          address: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          username: "alice",
          followerCount: 1234,
        });
      } else {
        setSearchResult(null);
      }
      setSearching(false);
    }, 300);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>Explore</h1>
      </header>

      <div style={styles.container}>
        <SearchBar onSearch={handleSearch} />

        {searching && <div style={styles.loading}>Searching...</div>}

        {searchResult && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Search Result</h2>
            <ProfileCard profile={searchResult} onFollow={() => {}} />
          </section>
        )}

        {!searchResult && !searching && (
          <div style={styles.noResults}>
            <span style={styles.noResultsIcon}>🔍</span>
            <p>Search for a username to find profiles</p>
          </div>
        )}

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Trending Posts</h2>
          {trendingPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Featured Creators</h2>
          {featuredCreators.map((creator) => (
            <ProfileCard
              key={creator.address}
              profile={creator}
              onFollow={() => {}}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
  },
  header: {
    background: "var(--color-bg)",
    borderBottom: "1px solid var(--color-border)",
    padding: "var(--spacing-lg)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  title: {
    textAlign: "center",
    fontSize: "1.5rem",
    fontWeight: 700,
  },
  container: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "var(--spacing-lg)",
  },
  loading: {
    textAlign: "center",
    padding: "var(--spacing-lg)",
    color: "var(--color-text-secondary)",
  },
  noResults: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    color: "var(--color-text-secondary)",
  },
  noResultsIcon: {
    fontSize: "2rem",
    display: "block",
    marginBottom: "var(--spacing-sm)",
  },
  section: {
    marginTop: "var(--spacing-xl)",
  },
  sectionTitle: {
    fontSize: "1.25rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-md)",
  },
};
