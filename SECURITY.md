# Security Policy

## Scope

This security policy applies to smart contract code in:

- `packages/contracts/contracts/linkora-contracts`

The repository is currently a prototype. Frontend and backend services are not included here, and no production deployment guarantees are implied.

## Supported Status

The current contract implementation should be treated as pre-production software. Security reports are welcome for all active code in the repository, but maintainers may prioritize fixes based on severity and roadmap impact.

## Responsible Disclosure

If you discover a vulnerability, please do **not** open a public issue first.

Use one of these private channels:

- Open a private GitHub security advisory for this repository.
- Email: `security@linkora.social`

Please include:

- A clear description of the issue and affected function(s)
- Reproduction steps or proof of concept
- Impact assessment (fund loss, denial of service, access control bypass, etc.)
- Suggested remediation (optional)

## Response Expectations

Maintainers will acknowledge valid reports as quickly as possible and coordinate remediation and disclosure timelines. Critical issues affecting token transfer safety and pool balances are prioritized.

## Prototype Limitations

Known limitations are described in the root `README.md` under current limitations. This project has not completed a formal external audit and should not be used for high-value production funds without additional hardening.
