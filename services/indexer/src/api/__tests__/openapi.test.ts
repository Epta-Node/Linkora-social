/**
 * The published OpenAPI contract must describe every route `createApp()`
 * mounts.
 *
 * `openapi.yaml` used to document six paths while `createApp()` mounted
 * roughly twenty, so SDK authors and mini-app integrators had no contract for
 * the feed, search, notification, governance, moderation and state-root
 * surfaces — and nothing for a client generator to consume.
 *
 * This test walks the Express router stack of a freshly built app and fails
 * when a mounted route has no OpenAPI path entry, or when an OpenAPI entry
 * refers to a route that no longer exists.
 */

import fs from "fs";
import path from "path";
import express from "express";
import type { Pool } from "pg";
import { createApp } from "../index";
import type { Database } from "../../db";
import type { HealthMonitor } from "../../services/health-monitor";

const stubDb = {} as Database;

function stubPool(): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  } as unknown as Pool;
}

function stubMonitor(): HealthMonitor {
  return {
    checkReadiness: jest.fn().mockResolvedValue({ ready: true, degraded: false }),
    isStarted: jest.fn().mockReturnValue(true),
    getStartedAt: jest.fn().mockReturnValue(new Date().toISOString()),
  } as unknown as HealthMonitor;
}

// ── Route enumeration ─────────────────────────────────────────────────────────

interface MountedRoute {
  method: string;
  path: string;
}

/** Fast-slash regexp express uses for `app.use(fn)` — i.e. no mount prefix. */
const FAST_SLASH_SOURCE = "^\\/?(?=\\/|$)";

function mountPathOf(layer: { regexp?: { source?: string } }): string {
  const source = String(layer.regexp?.source ?? "");
  if (source === FAST_SLASH_SOURCE) return "";
  let remainder = source.startsWith("^") ? source.slice(1) : source;
  // express appends `\/?(?=\/|$)` for non-terminal `app.use(path, …)` mounts.
  remainder = remainder.replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  return remainder.replace(/\\\//g, "/");
}

function joinPath(prefix: string, routePath: string): string {
  const suffix =
    !routePath || routePath === "/"
      ? ""
      : routePath.startsWith("/")
        ? routePath
        : `/${routePath}`;
  if (!prefix) return suffix || "/";
  return `${prefix.replace(/\/+$/, "")}${suffix}`;
}

/** Express writes `:id`, OpenAPI writes `{id}` — normalise before comparing. */
function toOpenApiPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function collectMountedRoutes(app: express.Application): MountedRoute[] {
  const collected: MountedRoute[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const rawPath = layer.route.path;
        const paths: string[] = Array.isArray(rawPath) ? rawPath : [rawPath];
        for (const routePath of paths) {
          const fullPath = toOpenApiPath(joinPath(prefix, routePath));
          for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
            if (!enabled || method === "_all") continue;
            collected.push({ method: method.toUpperCase(), path: fullPath });
          }
        }
      } else if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack, joinPath(prefix, mountPathOf(layer)));
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (app as any)._router;
  if (!router || !Array.isArray(router.stack)) {
    throw new Error("Could not read the Express router stack — express internals changed?");
  }
  walk(router.stack, "");
  return collected;
}

// ── Minimal OpenAPI path reader ───────────────────────────────────────────────

/**
 * Reads the `paths:` block without pulling in a YAML dependency.
 *
 * Path keys sit at two spaces under `paths:`; operations sit at four. The
 * block ends at the first key back at column zero (`components:`).
 */
function parseOpenApiPaths(yaml: string): Map<string, Set<string>> {
  const documented = new Map<string, Set<string>>();
  let inPaths = false;
  let current: string | null = null;

  for (const line of yaml.split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      current = null;
      continue;
    }
    if (!inPaths) continue;
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      inPaths = false;
      current = null;
      continue;
    }

    const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathMatch) {
      current = pathMatch[1];
      if (!documented.has(current)) documented.set(current, new Set());
      continue;
    }

    const methodMatch = line.match(/^ {4}(get|put|post|delete|options|head|patch|trace):\s*$/i);
    if (methodMatch && current) {
      documented.get(current)?.add(methodMatch[1].toUpperCase());
    }
  }

  return documented;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const OPENAPI_PATH = path.resolve(__dirname, "../../../openapi.yaml");

describe("openapi.yaml ↔ createApp() coverage", () => {
  let yaml = "";
  let mounted: MountedRoute[] = [];
  let documented: Map<string, Set<string>> = new Map();

  beforeAll(() => {
    yaml = fs.readFileSync(OPENAPI_PATH, "utf8");
    // Pass a pool so the conditional `/api/state-root` router is mounted too.
    const app = createApp(stubDb, stubPool(), stubMonitor());
    mounted = collectMountedRoutes(app);
    documented = parseOpenApiPaths(yaml);
  });

  it("mounts a substantial route surface (guards against a broken walk)", () => {
    expect(mounted.length).toBeGreaterThanOrEqual(20);
    expect(documented.size).toBeGreaterThanOrEqual(20);
  });

  it("documents every route mounted by createApp()", () => {
    const undocumented = mounted
      .filter((route) => !documented.get(route.path)?.has(route.method))
      .map((route) => `${route.method} ${route.path}`)
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("documents no route that createApp() does not mount", () => {
    const mountedKeys = new Set(mounted.map((route) => `${route.method} ${route.path}`));
    const stale: string[] = [];

    for (const [routePath, methods] of documented) {
      for (const method of methods) {
        const key = `${method} ${routePath}`;
        if (!mountedKeys.has(key)) stale.push(key);
      }
    }

    expect(stale.sort()).toEqual([]);
  });

  it("documents the feed, search, notification, governance and state-root surfaces", () => {
    expect(documented.has("/api/feed")).toBe(true);
    expect(documented.has("/api/feed/explore")).toBe(true);
    expect(documented.has("/api/search/posts")).toBe(true);
    expect(documented.has("/api/notifications/register")).toBe(true);
    expect(documented.has("/api/governance/proposals")).toBe(true);
    expect(documented.has("/api/state-root")).toBe(true);
    expect(documented.has("/health/live")).toBe(true);
    expect(documented.has("/metrics")).toBe(true);
  });

  it("specifies the StellarSig auth scheme and its canonical signing string", () => {
    expect(yaml).toContain("securitySchemes:");
    expect(yaml).toContain("StellarSig:");
    // Must reference the shared canonical builder, not re-implement it.
    expect(yaml).toContain("packages/types/src/auth.ts");
    expect(yaml).toContain("v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}");
    expect(yaml).toContain("Authorization: StellarSig <base64(JSON { address, timestamp, signature })>");
  });
});
