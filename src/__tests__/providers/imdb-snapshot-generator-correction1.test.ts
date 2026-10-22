import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "write-imdb-top250-snapshot.mjs");
const COMMITTED_FIXTURE = path.join(ROOT, "src", "__tests__", "fixtures", "imdb-top250-chart.json");

type Entry = { rank: number; id: string; originalTitle: string; title: string; titleType: string };

function tt(n: number): string {
  return `tt${String(n).padStart(7, "0")}`;
}

function baseEntries(): Entry[] {
  return Array.from({ length: 250 }, (_, i) => ({
    rank: i + 1,
    id: tt(4000000 + i),
    originalTitle: `Synthetic Title ${i + 1}`,
    title: `Titolo ${i + 1}`,
    titleType: "movie",
  }));
}

function htmlFromEntries(entries: Entry[], canonical = "https://www.imdb.com/it/chart/top/"): string {
  const edges = entries.map((e) => ({
    currentRank: e.rank,
    node: {
      id: e.id,
      titleType: { id: e.titleType },
      originalTitleText: { text: e.originalTitle },
      titleText: { text: e.title },
    },
  }));
  const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });
  return `<html><head><link rel="canonical" href="${canonical}"></head><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "imdb-gen-c1-"));
}

function runGen(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout: String(stdout), stderr: "" };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; status?: unknown };
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

function sha(b: Buffer | string): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

describe("correction1: snapshot generator reproducibility/provenance/safety", () => {
  it("rejects duplicates, partial pages, non-movie rows, missing ranks and WAF pages", () => {
    const dir = tmpDir();
    const dupes = baseEntries();
    dupes[249] = { ...dupes[0], rank: 250 };
    const dupHtml = path.join(dir, "dup.htm");
    fs.writeFileSync(dupHtml, htmlFromEntries(dupes));
    expect(runGen([dupHtml, "--out", path.join(dir, "o.ts"), "--imported-on", "2026-10-22"]).ok).toBe(false);

    const partial = baseEntries().slice(0, 200);
    const partHtml = path.join(dir, "part.htm");
    fs.writeFileSync(partHtml, htmlFromEntries(partial));
    expect(runGen([partHtml, "--out", path.join(dir, "o2.ts"), "--imported-on", "2026-10-22"]).ok).toBe(false);

    const tv = baseEntries();
    tv[10] = { ...tv[10], titleType: "tvSeries" };
    const tvHtml = path.join(dir, "tv.htm");
    fs.writeFileSync(tvHtml, htmlFromEntries(tv));
    expect(runGen([tvHtml, "--out", path.join(dir, "o3.ts"), "--imported-on", "2026-10-22"]).ok).toBe(false);

    const missing = baseEntries().filter((e) => e.rank !== 5);
    const missHtml = path.join(dir, "miss.htm");
    fs.writeFileSync(missHtml, htmlFromEntries(missing));
    expect(runGen([missHtml, "--out", path.join(dir, "o4.ts"), "--imported-on", "2026-10-22"]).ok).toBe(false);

    const wafHtml = path.join(dir, "waf.htm");
    fs.writeFileSync(wafHtml, "<html><body><div id='challenge'>waf</div></body></html>");
    expect(runGen([wafHtml, "--out", path.join(dir, "o5.ts"), "--imported-on", "2026-10-22"]).ok).toBe(false);
  });

  it("rejects a non-canonical chart source pretending to be the Top chart", () => {
    const dir = tmpDir();
    const htmlPath = path.join(dir, "bottom.htm");
    fs.writeFileSync(htmlPath, htmlFromEntries(baseEntries(), "https://www.imdb.com/chart/bottom/"));
    const r = runGen([htmlPath, "--out", path.join(dir, "o.ts"), "--imported-on", "2026-10-22"]);
    expect(r.ok).toBe(false);
  });

  it("accepts only the canonical Italian/English Top chart URLs", () => {
    for (const canonical of ["https://www.imdb.com/it/chart/top/", "https://www.imdb.com/chart/top/"]) {
      const dir = tmpDir();
      const htmlPath = path.join(dir, "ok.htm");
      fs.writeFileSync(htmlPath, htmlFromEntries(baseEntries(), canonical));
      const out = path.join(dir, "o.ts");
      const r = runGen([htmlPath, "--out", out, "--imported-on", "2026-10-22"]);
      expect(r.ok).toBe(true);
      const content = fs.readFileSync(out, "utf8");
      expect(content).toContain(`"sourceUrl":"${canonical}"`);
      expect(content).toContain('"sourceGeneratedAt":"UNKNOWN"');
    }
  });

  it("normalizes multiline comment titles to one safe line (no executable TS)", () => {
    const dir = tmpDir();
    const entries = baseEntries();
    entries[0] = { ...entries[0], originalTitle: "Bad\nTitle\u2028X\r\n// evil" };
    const htmlPath = path.join(dir, "ml.htm");
    fs.writeFileSync(htmlPath, htmlFromEntries(entries));
    const out = path.join(dir, "o.ts");
    const r = runGen([htmlPath, "--out", out, "--imported-on", "2026-10-22"]);
    expect(r.ok).toBe(true);
    const content = fs.readFileSync(out, "utf8");
    expect(content).not.toContain("\u2028");
    const idLine = content.split("\n").filter((l) => l.includes(`"${entries[0].id}"`));
    expect(idLine).toHaveLength(1);
    expect(idLine[0]).toContain("Bad Title X");
    expect(idLine[0]).not.toContain("// evil\n");
  });

  it("validates the --imported-on date instead of hardcoding it", () => {
    const dir = tmpDir();
    const htmlPath = path.join(dir, "d.htm");
    fs.writeFileSync(htmlPath, htmlFromEntries(baseEntries()));
    expect(runGen([htmlPath, "--out", path.join(dir, "o.ts"), "--imported-on", "not-a-date"]).ok).toBe(false);
    expect(runGen([htmlPath, "--out", path.join(dir, "o.ts"), "--imported-on", "2026-13-40"]).ok).toBe(false);
  });

  it("is deterministic for the same inputs with an explicit date", () => {
    const dir = tmpDir();
    const htmlPath = path.join(dir, "det.htm");
    fs.writeFileSync(htmlPath, htmlFromEntries(baseEntries()));
    const out1 = path.join(dir, "o1.ts");
    const out2 = path.join(dir, "o2.ts");
    expect(runGen([htmlPath, "--out", out1, "--imported-on", "2026-10-22"]).ok).toBe(true);
    expect(runGen([htmlPath, "--out", out2, "--imported-on", "2026-10-22"]).ok).toBe(true);
    expect(sha(fs.readFileSync(out1))).toBe(sha(fs.readFileSync(out2)));
  });

  it("keeps the committed minimal fixture regen exact and deterministic", () => {
    const dir = tmpDir();
    const out1 = path.join(dir, "f1.ts");
    const out2 = path.join(dir, "f2.ts");
    expect(runGen(["--fixture", COMMITTED_FIXTURE, "--out", out1]).ok).toBe(true);
    expect(runGen(["--fixture", COMMITTED_FIXTURE, "--out", out2]).ok).toBe(true);
    const b1 = fs.readFileSync(out1);
    const b2 = fs.readFileSync(out2);
    expect(sha(b1)).toBe(sha(b2));
    const content = b1.toString("utf8");
    expect(content).toContain('"importedOn":"2026-10-22"');
    expect(content).toContain('"sourceGeneratedAt":"UNKNOWN"');
  });
});
