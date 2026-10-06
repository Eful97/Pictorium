// Local-only types for standalone `*.mjs` worker scripts (no tsconfig change).
// Wildcard form: ambient declarations cannot use relative module names
// (TS2436), and this keeps real (non-any) shapes for the worker import.
declare module "*cloudflare-poster-worker.mjs" {
  export const DEFAULT_ORIGIN_URL: string;

  export interface OriginResolution {
    readonly ok: boolean;
    readonly origin?: string;
    readonly reason?: string;
  }

  export type WorkerEnv = { readonly ORIGIN_URL?: string } | null | undefined;
  export interface WorkerCtx {
    waitUntil(promise: Promise<unknown>): void;
  }

  export function resolveOrigin(env: WorkerEnv): OriginResolution;
  export function buildTarget(requestUrl: URL, origin: string): URL;
  export function sortedQueryString(searchParams: URLSearchParams): string;
  export function cacheKeyFor(
    request: Request,
    target: URL,
    sortedQuery: string,
  ): Promise<{ readonly key: Request; readonly rawAccept: string }>;
  export function bypassReason(request: Request, url: URL): string | null;
  export function sharedTtlSec(cacheControlValue: string | null): number | undefined;
  export function isCacheableResponse(response: Response): boolean;
  export function varyAllowsStorage(response: Response): boolean;
  export function storageHeaders(response: Response): Headers;

  const worker: {
    fetch(request: Request, env?: WorkerEnv, ctx?: WorkerCtx): Promise<Response>;
  };
  export default worker;
}
