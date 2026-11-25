/**
 * #1789 — unit tests for the accessibility helpers and the static audit that
 * CI runs over every screen and component.
 */
import path from "path";
import { contrastRatio, findInaccessibleTouchables, meetsWcagAA, relativeLuminance } from "../a11y";

/* eslint-disable @typescript-eslint/no-var-requires */
const { auditFile, collectFiles } = require("../../scripts/a11y-lint.js") as {
  auditFile: (
    file: string
  ) => Array<{ file: string; line: number; element: string; missing: string[] }>;
  collectFiles: (dir: string, out: string[]) => string[];
};
/* eslint-enable @typescript-eslint/no-var-requires */

describe("contrast maths", () => {
  it("computes the WCAG extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#7C3AED", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#7C3AED"),
      10
    );
  });

  it("applies the normal- and large-text AA thresholds", () => {
    // #767676 on white is the canonical 4.54:1 pass.
    expect(meetsWcagAA("#767676", "#FFFFFF")).toBe(true);
    // #949494 on white is ~3.03:1 — large text only.
    expect(meetsWcagAA("#949494", "#FFFFFF")).toBe(false);
    expect(meetsWcagAA("#949494", "#FFFFFF", true)).toBe(true);
  });

  it("rejects colours it cannot parse", () => {
    expect(() => contrastRatio("rgba(0,0,0,1)", "#fff")).toThrow(/Unsupported colour/);
  });
});

describe("findInaccessibleTouchables", () => {
  const press = () => undefined;

  it("flags pressables without a label or role", () => {
    const tree = {
      type: "View",
      props: {},
      children: [
        { type: "View", props: { onClick: press, testID: "bare" }, children: [] },
        {
          type: "View",
          props: { onClick: press, accessibilityLabel: "Ok", accessibilityRole: "button" },
          children: [],
        },
      ],
    };

    expect(findInaccessibleTouchables(tree)).toEqual([
      { testID: "bare", missing: ["accessibilityLabel", "accessibilityRole"] },
    ]);
  });

  it("ignores elements hidden from assistive tech", () => {
    const tree = { type: "View", props: { onClick: press, accessible: false }, children: [] };
    expect(findInaccessibleTouchables(tree)).toEqual([]);
  });
});

describe("static a11y audit (scripts/a11y-lint.js)", () => {
  const root = path.resolve(__dirname, "../..");
  const files = ["app", "components", "mini-apps", "notifications", "context"].flatMap((dir) =>
    collectFiles(path.join(root, dir), [])
  );

  it("scans the app source", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("finds every Pressable / Touchable labelled and with a role", () => {
    const violations = files.flatMap((file) => auditFile(file));
    expect(violations).toEqual([]);
  });
});
