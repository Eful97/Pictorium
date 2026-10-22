/**
 * Generate the authoritative ordered IMDb Top 250 snapshot.
 *
 * Reads either the committed minimal fixture (`src/__tests__/fixtures/imdb-top250-chart.json`)
 * or an external user-provided IMDb chart HTML file (offline, never fetched),
 * strictly validates the complete ordered chart, and writes
 * `src/lib/imdb-top250-data.ts` (generated — never edit by hand).
 *
 * Usage:
 *   node scripts/write-imdb-top250-snapshot.mjs
 *   node scripts/write-imdb-top250-snapshot.mjs "C:\path\to\chart.htm" [--imported-on YYYY-MM-DD] [--write-fixture <fixture.json>] [--out src/lib/imdb-top250-data.ts]
 *   node scripts/write-imdb-top250-snapshot.mjs --fixture src/__tests__/fixtures/imdb-top250-chart.json
 *
 * Validation (all mandatory):
 * - exactly 250 entries, ranks exactly 1..250 each once (no missing/out-of-range);
 * - every id matches ^tt\d{7,8}$, all 250 unique (duplicates rejected);
 * - every row is a movie (titleType `movie` when present; tv rows rejected);
 * - partial pages, unknown markers, invalid ids and blocked (WAF) pages rejected;
 * - HTML input must carry the official canonical chart URL (`<link
 *   rel="canonical">`, fallback `og:url`) and it must be the Italian or the
 *   English Top chart (`https://www.imdb.com/it/chart/top/`,
 *   `https://www.imdb.com/chart/top/`) — any other page type pretending to be
 *   the chart is rejected;
 * - provenance metadata validated (allowlisted sourceUrl, sha256 shape,
 *   YYYY-MM-DD importedOn, UNKNOWN-or-date sourceGeneratedAt).
 *
 * Refresh workflow (keeps the minimal fixture consistent without ever
 * regenerating it from itself): re-run with the SAME external HTML plus an
 * explicit --imported-on and --write-fixture pointing at the committed
 * fixture path, then review the diff:
 *   node scripts/write-imdb-top250-snapshot.mjs "<external-HTML>" --imported-on <YYYY-MM-DD> --write-fixture src/__tests__/fixtures/imdb-top250-chart.json
 * The minimal fixture is a curated cache of the capture, never a second
 * source of truth — the external HTML capture stays authoritative.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURE = path.join(rootDir, "src", "__tests__", "fixtures", "imdb-top250-chart.json");
const DEFAULT_OUT = path.join(rootDir, "src", "lib", "imdb-top250-data.ts");
const TT_ID_RE = /^tt\d{7,8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Canonical Top chart URLs accepted as snapshot sources (Italian/English only). */
export const ALLOWED_CHART_URLS = [
  "https://www.imdb.com/it/chart/top/",
  "https://www.imdb.com/chart/top/",
];

function fail(msg) {
  console.error(`write-imdb-top250-snapshot: ${msg}`);
  process.exit(1);
}

export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function resolveImportedOn(explicit, fallback) {
  if (explicit !== undefined && explicit !== null) {
    if (!isValidDateString(explicit)) fail(`--imported-on must be YYYY-MM-DD (got ${JSON.stringify(explicit)})`);
    return explicit;
  }
  if (isValidDateString(fallback)) return fallback;
  if (fallback !== undefined && fallback !== null) {
    fail(`provenance importedOn must be YYYY-MM-DD (got ${JSON.stringify(fallback)})`);
  }
  // Fresh external captures default to today (UTC); pass --imported-on for a
  // reproducible run. Fixture runs always carry their committed date.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Comment titles are TS `//` comments: a CR/LF/U+2028/U+2029 in the source
 * title would escape the comment and generate executable code. Normalize to
 * one safe line (existing clean titles pass through byte-identical).
 */
export function sanitizeCommentTitle(title) {
  return String(title).replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

function normalizeChartUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const m = /^https:\/\/www\.imdb\.com\/(it\/)?chart\/top\/?$/.exec(trimmed);
  if (!m) return null;
  return `https://www.imdb.com/${m[1] ?? ""}chart/top/`;
}

/**
 * Official canonical chart URL of an HTML capture (`<link rel="canonical">`,
 * fallback `og:url`). Only the Italian/English Top chart is accepted — any
 * other page type (or a missing tag) fails closed.
 */
export function extractCanonicalChartUrl(html) {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href && normalizeChartUrl(href[1])) return normalizeChartUrl(href[1]);
  }
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/i.exec(html)
    ?? /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/i.exec(html);
  if (og) {
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(og[0]);
    if (content && normalizeChartUrl(content[1])) return normalizeChartUrl(content[1]);
  }
  return null;
}

export function validateProvenanceMeta(meta, sourceLabel) {
  if (!meta || typeof meta !== "object") fail(`${sourceLabel}: provenance metadata missing`);
  if (!ALLOWED_CHART_URLS.includes(meta.sourceUrl)) {
    fail(`${sourceLabel}: unexpected sourceUrl ${JSON.stringify(meta.sourceUrl)}`);
  }
  if (typeof meta.sourceFile !== "string" || meta.sourceFile.length === 0) {
    fail(`${sourceLabel}: invalid sourceFile`);
  }
  if (typeof meta.sourceSha256 !== "string" || !SHA256_RE.test(meta.sourceSha256)) {
    fail(`${sourceLabel}: invalid sourceSha256`);
  }
  if (!Number.isFinite(meta.sourceBytes) || meta.sourceBytes < 0) {
    fail(`${sourceLabel}: invalid sourceBytes`);
  }
  if (!isValidDateString(meta.importedOn)) {
    fail(`${sourceLabel}: invalid importedOn ${JSON.stringify(meta.importedOn)}`);
  }
  if (meta.sourceGeneratedAt !== "UNKNOWN" && !isValidDateString(meta.sourceGeneratedAt)) {
    fail(`${sourceLabel}: invalid sourceGeneratedAt ${JSON.stringify(meta.sourceGeneratedAt)}`);
  }
  return meta;
}

export function parseArgs(argv) {
  const out = { htmlPath: null, fixture: DEFAULT_FIXTURE, outPath: DEFAULT_OUT, importedOn: undefined, writeFixture: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") out.fixture = path.resolve(rootDir, argv[++i] ?? fail("missing --fixture value"));
    else if (a === "--out") out.outPath = path.resolve(rootDir, argv[++i] ?? fail("missing --out value"));
    else if (a === "--imported-on") out.importedOn = argv[++i] ?? fail("missing --imported-on value");
    else if (a === "--write-fixture") out.writeFixture = path.resolve(rootDir, argv[++i] ?? fail("missing --write-fixture value"));
    else if (a.startsWith("--")) fail(`unknown flag ${a}`);
    else if (!out.htmlPath) out.htmlPath = path.resolve(a);
    else fail(`unexpected arg ${a}`);
  }
  return out;
}

export function validateEntries(entries, sourceLabel) {
  if (!Array.isArray(entries) || entries.length !== 250) {
    fail(`${sourceLabel}: expected exactly 250 entries, got ${Array.isArray(entries) ? entries.length : typeof entries}`);
  }
  const seenRanks = new Set();
  const seenIds = new Set();
  for (const e of entries) {
    if (typeof e !== "object" || e === null) fail(`${sourceLabel}: entry is not an object`);
    const { rank, id, titleType } = e;
    if (!Number.isInteger(rank) || rank < 1 || rank > 250) {
      fail(`${sourceLabel}: rank out of range 1..250 (got ${JSON.stringify(rank)} for ${JSON.stringify(id)})`);
    }
    if (seenRanks.has(rank)) fail(`${sourceLabel}: duplicate rank ${rank}`);
    seenRanks.add(rank);
    if (typeof id !== "string" || !TT_ID_RE.test(id)) {
      fail(`${sourceLabel}: invalid IMDb id ${JSON.stringify(id)} at rank ${rank}`);
    }
    if (seenIds.has(id)) fail(`${sourceLabel}: duplicate IMDb id ${id}`);
    seenIds.add(id);
    if (titleType !== undefined && titleType !== null && titleType !== "movie") {
      fail(`${sourceLabel}: non-movie row rejected (rank ${rank} id ${id} type ${JSON.stringify(titleType)})`);
    }
    if (e.unknown === true) fail(`${sourceLabel}: unknown marker at rank ${rank}`);
  }
  for (let r = 1; r <= 250; r++) {
    if (!seenRanks.has(r)) fail(`${sourceLabel}: missing rank ${r}`);
  }
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  return ordered;
}

export function entriesFromFixture(fixturePath, explicitImportedOn) {
  if (!fs.existsSync(fixturePath)) fail(`fixture not found: ${fixturePath}`);
  const raw = fs.readFileSync(fixturePath, "utf8");
  let json;
  try { json = JSON.parse(raw); } catch { fail(`fixture is not valid JSON: ${fixturePath}`); }
  const ordered = validateEntries(json.entries, `fixture ${fixturePath}`);
  const meta = {
    sourceUrl: typeof json.sourceUrl === "string" ? json.sourceUrl : ALLOWED_CHART_URLS[0],
    // The fixture caches the original capture: keep ITS source identity
    // (capture filename/sha), not the fixture filename.
    sourceFile: typeof json.sourceFile === "string" ? json.sourceFile : path.basename(fixturePath),
    sourceSha256: typeof json.sourceSha256 === "string" ? json.sourceSha256 : crypto.createHash("sha256").update(raw).digest("hex"),
    sourceBytes: Number.isFinite(json.sourceBytes) ? json.sourceBytes : Buffer.byteLength(raw),
    importedOn: resolveImportedOn(explicitImportedOn, typeof json.importedOn === "string" ? json.importedOn : undefined),
    sourceGeneratedAt: typeof json.sourceGeneratedAt === "string" ? json.sourceGeneratedAt : "UNKNOWN",
  };
  validateProvenanceMeta(meta, `fixture ${fixturePath}`);
  return { ordered, meta };
}

export function entriesFromHtml(htmlPath, explicitImportedOn) {
  if (!fs.existsSync(htmlPath)) fail(`HTML input not found: ${htmlPath}`);
  const buf = fs.readFileSync(htmlPath);
  const html = buf.toString("utf8");
  const canonical = extractCanonicalChartUrl(html);
  if (!canonical) {
    fail(`HTML has no canonical Italian/English Top-chart URL (refusing unknown source): ${htmlPath}`);
  }
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const m = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!m) fail(`HTML has no __NEXT_DATA__ chart payload (refusing partial/unknown source): ${htmlPath}`);
  let json;
  try { json = JSON.parse(m[1]); } catch { fail(`HTML __NEXT_DATA__ is not valid JSON: ${htmlPath}`); }
  const edges = json?.props?.pageProps?.pageData?.chartTitles?.edges;
  if (!Array.isArray(edges)) fail(`HTML has no pageData.chartTitles.edges (refusing unknown layout): ${htmlPath}`);
  const entries = edges.map((e) => ({
    rank: e?.currentRank,
    id: e?.node?.id,
    originalTitle: e?.node?.originalTitleText?.text ?? null,
    title: e?.node?.titleText?.text ?? null,
    titleType: e?.node?.titleType?.id ?? e?.node?.titleType ?? null,
  }));
  const ordered = validateEntries(entries, `HTML ${htmlPath}`);
  const meta = {
    sourceUrl: canonical,
    sourceFile: path.basename(htmlPath),
    sourceSha256: sha,
    sourceBytes: buf.length,
    importedOn: resolveImportedOn(explicitImportedOn, undefined),
    sourceGeneratedAt: "UNKNOWN",
  };
  validateProvenanceMeta(meta, `HTML ${htmlPath}`);
  return { ordered, meta };
}

export function chartLanguageLabel(sourceUrl) {
  return sourceUrl.includes("/it/chart/top/") ? "Italian" : "English";
}

export function buildOutput(ordered, meta, command, sourceKindLabel) {
  const lines = [];
  lines.push("// AUTO-GENERATED by scripts/write-imdb-top250-snapshot.mjs — do not edit manually.");
  lines.push(`// Source: ${meta.sourceUrl} (${chartLanguageLabel(meta.sourceUrl)} chart, ${sourceKindLabel} "${meta.sourceFile}").`);
  lines.push(`// Imported on: ${meta.importedOn}; IMDb retrieval timestamp: ${meta.sourceGeneratedAt} (unknown unless the capture carries verifiable evidence).`);
  lines.push(`// Source SHA-256: ${meta.sourceSha256} (${meta.sourceBytes} bytes).`);
  lines.push(`// Reproduce: ${command} (fixture: src/__tests__/fixtures/imdb-top250-chart.json) or re-run with the same external HTML (SHA-256 above).`);
  lines.push(`// Absolute Cinema = movies ranked 1..100 of this ordered snapshot (rank 100 in, rank 101 out).`);
  lines.push(`export const IMDB_TOP_250_PROVENANCE = ${JSON.stringify(meta)} as const;`);
  lines.push("export const IMDB_TOP_250_ORDERED_IDS: readonly string[] = [");
  for (const e of ordered) {
    const label = typeof e.originalTitle === "string" && e.originalTitle ? ` // #${e.rank} ${sanitizeCommentTitle(e.originalTitle)}` : ` // #${e.rank}`;
    lines.push(`  "${e.id}",${label}`);
  }
  lines.push("];");
  lines.push("/** Legacy membership set (250 ids). Prefer rank-based helpers for new code. */");
  lines.push("export const IMDB_TOP_250_IDS = new Set<string>(IMDB_TOP_250_ORDERED_IDS);");
  lines.push("");
  return lines.join("\n");
}

export function buildFixtureJson(ordered, meta) {
  return JSON.stringify(
    {
      sourceUrl: meta.sourceUrl,
      sourceFile: meta.sourceFile,
      sourceSha256: meta.sourceSha256,
      sourceBytes: meta.sourceBytes,
      importedOn: meta.importedOn,
      sourceGeneratedAt: meta.sourceGeneratedAt,
      entries: ordered.map((e) => ({
        rank: e.rank,
        id: e.id,
        originalTitle: e.originalTitle ?? null,
        title: e.title ?? null,
        titleType: e.titleType ?? null,
      })),
    },
    null,
    2,
  ) + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { ordered, meta } = args.htmlPath
    ? entriesFromHtml(args.htmlPath, args.importedOn)
    : entriesFromFixture(args.fixture, args.importedOn);
  const sourceKindLabel = args.htmlPath ? "user-provided canonical HTML" : "minimal fixture of the user-provided canonical HTML";
  const extraFlags = [
    args.htmlPath ? `--imported-on ${meta.importedOn}` : null,
    args.writeFixture ? `--write-fixture ${path.relative(rootDir, args.writeFixture)}` : null,
  ].filter(Boolean).join(" ");
  const command = args.htmlPath
    ? `node scripts/write-imdb-top250-snapshot.mjs "<external-HTML>"${extraFlags ? ` ${extraFlags}` : ""}`
    : `node scripts/write-imdb-top250-snapshot.mjs`;
  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, buildOutput(ordered, meta, command, sourceKindLabel));
  if (args.writeFixture) {
    if (!args.htmlPath) fail("--write-fixture requires an external HTML input (never regenerate the fixture from itself)");
    fs.mkdirSync(path.dirname(args.writeFixture), { recursive: true });
    fs.writeFileSync(args.writeFixture, buildFixtureJson(ordered, meta));
  }
  console.log(JSON.stringify({ wrote: path.relative(rootDir, args.outPath), entries: ordered.length, rank1: ordered[0].id, rank100: ordered[99].id, rank101: ordered[100].id, rank250: ordered[249].id, sha: meta.sourceSha256 }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
