"use client";

import React, { useState } from "react";
import { LeftSidebar } from "../../components/dashboard/LeftSidebar";
import { RightSidebar } from "../../components/dashboard/RightSidebar";
import { DashboardHeader } from "../../components/dashboard/DashboardHeader";
import { DashboardPostGrid } from "../../components/dashboard/DashboardPostGrid";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const toggleLoading = () => setIsLoading((prev) => !prev);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        backgroundColor: "var(--bg-primary, #0B1120)",
        color: "var(--text-primary, #F8FAFC)",
        width: "100%",
        overflowX: "hidden",
      }}
    >
      {/* 1. Left Sidebar Column (240px / drawer below 768px) */}
      <LeftSidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />

      {/* 2. Main Content Area Column (Background #0F172A) */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: "#0F172A",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <div className="dashboard-mobile-topbar">
          <button
            type="button"
            data-testid="dashboard-mobile-menu-button"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              border: "1px solid var(--border, #334155)",
              backgroundColor: "var(--bg-secondary, #1E293B)",
              color: "var(--text-primary, #F8FAFC)",
              cursor: "pointer",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {mobileNavOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
          <span style={{ fontWeight: 700, fontSize: "1.05rem", color: "#F8FAFC" }}>Linkora</span>
          <span style={{ width: "40px" }} aria-hidden="true" />
        </div>

        <DashboardHeader isLoading={isLoading} onToggleLoading={toggleLoading} />
        <DashboardPostGrid isLoading={isLoading} />
      </main>

      {/* 3. Right Sidebar Column (320px / hidden below 1024px) */}
      <RightSidebar />
    </div>
  );
}
