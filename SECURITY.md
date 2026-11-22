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

| Severity | Patch target         |
| -------- | -------------------- |
| Critical | 3 business days      |
| High     | 7 business days      |
| Medium   | 30 days              |
| Low      | Next planned release |

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

---

## Contributor Pre-Audit Checklist

Complete the checks relevant to the changed components before requesting a security review. A checked item means it has been verified in code or tests, not merely considered. Record accepted risks and any skipped checks in the pull request.

### Soroban smart contracts

- [ ] Every state-changing entry point enforces the intended `require_auth` / authorization policy; unauthorized callers are tested.
- [ ] Contract IDs, token addresses, owners, recipients, and other caller-supplied identifiers are validated before use.
- [ ] Arithmetic uses checked operations and explicit token precision; overflow, underflow, rounding, zero, and maximum values are tested.
- [ ] Balance and supply invariants hold across deposits, withdrawals, transfers, fees, refunds, and failed cross-contract calls.
- [ ] External contract calls and oracle values are treated as untrusted; failure paths cannot leave partial state changes.
- [ ] Storage keys, TTL/expiration, upgrade/admin controls, and initialization are reviewed for takeover, stale-state, and denial-of-service risks.
- [ ] No secret, private key, authentication token, or private message content is written to contract storage or public events.
- [ ] Events are deterministic, sufficiently structured for indexing, and emitted only for committed state transitions.
- [ ] Replay, duplicate submission, re-entrancy-like callback assumptions, and transaction-order edge cases are covered where applicable.
- [ ] Unit, invariant/property-based, and fuzz tests cover both successful and adversarial call sequences.

### Backend and indexer APIs

- [ ] Every request body, path parameter, query parameter, header, and uploaded file is validated at the boundary.
- [ ] Database access uses parameterized queries; no user-controlled SQL fragments are interpolated.
- [ ] Authentication and resource-level authorization are enforced server-side; ownership is checked independently of client-supplied IDs.
- [ ] Rate limits, request/body size limits, timeouts, and pagination bounds protect expensive endpoints.
- [ ] CORS uses an explicit production origin allowlist; credentials are never combined with wildcard origins.
- [ ] Secrets, authorization headers, personal data, and raw message content are redacted from logs and error responses.
- [ ] Webhook destinations and URL fetches are protected against SSRF, redirects to private networks, and unsafe schemes.
- [ ] Errors do not expose stack traces, SQL, filesystem paths, or internal configuration.
- [ ] Security-sensitive behavior has tests for missing, malformed, expired, replayed, and unauthorized credentials.

### Web frontend and browser security

- [ ] User-generated content is rendered as text or sanitized with a well-maintained allowlist; unsafe `dangerouslySetInnerHTML` use is avoided.
- [ ] Links, markdown, embeds, and rich previews validate schemes and destinations; untrusted URLs cannot execute `javascript:` or `data:` payloads.
- [ ] State-changing cookie-authenticated requests have CSRF protections (SameSite cookies plus token/origin validation as appropriate).
- [ ] Authentication tokens and wallet secrets are not placed in URLs, logs, analytics, or insecure persistent storage.
- [ ] Content Security Policy and security headers are reviewed for new scripts, frames, workers, and external origins.
- [ ] Forms validate on both client and server; client validation is never treated as an authorization boundary.
- [ ] Dependencies, source maps, third-party scripts, and browser storage are reviewed for supply-chain and data-exposure risk.
- [ ] Keyboard navigation, focus handling, and accessible error states are preserved when adding security controls.

### Recommended references

- [OWASP Top 10: Web Application Security Risks](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Smart Contract Top 10](https://owasp.org/www-project-smart-contract-top-10/)

For the protocol threat model, deployment checks, monitoring, and incident response process, continue to use the [Security Audit Reference](./docs/SECURITY_AUDIT.md).
