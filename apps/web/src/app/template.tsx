"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export default function RootTemplate({ children }: { children: ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`page-transition-shell ${isVisible ? "page-transition-shell--visible" : ""}`}>
      {children}
    </div>
  );
}
