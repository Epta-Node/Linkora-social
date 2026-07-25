export interface IndexerPost {
  id: string;
  author: string;
  deleted: boolean;
  tip_total: string;
  like_count: string;
  created_ledger: number;
  deleted_ledger: number | null;
}

export interface AnalyticsAttestation {
  oracleName: string;
  reportHash: string;
  signature: string;
  txHash: string;
  submittedAt: number;
  report: {
    version: number;
    creator: string;
    windowStart: string;
    windowEnd: string;
    totalTips: string;
    postCount: string;
    followerDelta: string;
    uniqueTippers: number;
  };
}

export interface TimeSeriesPoint {
  date: string;
  likes: number;
  tips: number;
  posts: number;
}

export interface FollowerPoint {
  date: string;
  followers: number;
}

export interface TipEarningPoint {
  date: string;
  earnings: number;
}

export interface TopPost {
  id: string;
  likes: number;
  tips: number;
  score: number;
  created_ledger: number;
}

export interface AnalyticsData {
  summary: {
    totalTips: string;
    totalTipsXlm: string;
    totalPosts: number;
    totalLikes: number;
    followerCount: number;
    uniqueTippers: number;
  };
  engagementOverTime: TimeSeriesPoint[];
  followerGrowth: FollowerPoint[];
  tipEarnings: TipEarningPoint[];
  topPosts: TopPost[];
  attestation: AnalyticsAttestation | null;
}

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
const ORACLE_URL = process.env.NEXT_PUBLIC_ORACLE_URL || "http://localhost:4000";

const STELLAR_GENESIS_MS = new Date("2015-09-01T00:00:00Z").getTime();

function ledgerToDate(ledger: number): Date {
  return new Date(STELLAR_GENESIS_MS + (ledger - 1) * 5000);
}

export function formatStroops(value: string): string {
  const n = BigInt(value);
  if (n === 0n) return "0";
  const whole = n / 10_000_000n;
  const frac = n % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function dateRangeToLedgerRange(days: number): number {
  return (days * 24 * 60 * 60) / 5;
}

export async function fetchPosts(address: string): Promise<IndexerPost[]> {
  const allPosts: IndexerPost[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${INDEXER_URL}/api/posts?author=${address}&limit=${limit}&offset=${offset}`
    );
    if (!res.ok) break;
    const data = await res.json();
    const posts: IndexerPost[] = data.posts ?? [];
    allPosts.push(...posts);
    hasMore = data.has_more ?? false;
    offset += limit;
  }

  return allPosts;
}

export async function fetchAttestation(address: string): Promise<AnalyticsAttestation | null> {
  try {
    const res = await fetch(`${ORACLE_URL}/attestations/${address}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<AnalyticsAttestation>;
  } catch {
    return null;
  }
}

export function computeAnalytics(
  posts: IndexerPost[],
  attestation: AnalyticsAttestation | null,
  ledgerRange: number
): AnalyticsData {
  const nowLedger = posts.length > 0 ? Math.max(...posts.map((p) => p.created_ledger)) : 0;
  const cutoffLedger = nowLedger - ledgerRange;

  const filteredPosts = posts.filter((p) => p.created_ledger >= cutoffLedger);

  const summary = {
    totalTips: attestation?.report.totalTips ?? "0",
    totalTipsXlm: attestation ? formatStroops(attestation.report.totalTips) : "0",
    totalPosts: filteredPosts.length,
    totalLikes: filteredPosts.reduce((sum, p) => sum + Number(p.like_count || 0), 0),
    followerCount: attestation ? Number(attestation.report.followerDelta) : 0,
    uniqueTippers: attestation?.report.uniqueTippers ?? 0,
  };

  const dateMap = new Map<string, { likes: number; tips: number; posts: number }>();

  for (const post of filteredPosts) {
    const date = ledgerToDate(post.created_ledger).toISOString().slice(0, 10);
    const entry = dateMap.get(date) || { likes: 0, tips: 0, posts: 0 };
    entry.likes += Number(post.like_count || 0);
    entry.tips += Number(post.tip_total || 0);
    entry.posts += 1;
    dateMap.set(date, entry);
  }

  const sortedDates = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  const engagementOverTime: TimeSeriesPoint[] = sortedDates.map(([date, data]) => ({
    date,
    likes: data.likes,
    tips: data.tips,
    posts: data.posts,
  }));

  let cumulative = 0;
  const followerGrowth: FollowerPoint[] = sortedDates.map(([date, data]) => {
    cumulative += data.posts;
    return { date, followers: cumulative };
  });

  const tipEarnings: TipEarningPoint[] = sortedDates.map(([date, data]) => ({
    date,
    earnings: data.tips,
  }));

  const topPosts: TopPost[] = filteredPosts
    .map((p) => ({
      id: p.id,
      likes: Number(p.like_count || 0),
      tips: Number(p.tip_total || 0),
      score: Number(p.like_count || 0) + Number(p.tip_total || 0),
      created_ledger: p.created_ledger,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    summary,
    engagementOverTime,
    followerGrowth,
    tipEarnings,
    topPosts,
    attestation,
  };
}

export function generateCSV(data: AnalyticsData): string {
  const rows: string[] = ["date,metric,value"];

  for (const point of data.engagementOverTime) {
    rows.push(`${point.date},likes,${point.likes}`);
    rows.push(`${point.date},tips,${point.tips}`);
    rows.push(`${point.date},posts,${point.posts}`);
  }

  for (const point of data.followerGrowth) {
    rows.push(`${point.date},followers,${point.followers}`);
  }

  for (const point of data.tipEarnings) {
    rows.push(`${point.date},tip_earnings,${point.earnings}`);
  }

  rows.push("");
  rows.push("top_posts");
  rows.push("post_id,likes,tips,score");
  for (const post of data.topPosts) {
    rows.push(`${post.id},${post.likes},${post.tips},${post.score}`);
  }

  return rows.join("\n");
}
