/**
 * Accessibility helpers shared by the a11y audit tests (#1789).
 *
 * - WCAG 2.1 contrast ratio maths for colour-token checks.
 * - A tree walker that finds pressable elements rendered without an
 *   accessible label or role.
 */

/** WCAG AA minimum contrast for normal-size text. */
export const WCAG_AA_NORMAL_TEXT = 4.5;
/** WCAG AA minimum contrast for large text (>= 18pt, or 14pt bold). */
export const WCAG_AA_LARGE_TEXT = 3;

function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Unsupported colour "${hex}" — use #rgb or #rrggbb`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance as defined by WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsWcagAA(foreground: string, background: string, largeText = false): boolean {
  return (
    contrastRatio(foreground, background) >= (largeText ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT)
  );
}

/** Minimal shape of a rendered host element (compatible with ReactTestInstance). */
export interface A11yNode {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<A11yNode | string>;
}

export interface A11yViolation {
  testID?: string;
  missing: Array<"accessibilityLabel" | "accessibilityRole">;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

/**
 * Walks a rendered tree and reports every interactive host element that lacks
 * an accessible label or role. Pressable / Touchable* render a host view with
 * press-responder handlers (`onClick`, `onResponderRelease`), so those are what
 * mark an element as interactive here.
 */
export function findInaccessibleTouchables(root: A11yNode): A11yViolation[] {
  const violations: A11yViolation[] = [];

  const visit = (node: A11yNode | string) => {
    if (typeof node === "string") return;
    const { props } = node;
    const isHost = typeof node.type === "string";
    const interactive =
      isHost &&
      props.accessible !== false &&
      (typeof props.onClick === "function" ||
        typeof props.onResponderRelease === "function" ||
        typeof props.onPress === "function");

    if (interactive) {
      const missing: A11yViolation["missing"] = [];
      if (!hasValue(props.accessibilityLabel) && !hasValue(props["aria-label"])) {
        missing.push("accessibilityLabel");
      }
      if (!hasValue(props.accessibilityRole) && !hasValue(props.role)) {
        missing.push("accessibilityRole");
      }
      if (missing.length > 0) {
        violations.push({
          testID: typeof props.testID === "string" ? props.testID : undefined,
          missing,
        });
      }
    }

    node.children.forEach(visit);
  };

  visit(root);
  return violations;
}
