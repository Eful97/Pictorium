import { promises as fsp } from "node:fs"

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/**
 * Opt-in bounded retry for transient Windows share-lock failures.
 *
 * Proven context (F5 raw-OS probe): on Windows, `rename(tmp, target)` fails
 * with EPERM/EBUSY/EACCES whenever ANY handle on the target is open at that
 * instant (200/200 renames over an open reader failed; 300/300 sequential
 * renames succeeded, so dir/permissions are not the cause). A concurrent
 * reader (store reads run outside the write mutex, AV/indexer, dev watcher)
 * can therefore fail one rename out of back-to-back saves.
 *
 * Bounds (no random sleep fix): `attempts` total rename tries (clamped
 * 1..10), `delayMs` fixed pause between tries (clamped 0..250ms). The SAME
 * completed tmp is reused on every try (written once, never rewritten), the
 * target is never unlinked before a successful replace, and exhaustion
 * unlinks the tmp and throws the last error (fail-closed, last-good target
 * intact). EXDEV keeps the legacy copy+unlink fallback (a permanent
 * cross-device condition: retrying is pointless) and is never retried;
 * any other error throws after the first try with tmp cleanup.
 *
 * Windows-only in production: the retry engages only when
 * `process.platform === "win32"` (on POSIX rename-over-open succeeds
 * atomically, so these codes mean a genuine permanent failure there).
 * `__testForce` is a test-only escape hatch so the committed regression
 * tests stay deterministic on any OS; the preset store never sets it.
 */
export interface AtomicWriteRetryOptions {
  attempts?: number
  delayMs?: number
  /** Test-only: engage the Windows-only gate off win32. Never set in prod. */
  __testForce?: boolean
}

export interface AtomicWriteOptions {
  mode?: number
  renameRetry?: AtomicWriteRetryOptions
}

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"])

function normalizeRetry(retry: AtomicWriteRetryOptions | undefined): {
  attempts: number
  delayMs: number
  enabled: boolean
} {
  if (!retry) return { attempts: 1, delayMs: 0, enabled: false }
  const attempts = Math.min(Math.max(Math.floor(retry.attempts ?? 1), 1), 10)
  const delayMs = Math.min(Math.max(retry.delayMs ?? 25, 0), 250)
  const enabled =
    attempts > 1 && (process.platform === "win32" || retry.__testForce === true)
  return { attempts, delayMs, enabled }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Scrittura file atomica: tmp nella STESSA directory del target (stesso
 * filesystem → rename atomica) + rename. Su EXDEV (HF Storage FUSE con mount
 * diversi) fallback copy+unlink, come già in store.ts/flixpatrol.ts.
 * `mode` opzionale per preservare 0o600 sui file di segreti.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  options?: AtomicWriteOptions,
): Promise<void> {
  const retry = normalizeRetry(options?.renameRetry)
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fsp.writeFile(tmp, data, options?.mode !== undefined ? { mode: options.mode } : {})
  for (let attempt = 1; ; attempt++) {
    try {
      await fsp.rename(tmp, filePath)
      return
    } catch (e) {
      if (isNodeError(e) && e.code === "EXDEV") {
        await fsp.copyFile(tmp, filePath)
        await fsp.unlink(tmp).catch(() => {})
        return
      }
      const transient =
        retry.enabled && isNodeError(e) && TRANSIENT_RENAME_CODES.has(e.code ?? "")
      if (transient && attempt < retry.attempts) {
        await sleep(retry.delayMs)
        continue
      }
      await fsp.unlink(tmp).catch(() => {})
      throw e
    }
  }
}
