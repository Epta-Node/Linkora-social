/**
 * #1789 — colour-contrast audit for the design tokens.
 *
 * Every text/background pairing the app relies on must reach WCAG AA
 * (4.5:1 for normal text). A token change that drops below the threshold fails
 * CI instead of shipping unreadable text.
 */
import { themes, type ColorScheme } from "../tokens";
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from "../../utils/a11y";

type Pair = { name: string; fg: string; bg: string };

function textPairs(scheme: ColorScheme): Pair[] {
  const { colors } = themes[scheme];
  const surfaces = {
    background: colors.surface.background,
    surface1: colors.surface.surface1,
    surface2: colors.surface.surface2,
  };
  const pairs: Pair[] = [];

  // Body copy on every surface.
  for (const [surfaceName, bg] of Object.entries(surfaces)) {
    pairs.push({ name: `text.primary on ${surfaceName}`, fg: colors.text.primary, bg });
    pairs.push({ name: `text.secondary on ${surfaceName}`, fg: colors.text.secondary, bg });
  }

  // Status text (errors, success amounts, warnings) on page and card surfaces.
  for (const key of ["success", "warning", "error", "info"] as const) {
    pairs.push({
      name: `semantic.${key} on background`,
      fg: colors.semantic[key],
      bg: colors.surface.background,
    });
    pairs.push({
      name: `semantic.${key} on surface1`,
      fg: colors.semantic[key],
      bg: colors.surface.surface1,
    });
  }

  // Labels on filled buttons.
  pairs.push({
    name: "text.onBrand on brand.primary",
    fg: colors.text.onBrand,
    bg: colors.brand.primary,
  });
  pairs.push({
    name: "text.onSemantic on semantic.error",
    fg: colors.text.onSemantic,
    bg: colors.semantic.error,
  });

  return pairs;
}

describe.each(["light", "dark"] as const)("%s theme colour contrast (WCAG AA)", (scheme) => {
  it.each(textPairs(scheme).map((p) => [p.name, p] as const))("%s", (_name, pair) => {
    expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});
