// Standalone edge-worker tests: mocks `caches`/`fetch`/ctx, no live network.
// Covers key isolation, conservative bypasses and response cacheability.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import worker, {
  PosterCacheTier,
  buildTarget,
  bypassReason,
  cacheDigestHex,
  cacheDigestInput,
  cacheKeyFor,
  edgeCacheControl,
  isCacheableResponse,
  resolveOrigin,
  resolveTiered,
  serveTierInner,
  sharedTtlSec,
  sortedQueryString,
  tierVaryCoversRequest,
  varyAllowsStorage,
} from "../../scripts/cloudflare-poster-worker.mjs";

const ENV: Record<string, string> = { ORIGIN_URL: "https://origin.example" };
const WORKER_HOST = "https://worker.example";

type FetchHandler = (target: string, init: RequestInit) => Promise<Response>;
type FetchMock = Mock<FetchHandler>;

interface MockEdgeCache {
  readonly match: Mock<(req: Request) => Promise<Response | undefined>>;
  readonly put: Mock<(req: Request, res: Response) => Promise<void>>;
  readonly delete: Mock<(req: Request) => Promise<boolean>>;
}

interface TestCtx {
  readonly ctx: { waitUntil(promise: Promise<unknown>): void };
  readonly flush: () => Promise<PromiseSettledResult<unknown>[]>;
}

function posterUrl(query = ""): string {
  return `${WORKER_HOST}/api/poster/movie/123${query}`;
}

function originResponse(body = "bytes", headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "image/webp",
      vary: "Accept",
      ...headers,
    },
  });
}

function installCache(store: Map<string, Response> = new Map<string, Response>()): {
  readonly store: Map<string, Response>;
  readonly cache: MockEdgeCache;
} {
  const cache: MockEdgeCache = {
    match: vi.fn(async (req: Request): Promise<Response | undefined> => {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    }),
    put: vi.fn(async (req: Request, res: Response): Promise<void> => {
      store.set(req.url, res.clone());
    }),
    delete: vi.fn(async (req: Request): Promise<boolean> => store.delete(req.url)),
  };
  vi.stubGlobal("caches", { default: cache });
  return { store, cache };
}

function installFetch(handler: FetchHandler): FetchMock {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeCtx(): TestCtx {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise: Promise<unknown>): void => void pending.push(promise) },
    flush: (): Promise<PromiseSettledResult<unknown>[]> => Promise.allSettled(pending),
  };
}

let fetchMock: FetchMock;
let ctxFactory: TestCtx;

beforeEach(() => {
  installCache();
  fetchMock = installFetch(async (): Promise<Response> => originResponse());
  ctxFactory = makeCtx();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function get(url: string, headers: Record<string, string> = {}, env: Record<string, string> = ENV): Promise<Response> {
  const res = await worker.fetch(new Request(url, { headers }), env, ctxFactory.ctx);
  await ctxFactory.flush();
  return res;
}

describe("resolveOrigin", () => {
  it("keeps the configured default origin", () => {
    expect(resolveOrigin(undefined)).toEqual({ ok: true, origin: "https://pictorium.duckdns.org" });
  });

  it("rejects non-http(s) origins", () => {
    expect(resolveOrigin({ ORIGIN_URL: "ftp://x.example" }).ok).toBe(false);
  });

  it("rejects origins with credentials", () => {
    expect(resolveOrigin({ ORIGIN_URL: "https://user:pass@origin.example" }).ok).toBe(false);
  });

  it("returns 500 on bad origin configuration", async () => {
    const res = await worker.fetch(new Request(posterUrl()), { ORIGIN_URL: "ftp://x.example" }, ctxFactory.ctx);
    expect(res.status).toBe(500);
  });
});

describe("buildTarget", () => {
  it("never lets // alter the origin host", () => {
    const target = buildTarget(new URL(`${WORKER_HOST}//evil.example/api/poster/movie/1`), "https://origin.example");
    expect(target.host).toBe("origin.example");
    expect(target.pathname).toBe("//evil.example/api/poster/movie/1");
  });

  it("strips internal __fmt/__format params", () => {
    const target = buildTarget(new URL(posterUrl("?fmt=webp&__fmt=x&__format=y&a=1")), "https://origin.example");
    expect(target.searchParams.get("fmt")).toBe("webp");
    expect(target.searchParams.has("__fmt")).toBe(false);
    expect(target.searchParams.has("__format")).toBe(false);
  });
});

describe("sortedQueryString", () => {
  it("sorts by key only, keeps unknown params and repeat order", () => {
    expect(sortedQueryString(new URLSearchParams("b=2&a=1&u=x&rv=1&mv=2&config=z&a=0"))).toBe(
      "a=1&a=0&b=2&config=z&mv=2&rv=1&u=x",
    );
  });

  it("drops internal keys from the key input", () => {
    expect(sortedQueryString(new URLSearchParams("a=1&__fmt=x&__format=y"))).toBe("a=1");
  });
});

describe("cacheKeyFor", () => {
  it("isolates raw Accept values opaquely on the worker host", async () => {
    const target = new URL("https://origin.example/api/poster/movie/1?a=1");
    const webp = await cacheKeyFor(new Request(posterUrl("?a=1"), { headers: { accept: "image/webp" } }), target, "a=1");
    const generic = await cacheKeyFor(new Request(posterUrl("?a=1"), { headers: { accept: "*/*" } }), target, "a=1");
    expect(webp.key.url).toContain("/.pictorium-poster-cache/v2/");
    expect(new URL(webp.key.url).host).toBe("worker.example");
    expect(webp.key.url).not.toBe(generic.key.url);
    expect(webp.key.url).not.toContain("webp");
  });
});

describe("cold/hit behavior", () => {
  it("serves MISS then HIT with body and headers preserved", async () => {
    const first = await get(posterUrl("?a=1"));
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(first.headers.get("vary")).toBe("Accept");
    expect(await first.text()).toBe("bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await get(posterUrl("?a=1"));
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(second.headers.get("vary")).toBe("Accept");
    expect(await second.text()).toBe("bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isolates raw Accept classes", async () => {
    await get(posterUrl("?a=1"), { accept: "image/webp" });
    await get(posterUrl("?a=1"), { accept: "*/*" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await get(posterUrl("?a=1"), { accept: "image/webp" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps explicit fmt in target and key", async () => {
    await get(posterUrl("?fmt=webp"));
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.searchParams.get("fmt")).toBe("webp");
    await get(posterUrl(""));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats sorted queries as the same key", async () => {
    await get(posterUrl("?b=2&a=1"));
    await get(posterUrl("?a=1&b=2"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps u/mv/rv/config distinct", async () => {
    await get(posterUrl("?a=1&u=aaa"));
    await get(posterUrl("?a=1&u=bbb"));
    await get(posterUrl("?a=1&mv=1"));
    await get(posterUrl("?a=1&mv=2"));
    await get(posterUrl("?a=1&rv=10"));
    await get(posterUrl("?a=1&rv=11"));
    await get(posterUrl("?a=1&config=cfg1"));
    await get(posterUrl("?a=1&config=cfg2"));
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("collapses __fmt/__format to the same key", async () => {
    await get(posterUrl("?a=1"));
    await get(posterUrl("?a=1&__fmt=x&__format=y"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("__fmt")).toBe(false);
  });

  it("stores the copy without the Accept vary token", async () => {
    const { store } = installCache();
    fetchMock = installFetch(async (): Promise<Response> => originResponse());
    await get(posterUrl("?a=9"));
    expect(store.size).toBe(1);
    const stored = [...store.values()][0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error("expected a stored response");
    expect(stored.headers.get("vary")).toBeNull();
  });
});

interface BypassCase {
  readonly headers?: Record<string, string>;
  readonly query?: string;
}

const bypassCases: Array<[string, BypassCase]> = [
  ["auth-header", { headers: { authorization: "Bearer k" } }],
  ["auth-header", { headers: { cookie: "sid=1" } }],
  ["auth-header", { headers: { "x-api-key": "k" } }],
  ["auth-header", { headers: { "x-admin-token": "t" } }],
  ["auth-header", { headers: { "x-tvdb-key": "t" } }],
  ["auth-header", { headers: { "x-simkl-key": "t" } }],
  ["auth-header", { headers: { "simkl-api-key": "t" } }],
  ["auth-header", { headers: { "x-fanart-key": "t" } }],
  ["auth-query", { query: "?api_key=k" }],
  ["auth-query", { query: "?mdblist_key=k" }],
  ["auth-query", { query: "?simkl_key=k" }],
  ["auth-query", { query: "?tvdb_key=k" }],
  ["auth-query", { query: "?fanart_key=k" }],
  ["preview", { query: "?preview=1" }],
  ["refresh", { query: "?__poster_refresh=1" }],
  ["live", { query: "?live=1" }],
  ["request-cache-control", { headers: { "cache-control": "no-cache" } }],
  ["request-cache-control", { headers: { "cache-control": "max-age=0" } }],
  ["pragma", { headers: { pragma: "no-cache" } }],
  ["conditional", { headers: { "if-none-match": '"x"' } }],
  ["conditional", { headers: { "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT" } }],
  ["range", { headers: { range: "bytes=0-99" } }],
];

describe("bypass rules", () => {
  it.each(bypassCases)("bypasses on %s without storing", async (reason, opts) => {
    const headers: Record<string, string> = opts.headers ?? {};
    const query: string = opts.query ?? "";
    expect(bypassReason(new Request(posterUrl(query), { headers }), new URL(posterUrl(query)))).toBe(reason);
    const first = await get(posterUrl(`?b=1${query.replace("?", "&")}`), headers);
    const second = await get(posterUrl(`?b=1${query.replace("?", "&")}`), headers);
    expect(first.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(second.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bypasses non-poster routes and non-GET methods", async () => {
    const health = await worker.fetch(new Request(`${WORKER_HOST}/api/health`), ENV, ctxFactory.ctx);
    expect(health.headers.get("x-pictorium-worker")).toBe("BYPASS");
    const posted = await worker.fetch(new Request(posterUrl(), { method: "POST", body: "hi" }), ENV, ctxFactory.ctx);
    expect(posted.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards credentials and api_key query untouched", async () => {
    await get(posterUrl("?api_key=secret-k"), { "x-api-key": "secret-h" });
    const [target, init] = fetchMock.mock.calls[0];
    expect(new URL(target).searchParams.get("api_key")).toBe("secret-k");
    expect((init.headers as Headers).get("x-api-key")).toBe("secret-h");
  });

  it("forwards POST bodies with manual redirect handling", async () => {
    fetchMock = installFetch(async (): Promise<Response> =>
      new Response(null, { status: 302, headers: { location: "https://origin.example/x" } }),
    );
    const res = await worker.fetch(new Request(posterUrl(), { method: "POST", body: "hi" }), ENV, ctxFactory.ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://origin.example/x");
    expect(res.headers.get("x-pictorium-worker")).toBe("BYPASS");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.body).toBeDefined();
  });

  it("sends GET without a body and rewrites host headers", async () => {
    await get(posterUrl("?a=1"));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Headers;
    expect(headers.has("host")).toBe(false);
    expect(headers.get("x-forwarded-host")).toBe("worker.example");
    expect(headers.get("x-forwarded-proto")).toBe("https");
  });
});

const uncacheableResponses: Array<[string, Record<string, string>]> = [
  ["no public", { "cache-control": "private, max-age=60" }],
  ["no-store", { "cache-control": "public, max-age=60, no-store" }],
  ["no-cache", { "cache-control": "public, max-age=60, no-cache" }],
  ["valued no-cache", { "cache-control": 'public, max-age=60, no-cache="Set-Cookie"' }],
  ["private", { "cache-control": "public, private, max-age=60" }],
  ["valued private", { "cache-control": 'public, max-age=60, private="x"' }],
  ["set-cookie", { "set-cookie": "sid=1" }],
  ["zero ttl", { "cache-control": "public, max-age=0" }],
  ["missing ttl", { "cache-control": "public" }],
  ["conflicting ttl", { "cache-control": "public, max-age=60, max-age=120" }],
  ["meaningful vary", { vary: "Accept, Cookie" }],
  ["vary star", { vary: "*" }],
];

describe("response cacheability", () => {
  it.each(uncacheableResponses)("skips storage on %s", async (_label, headers) => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", headers));
    await get(posterUrl("?c=1"));
    await get(posterUrl("?c=1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats conflicting shared TTLs as unknown", () => {
    expect(sharedTtlSec("public, max-age=60, max-age=120")).toBeUndefined();
    expect(sharedTtlSec("public, s-maxage=10, s-maxage=20")).toBeUndefined();
    expect(sharedTtlSec("public, max-age=60, max-age=60")).toBe(60);
    expect(sharedTtlSec("public, s-maxage=120, max-age=60")).toBe(120);
  });

  it("stores public responses with positive s-maxage and skips error statuses", async () => {
    fetchMock = installFetch(
      async (): Promise<Response> => originResponse("bytes", { "cache-control": "public, s-maxage=120, max-age=60" }),
    );
    expect(sharedTtlSec("public, s-maxage=120, max-age=60")).toBe(120);
    await get(posterUrl("?d=1"));
    await get(posterUrl("?d=1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = installFetch(async (): Promise<Response> => new Response("nope", { status: 500 }));
    const res = await get(posterUrl("?e=1"));
    expect(res.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(isCacheableResponse(new Response("x", { status: 500 }))).toBe(false);
  });

  it("allows accept-encoding-only vary", () => {
    expect(varyAllowsStorage(originResponse("x", { vary: "Accept, Accept-Encoding" }))).toBe(true);
  });

  it("allows the tracked Next.js RSC vary", () => {
    expect(
      varyAllowsStorage(
        originResponse("x", {
          vary: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept",
        }),
      ),
    ).toBe(true);
  });

  it("still skips storage when a tracked Next.js vary is joined by an unknown token", () => {
    expect(
      varyAllowsStorage(
        originResponse("x", {
          vary: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept, Cookie",
        }),
      ),
    ).toBe(false);
  });
});

describe("next.js rsc vary", () => {
  const NEXT_VARY =
    "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept";

  it("serves MISS then HIT with the full Next.js Vary preserved and no internal leak", async () => {
    const { store } = installCache();
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY }));
    const first = await get(posterUrl("?n=1"));
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(first.headers.get("vary")).toBe(NEXT_VARY);
    expect(first.headers.get("x-pictorium-worker-origin-vary")).toBeNull();
    expect(await first.text()).toBe("bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(store.size).toBe(1);
    const stored = [...store.values()][0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error("expected a stored response");
    expect(stored.headers.get("vary")).toBeNull();
    expect(stored.headers.get("x-pictorium-worker-origin-vary")).toBe(NEXT_VARY);

    const second = await get(posterUrl("?n=1"));
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(second.headers.get("vary")).toBe(NEXT_VARY);
    expect(second.headers.get("x-pictorium-worker-origin-vary")).toBeNull();
    expect(await second.text()).toBe("bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restores an absent Vary as absent without adding Accept", async () => {
    fetchMock = installFetch(
      async (): Promise<Response> =>
        new Response("bytes", {
          status: 200,
          headers: { "cache-control": "public, max-age=60", "content-type": "image/webp" },
        }),
    );
    const first = await get(posterUrl("?n=2"));
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(first.headers.get("vary")).toBeNull();
    const second = await get(posterUrl("?n=2"));
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(second.headers.get("vary")).toBeNull();
    expect(second.headers.get("x-pictorium-worker-origin-vary")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("overwrites a spoofed internal header in the stored copy", async () => {
    const { store } = installCache();
    fetchMock = installFetch(
      async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY, "x-pictorium-worker-origin-vary": "spoof" }),
    );
    const first = await get(posterUrl("?n=3"));
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(first.headers.get("vary")).toBe(NEXT_VARY);
    const stored = [...store.values()][0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error("expected a stored response");
    expect(stored.headers.get("x-pictorium-worker-origin-vary")).toBe(NEXT_VARY);
    const second = await get(posterUrl("?n=3"));
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(second.headers.get("vary")).toBe(NEXT_VARY);
    expect(second.headers.get("x-pictorium-worker-origin-vary")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isolates rsc / prefetch / state-tree values, keeping null distinct from empty", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY }));
    await get(posterUrl("?n=4"), { rsc: "1" });
    await get(posterUrl("?n=4"), {});
    await get(posterUrl("?n=4"), { rsc: "" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await get(posterUrl("?n=4"), { rsc: "1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await get(posterUrl("?n=5"), { "next-router-prefetch": "1" });
    await get(posterUrl("?n=5"), {});
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await get(posterUrl("?n=6"), { "next-router-state-tree": "abc" });
    await get(posterUrl("?n=6"), { "next-router-state-tree": "abd" });
    await get(posterUrl("?n=6"), { "next-router-state-tree": "abc" });
    expect(fetchMock).toHaveBeenCalledTimes(7);

    await get(posterUrl("?n=7"), { "next-router-segment-prefetch": "1" });
    await get(posterUrl("?n=7"), {});
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("skips storage when the Next.js vary is joined by an unknown token", async () => {
    fetchMock = installFetch(
      async (): Promise<Response> => originResponse("bytes", { vary: `${NEXT_VARY}, Cookie` }),
    );
    await get(posterUrl("?n=8"));
    await get(posterUrl("?n=8"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cache failure safety", () => {
  it("serves origin when match fails and logs a fixed message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const { cache } = installCache();
    cache.match.mockRejectedValueOnce(new Error("down"));
    const res = await get(posterUrl("?f=1"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
    expect(warn).toHaveBeenCalledWith("[pictorium-worker] cache lookup failed");
  });

  it("serves MISS when async put fails without leaking secrets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const { cache } = installCache();
    cache.put.mockRejectedValue(new Error("down"));
    const res = await get(posterUrl("?g=1&api_key=zzz"));
    expect(res.headers.get("x-pictorium-worker")).toBe("BYPASS");
    const clean = await get(posterUrl("?g=2"));
    expect(clean.headers.get("x-pictorium-worker")).toBe("MISS");
    for (const call of warn.mock.calls) {
      expect(call.join(" ")).not.toContain("zzz");
      expect(call.join(" ")).not.toContain("api_key");
    }
    expect(warn).toHaveBeenCalledWith("[pictorium-worker] cache put failed");
  });

  it("serves MISS when put throws synchronously", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const { cache } = installCache();
    cache.put.mockImplementation((): Promise<void> => {
      throw new Error("sync down");
    });
    const first = await get(posterUrl("?g=3"));
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(await first.text()).toBe("bytes");
    const second = await get(posterUrl("?g=3"));
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("[pictorium-worker] cache put failed");
  });

  it("works without waitUntil", async () => {
    const res = await worker.fetch(new Request(posterUrl("?h=1")), ENV, undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-pictorium-worker")).toBe("MISS");
  });
});

const TIER_ENV: Record<string, string> = { ORIGIN_URL: "https://origin.example", PICTORIUM_TIERED_CACHE: "1" };
const NEXT_VARY =
  "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept";

function tierCtx(innerFetch: (req: Request) => Promise<Response>): {
  ctx: { waitUntil(promise: Promise<unknown>): void; exports: { PosterCacheTier: { fetch: (req: Request) => Promise<Response> } } };
  flush: () => Promise<PromiseSettledResult<unknown>[]>;
} {
  const base = makeCtx();
  return {
    flush: base.flush,
    ctx: { ...base.ctx, exports: { PosterCacheTier: { fetch: innerFetch } } },
  };
}

describe("tiered opt-in", () => {
  it("stays OFF unless explicitly enabled (fail-closed)", () => {
    expect(resolveTiered(undefined)).toBe(false);
    expect(resolveTiered(null)).toBe(false);
    expect(resolveTiered({})).toBe(false);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "" })).toBe(false);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "0" })).toBe(false);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "false" })).toBe(false);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "yes" })).toBe(false);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "on" })).toBe(false);
  });

  it("turns ON for 1/true (trimmed, case-insensitive)", () => {
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "1" })).toBe(true);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: "true" })).toBe(true);
    expect(resolveTiered({ PICTORIUM_TIERED_CACHE: " TRUE " })).toBe(true);
  });

  it("never consults exports when the flag is off", async () => {
    let innerCalls = 0;
    const t = tierCtx(async (): Promise<Response> => {
      innerCalls += 1;
      return originResponse();
    });
    const first = await worker.fetch(new Request(posterUrl("?t=1")), ENV, t.ctx);
    await t.flush();
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    const second = await worker.fetch(new Request(posterUrl("?t=1")), ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(innerCalls).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy path when exports are missing despite the flag", async () => {
    const local = makeCtx();
    const first = await worker.fetch(new Request(posterUrl("?t=2")), TIER_ENV, local.ctx);
    await local.flush();
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.host).toBe("origin.example");
    const second = await worker.fetch(new Request(posterUrl("?t=2")), TIER_ENV, local.ctx);
    await local.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("HIT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails open to the legacy path when the inner entrypoint throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const t = tierCtx(async (): Promise<Response> => {
      throw new Error("rpc down");
    });
    const res = await worker.fetch(new Request(posterUrl("?t=3")), TIER_ENV, t.ctx);
    await t.flush();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(await res.text()).toBe("bytes");
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.host).toBe("origin.example");
    expect(warn).toHaveBeenCalledWith("[pictorium-worker] tier fetch failed");
  });
});

describe("tiered gateway", () => {
  it("forwards eligible requests with a canonical worker-host URL", async () => {
    const { store } = installCache();
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY }));
    const seen: Request[] = [];
    const t = tierCtx(async (req: Request): Promise<Response> => {
      seen.push(req);
      return serveTierInner(req, TIER_ENV);
    });
    const res = await worker.fetch(
      new Request(posterUrl("?b=2&a=1&__fmt=x"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
      t.ctx,
    );
    await t.flush();
    expect(res.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(res.headers.get("vary")).toBe(NEXT_VARY);
    expect(await res.text()).toBe("bytes");
    expect(seen).toHaveLength(1);
    const innerReq = seen[0];
    expect(innerReq).toBeDefined();
    if (!innerReq) throw new Error("expected an inner request");
    const innerUrl = new URL(innerReq.url);
    // Canonical: worker host (never the origin), sorted query, no internals.
    expect(innerUrl.host).toBe("worker.example");
    expect(innerUrl.pathname).toBe("/api/poster/movie/123");
    expect(innerUrl.search).toBe("?a=1&b=2");
    // Raw tracked classes travel verbatim for the upper-tier Vary partition.
    expect(innerReq.headers.get("accept")).toBe("image/webp");
    expect(innerReq.headers.get("rsc")).toBe("1");
    // The origin still sees the fixed ORIGIN_URL host with the same params.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.host).toBe("origin.example");
    expect(target.searchParams.get("a")).toBe("1");
    expect(target.searchParams.get("b")).toBe("2");
    expect(target.searchParams.has("__fmt")).toBe(false);

    // Tier-served responses are never duplicated into the manual cache:
    // the same query class misses locally and is served natively on
    // repeat (here the stub inner has no native cache, so the repeat
    // re-invokes inner instead of hitting locally).
    expect(store.size).toBe(0);
    const second = await worker.fetch(
      new Request(posterUrl("?a=1&b=2"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
      t.ctx,
    );
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(second.headers.get("vary")).toBe(NEXT_VARY);
    expect(store.size).toBe(0);
    expect(seen).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps u/config distinct and never forwards credential traffic", async () => {
    let innerCalls = 0;
    const t = tierCtx(async (req: Request): Promise<Response> => {
      innerCalls += 1;
      return serveTierInner(req, TIER_ENV);
    });
    await worker.fetch(new Request(posterUrl("?u=aaa")), TIER_ENV, t.ctx);
    await worker.fetch(new Request(posterUrl("?u=bbb")), TIER_ENV, t.ctx);
    await worker.fetch(new Request(posterUrl("?config=cfg1")), TIER_ENV, t.ctx);
    await worker.fetch(new Request(posterUrl("?config=cfg2")), TIER_ENV, t.ctx);
    await t.flush();
    expect(innerCalls).toBe(4);

    const secret = tierCtx(async (req: Request): Promise<Response> => {
      innerCalls += 1;
      return serveTierInner(req, TIER_ENV);
    });
    const first = await worker.fetch(
      new Request(posterUrl("?s=1&api_key=secret-k"), { headers: { "x-api-key": "secret-h" } }),
      TIER_ENV,
      secret.ctx,
    );
    const second = await worker.fetch(
      new Request(posterUrl("?s=1&api_key=secret-k"), { headers: { "x-api-key": "secret-h" } }),
      TIER_ENV,
      secret.ctx,
    );
    await secret.flush();
    expect(first.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(second.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(innerCalls).toBe(4);
    // Credentials are forwarded untouched to the origin, never upward.
    const [target, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(new URL(target).searchParams.get("api_key")).toBe("secret-k");
    expect((init.headers as Headers).get("x-api-key")).toBe("secret-h");
  });

  it("bypasses preview/live/conditional/range without touching the inner tier", async () => {
    const cases: Array<{ headers: Record<string, string>; query: string }> = [
      { headers: {}, query: "?p=1&preview=1" },
      { headers: {}, query: "?p=2&live=1" },
      { headers: { "if-none-match": '"x"' }, query: "?p=3" },
      { headers: { range: "bytes=0-99" }, query: "?p=4" },
      { headers: { cookie: "sid=1" }, query: "?p=5" },
    ];
    for (const { headers, query } of cases) {
      let innerCalls = 0;
      const t = tierCtx(async (req: Request): Promise<Response> => {
        innerCalls += 1;
        return serveTierInner(req, TIER_ENV);
      });
      const res = await worker.fetch(new Request(posterUrl(query), { headers }), TIER_ENV, t.ctx);
      await t.flush();
      expect(res.headers.get("x-pictorium-worker")).toBe("BYPASS");
      expect(innerCalls).toBe(0);
    }
  });

  it("serves redirects as BYPASS without storing, like the legacy path", async () => {
    const { store } = installCache();
    fetchMock = installFetch(async (): Promise<Response> =>
      new Response(null, { status: 302, headers: { location: "https://origin.example/x" } }),
    );
    const t = tierCtx(async (req: Request): Promise<Response> => serveTierInner(req, TIER_ENV));
    const res = await worker.fetch(new Request(posterUrl("?r=1")), TIER_ENV, t.ctx);
    await t.flush();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://origin.example/x");
    expect(res.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(res.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(store.size).toBe(0);
    const second = await worker.fetch(new Request(posterUrl("?r=1")), TIER_ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("BYPASS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("tierVaryCoversRequest", () => {
  const req = (headers: Record<string, string> = {}): Request =>
    new Request(posterUrl(), { headers });

  it("requires Vary coverage for every tracked header present on the request", () => {
    const full = originResponse("x", { vary: NEXT_VARY });
    expect(tierVaryCoversRequest(full, req({ accept: "image/webp", rsc: "1" }))).toBe(true);
    const acceptOnly = originResponse("x", { vary: "Accept" });
    expect(tierVaryCoversRequest(acceptOnly, req({ accept: "image/webp" }))).toBe(true);
    // Present-but-uncovered tracked header: the upper tier would collapse it.
    expect(tierVaryCoversRequest(acceptOnly, req({ accept: "image/webp", rsc: "1" }))).toBe(false);
    // Absent headers share one variant legitimately: no coverage needed.
    expect(tierVaryCoversRequest(acceptOnly, req())).toBe(true);
    // Empty string is present (distinct class in the lower-tier key).
    expect(tierVaryCoversRequest(acceptOnly, req({ rsc: "" }))).toBe(false);
  });

  it("rejects absent Vary and Vary: *", () => {
    expect(
      tierVaryCoversRequest(new Response("x", { headers: { "cache-control": "public, max-age=60" } }), req()),
    ).toBe(false);
    expect(tierVaryCoversRequest(originResponse("x", { vary: "*" }), req())).toBe(false);
  });
});

describe("serveTierInner", () => {
  it("passes fully-partitionable responses through with Vary intact", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY }));
    const res = await serveTierInner(
      new Request(posterUrl("?i=1"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
    // Edge-normalized for the upper tier (SWR/SIE stripped, indefinite
    // stale-on-error default defeated) with the exact origin policy
    // smuggled for gateway restore; full origin Vary untouched.
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, stale-if-error=0");
    expect(res.headers.get("x-pictorium-tier-edge-cc")).toBe("public, max-age=60");
    expect(res.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(res.headers.get("vary")).toBe(NEXT_VARY);
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.host).toBe("origin.example");
  });

  it("neutralizes responses the upper tier could not partition, restoring them at the gateway", async () => {
    const { store } = installCache();
    fetchMock = installFetch(async (): Promise<Response> =>
      originResponse("bytes", { vary: "Accept, Cookie" }),
    );
    // Raw inner response: not storable upstream, original smuggled inside.
    const raw = await serveTierInner(new Request(posterUrl("?i=2")), TIER_ENV);
    expect(raw.headers.get("cache-control")).toBe("no-store");
    expect(raw.headers.get("x-pictorium-tier-orig-cc")).toBe("public, max-age=60");
    expect(raw.headers.get("vary")).toBe("Accept, Cookie");

    const t = tierCtx(async (req: Request): Promise<Response> => serveTierInner(req, TIER_ENV));
    const first = await worker.fetch(new Request(posterUrl("?i=2")), TIER_ENV, t.ctx);
    await t.flush();
    // Client-visible: exact origin headers, marker MISS, no internal leak.
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    expect(first.headers.get("vary")).toBe("Accept, Cookie");
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(first.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(await first.text()).toBe("bytes");
    expect(store.size).toBe(0);
    const second = await worker.fetch(new Request(posterUrl("?i=2")), TIER_ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("strips a spoofed tier-internal header on pass-through", async () => {
    const { store } = installCache();
    fetchMock = installFetch(
      async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY, "x-pictorium-tier-orig-cc": "evil" }),
    );
    const t = tierCtx(async (req: Request): Promise<Response> => serveTierInner(req, TIER_ENV));
    const res = await worker.fetch(
      new Request(posterUrl("?i=3"), { headers: { accept: "image/webp" } }),
      TIER_ENV,
      t.ctx,
    );
    await t.flush();
    // Pass-through (gate passes): attacker header gone, real CC kept, no
    // neutralization signal, never duplicated into the manual cache.
    expect(res.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(store.size).toBe(0);
    const again = await worker.fetch(
      new Request(posterUrl("?i=3"), { headers: { accept: "image/webp" } }),
      TIER_ENV,
      t.ctx,
    );
    await t.flush();
    // No manual copy exists, and this stub inner has no native cache, so
    // the repeat re-invokes inner (MISS, origin again) instead of hitting.
    expect(again.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(again.headers.get("cache-control")).toBe("public, max-age=60");
    expect(store.size).toBe(0);
  });

  it("proxies bypass traffic without upper-tier storage on direct calls", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes"));
    const res = await serveTierInner(new Request(posterUrl("?api_key=k")), TIER_ENV);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-pictorium-tier-orig-cc")).toBe("public, max-age=60");
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.searchParams.get("api_key")).toBe("k");
  });

  it("exposes the named entrypoint delegating to the inner logic", () => {
    expect(typeof PosterCacheTier).toBe("function");
    expect(typeof PosterCacheTier.prototype.fetch).toBe("function");
  });
});

type UpperBucket = Array<{
  readonly vary: string[];
  readonly values: Record<string, string | null>;
  readonly res: Response;
}>;

interface RealisticUpperTier {
  readonly fetch: (req: Request, opts?: { cf?: { cacheKey?: string } }) => Promise<Response>;
  readonly innerCalls: () => number;
  readonly originCalls: () => number;
  readonly seenKeys: () => Array<string | undefined>;
}

/**
 * Simulates the DOCUMENTED Workers Caching behavior for a `ctx.exports`
 * loopback (https://developers.cloudflare.com/workers/cache/,
 * https://developers.cloudflare.com/workers/cache/cache-keys/):
 * the key is the target entrypoint + path + query string (order matters,
 * host ignored) unless the caller overrides it via `cf.cacheKey`; request
 * headers outside the key (Accept, Cookie, RSC, ...) do NOT partition
 * unless the stored response lists them in `Vary` (verbatim values, only a
 * variant whose stored values match is returned, `Vary: *` never stored).
 * A HIT returns the stored inner response WITHOUT invoking inner (or the
 * origin). Tests below use a partial `Vary: Accept` origin response so the
 * collapse of unlisted tracked headers is observable.
 */
function makeRealisticUpperTier(
  env: Record<string, string>,
  shared: Map<string, UpperBucket> = new Map<string, UpperBucket>(),
): RealisticUpperTier {
  let innerCalls = 0;
  const seenKeys: Array<string | undefined> = [];
  const fetch = async (req: Request, opts?: { cf?: { cacheKey?: string } }): Promise<Response> => {
    const url = new URL(req.url);
    const key = opts?.cf?.cacheKey ?? `${url.pathname}${url.search}`;
    seenKeys.push(opts?.cf?.cacheKey);
    const bucket = shared.get(key) ?? [];
    for (const entry of bucket) {
      let match = true;
      for (const token of entry.vary) {
        if (req.headers.get(token) !== entry.values[token]) {
          match = false;
          break;
        }
      }
      if (match) return entry.res.clone();
    }
    innerCalls += 1;
    const live = await serveTierInner(req, env);
    const cc = (live.headers.get("cache-control") ?? "").toLowerCase();
    const uncacheable = /(^|,)\s*no-store(\s*(,|$|=))/.test(cc) || live.headers.has("set-cookie");
    if (!uncacheable) {
      const vary = (live.headers.get("vary") ?? "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      if (!vary.includes("*")) {
        const values: Record<string, string | null> = {};
        for (const token of vary) values[token] = req.headers.get(token);
        bucket.push({ vary, values, res: live.clone() });
        shared.set(key, bucket);
      }
    }
    return live;
  };
  return { fetch, innerCalls: (): number => innerCalls, originCalls: (): number => fetchMock.mock.calls.length, seenKeys: (): Array<string | undefined> => [...seenKeys] };
}

describe("realistic upper tier (documented key + Vary semantics)", () => {
  const PARTIAL_VARY = "Accept";

  it("isolates absent-vs-present RSC: same URL must run inner per raw class", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: PARTIAL_VARY }));
    const upper = makeRealisticUpperTier(TIER_ENV);
    const t = tierCtx(upper.fetch);
    const first = await worker.fetch(new Request(posterUrl("?k=1")), TIER_ENV, t.ctx);
    await t.flush();
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(upper.innerCalls()).toBe(1);
    // Same URL, only an UNLISTED tracked header differs: without proactive
    // digest keying the upper tier HITs here and serves the wrong raw class
    // without running inner (documented: headers outside the key + outside
    // Vary return the same cached response).
    const second = await worker.fetch(new Request(posterUrl("?k=1"), { headers: { rsc: "1" } }), TIER_ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(upper.innerCalls()).toBe(2);
    expect(upper.originCalls()).toBe(2);
    // The second response is unpartitionable upstream (present-but-uncovered
    // `rsc` fails the Vary-coverage gate, so inner neutralizes it): nothing
    // is stored, and a repeat runs inner again instead of serving a wrong
    // variant.
    installCache();
    const third = await worker.fetch(new Request(posterUrl("?k=1"), { headers: { rsc: "1" } }), TIER_ENV, t.ctx);
    await t.flush();
    expect(third.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(await third.text()).toBe("bytes");
    expect(upper.innerCalls()).toBe(3);
    expect(upper.originCalls()).toBe(3);
  });

  it("serves same-class repeats from the upper tier without running inner", async () => {
    const fullVary = "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept";
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: fullVary }));
    const upper = makeRealisticUpperTier(TIER_ENV);
    const t = tierCtx(upper.fetch);
    const headers = { accept: "image/webp", rsc: "1" };
    const first = await worker.fetch(new Request(posterUrl("?h=1"), { headers }), TIER_ENV, t.ctx);
    await t.flush();
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(upper.innerCalls()).toBe(1);
    // Repeat through a FRESH manual tier: the upper-tier HIT serves the
    // stored copy without invoking inner or the origin, with the exact
    // origin policy restored, and nothing is duplicated into the manual
    // cache (repeats stay native, with exact upstream expiration).
    const { store: freshStore } = installCache();
    const second = await worker.fetch(new Request(posterUrl("?h=1"), { headers }), TIER_ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(await second.text()).toBe("bytes");
    expect(second.headers.get("cache-control")).toBe("public, max-age=60");
    expect(second.headers.get("vary")).toBe(fullVary);
    expect(freshStore.size).toBe(0);
    expect(upper.innerCalls()).toBe(1);
    expect(upper.originCalls()).toBe(1);
  });

  it("keeps missing/empty/present Accept distinct and isolates ORIGIN_URL flips", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: PARTIAL_VARY }));
    const shared = new Map<string, UpperBucket>();
    const upper = makeRealisticUpperTier(TIER_ENV, shared);
    const t = tierCtx(upper.fetch);
    await worker.fetch(new Request(posterUrl("?k=2")), TIER_ENV, t.ctx);
    await worker.fetch(new Request(posterUrl("?k=2"), { headers: { accept: "" } }), TIER_ENV, t.ctx);
    await worker.fetch(new Request(posterUrl("?k=2"), { headers: { accept: "image/webp" } }), TIER_ENV, t.ctx);
    await t.flush();
    expect(upper.innerCalls()).toBe(3);
    expect(upper.originCalls()).toBe(3);
    // Same URL/headers but a different ORIGIN_URL must never reuse bytes:
    // the digest covers the origin. The upper store is intentionally shared
    // (one Worker/account), so a URL-only key would HIT here with origin-A
    // bytes for an origin-B request.
    const envB: Record<string, string> = { ORIGIN_URL: "https://origin2.example", PICTORIUM_TIERED_CACHE: "1" };
    const upperB = makeRealisticUpperTier(envB, shared);
    const tB = tierCtx(upperB.fetch);
    await worker.fetch(new Request(posterUrl("?k=2"), { headers: { accept: "image/webp" } }), envB, tB.ctx);
    await tB.flush();
    expect(upperB.innerCalls()).toBe(1);
    expect(upper.originCalls()).toBe(4);
    const target = new URL(fetchMock.mock.calls[3][0]);
    expect(target.host).toBe("origin2.example");
  });

  it("keys the upper tier by the canonical digest: same class shares, raw classes split", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: PARTIAL_VARY }));
    const upper = makeRealisticUpperTier(TIER_ENV);
    const t = tierCtx(upper.fetch);
    const target = new URL("https://origin.example/api/poster/movie/123");
    const reqA = new Request(posterUrl("?k=4"));
    const expected = `pictorium-poster-tier:${await cacheDigestHex(reqA, target, "k=4")}`;
    expect(cacheDigestInput(reqA, target, "k=4")).toContain('"accept":null');
    await worker.fetch(reqA, TIER_ENV, t.ctx);
    // Repeat through a FRESH lower tier: the upper tier serves the same
    // raw class from the identical digest key without running inner again.
    installCache();
    await worker.fetch(new Request(posterUrl("?k=4")), TIER_ENV, t.ctx);
    await t.flush();
    // Same raw class reuses one upper-tier key and one inner run.
    expect(upper.innerCalls()).toBe(1);
    expect(upper.seenKeys()).toEqual([expected, expected]);
    expect(expected.startsWith("pictorium-poster-tier:")).toBe(true);
  });
});

describe("upper-tier freshness (no added SWR)", () => {
  const NEXT_VARY =
    "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept";

  it("edgeCacheControl strips stale-serving directives and pins stale-if-error=0", () => {
    expect(edgeCacheControl("public, max-age=60")).toBe("public, max-age=60, stale-if-error=0");
    expect(edgeCacheControl("public, max-age=60, stale-while-revalidate=300, stale-if-error=600")).toBe(
      "public, max-age=60, stale-if-error=0",
    );
    expect(edgeCacheControl("public, max-age=60, Stale-While-Revalidate=300, stale-if-error")).toBe(
      "public, max-age=60, stale-if-error=0",
    );
    // Any other directive (incl. s-maxage/must-revalidate/immutable) passes
    // through untouched; the explicit pin is idempotent.
    expect(edgeCacheControl("public, s-maxage=120, max-age=60, must-revalidate, immutable")).toBe(
      "public, s-maxage=120, max-age=60, must-revalidate, immutable, stale-if-error=0",
    );
    expect(edgeCacheControl("public, max-age=60, stale-if-error=0")).toBe("public, max-age=60, stale-if-error=0");
  });

  it("stores an edge-normalized copy upstream while smuggling the exact original", async () => {
    const originCC = "public, max-age=60, stale-while-revalidate=300, stale-if-error=600";
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY, "cache-control": originCC }));
    const raw = await serveTierInner(
      new Request(posterUrl("?e=1"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
    );
    expect(raw.headers.get("cache-control")).toBe("public, max-age=60, stale-if-error=0");
    expect(raw.headers.get("x-pictorium-tier-edge-cc")).toBe(originCC);
    expect(raw.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(raw.headers.get("vary")).toBe(NEXT_VARY);
  });

  it("pins stale-if-error=0 even when the origin carries no stale directives", async () => {
    fetchMock = installFetch(async (): Promise<Response> => originResponse("bytes", { vary: NEXT_VARY }));
    const raw = await serveTierInner(
      new Request(posterUrl("?e=2"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
    );
    // Defeats the documented indefinite stale-on-error default; the client
    // still sees the exact origin policy after gateway restore.
    expect(raw.headers.get("cache-control")).toBe("public, max-age=60, stale-if-error=0");
    expect(raw.headers.get("x-pictorium-tier-edge-cc")).toBe("public, max-age=60");
  });

  it("strips a spoofed edge-policy header on pass-through", async () => {
    fetchMock = installFetch(
      async (): Promise<Response> =>
        originResponse("bytes", { vary: NEXT_VARY, "x-pictorium-tier-edge-cc": "public, max-age=9999" }),
    );
    const raw = await serveTierInner(
      new Request(posterUrl("?e=3"), { headers: { accept: "image/webp", rsc: "1" } }),
      TIER_ENV,
    );
    expect(raw.headers.get("x-pictorium-tier-edge-cc")).toBe("public, max-age=60");
    expect(raw.headers.get("cache-control")).toContain("stale-if-error=0");
  });

  it("restores the exact origin policy for the client, passing Age through (header fidelity only)", async () => {
    const originCC = "public, max-age=60, stale-while-revalidate=300";
    const { store } = installCache();
    fetchMock = installFetch(
      async (): Promise<Response> =>
        new Response("bytes", {
          status: 200,
          headers: { "cache-control": originCC, "content-type": "image/webp", vary: NEXT_VARY, age: "55" },
        }),
    );
    const upper = makeRealisticUpperTier(TIER_ENV);
    const t = tierCtx(upper.fetch);
    const headers = { accept: "image/webp", rsc: "1" };
    const first = await worker.fetch(new Request(posterUrl("?e=4"), { headers }), TIER_ENV, t.ctx);
    await t.flush();
    // Client-visible: exact origin policy + Age passthrough, no tier metadata.
    // (`Age: 55` here asserts header fidelity only: the Map stub has no
    // expiry semantics, so this is NOT a live expiration proof.)
    expect(first.headers.get("cache-control")).toBe(originCC);
    expect(first.headers.get("age")).toBe("55");
    expect(first.headers.get("vary")).toBe(NEXT_VARY);
    expect(first.headers.get("x-pictorium-tier-edge-cc")).toBeNull();
    expect(first.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(first.headers.get("x-pictorium-worker")).toBe("MISS");
    // The tier response is never duplicated into the manual cache, even
    // with `Age` present: repeats are served natively by the upper tier
    // (manual MISS) with identical headers, one inner run, one origin call.
    expect(store.size).toBe(0);
    const second = await worker.fetch(new Request(posterUrl("?e=4"), { headers }), TIER_ENV, t.ctx);
    await t.flush();
    expect(second.headers.get("x-pictorium-worker")).toBe("MISS");
    expect(second.headers.get("cache-control")).toBe(originCC);
    expect(second.headers.get("age")).toBe("55");
    expect(second.headers.get("x-pictorium-tier-edge-cc")).toBeNull();
    expect(second.headers.get("x-pictorium-tier-orig-cc")).toBeNull();
    expect(store.size).toBe(0);
    expect(upper.innerCalls()).toBe(1);
    expect(upper.originCalls()).toBe(1);
  });
});
