# Security Policy

## Supported Versions

Only the latest `main` branch is supported with security updates.
Tagged releases receive fixes exclusively through an update to `main`
— we do not backport patches to older tags.

## Reporting a Vulnerability

**Do not open a public issue** for security reports.

Report privately via
[GitHub Security Advisories](https://github.com/Eful97/Pictorium/security/advisories/new)
(`Security` tab → `Report a vulnerability`).

Please include:

- affected endpoint or component and version/commit;
- steps to reproduce or a minimal proof of concept;
- impact assessment (what an attacker can achieve).

## Response SLA (indicative)

- Acknowledgement within **7 days**;
- fix or mitigation on `main` within **30 days** for confirmed
  high-severity issues, best-effort otherwise.

No bug bounty is offered.

## Scope

In scope: admin-token and PIN/session authentication, rate limiting,
SSRF allowlists (`PROXY_ALLOW_DOMAINS`, addon proxy), path traversal
in storage, cache-key isolation between user namespaces (`?u=`).

Out of scope:

- user-supplied third-party API keys (TMDB, MDBList, TVDB) leaked by
  the instance operator themselves;
- vulnerabilities in upstream dependencies without a working exploit
  against this project (report those upstream);
- denial of service requiring large-scale botnets against default
  rate limits;
- reports generated solely by automated scanners without a manual
  impact analysis.

## Hardening for public instances

See `README.md` → Security and Environment Variables
(`PUBLIC_INSTANCE=0` + `ADMIN_TOKEN`, `TRUST_PROXY` + pinned
`CLIENT_IP_HEADER` behind Cloudflare, `PUBLIC_STATS=0`,
`FRAME_ANCESTORS`, `PREVIEW_AUTH`).
