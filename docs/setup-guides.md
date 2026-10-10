# Pictorium setup guides

Three detailed, step-by-step English guides. Pick the one that matches where
you want Pictorium artwork to appear. Each guide is a single Markdown file
you can read here or share as an attachment.

## Which guide do I need?

| If you want... | Read this guide |
|---|---|
| Pictorium as its own Stremio addon (poster cards, badges, plus optional Pictorium catalog rows inside Stremio) | [Pictorium as a Stremio addon](./discord-stremio-addon-guide.md) |
| Your Pictorium artwork inside your existing AIOMetadata setup (same AIO catalogs and order, only the artwork URLs change; portrait or landscape picked per catalog) | [Pictorium posters in AIOMetadata](./discord-aiometadata-guide.md) |
| Your Pictorium artwork inside Nuvio (same Nuvio catalogs and order, only the poster image URLs change via the Poster URL template) | [Pictorium posters in Nuvio](./discord-nuvio-guide.md) |

## Reading on GitHub

GitHub readers can just open and read the full guide files above — no
copying needed. Sources and version notes live in the appendix of each file.
You can also download a guide file and keep it with your setup notes.

## Sharing on Discord

To share a guide on Discord, attach the guide's `.md` file to your message:

- Attach the Markdown file itself — readers download it and read the full
  guide, appendix included.
- For a web-readable version, link to the full guide files on GitHub (paths
  in the table above).

## Version and client notes

- AIOMetadata: the AIO steps were verified against AIOMetadata's current
  dev-branch source (checked Oct 2026). Your hosted AIO build may label,
  move, or lack a control — that is version drift, not user error. Adapt to
  what you see on your build.
- Nuvio: shape is requested per view through the literal `shape={shape}`
  placeholder in the Poster URL template, so each Nuvio view gets the art it
  asked for. Whether wide cards are shown also depends on Nuvio's own layout
  settings (e.g. Landscape Posters) on your client and version.
- Stremio addon: the Pictorium addon works like any other Stremio addon and
  syncs through your Stremio account to your logged-in clients. Install it
  from a browser or Stremio Web while logged in, then confirm it under
  Addons → Installed.
