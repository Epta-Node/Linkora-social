# Web Package

This package bootstraps the Linkora web frontend using Next.js App Router and TypeScript.

## Prerequisites

- Node.js 18+
- pnpm 9+

## Install workspace dependencies

From repository root:

```bash
pnpm install
```

## Run the web app

From repository root:

```bash
pnpm --filter web dev
```

Or from this directory:

```bash
pnpm dev
```

## Build and lint

From repository root:

```bash
pnpm --filter web build
pnpm --filter web lint
```

## Notes

- This scaffold intentionally keeps the first page minimal.
- Contract code and existing contract workspace remain unchanged.
