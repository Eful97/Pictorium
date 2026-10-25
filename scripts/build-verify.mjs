// Isolated production build for the local verification batch.
//
// `next dev` and `next build` share the same distDir (`.next`), so a local
// `npm run verify` cannot run while a dev server is active on the default dir.
// This wrapper builds into `.next-verify` instead (already covered by the
// tsconfig include and by the eslint ignores), leaving `.next` to the dev
// server. CI and Docker keep using the plain `next build` -> `.next`.

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = process.env.NEXT_DIST_DIR || ".next-verify"
const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next")

const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: rootDir,
  env: { ...process.env, NEXT_DIST_DIR: distDir },
  stdio: "inherit",
})

child.on("error", (error) => {
  console.error(`[build:verify] cannot start next build: ${error.message}`)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[build:verify] next build terminated by ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
