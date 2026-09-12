import { lookup } from "node:dns"
import { BlockList, isIP } from "node:net"
import { Agent, request } from "undici"
import { combineAbortSignals } from "../abort-signal"
import type { CustomRatingConfig, RatingItem } from "./types"

const blocked = new BlockList()
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix, "ipv4")
blocked.addSubnet("::", 96, "ipv6")
blocked.addSubnet("::ffff:0:0", 96, "ipv6")
blocked.addSubnet("fc00::", 7, "ipv6")
blocked.addSubnet("fe80::", 10, "ipv6")
blocked.addSubnet("ff00::", 8, "ipv6")
blocked.addSubnet("2001::", 32, "ipv6")
blocked.addSubnet("2002::", 16, "ipv6")
blocked.addSubnet("64:ff9b::", 96, "ipv6")

function publicAddress(address: string): boolean {
  const family = isIP(address)
  return !!family && !blocked.check(address, family === 4 ? "ipv4" : "ipv6")
}

// Validate the address used by the socket itself, preventing DNS rebinding.
const dispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, [])
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      return callback(new Error("Custom rating destination is not public"), [])
    }
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
} } })

export async function fetchCustomRatings(imdbId: string | null | undefined, config: CustomRatingConfig, signal?: AbortSignal): Promise<RatingItem[]> {
  if (!config.enabled || !imdbId || !/^tt\d+$/.test(imdbId) || signal?.aborted) return []
  try {
    if (!config.endpoint.includes("{imdbId}")) return []
    const url = new URL(config.endpoint.replaceAll("{imdbId}", imdbId))
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return []
    if (config.apiKey && url.protocol !== "https:") return []
    const host = url.hostname.replace(/^\[|\]$/g, "")
    if (isIP(host) && !publicAddress(host)) return []
    const headers: Record<string, string> = { accept: "application/json" }
    if (config.apiKey) headers[config.apiKeyHeader || "X-API-Key"] = config.apiKey
    const response = await request(url, {
      dispatcher, headers, signal: combineAbortSignals(signal, 1500),
      // undici.request does not follow redirects (no redirect interceptor).
      headersTimeout: 1500, bodyTimeout: 1500,
    })
    try {
      if (response.statusCode < 200 || response.statusCode >= 300) return []
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 16 * 1024) return []
        chunks.push(Buffer.from(chunk))
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!data || typeof data !== "object" || !("ratings" in data) || !Array.isArray(data.ratings)) return []
      const ratings = new Map<string, RatingItem>()
      for (const item of data.ratings) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue
        const { id, name, value, format } = item
        if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim()) continue
        if (typeof value !== "number" || !Number.isFinite(value)) continue
        if (format !== "decimal" && format !== "percent") continue
        // Last valid value wins; retain the first occurrence's position.
        ratings.set(id.trim(), { id: id.trim(), name: name.trim(), value, format })
      }
      return [...ratings.values()]
    } finally {
      response.body.destroy()
    }
  } catch {
    return []
  }
}
