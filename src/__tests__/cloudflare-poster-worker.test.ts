// Standalone edge-worker tests: mocks `caches`/`fetch`/ctx, no live network.
// Covers key isolation, conservative bypasses and response cacheability.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import worker, {
  buildTarget,
  bypassReason,
  cacheKeyFor,
  isCacheableResponse,
  resolveOrigin,
  sharedTtlSec,
  sortedQueryString,
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
