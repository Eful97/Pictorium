import { NextResponse } from "next/server"

/**
 * JSON API response. Compression is delegated to the Next.js server, which
 * negotiates `Accept-Encoding` itself: manually gzipping here produced a body
 * the server no longer frames correctly on Next >= 16.4.5 (the `Content-Encoding`
 * header is dropped, or the body is compressed a second time), so clients
 * received binary garbage and `JSON.parse` failed. `Vary: Accept-Encoding` is
 * kept so caches still separate the negotiated representations.
 *
 * The `acceptEncoding` argument is retained for the call sites (they pass the
 * request header positionally); the server makes the decision now.
 */
export function jsonGzip(data: unknown, status = 200, extraHeaders?: Record<string, string>, _acceptEncoding?: string | null): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Vary": "Accept-Encoding", ...extraHeaders },
  })
}
