#!/usr/bin/env node
/**
 * Static accessibility audit for the mobile app (#1789).
 *
 * Walks every .tsx file in the app source folders and reports interactive
 * React Native elements (Pressable / Touchable* / Button-like components)
 * that are missing an `accessibilityLabel` (or `aria-label`) or an
 * `accessibilityRole` (or `role`).
 *
 * Uses the TypeScript compiler API, so it understands real JSX rather than
 * matching text. Elements that spread props (`{...rest}`) are skipped because
 * the label may be supplied by the caller.
 *
 * Exit code is non-zero when violations are found, so CI fails on regressions.
 *
 * Usage: node scripts/a11y-lint.js [--json]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components", "mini-apps", "notifications", "context"];
const IGNORED_SEGMENTS = new Set(["node_modules", "__tests__", "__mocks__"]);

/** Interactive components that must expose a label and a role. */
const INTERACTIVE_TAGS = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
]);

const LABEL_PROPS = new Set([
  "accessibilityLabel",
  "aria-label",
  "accessibilityLabelledBy",
  "aria-labelledby",
]);
const ROLE_PROPS = new Set(["accessibilityRole", "role"]);

function collectFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_SEGMENTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.name.endsWith(".tsx") && !/\.(test|spec|stories)\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function tagName(node) {
  const name = node.tagName;
  if (ts.isIdentifier(name)) return name.text;
  // Animated.Pressable etc. — audit on the trailing identifier.
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  return null;
}

function auditFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      if (name && INTERACTIVE_TAGS.has(name)) {
        let hasLabel = false;
        let hasRole = false;
        let hasSpread = false;
        let hidden = false;
        for (const attr of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attr)) {
            hasSpread = true;
            continue;
          }
          const attrName = attr.name.getText(sf);
          if (LABEL_PROPS.has(attrName)) hasLabel = true;
          if (ROLE_PROPS.has(attrName)) hasRole = true;
          if (attrName === "accessible" && attr.initializer) {
            const text = attr.initializer.getText(sf);
            if (text === "{false}") hidden = true;
          }
          if (
            attrName === "importantForAccessibility" ||
            attrName === "accessibilityElementsHidden"
          ) {
            hidden = true;
          }
        }
        if (!hasSpread && !hidden) {
          const missing = [];
          if (!hasLabel) missing.push("accessibilityLabel");
          if (!hasRole) missing.push("accessibilityRole");
          if (missing.length > 0) {
            const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            violations.push({
              file: path.relative(ROOT, file),
              line: line + 1,
              column: character + 1,
              element: name,
              missing,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

function main() {
  const files = SOURCE_DIRS.flatMap((dir) => collectFiles(path.join(ROOT, dir), []));
  const violations = files.flatMap(auditFile);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(violations, null, 2) + "\n");
  } else if (violations.length === 0) {
    console.log(`a11y-lint: ${files.length} files checked, no issues found.`);
  } else {
    for (const v of violations) {
      console.error(
        `${v.file}:${v.line}:${v.column}  <${v.element}> is missing ${v.missing.join(" and ")}`
      );
    }
    console.error(`\na11y-lint: ${violations.length} issue(s) in ${files.length} files.`);
  }

  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main();
}

module.exports = { auditFile, collectFiles, INTERACTIVE_TAGS };
