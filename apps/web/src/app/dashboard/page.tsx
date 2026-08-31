"use client";

import React, { useState } from "react";
import { LeftSidebar } from "../../components/dashboard/LeftSidebar";
import { RightSidebar } from "../../components/dashboard/RightSidebar";
import { DashboardHeader } from "../../components/dashboard/DashboardHeader";
import { DashboardPostGrid } from "../../components/dashboard/DashboardPostGrid";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(false);

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
      {/* 1. Left Sidebar Column (240px / collapsible) */}
      <LeftSidebar />

      {/* 2. Main Content Area Column (Background #0F172A) */}
      <main
        style={{
          flex: 1,
          backgroundColor: "#0F172A",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <DashboardHeader isLoading={isLoading} onToggleLoading={toggleLoading} />
        <DashboardPostGrid isLoading={isLoading} />
      </main>

      {/* 3. Right Sidebar Column (320px / hidden on <1280px) */}
      <RightSidebar />
    </div>
  );
}
