// Local-only stub for the `cloudflare:workers` runtime builtin, which does
// not exist under Node/vitest. It is mapped via `vitest.config.ts` alias so
// `scripts/cloudflare-poster-worker.mjs` (paste-ready for the Workers
// runtime, where the real builtin exists) stays importable in unit tests.
// The tiered upper-layer behavior is unreachable here anyway: the gateway
// additionally requires `ctx.exports.PosterCacheTier.fetch` at request time.
export class WorkerEntrypoint {
  protected ctx?: unknown;
  protected env?: unknown;
  constructor(ctx?: unknown, env?: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
