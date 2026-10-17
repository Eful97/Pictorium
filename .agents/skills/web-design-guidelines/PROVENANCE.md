# Provenance — web-design-guidelines (Pictorium local copy)

- Upstream source: https://github.com/vercel-labs/agent-skills
- Pinned commit: `063bee94c3f4df8453406c830b0a7df0f2860278`
- Upstream path: `skills/web-design-guidelines/` (`SKILL.md` only)
- Installed as: `.agents/skills/web-design-guidelines/`
- License: MIT (per upstream root `README.md` "## License" section; no
  `LICENSE` file ships in the upstream repo at this commit)
- Contents: `SKILL.md` only. No upstream scripts exist in this skill
  directory, none were executed; the `skills/web-design-guidelines.zip`
  build artifact was intentionally not installed.
- Local adaptation: ONLY the `SKILL.md` entrypoint gained a clearly marked
  "Pictorium integration guard" blockquote directly after the frontmatter
  (frontmatter untouched). The remainder of the file is byte-identical to
  upstream (verified with `git diff --no-index` against the pinned-commit
  tarball: the diff is exactly the guard insertion).

SHA-256 (installed file, guard included):

- `SKILL.md` (guarded): `EFCA2D8D71BC1292F3825F45FBA3A0D7BE3ECBD180AA57FFF0F4FD31FDB98A56`
  (upstream unguarded: `F4647CA866A3ACCF763777F83E7682954F0187CD6BEA7EEA0399796652414E8F`)
