export interface FeedViewedEvent {
  postId: string;
  durationMs: number;
}

// Deliberately non-PII: only a post identifier and an engagement duration are sent.
export function trackPostViewed(event: FeedViewedEvent): void {
  if (__DEV__) return;
  // Replace with the hosted analytics transport when configured by the app shell.
  globalThis.dispatchEvent?.(new CustomEvent("linkora:post_viewed", { detail: event }));
}
