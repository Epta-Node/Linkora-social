"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ConnectWallet } from "./ConnectWallet";
import { NavComposeButton } from "./NavComposeButton";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen((prev) => !prev);
  const closeMenu = () => setIsOpen(false);

  return (
    <nav style={styles.nav}>
      <div style={styles.container}>
        {/* Brand Logo */}
        <Link href="/" style={styles.logo} onClick={closeMenu}>
          Linkora
        </Link>

        {/* Desktop Menu Link List */}
        <div className="desktop-links" style={styles.desktopLinks}>
          <Link href="/feed" style={styles.navLink}>
            Feed
          </Link>
          <Link href="/explore" style={styles.navLink}>
            Explore
          </Link>
          <Link href="/pools" style={styles.navLink}>
            Pools
          </Link>
          <NavComposeButton />
          <ConnectWallet />
        </div>

        {/* Mobile Hamburger Toggle button */}
        <button
          className="hamburger-btn"
          onClick={toggleMenu}
          style={styles.hamburgerBtn}
          aria-expanded={isOpen}
          aria-label="Toggle navigation menu"
        >
          <span
            style={{
              ...styles.hamburgerLine,
              ...(isOpen ? styles.hamburgerLine1Active : {}),
            }}
          />
          <span
            style={{
              ...styles.hamburgerLine,
              ...(isOpen ? styles.hamburgerLine2Active : {}),
            }}
          />
          <span
            style={{
              ...styles.hamburgerLine,
              ...(isOpen ? styles.hamburgerLine3Active : {}),
            }}
          />
        </button>
      </div>

      {/* Mobile Drawer Dropdown Menu */}
      {isOpen && (
        <div style={styles.mobileDrawer}>
          <Link href="/feed" style={styles.mobileNavLink} onClick={closeMenu}>
            Feed
          </Link>
          <Link href="/explore" style={styles.mobileNavLink} onClick={closeMenu}>
            Explore
          </Link>
          <Link href="/pools" style={styles.mobileNavLink} onClick={closeMenu}>
            Pools
          </Link>
          <NavComposeButton />
          <div style={styles.mobileWalletWrapper}>
            <ConnectWallet />
          </div>
        </div>
      )}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    background: "var(--color-bg)",
    borderBottom: "1px solid var(--color-border)",
    padding: "16px 20px",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logo: {
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "var(--color-primary)",
    textDecoration: "none",
    letterSpacing: "-0.03em",
  },
  desktopLinks: {
    display: "flex",
    alignItems: "center",
    gap: "24px",
    // Handled responsively via CSS display toggles in globals.css
  },
  navLink: {
    color: "var(--color-text-primary)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.95rem",
    transition: "color 0.2s",
  },
  hamburgerBtn: {
    display: "none", // Toggled via media queries in globals.css to be block
    flexDirection: "column",
    justifyContent: "space-between",
    width: "24px",
    height: "18px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
    zIndex: 101,
  },
  hamburgerLine: {
    width: "100%",
    height: "2px",
    background: "var(--color-text-primary)",
    borderRadius: "2px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    transformOrigin: "left center",
  },
  hamburgerLine1Active: {
    transform: "rotate(45deg) translate(2px, -1px)",
  },
  hamburgerLine2Active: {
    opacity: 0,
    transform: "scale(0)",
  },
  hamburgerLine3Active: {
    transform: "rotate(-45deg) translate(2px, 1px)",
  },
  mobileDrawer: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "var(--color-bg)",
    borderBottom: "1px solid var(--color-border)",
    padding: "16px 20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
    animation: "slideDown 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  mobileNavLink: {
    color: "var(--color-text-primary)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "1.1rem",
    padding: "8px 0",
    borderBottom: "1px solid var(--color-border)",
  },
  mobileWalletWrapper: {
    paddingTop: "8px",
    display: "flex",
    justifyContent: "center",
  },
};
