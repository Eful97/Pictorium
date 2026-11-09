#!/usr/bin/env node
/**
 * One-shot SVGO hygiene for the static SVG assets under `public/`.
 *
 * NOT part of the build: this is a manual operator tool. It never runs from
 * prebuild/CI. Runtime-generated SVG strings (badge/scrim/gradient builders)
 * are untouched: only files on disk under `public/` are processed.
 *
 * Safe in-place semantics: a file is overwritten only when the optimized
 * output is strictly smaller. Files that would grow (SVGO re-serialization on
 * already-tight icons) keep their original bytes. Work happens on a copy in
 * the OS temp directory, so the repository is never polluted with scratch
 * files.
 *
 * Usage:
 *   node scripts/optimize-svgs.mjs           # optimize in place
 *   node scripts/optimize-svgs.mjs --dry-run # report only, write nothing
 *
 * Requires network on first run: `npx --yes svgo@3.3.5` fetches the pinned
 * SVGO version into the npm cache (no dependency is added to package.json).
 * The visual contract is `svgo.config.mjs`; the gate is the visual suite.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVGO_VERSION = "3.3.5";
const CONFIG = path.join(ROOT, "svgo.config.mjs");
const DRY_RUN = process.argv.includes("--dry-run");

/** Directories (recursive) and root-level files that are in scope. */
const TARGET_DIRS = [
  "public/networks",
  "public/seasonal-frames",
  "public/awards",
  "public/quality-badges",
  "public/rating",
];
const TARGET_ROOT_GLOB = /^public\/[^/]+\.svg$/i;

async function walk(rel) {
  const out = [];
  const entries = await fs.readdir(path.join(ROOT, rel), { withFileTypes: true });
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(child)));
    else if (entry.name.toLowerCase().endsWith(".svg")) out.push(child);
  }
  return out;
}

async function collect() {
  const files = [];
  for (const dir of TARGET_DIRS) files.push(...(await walk(dir)));
  const publicEntries = await fs.readdir(path.join(ROOT, "public"), { withFileTypes: true });
  for (const entry of publicEntries) {
    const rel = `public/${entry.name}`;
    if (entry.isFile() && TARGET_ROOT_GLOB.test(rel)) files.push(rel);
  }
  return files.sort();
}

/** Cross-platform spawn (Node cannot spawn .cmd directly on Windows). */
function run(command, args) {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } else {
    execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
  }
}

async function main() {
  const files = await collect();
  if (files.length === 0) {
    console.log("No SVG assets found.");
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pictorium-svgo-"));
  try {
    for (const rel of files) {
      const dst = path.join(workDir, rel);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(path.join(ROOT, rel), dst);
    }

    for (const dir of TARGET_DIRS) {
      run("npx", ["--yes", `svgo@${SVGO_VERSION}`, "--config", CONFIG, "--folder", path.join(workDir, dir), "--recursive"]);
    }

    let kept = 0;
    let written = 0;
    let saved = 0;
    for (const rel of files) {
      const originalPath = path.join(ROOT, rel);
      const optimizedPath = path.join(workDir, rel);
      const original = (await fs.stat(originalPath)).size;
      const optimized = (await fs.stat(optimizedPath)).size;
      if (optimized >= original) {
        kept++;
        continue;
      }
      if (!DRY_RUN) await fs.copyFile(optimizedPath, originalPath);
      written++;
      saved += original - optimized;
    }

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}optimized=${written} kept=${kept} saved=${saved} bytes`,
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
