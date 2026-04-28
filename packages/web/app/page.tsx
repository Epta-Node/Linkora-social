import type { CSSProperties } from "react";

type StateCardProps = {
  label: string;
  title: string;
  copy: string;
  action?: string;
};

function StateIcon() {
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 999,
        border: "1px solid #2f3d67",
        background:
          "radial-gradient(circle at 30% 30%, #3a4f82 0%, #111a31 60%, #0a1023 100%)",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
      aria-hidden
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          border: "2px solid #8ea6dd",
        }}
      />
    </div>
  );
}

function StateCard({ label, title, copy, action }: StateCardProps) {
  return (
    <article
      style={{
        border: "1px solid #1f2946",
        background: "linear-gradient(180deg, #0e1530 0%, #0a1227 100%)",
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <span
        style={{
          alignSelf: "flex-start",
          padding: "5px 10px",
          borderRadius: 999,
          fontSize: 12,
          color: "#cad7f6",
          border: "1px solid #2b385f",
          background: "#111b38",
        }}
      >
        {label}
      </span>
      <StateIcon />
      <div>
        <h3
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            lineHeight: 1.3,
            color: "#f7f9ff",
          }}
        >
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#b5c0df" }}>{copy}</p>
      </div>
      {action ? (
        <button
          type="button"
          style={{
            marginTop: 4,
            alignSelf: "flex-start",
            padding: "9px 14px",
            borderRadius: 10,
            border: "1px solid #3a4d7d",
            color: "#f7f9ff",
            background: "#1a2a54",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {action}
        </button>
      ) : null}
    </article>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      style={{
        width,
        height: 10,
        borderRadius: 999,
        background: "linear-gradient(90deg, #18223e 0%, #26365f 50%, #18223e 100%)",
      }}
    />
  );
}

function SkeletonPostCard() {
  return (
    <article style={skeletonCardStyle}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={skeletonAvatarStyle} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <SkeletonLine width="38%" />
          <SkeletonLine width="22%" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonLine width="96%" />
        <SkeletonLine width="84%" />
        <SkeletonLine width="66%" />
      </div>
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 12,
          background: "linear-gradient(120deg, #162243 0%, #263560 45%, #162243 100%)",
        }}
      />
    </article>
  );
}

function SkeletonProfileCard() {
  return (
    <article style={skeletonCardStyle}>
      <div style={skeletonAvatarStyle} />
      <SkeletonLine width="52%" />
      <SkeletonLine width="36%" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <div style={skeletonChipStyle} />
        <div style={skeletonChipStyle} />
        <div style={skeletonChipStyle} />
      </div>
    </article>
  );
}

function SkeletonPoolCard() {
  return (
    <article style={skeletonCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonLine width="48%" />
        <div style={skeletonChipStyle} />
      </div>
      <SkeletonLine width="76%" />
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...skeletonChipStyle, width: 96 }} />
        <div style={{ ...skeletonChipStyle, width: 120 }} />
      </div>
    </article>
  );
}

function SkeletonFeedList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SkeletonPostCard />
      <SkeletonPostCard />
    </div>
  );
}

const skeletonCardStyle: CSSProperties = {
  border: "1px solid #1d2948",
  borderRadius: 14,
  background: "#0d162e",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const skeletonAvatarStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 999,
  background: "linear-gradient(90deg, #1a284a 0%, #2a3a68 50%, #1a284a 100%)",
};

const skeletonChipStyle: CSSProperties = {
  width: 72,
  height: 24,
  borderRadius: 999,
  background: "linear-gradient(90deg, #182642 0%, #2b3f6d 50%, #182642 100%)",
};

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "24px 16px 64px",
        background:
          "radial-gradient(circle at top, #162753 0%, rgba(9, 16, 34, 0.95) 35%, #070b17 80%)",
      }}
    >
      <section style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={sectionHeaderStyle}>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 2.8vw, 2.3rem)" }}>
            Linkora State System
          </h1>
          <p style={sectionSubtextStyle}>
            Designed for consistent empty states, loading skeletons, 404 cases, RPC failures,
            and wallet-auth gated views across desktop and mobile.
          </p>
        </header>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Loading Skeletons</h2>
          <div style={gridStyle}>
            <div>
              <p style={surfaceTitleStyle}>Post Card</p>
              <SkeletonPostCard />
            </div>
            <div>
              <p style={surfaceTitleStyle}>Profile Card</p>
              <SkeletonProfileCard />
            </div>
            <div>
              <p style={surfaceTitleStyle}>Pool Card</p>
              <SkeletonPoolCard />
            </div>
            <div>
              <p style={surfaceTitleStyle}>Feed List</p>
              <SkeletonFeedList />
            </div>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Empty States</h2>
          <div style={gridStyle}>
            <StateCard
              label="Feed"
              title="No posts in your feed yet"
              copy="Follow builders or join pools to start seeing updates in your personalized stream."
              action="Explore creators"
            />
            <StateCard
              label="Profile / Posts"
              title="No posts published yet"
              copy="Your profile is ready. Create your first post to start building your on-chain social graph."
              action="Create first post"
            />
            <StateCard
              label="Profile / Followers"
              title="No followers yet"
              copy="Share your profile and engage in pools to grow your audience."
              action="Share profile"
            />
            <StateCard
              label="Pool List"
              title="No pools available"
              copy="There are no active pools right now. Check again shortly or create one to get started."
              action="Create pool"
            />
            <StateCard
              label="Search"
              title="No matching results"
              copy="Try another username, pool ticker, or keyword. You can broaden your query for better discovery."
              action="Clear filters"
            />
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Error and Auth States</h2>
          <div style={gridStyle}>
            <StateCard
              label="404 / Post"
              title="Post not found"
              copy="The post may have been deleted or the link is invalid."
              action="Back to feed"
            />
            <StateCard
              label="404 / Profile"
              title="Profile not found"
              copy="We could not locate this profile. Check the handle and try again."
              action="Search profiles"
            />
            <StateCard
              label="Network / RPC"
              title="Cannot reach RPC endpoint"
              copy="Linkora cannot sync with Solana right now. Please retry or switch endpoint."
              action="Retry connection"
            />
            <StateCard
              label="Wallet Required"
              title="Connect your wallet to continue"
              copy="This page requires authentication. Connect your wallet to view and interact."
              action="Connect wallet"
            />
          </div>
        </section>
      </section>
    </main>
  );
}

const sectionHeaderStyle: CSSProperties = {
  border: "1px solid #22325a",
  background: "linear-gradient(180deg, rgba(16, 28, 59, 0.95) 0%, rgba(10, 18, 39, 0.96) 100%)",
  borderRadius: 18,
  padding: "18px 18px 16px",
};

const sectionSubtextStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "#b4c0de",
  maxWidth: 760,
  lineHeight: 1.55,
  fontSize: 14,
};

const sectionStyle: CSSProperties = {
  border: "1px solid #1f2c4f",
  borderRadius: 18,
  padding: "16px",
  background: "linear-gradient(180deg, rgba(11, 20, 43, 0.95) 0%, rgba(8, 14, 32, 0.96) 100%)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: "1.15rem",
};

const surfaceTitleStyle: CSSProperties = {
  margin: "0 0 8px",
  color: "#c4d0ee",
  fontSize: 13,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: 12,
};
