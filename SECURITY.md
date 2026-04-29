# Security Policy

## Supported Versions

This security policy applies to all versions of the Linkora-socials smart contracts. The current version is `0.1.0` as specified in `packages/contracts/contracts/linkora-contracts/Cargo.toml`.

## Scope

This security policy applies to smart contract code in:

- `packages/contracts/contracts/linkora-contracts/src/lib.rs` - Core contract implementation
- `packages/contracts/contracts/linkora-contracts/src/test.rs` - Test suite (for test-related vulnerabilities)

**In Scope:**
- Smart contract access control vulnerabilities
- Token transfer and tipping logic flaws
- Pool manipulation attacks
- Storage layout and TTL issues
- Authorization bypasses
- Economic/financial vulnerabilities
- Integer overflow/underflow issues

**Out of Scope:**
- Frontend mock data and UI components (not yet included in this repository)
- Backend services and APIs (not yet included in this repository)
- Issues requiring physical access to user devices
- Social engineering attacks
- Third-party dependencies (unless directly exploitable in contract context)
- Network-level attacks on Stellar infrastructure

The repository is currently a prototype. Frontend and backend services are not included here, and no production deployment guarantees are implied.

## How to Report a Vulnerability

If you discover a vulnerability, please do **not** open a public issue first.

**Private Disclosure Channels:**

1. **Preferred:** Open a private GitHub security advisory for this repository
2. **Alternative:** Email: `security@linkora.social`

**What to Include:**
- A clear description of the issue and affected function(s)
- Reproduction steps or proof of concept
- Impact assessment (fund loss, denial of service, access control bypass, etc.)
- Suggested remediation (optional but appreciated)
- Your contact information for follow-up

## Response Timeline

Our security response team commits to the following timelines:

- **Initial Response:** Within 48 hours of receiving a valid report
- **Triage Assessment:** Within 7 days - severity classification and impact analysis
- **Remediation Timeline:**
  - **Critical:** Fix deployed within 30 days
  - **High:** Fix deployed within 60 days  
  - **Medium:** Fix deployed within 90 days
  - **Low:** Addressed in next scheduled release

**Priority Levels:**
- **Critical:** Direct fund loss, pool drainage, unauthorized token transfers
- **High:** Access control bypass, contract upgrade vulnerabilities
- **Medium:** DOS attacks, logic errors that don't directly cause fund loss
- **Low:** Information disclosure, minor logic issues

## Disclosure Process

1. **Report Submission:** Vulnerability reported via private channel
2. **Acknowledgment:** Security team confirms receipt within 48 hours
3. **Triage:** Team assesses severity and impact within 7 days
4. **Remediation:** Fix developed and tested based on severity timeline
5. **Coordination:** If multiple vendors are affected, we coordinate disclosure
6. **Publication:** Security advisory published after fix is deployed
7. **Credit:** Reporter credited in security advisory (with permission)

## Security Guarantees

This project is currently in **prototype stage** and has not completed a formal external audit. While we take security seriously and will address reported vulnerabilities promptly:

- Do not use with high-value production funds
- Additional security reviews are recommended before mainnet deployment
- Known limitations are described in the root `README.md` under "Current Limitations"

## Security Best Practices for Users

- Use dedicated accounts for contract interactions
- Start with small test transactions
- Keep private keys secure
- Monitor contract upgrades and announcements
- Review the source code before significant interactions

## Recognition Program

While we don't currently offer a formal bug bounty program, we will:

- Credit security researchers in our release notes (with permission)
- Provide recognition in our community channels
- Consider contributions for future bounty programs

Thank you for helping keep Linkora-socials secure!
