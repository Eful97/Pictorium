import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const DISCORD_MAX_LENGTH = 2000
export const DEFAULT_AVATAR_URL =
  "https://raw.githubusercontent.com/Eful97/Pictorium/master/public/icon-192.png"
export const DEFAULT_USERNAME = "Pictorium Releases"

/**
 * Pure: formats the Discord webhook JSON payload.
 * Truncates notes gracefully if total length exceeds Discord's 2000 character limit.
 */
export function formatDiscordPayload({
  tag,
  repo = "",
  notes = "",
  avatarUrl = DEFAULT_AVATAR_URL,
  username = DEFAULT_USERNAME,
}) {
  const cleanTag = tag ? (tag.startsWith("v") ? tag : `v${tag}`) : ""
  const title = cleanTag ? `# 🚀 Pictorium ${cleanTag} is now available!\n\n` : "# 🚀 New Pictorium Release!\n\n"
  const releaseUrl = repo && cleanTag ? `https://github.com/${repo}/releases/tag/${cleanTag}` : ""
  const footer = releaseUrl ? `\n\n🔗 **GitHub Release**: ${releaseUrl}` : ""

  const overhead = title.length + footer.length
  const maxNotesLen = DISCORD_MAX_LENGTH - overhead

  let body = notes.trim()

  if (title.length + body.length + footer.length > DISCORD_MAX_LENGTH) {
    const truncationNotice = "\n\n*(...and more, see full release notes)*"
    const allowedBodyLen = maxNotesLen - truncationNotice.length
    if (allowedBodyLen > 0) {
      body = body.slice(0, allowedBodyLen)
      const lastNewline = body.lastIndexOf("\n")
      if (lastNewline > 50) {
        body = body.slice(0, lastNewline)
      }
      body += truncationNotice
    } else {
      body = truncationNotice.trim()
    }
  }

  return {
    content: `${title}${body}${footer}`,
    username,
    avatar_url: avatarUrl,
  }
}

export async function sendDiscordNotification({ webhookUrl, payload, fetchImpl = fetch }) {
  const res = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Discord webhook returned HTTP ${res.status} ${res.statusText}: ${errorText}`)
  }

  return true
}

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim()
  if (!webhookUrl) {
    console.log("[discord] DISCORD_WEBHOOK_URL not set — skipping Discord notification")
    process.exit(0)
  }

  const notesPath = process.argv[2] || "/tmp/notes.md"
  let notes = ""
  try {
    notes = await fs.readFile(notesPath, "utf-8")
  } catch (err) {
    console.error(`[discord] cannot read release notes from ${notesPath}: ${err.message}`)
    process.exit(1)
  }

  const tag = process.env.RELEASE_TAG || process.argv[3] || ""
  const repo = process.env.GITHUB_REPOSITORY || ""

  const payload = formatDiscordPayload({ tag, repo, notes })

  try {
    await sendDiscordNotification({ webhookUrl, payload })
    console.log("[discord] Successfully posted release announcement to Discord!")
  } catch (err) {
    console.error(`[discord] Failed to send webhook: ${err.message}`)
    process.exit(1)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error("[discord] Unexpected error:", err)
    process.exit(1)
  })
}
