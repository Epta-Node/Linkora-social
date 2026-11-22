# Changelog guide

This guide is for maintainers writing entries in `CHANGELOG.md` and cutting a
release with `scripts/release.sh`. It covers the format, how to write entries
for each kind of change, and the release steps around the script.

For the full release workflow (versioning policy, contract versions, npm
publish, GitHub release), read [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md).
This guide focuses on the changelog and the script's behavior with it.

---

## 1. Format

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The file is laid out newest first:

```markdown
# Changelog

(header: links to the format and versioning specs)

---

## [Unreleased]

### Added

- ...

---

## [0.1.0] - 2026-10-19

### Added

- ...
```

Rules:

- **Heading.** Each release is `## [X.Y.Z] - YYYY-MM-DD`, with the version in
  square brackets and an ISO date. `## [Unreleased]` holds changes not yet
  released.
- **Order.** Newest release first. Within a release, sections follow the order
  below.
- **Sections.** Use only the sections that have entries, in this order:

  | Section          | Use for                                                           |
  | ---------------- | ----------------------------------------------------------------- |
  | `### Added`      | New features, new endpoints, new docs, new packages               |
  | `### Changed`    | Behavior changes to existing features, including breaking changes |
  | `### Deprecated` | Features that still work but will be removed                      |
  | `### Removed`    | Features removed in this release                                  |
  | `### Fixed`      | Bug fixes                                                         |
  | `### Security`   | Fixes for vulnerabilities. Keep the detail vague until disclosed  |

  `release.sh` creates only `Added`, `Changed` and `Fixed`. Add `Deprecated`,
  `Removed` or `Security` by hand when you need them.

- **Bullets.** A plain `-` bullet per change. Wrap lines at about 80 characters,
  indenting continuation lines by two spaces, as the existing entries do.
- **Reference.** End an entry with the issue or PR number in parentheses, for
  example `(#1721)`, so readers can find the discussion. The examples in
  section 3 use `#NNNN` as a placeholder for the real number.

---

## 2. What belongs in the changelog

Write for a reader who uses Linkora but did not read the code.

**Include**

- User-visible behavior: a new screen, a changed API response, a new env var,
  a new contract entrypoint.
- Changes that break integrators: changed event shapes, removed endpoints, new
  required configuration, a new minimum Node version.
- Fixes a user or operator would notice.
- Significant internal changes that affect operators: a new migration that must
  run, a new required secret, a changed default.

**Leave out**

- Refactors with no behavior change.
- Test-only and CI-only changes, unless they change how someone develops.
- Dependency bumps with no visible effect. Group them under one line if the
  bump matters, such as a security fix in a dependency.
- Anything you would not mention in a release note.

When one PR changes several things, write one entry per user-visible change, not
one per file.

---

## 3. Writing entries by change type

Start every entry with the area it touches, in code formatting or bold, followed
by a short description in the present tense. Say what changed for the reader,
not how it was implemented.

### 3.1 New feature (`### Added`)

```markdown
### Added

- `services/dm-relay`: `GET /api/messages/conversation/:id/search` returns the
  conversation's messages for client-side search (#NNNN)
- **Feature name** (`apps/web`): one-line description of what users can now do (#NNNN)
```

Include the new endpoint, command, env var or screen name in backticks or bold so
it can be found.

### 3.2 Behavior change (`### Changed`)

State the old behavior and the new one, and say whether it is breaking.

```markdown
### Changed

- **Breaking:** `POST /api/messages` now requires an `X-Idempotency-Key` header.
  Requests without it get `400`. Clients must send a UUID per logical send (#NNNN)
- `analytics-oracle`: one-line description of the behavior change (#NNNN)
```

Mark breaking changes with **Breaking:** at the start of the bullet. Say what an
integrator has to do.

### 3.3 Deprecation (`### Deprecated`)

Name the replacement and the removal target.

```markdown
### Deprecated

- `linkora-sdk`: `oldMethod()` is deprecated in favour of `newMethod()`. It
  will be removed in 0.3.0 (#NNNN)
```

### 3.4 Removal (`### Removed`)

Name what was removed and what to use instead.

```markdown
### Removed

- `services/dm-relay`: one-line description of what was removed and its
  replacement (#NNNN)
```

### 3.5 Bug fix (`### Fixed`)

Describe the symptom the user saw, not the cause.

```markdown
### Fixed

- Symptom the user saw, in one line (#NNNN)
- Another symptom, in one line (#NNNN)
```

### 3.6 Security (`### Security`)

Keep it factual and short. Do not describe an exploit before users can update. If
the issue is not yet public, write the entry when the fix is released, and link
the advisory once it is published.

```markdown
### Security

- One-line, factual description of the fix, without exploit detail (#NNNN)
```

### 3.7 Docs

Documentation changes go under `### Added` when they add a guide, or under
`### Changed` when they correct one that was wrong. The existing `Unreleased`
entries follow this pattern:

```markdown
- Docs: `docs/RELEASE_PROCESS.md` — full release workflow (#1721)
```

---

## 4. Adding entries during development

Add the entry in the same PR as the change, under `## [Unreleased]`. Reviewers
should check it. The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) does not
currently ask for a changelog entry, so the author and reviewer need to remember
it.

Do not edit released sections. A correction to an old release goes in
`## [Unreleased]` under `### Fixed` or `### Changed`, and says that it corrects a
previous release.

---

## 5. Cutting a release

The release steps are in [`RELEASE_PROCESS.md` §5](./RELEASE_PROCESS.md#5-cutting-a-release).
This section covers the changelog and what `scripts/release.sh` does to it.

### 5.1 What the script does

`scripts/release.sh` (run with `bash scripts/release.sh`) does the following:

1. Requires a clean working tree and a valid `X.Y.Z` version that has no
   existing tag.
2. Writes the new version to `packages/contracts/contracts/linkora-contracts/Cargo.toml`
   and to the root `package.json`.
3. Calls `add_changelog_entry`, which inserts a template block:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added

   -

   ### Changed

   -

   ### Fixed

   -
   ```

4. Runs `git add -A`, commits with the message `Release X.Y.Z`, and creates the
   annotated tag `vX.Y.Z`.
5. Prints the next steps: edit `CHANGELOG.md`, review with `git diff`, push the
   branch and the tag, and create a GitHub release.

### 5.2 Known issues with the script

Verified against the current `scripts/release.sh`. Work around them until they
are fixed.

**The new block goes under the wrong heading.** `add_changelog_entry` finds the
last line starting with `## [` and inserts after it. In a changelog that has an
`[Unreleased]` section and at least one release, that last heading is the oldest
release. The template therefore lands directly under that old release's heading,
and the old release's bullets end up beneath the new version. Reproduced with a
copy of the current `CHANGELOG.md`: the new `9.9.9` block appeared between the
`0.1.0` heading and its `### Added` content.

Workaround: after the script runs, move the new block so it sits above the
previous release, and check that each release keeps its own bullets.

**The release commit is made before the changelog is written.** The script
commits and tags in `create_git_tag`, and only then prints "edit CHANGELOG.md".
The commit contains empty bullets, and the tag points at that commit.

Workaround, before pushing:

```bash
# edit CHANGELOG.md, then:
git add CHANGELOG.md
git commit --amend --no-edit
git tag -d vX.Y.Z
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

Re-create the tag after amending. Otherwise `vX.Y.Z` points at the commit before
the edit.

**`[Unreleased]` is not moved.** The script does not rename `## [Unreleased]` or
move its bullets into the new version. Move them by hand into the new block, and
leave `## [Unreleased]` empty above it.

**The repository check does not check the repository.** The guard in `main`
runs `git rev-parse --git-head`, which is not a valid option. Inside the
repository the command exits `0`, so the guard passes, and it does not test what
its error message says. Run the script from the repository root, on a clean
working tree.

**Commits are not signed.** `RELEASE_PROCESS.md` says the release commit is
signed. The script runs a plain `git commit` and `git tag -a`. Sign by hand if
the policy requires it (`git commit -S --amend`, `git tag -s`).

**Sections are incomplete.** The template creates `Added`, `Changed` and `Fixed`
only. Add `Deprecated`, `Removed` or `Security` by hand when needed.

### 5.3 Checklist

- [ ] Every user-visible change merged since the last tag has an entry under
      `[Unreleased]`. `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
      helps find them.
- [ ] Breaking changes are marked **Breaking:**, and each has a migration note.
- [ ] Run the script, then fix the heading position and move `[Unreleased]`
      entries (section 5.2).
- [ ] Amend the release commit and re-create the tag.
- [ ] Versions match in `Cargo.toml` and root `package.json`.
- [ ] Push the branch, open the release PR, then push the tag.
- [ ] Paste the new section into the GitHub release body.

---

## 6. Review checklist for changelog PRs

- [ ] Entry is under `[Unreleased]`, in the right section.
- [ ] The bullet says what changed for the reader, in the present tense.
- [ ] Breaking changes are marked and explain the action needed.
- [ ] The entry references the issue or PR number.
- [ ] No internal-only detail, and nothing that exposes an unpatched
      vulnerability.
