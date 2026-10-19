/**
 * #1592 — structural guards for the single pool detail route.
 *
 * The bug this issue fixes was structural, not a typo: two screens existed for
 * one concept (`app/pool/[id].tsx` and `app/pools/[id].tsx`) and two
 * navigators hard-coded `/pool/${id}`. A behaviour test only covers the paths it
 * happens to exercise, so these assertions read the tree itself: there is one
 * pool detail screen, and nothing outside a comment navigates to the removed
 * route.
 */
import fs from "fs";
import path from "path";

const MOBILE_ROOT = path.resolve(__dirname, "../../..");
const APP_DIR = path.join(MOBILE_ROOT, "app");
const SOURCE_DIRS = ["app", "components", "context", "hooks", "utils"];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

function isSourceFile(file: string): boolean {
  return /\.(ts|tsx)$/.test(file) && !/__tests__|\.test\.|\.d\.ts$/.test(file);
}

function relative(file: string): string {
  return path.relative(MOBILE_ROOT, file).split(path.sep).join("/");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const sourceFiles = SOURCE_DIRS.flatMap((dir) => walk(path.join(MOBILE_ROOT, dir))).filter(
  isSourceFile
);

describe("pool route structure (#1592)", () => {
  it("has exactly one pool detail screen", () => {
    const poolDetailScreens = sourceFiles
      .map(relative)
      .filter((file) => /pool(s)?\/\[id\]\.tsx$/.test(file));

    expect(poolDetailScreens).toEqual(["app/pools/[id].tsx"]);
  });

  it("keeps the removed singular route gone, admins and all", () => {
    expect(fs.existsSync(path.join(APP_DIR, "pool"))).toBe(false);
    expect(fs.existsSync(path.join(APP_DIR, "pools", "[id]", "admins.tsx"))).toBe(true);
  });

  it("has no source that navigates to the removed /pool/ route", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const code = stripComments(fs.readFileSync(file, "utf8"));

      if (/\/pool\/(?!s)/.test(code)) {
        offenders.push(relative(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
