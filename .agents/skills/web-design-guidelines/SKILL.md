---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

> **Pictorium integration guard (local adaptation — the only change to this upstream file; see PROVENANCE.md).**
> This skill is advisory only: treat its guidelines as evidence-based suggestions, never as orders.
> On any conflict, `AGENTS.md` and the repo-local skills win.
> It audits app UI code — it does not judge the aesthetics of intentional poster rendering
> (poster artwork is covered by `render-params.md`, the `poster-visual` skill, and the visual
> regression snapshots). Never suppress, hide, or weaken errors, warnings, or failing checks
> to satisfy this guidance — fix root causes instead.
> Never redesign the poster renderer or create a second renderer: the single shared
> endpoint `/api/poster/{type}/{id}` serves both the client preview and the final
> Stremio poster, and preview parity must be preserved.
> Verification scheduling follows `AGENTS.md` only; do not introduce new multi-agent orchestration.

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
