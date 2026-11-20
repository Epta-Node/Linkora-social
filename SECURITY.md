# Security Policy

## Supported Versions

| Version        | Supported |
| -------------- | --------- |
| `main`         | ✅        |
| Older branches | ❌        |

We only provide security fixes on the `main` branch. If you are running an older fork or
branch, upgrade to the latest `main` before reporting.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via GitHub's built-in private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Epta-Node/Linkora-social/security) of this
   repository.
2. Click **"Report a vulnerability"**.
3. Fill in the report form with as much detail as possible (see below).

Alternatively, email the security team at **security@linkora.social** with the subject line
`[SECURITY] <short description>`.

### What to include in your report

- **Component affected** — contract, indexer, DM relay, frontend, SDK, or mobile app
- **Severity estimate** — Critical / High / Medium / Low (use CVSS 3.1 if possible)
- **Description** — a clear, concise summary of the vulnerability
- **Steps to reproduce** — the minimal sequence of actions or code needed to trigger it
- **Proof of concept** — a script, transaction, or payload demonstrating the issue
- **Impact** — what an attacker could achieve (fund drain, data exfiltration, DoS, etc.)
- **Suggested fix** (optional but welcome)

### Response timeline

| Stage                   | Target time       |
| ----------------------- | ----------------- |
| Initial acknowledgement | ≤ 48 hours        |
| Severity assessment     | ≤ 5 business days |
| Patch / mitigation      | See table below   |
| Public disclosure       | After patch ships |

| Severity | Patch target          |
| -------- | --------------------- |
| Critical | 3 business days       |
| High     | 7 business days       |
| Medium   | 30 days               |
| Low      | Next planned release  |

We follow a **coordinated disclosure** model. We ask that you give us reasonable time to
investigate and fix the issue before publishing details publicly.

---

## Scope

### In scope

- Soroban smart contract (`packages/contracts`) — reentrancy, auth bypass, fund drain,
  storage manipulation, upgrade path exploits
- Indexer REST/WebSocket API (`services/indexer`) — SQL injection, authentication bypass,
  rate-limit bypass, data exfiltration
- DM relay (`services/dm-relay`) — E2EE compromise, authentication bypass, message
  injection, metadata leakage
- Web frontend (`apps/web`) — XSS, CSRF, wallet phishing, link-preview SSRF
- Mobile app (`apps/mobile`) — wallet key exposure, insecure storage, deep-link hijacking
- SDK (`packages/sdk`) — transaction manipulation, signature bypass
- CI/CD pipeline — secret exposure, supply chain attacks on dependencies

### Out of scope

- Vulnerabilities in third-party dependencies that are not directly exploitable in Linkora
- Attacks requiring physical access to a developer's machine
- Social engineering of team members
- Volumetric DoS that requires overwhelming a public testnet with resources
- Issues already reported or publicly known

---

## Security Audit Documentation

For the full threat model, pre-deployment security checklist, monitoring recommendations,
and incident response runbook, see:

**[`docs/SECURITY_AUDIT.md`](./docs/SECURITY_AUDIT.md)**

---

## Bug Bounty

There is currently no formal bug bounty programme. We may offer recognition (hall of fame,
public credit) for responsibly disclosed vulnerabilities at our discretion.

---

## Hall of Fame

We maintain a list of researchers who have responsibly disclosed vulnerabilities. If you
would like to be recognised, let us know in your report.


