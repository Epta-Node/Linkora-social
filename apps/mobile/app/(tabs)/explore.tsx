import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { PoolRow, PoolSearchResult } from "../../components/PoolRow";
import { ProfileRow, ProfileSearchResult } from "../../components/ProfileRow";
import { SearchBar } from "../../components/SearchBar";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { PoolCardSkeleton } from "../../components/skeletons/PoolCardSkeleton";
import { ProfileCardSkeleton } from "../../components/skeletons/ProfileCardSkeleton";
import { useTheme } from "../../theme/useTheme";

const DEBOUNCE_MS = 300;

const PROFILES: ProfileSearchResult[] = [
  {
    address: "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ",
    username: "maya",
    bio: "Creator economy researcher",
    creatorToken: "MAYA",
  },
  {
    address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    username: "atlas",
    bio: "Building social pools for artists",
    creatorToken: "ATLAS",
  },
  {
    address: "GDXU2G6VZLJIFRVDH5HLYCWJ2F64YQZH2TJUFDPBTZC53RIRZQJQ4LNK",
    username: "nova",
    bio: "Music drops and fan rewards",
    creatorToken: "NOVA",
  },
];

const POOLS: PoolSearchResult[] = [
  {
    id: "creator-fund",
    name: "Creator Fund",
    description: "Shared treasury for emerging creators",
    token: "XLM",
    balance: "18,240 XLM",
    members: 128,
  },
  {
    id: "music-drops",
    name: "Music Drops",
    description: "Funding pool for independent releases",
    token: "NOVA",
    balance: "7,900 NOVA",
    members: 64,
  },
  {
    id: "design-guild",
    name: "Design Guild",
    description: "Collective pool for visual artists",
    token: "ATLAS",
    balance: "3,450 ATLAS",
    members: 42,
  },
];

interface SearchResults {
  profiles: ProfileSearchResult[];
  pools: PoolSearchResult[];
}

function matchesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

async function searchCatalog(query: string): Promise<SearchResults> {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { profiles: [], pools: [] };
  }

  return {
    profiles: PROFILES.filter((profile) =>
      [profile.username, profile.bio, profile.creatorToken, profile.address].some((value) =>
        matchesQuery(value, normalized)
      )
    ),
    pools: POOLS.filter((pool) =>
      [pool.id, pool.name, pool.description, pool.token].some((value) =>
        matchesQuery(value, normalized)
      )
    ),
  };
}

export default function ExploreScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({
    profiles: [],
    pools: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      setLoading(true);
      setError(null);

      try {
        const nextResults = await searchCatalog(debouncedQuery);
        if (!cancelled) {
          setResults(nextResults);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults({ profiles: [], pools: [] });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchNonce]);

  const hasQuery = debouncedQuery.trim().length > 0;
  const hasResults = results.profiles.length > 0 || results.pools.length > 0;

  const resultSummary = useMemo(() => {
    const total = results.profiles.length + results.pools.length;
    return total === 1 ? "1 result" : `${total} results`;
  }, [results]);

  return (
    <View style={styles.container}>
      <SearchBar value={query} onChangeText={setQuery} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, !hasResults && styles.centerContent]}
      >
        {loading ? (
          <View style={styles.loadingStack}>
            <ProfileCardSkeleton />
            <PoolCardSkeleton />
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.brand.primary} />
              <Text style={styles.muted}>Searching...</Text>
            </View>
          </View>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setSearchNonce((current) => current + 1)} />
        ) : !hasQuery ? (
          <EmptyState
            icon="🔎"
            title="Search Linkora"
            subtitle="Find creators and community pools."
          />
        ) : !hasResults ? (
          <EmptyState
            icon="🧭"
            title="No matches"
            subtitle="Try another username, token, or pool name."
            actionLabel="Clear search"
            onAction={() => {
              setQuery("");
              setSearchNonce((current) => current + 1);
            }}
          />
        ) : (
          <>
            <Text style={styles.summary}>{resultSummary}</Text>
            {results.profiles.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Profiles</Text>
                {results.profiles.map((profile) => (
                  <ProfileRow
                    key={profile.address}
                    profile={profile}
                    onPress={(item) =>
                      router.push(
                        `/profile/${encodeURIComponent(item.address)}` as Parameters<
                          typeof router.push
                        >[0]
                      )
                    }
                  />
                ))}
              </View>
            ) : null}

            {results.pools.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pools</Text>
                {results.pools.map((pool) => (
                  <PoolRow
                    key={pool.id}
                    pool={pool}
                    onPress={(item) =>
                      router.push(
                        `/pool/${encodeURIComponent(item.id)}` as Parameters<typeof router.push>[0]
                      )
                    }
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    content: {
      paddingBottom: 24,
    },
    centerContent: {
      flexGrow: 1,
      justifyContent: "center",
    },
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    loadingStack: {
      gap: 16,
      padding: 16,
    },
    muted: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      marginTop: 10,
    },
    summary: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: "700",
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 8,
      textTransform: "uppercase",
    },
    section: {
      marginTop: 8,
    },
    sectionTitle: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: "800",
      marginHorizontal: 16,
      marginBottom: 4,
      textTransform: "uppercase",
    },
    miniAppsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      paddingHorizontal: 12,
      paddingBottom: 16,
    },
    discoveryCard: {
      width: "30%",
      alignItems: "center",
      marginVertical: 8,
      marginHorizontal: "1.5%",
    },
    installButton: {
      marginTop: 4,
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 6,
    },
    installButtonText: {
      color: theme.colors.text.onBrand,
      fontSize: 11,
      fontWeight: "700",
    },
  });
}
