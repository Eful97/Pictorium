---
name: pictorium-security
description: >
  Security workflow for Pictorium: API-key resolution, user namespace isolation,
  SSRF-safe image fetching, anonymous poster overrides, cache-busting abuse,
  log redaction, admin/PIN authorization and rate limits. Use when modifying
  authentication, user spaces, credentials, external URLs, proxy/image routes,
  public-instance policy, config tokens or render resource limits; also for a
  requested security review. Evidence-based review, not an automatic hardening sweep.
---

# Pictorium security

## Scope and source of truth

Read the repository's `AGENTS.md` before work. This skill adds security-specific
inspection, not a second verification schedule or a new authorization policy.
Relative file links below resolve from this skill directory; commands run from
the repository root (`../../..`). Re-read implementation and all consumers:
this map is an entry point, not a guarantee that behavior is unchanged.

Never print real credentials, inspect personal browser profiles, read `.env*`
merely to discover settings, or copy auth headers into reports. Use synthetic
keys, isolated browser contexts and deterministic mocked upstreams. Browser
screenshots/network traces can contain secrets; review before sharing them.

## Locate the boundary and existing regression tests

| Boundary | Start reading | Relevant tests under `src/__tests__/` |
|---|---|---|
| Per-request, user-space and instance keys | [tmdb.ts](../../../src/lib/tmdb.ts), [user-keys.ts](../../../src/lib/user-keys.ts), [device-keys.ts](../../../src/lib/device-keys.ts) | `auth-security/user-keys.test.ts`, `auth-security/namespace-keys.test.ts`, `auth-security/device-keys.test.ts`, `providers/tmdb-api-key.test.ts` |
| Namespace identity and write ownership | [user-auth.ts](../../../src/lib/user-auth.ts), [guest-guard.ts](../../../src/lib/guest-guard.ts), [http.ts](../../../src/lib/http.ts) (`userFetch`), user/defaults/mappings route consumers | `auth-security/user-namespacing.test.ts`, `auth-security/multi-user-hardening.test.ts`, `auth-security/guest-guard.test.ts`, `auth-security/user-password.test.ts` |
| Admin, PIN and origin checks | [auth.ts](../../../src/lib/auth.ts), [pin-auth.ts](../../../src/lib/pin-auth.ts), corresponding route consumers | `auth-security/auth.test.ts`, `auth-security/admin-token.test.ts`, `auth-security/pin-auth.test.ts` |
| External fetch and SSRF | [safe-remote-fetch.ts](../../../src/lib/safe-remote-fetch.ts), [resolve-image.ts](../../../src/lib/resolve-image.ts), [image-utils.ts](../../../src/lib/image-utils.ts), [proxy route](../../../src/app/api/proxy/[...path]/route.ts) | Search for `safe-remote-fetch` and `SSRF`; `auth-security/resolve-image-route.test.ts`, `auth-security/proxy-key-strip.test.ts` |
| Image decode/resource limits | [custom-image-validate.ts](../../../src/lib/custom-image-validate.ts), [custom-poster-base.ts](../../../src/lib/custom-poster-base.ts) and logo/backdrop consumers | `auth-security/custom-image-validate.test.ts`, `auth-security/custom-poster-url-validation.test.ts`, `auth-security/custom-logo-route.test.ts`, `auth-security/custom-backdrop-route.test.ts` |
| Public poster query, preview and cache policy | [poster-params-hardening.ts](../../../src/lib/poster-params-hardening.ts), [validation.ts](../../../src/lib/validation.ts), [poster route](../../../src/app/api/poster/[type]/[id]/route.ts) | `auth-security/poster-params-hardening.test.ts`, `auth-security/poster-query-validation.test.ts` |
| Configuration tokens | [config-token.ts](../../../src/lib/config-token.ts), [config-token route](../../../src/app/api/config-token/route.ts) | `auth-security/config-token.test.ts`, `auth-security/config-token-route.test.ts`, `auth-security/config-token-partial.test.ts` |
| Secret redaction | [logger.ts](../../../src/lib/logger.ts), `redactUrlForLog` in `safe-remote-fetch.ts`, actual logging call sites | `auth-security/logger-sanitize.test.ts`, `auth-security/proxy-key-strip.test.ts` |
| Abuse and render budget | [rate-limit.ts](../../../src/lib/rate-limit.ts), [poster-runtime-cache.ts](../../../src/lib/poster-runtime-cache.ts), [poster-service.ts](../../../src/lib/poster-service.ts) | `auth-security/rate-limit.test.ts`, `auth-security/rate-limit-kv.test.ts`, relevant `storage-cache/` tests |

Find consumers and the closest tests before selecting a run:

```bash
rg -n 'resolveUserApiKeys|resolveRouteApiKey|checkUserAuth|requireAdminToken' src
rg -n 'safeFetchRemote|resolveAndCheckBlocked|readBodyCapped|validateImageBytes|SSRF' src
rg -n 'isPreviewDowngraded|hardenPosterSearchParams|redactUrlForLog|sanitizeLogData' src
```

## Review questions (verify; do not assume)

1. **Keys:** Does each provider retain its actual request/key precedence? Does a
   scoped multi-user request avoid operator-key fallback unless explicitly
   permitted? Check `resolveUserApiKeys`, not only `resolveRequestApiKey`.
   Do not assume global and scoped requests share the same fallback policy.
2. **Ownership:** Is namespace input normalized before filesystem/KV use? Is
   server-side write authorization checked for that exact namespace? A valid
   UUID or a client-side guest guard is not proof of ownership. Test missing,
   wrong and cross-user credentials, plus admin/PIN/legacy modes as applicable.
3. **SSRF:** Are URL scheme/host, DNS addresses, connection-time lookup and
   every redirect checked by the existing fetch path? Verify actual fallback
   behavior if undici is unavailable; a preflight DNS check alone is not a
   guarantee against rebinding. Do not replace safe fetches with plain fetch.
4. **Images:** Are byte limits enforced while reading, followed by MIME/magic,
   decode, pixel and animation validation where required? Trace validation
   through resolve AND rendering; validating only the UI is insufficient.
5. **Public renders:** Can an anonymous request gain live-preview privileges,
   introduce arbitrary image overrides or manufacture unbounded cache keys?
   Preserve the documented distinction between query hardening and saved
   mappings/defaults. An existing user space is not automatically write access.
6. **Caches:** Can two users or credential sets share private cached results?
   Inspect cache keys, persistence and inflight coalescing together. Never put
   raw credentials in a diagnostic cache-key example.
7. **Logs/tokens:** Are secrets absent from errors, redirects, response bodies
   and URLs as well as structured log fields? A config token must not be
   assumed secret or authenticated just because it is encoded/compressed.
8. **Resources:** Preserve slot limits, deadlines, abort propagation and body
   caps. Inspect trusted-proxy assumptions in rate-limit key derivation. Do not
   change limits or add fallback paths without evidence and task authorization.

## Changes, tests and reporting

- First demonstrate the issue with a minimal synthetic regression when relevant.
  Use the existing fixtures; no real production accounts or hostile live probes.
- Make the smallest boundary fix. Do not silently change public route/query/env
  contracts or globally harden unrelated behavior.
- Load `tmdb-api`, `stremio-protocol`, `perf`, `poster-sync` or `poster-visual`
  when that concern is touched; reuse their canonical workflows.
- During work, run the closest test, for example:

  ```bash
  npx vitest run src/__tests__/auth-security/logger-sanitize.test.ts
  ```

- Verification scheduling belongs ONLY to `AGENTS.md` → Verification Strategy.
  App build/E2E/visual gates are not triggered merely by reading this skill.
- Report findings with path/line, input, observed consequence and regression
  evidence. Distinguish proven vulnerability, intended policy and unverified
  hypothesis. No blanket claims of safety or complete audit coverage.
