import Link from "next/link";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        background: "var(--color-bg-secondary)",
      }}
    >
      <section style={{ textAlign: "center", padding: "2rem" }}>
        <h1
          style={{ fontSize: "2.5rem", marginBottom: "1rem", fontWeight: 700 }}
        >
          Linkora Social
        </h1>
        <p
          style={{ marginBottom: "2rem", color: "var(--color-text-secondary)" }}
        >
          A decentralized social platform built on Stellar
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
          <a
            href="/feed"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--color-primary)",
              color: "white",
              borderRadius: "8px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View Feed
          </a>
          <a
            href="/explore"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Explore
          </a>
        </div>
      </section>
    </main>
  );
}
