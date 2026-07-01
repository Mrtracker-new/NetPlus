# Security Policy

NetPulse is a security tool that parses bytes controlled by remote parties. We
take vulnerabilities seriously.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, report privately via GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or email the maintainers at `security@netpulse.example`
(placeholder — update before public release).

Please include:
- A description of the vulnerability and its impact.
- Steps to reproduce (a capture fixture or fuzz input is ideal).
- Affected component/crate and version/commit.

We aim to acknowledge reports within 72 hours and to provide a remediation
timeline after triage.

## Scope and posture

The design deliberately shrinks the attack surface (see
`docs/0-foundation/02_System_Architecture.md` §10):

- **Observe-only.** No component can inject, block, or modify network traffic.
- **Memory safety.** The engine is Rust; the parser (`netpulse-decode`) forbids
  `unsafe` without documented, reviewed justification and is continuously fuzzed
  (one fuzz target per dissector).
- **Single egress boundary.** Only `netpulse-ai` may make outbound connections,
  and only when the user opts into a remote endpoint.
- **Privilege isolation.** Raw capture runs in a small, separate, privileged
  process (`netpulse-capture-svc`) with a minimal trusted computing base.

## Dependencies

Dependencies are attack surface. We prefer few, well-audited crates; pin and
commit lockfiles; and run `cargo audit` / `pnpm audit` in CI. A dependency that
introduces mandatory network egress is disqualified (`docs/03` §14).
