"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useGuidedTour } from "@/hooks/useGuidedTour";

function getTooltipPosition(rect: DOMRect) {
  const padding = 16;
  const tooltipWidth = 320;
  const top = Math.min(rect.bottom + padding, window.innerHeight - 200);
  const left = Math.min(Math.max(padding, rect.left), window.innerWidth - tooltipWidth - padding);

  return { top, left };
}

export function GuidedTour() {
  const pathname = usePathname();
  const context = useGuidedTour();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const isFeedPage = pathname === "/feed" || pathname === "/";

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateRect = useCallback(() => {
    if (!context?.currentStep) return;
    const element = document.querySelector(context.currentStep.target);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setRect(element.getBoundingClientRect());
      return;
    }
    setRect(null);
  }, [context]);

  useEffect(() => {
    if (!context?.active) return;

    const frame = window.requestAnimationFrame(updateRect);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [context?.active, context?.stepIndex, updateRect]);

  if (!context || !mounted || !context.active || !context.currentStep || !isFeedPage) return null;

  const isLast = context.stepIndex === context.totalSteps - 1;
  const tooltipPosition = rect ? getTooltipPosition(rect) : { top: "50%", left: "50%" };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] pointer-events-none"
      role="region"
      aria-labelledby="guided-tour-title"
      aria-describedby="guided-tour-description"
    >
      <svg className="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="linkora-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - 8}
                y={rect.top - 8}
                width={rect.width + 16}
                height={rect.height + 16}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#linkora-tour-mask)" />
      </svg>

      {rect && (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-violet-400 ring-offset-2 ring-offset-transparent"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
          }}
        />
      )}

      <div
        className="pointer-events-auto fixed z-[101] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4 shadow-2xl"
        style={
          rect
            ? { top: tooltipPosition.top, left: tooltipPosition.left }
            : {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
        }
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-400">
          Step {context.stepIndex + 1} of {context.totalSteps}
        </p>
        <h2 id="guided-tour-title" className="mb-2 text-lg font-bold text-[var(--foreground)]">
          {context.currentStep.title}
        </h2>
        <p id="guided-tour-description" className="mb-4 text-sm text-[var(--text-muted)]">
          {context.currentStep.description}
        </p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={context.dismiss}
            className="text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {context.stepIndex > 0 && (
              <button
                type="button"
                onClick={context.prev}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-violet-500/50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={context.next}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
