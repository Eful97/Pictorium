import { describe, expect, it } from "vitest"
import { lookupAVSpecs, isVideoFormat, KNOWN_VIDEO_FORMATS, FORMAT_ICON_PATHS } from "@/lib/av-specs"
import { REVIEWED832_APPROVED, REVIEWED832_SCOPE, REVIEWED_APPROVED, REVIEWED_EXCLUDED, REVIEWED_SCOPE, REVIEWED_SNAPSHOT_SHA256 } from "../../../scripts/torrentio-av-import.mjs"
import { renderQualityBadgeGroup, renderQualityIconBadge } from "@/lib/poster-service"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

const ROOT = path.resolve(__dirname, "../../..")

describe("av-specs lookup", () => {
  it("resolves specs for known blockbusters with 4K and formats", () => {
    // Dune Part Two (+ union-832 declared generic HDR: title-edition union,
    // user-accepted; not a same-stream claim).
    const dune = lookupAVSpecs("tt15239678")
    expect(dune).not.toBeNull()
    expect(dune?.quality).toBe("4K")
    expect(dune?.formats).toContain("dv")
    expect(dune?.formats).toContain("atmos")
    expect(dune?.formats).toContain("imax")
    expect(dune?.formats).toContain("hdr")

    // Oppenheimer (+ union-832 declared DV/HDR: title-edition union,
    // user-accepted; not a same-stream claim).
    const opp = lookupAVSpecs("tt15398776")
    expect(opp).not.toBeNull()
    expect(opp?.quality).toBe("4K")
    expect(opp?.formats).toContain("imax")
    expect(opp?.formats).toContain("dv")
    expect(opp?.formats).toContain("hdr")
  })

  it("Interstellar carries curated IMAX + HDR plus the union-832 declared set; Dune unchanged + union hdr", () => {
    // Interstellar 4K disc is HDR10 (HighDefWatch review, article 2024-12-20):
    // hdr added next to the pre-existing imax. Union-832 (user-accepted,
    // title-edition union) declared tags (DV/HDR10+/Atmos) accepted as
    // union, not independently corroborated — kept as an additive edition
    // union, not a same-disc claim.
    const interstellar = lookupAVSpecs("tt0816692")
    expect(interstellar).not.toBeNull()
    expect(interstellar?.quality).toBe("4K")
    expect(interstellar?.formats).toEqual(["imax", "hdr", "dv", "hdr10plus", "atmos"])

    // Control entry: Dune Part One keeps its curated DV/Atmos/IMAX set plus
    // the union-832 declared generic HDR.
    const dune = lookupAVSpecs("tt1160419")
    expect(dune).not.toBeNull()
    expect(dune?.quality).toBe("4K")
    expect(dune?.formats).toEqual(["dv", "atmos", "imax", "hdr"])
  })

  it("batch 1 corroborated additions (hdr10plus x3, atmos x3); union-832 hdr where declared", () => {
    // Corroborated HDR10+: each Back to the Future film's own 4K edition page lists
    // "HDR: Dolby Vision, HDR10+" with "English: Dolby Atmos" (blu-ray.com 255542 /
    // 255544 / 255546; Liebman reviews 2020-10-18). Per-film pages, no set inference.
    // Union-832 (user-accepted title-edition union) declares generic HDR for
    // tt0088763 only; tt0096874/tt0099088 had no Torrentio delta and stay curated.
    expect(lookupAVSpecs("tt0088763")?.formats).toEqual(["dv", "atmos", "hdr10plus", "hdr"])
    for (const id of ["tt0096874", "tt0099088"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toContain("dv")
      expect(specs?.formats).toContain("atmos")
      expect(specs?.formats).toContain("hdr10plus")
    }

    // Corroborated Atmos, each pre-existing dv preserved:
    // Parasite (Universal 4K specs list "Korean: Dolby Atmos", Liebman review
    // 2020-06-06), Jurassic Park (2026 Universal remaster specs + studio
    // announcement 2026-01-23: new DV grades and Atmos tracks), Dead Poets
    // Society (Disney 2026-09-29 4K specs list English Atmos, Kauffman review
    // 2026-09-26). Union-832 adds declared generic HDR to all three.
    for (const id of ["tt6751668", "tt0107290", "tt0097165"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "atmos", "hdr"])
    }

    // Candidates not corroborated for the checked edition stay byte-identical,
    // except where union-832 declares generic HDR (additive edition union, no
    // broader claim about other editions/platforms).
    expect(lookupAVSpecs("tt10366206")?.formats).toEqual(["dv", "atmos", "hdr"])
    expect(lookupAVSpecs("tt10838180")?.formats).toEqual(["dv", "atmos", "hdr"])
    expect(lookupAVSpecs("tt10872600")?.formats).toEqual(["dv", "atmos", "imax", "hdr"])
    expect(lookupAVSpecs("tt0112641")?.formats).toEqual(["dv", "hdr"])
  })

  it("batch 2 corroborated additions (hdr10plus x3, atmos x1); union-832 declared deltas additive", () => {
    // Corroborated HDR10+, pre-existing tokens preserved:
    // The Shining (US 2019 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/The-Shining-4K-Blu-ray/238513/),
    // The Suicide Squad (US 2021 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/The-Suicide-Squad-4K-Blu-ray/295757/),
    // 1917 (US 2020 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/1917-4K-Blu-ray/259242/).
    // Union-832 (user-accepted title-edition union) adds declared generic HDR
    // to each corroborated row below, preserving the curated tokens.
    expect(lookupAVSpecs("tt0081505")?.formats).toEqual(["dv", "hdr10plus", "hdr"])
    expect(lookupAVSpecs("tt6334354")?.formats).toEqual(["dv", "atmos", "imax", "hdr10plus", "hdr"])
    expect(lookupAVSpecs("tt8579674")?.formats).toEqual(["dv", "atmos", "imax", "hdr10plus", "hdr"])

    // Corroborated Atmos, pre-existing dv preserved:
    // The Truman Show (25th Anniversary 4K specs list "English: Dolby Atmos",
    // https://www.blu-ray.com/movies/The-Truman-Show-4K-Blu-ray/336821/).
    // Union-832 adds declared generic HDR.
    expect(lookupAVSpecs("tt0120382")?.formats).toEqual(["dv", "atmos", "hdr"])

    // Candidates not corroborated for the checked edition stay byte-identical,
    // except where union-832 declares generic HDR or Atmos (additive edition
    // union, no broader claim about other editions/platforms).
    expect(lookupAVSpecs("tt0103064")?.formats).toEqual(["dv", "hdr"])
    expect(lookupAVSpecs("tt3397884")?.formats).toEqual(["dv", "atmos", "hdr"])
    expect(lookupAVSpecs("tt0117060")?.formats).toEqual(["dv", "hdr"])
    expect(lookupAVSpecs("tt1229238")?.formats).toEqual(["dv", "imax", "hdr"])

    // Identity-flagged pages (edition imdb link mismatches the candidate id)
    // stay untouched pending operator resolution, never guessed — except for
    // the union-832 declared deltas below (user-accepted edition union).
    expect(lookupAVSpecs("tt0414387")?.formats).toEqual(["dv", "hdr", "atmos"])
    expect(lookupAVSpecs("tt0892791")?.formats).toEqual(["dv", "hdr", "atmos"])
  })

  it("batch 3 corroborated additions (atmos x17); union-832 declared deltas additive", () => {
    // Corroborated Atmos, pre-existing dv preserved (all "English: Dolby Atmos"
    // on each title's own 4K edition page, identity + past street date gated):
    // The Dark Crystal (Anniversary 4K https://www.blu-ray.com/movies/The-Dark-Crystal-4K-Blu-ray/195134/),
    // Tootsie (https://www.blu-ray.com/movies/Tootsie-4K-Blu-ray/366189/),
    // Ghostbusters (https://www.blu-ray.com/movies/Ghostbusters-4K-Blu-ray/151359/),
    // The Karate Kid (35th Anniversary 4K https://www.blu-ray.com/movies/The-Karate-Kid-4K-Blu-ray/227191/),
    // The Natural (https://www.blu-ray.com/movies/The-Natural-4K-Blu-ray/237391/),
    // A Nightmare on Elm Street (https://www.blu-ray.com/movies/A-Nightmare-on-Elm-Street-4K-Blu-ray/367160/),
    // The Terminator (40th Anniversary 4K https://www.blu-ray.com/movies/The-Terminator-4K-Blu-ray/369248/),
    // Fright Night (SteelBook-only 4K https://www.blu-ray.com/movies/Fright-Night-4K-Blu-ray/320147/),
    // Out of Africa (40th Anniversary 4K https://www.blu-ray.com/movies/Out-of-Africa-4K-Blu-ray/396916/),
    // Pale Rider (https://www.blu-ray.com/movies/Pale-Rider-4K-Blu-ray/382393/),
    // Silverado (SteelBook-only 40th Anniversary 4K https://www.blu-ray.com/movies/Silverado-4K-Blu-ray/392589/),
    // Ferris Bueller's Day Off (https://www.blu-ray.com/movies/Ferris-Buellers-Day-Off-4K-Blu-ray/339081/),
    // Stand by Me (https://www.blu-ray.com/movies/Stand-by-Me-4K-Blu-ray/243031/),
    // Dirty Dancing (35th Anniversary 4K https://www.blu-ray.com/movies/Dirty-Dancing-4K-Blu-ray/319254/),
    // Lethal Weapon (https://www.blu-ray.com/movies/Lethal-Weapon-4K-Blu-ray/387483/),
    // RoboCop (Arrow Limited Edition 4K https://www.blu-ray.com/movies/RoboCop-4K-Blu-ray/307415/),
    // Beetlejuice (https://www.blu-ray.com/movies/Beetlejuice-4K-Blu-ray/270987/).
    // Beetlejuice (https://www.blu-ray.com/movies/Beetlejuice-4K-Blu-ray/270987/).
    // Union-832 (user-accepted title-edition union) adds declared generic HDR
    // to sixteen of the seventeen rows; Ghostbusters (tt0087332) carries the
    // union-declared HDR10+ instead (one of the 10 authorized prev-conflicts).
    for (const id of ["tt0083791", "tt0084805", "tt0087538", "tt0087781", "tt0087800", "tt0088247", "tt0089175", "tt0089755", "tt0089767", "tt0090022", "tt0091042", "tt0092005", "tt0092890", "tt0093409", "tt0093870", "tt0094721"]) {
      expect(lookupAVSpecs(id)?.formats).toEqual(["dv", "atmos", "hdr"])
    }
    expect(lookupAVSpecs("tt0087332")?.formats).toEqual(["dv", "atmos", "hdr10plus"])

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms): hdr10plus negatives
    // (Escape from New York, Aliens, Prestige-correct-id, Nope), First Blood
    // (atmos sought; DTS-HD MA 5.1 only), Pusher III (Norway edition deferred),
    // Day of the Dead (Collector's edition deferred). Nope/Dunkirk keep imax.
    // Union-832 declared deltas below are additive edition unions, not
    // re-curations of these negatives.
    expect(lookupAVSpecs("tt0082340")?.formats).toEqual(["dv", "hdr"])
    expect(lookupAVSpecs("tt0090605")?.formats).toEqual(["dv", "atmos"])
    expect(lookupAVSpecs("tt0482571")?.formats).toEqual(["dv", "hdr"])
    expect(lookupAVSpecs("tt10954984")?.formats).toEqual(["imax", "hdr"])
    expect(lookupAVSpecs("tt5013056")?.formats).toEqual(["imax", "hdr"])
    expect(lookupAVSpecs("tt0083944")?.formats).toEqual(["dv", "hdr", "atmos"])
    expect(lookupAVSpecs("tt0425379")?.formats).toEqual(["dv", "atmos"])
    expect(lookupAVSpecs("tt0088993")?.formats).toEqual(["dv", "hdr", "atmos"])
    expect(lookupAVSpecs("tt10366206")?.formats).toEqual(["dv", "atmos", "hdr"])

    // Correct-id resolutions stay untouched: the tt0482572 page lacks
    // HDR10+ and the tt1130884 page lacks on-page release evidence.
    // Union-832 declares HDR10+ for tt1130884 (user-accepted edition union).
    expect(lookupAVSpecs("tt1130884")?.formats).toEqual(["dv", "hdr10plus"])
  })

  it("batch 4 wave1 corroborated additions (atmos x15); union-832 declared hdr additive", () => {
    // Corroborated Atmos, pre-existing formats preserved (all "English: Dolby Atmos"
    // on each title's own 4K edition page, identity + past street date gated):
    // They Live (Collector's Edition 4K https://www.blu-ray.com/movies/They-Live-4K-Blu-ray/276277/),
    // Who Framed Roger Rabbit (https://www.blu-ray.com/movies/Who-Framed-Roger-Rabbit-4K-Blu-ray/288676/),
    // Glory (30th Anniversary 4K https://www.blu-ray.com/movies/Glory-4K-Blu-ray/240867/),
    // The Little Mermaid (Anniversary 4K https://www.blu-ray.com/movies/The-Little-Mermaid-4K-Blu-ray/227169/),
    // Parenthood (https://www.blu-ray.com/movies/Parenthood-4K-Blu-ray/409825/),
    // Steel Magnolias (35th Anniversary 4K https://www.blu-ray.com/movies/Steel-Magnolias-4K-Blu-ray/356073/),
    // Total Recall (https://www.blu-ray.com/movies/Total-Recall-4K-Blu-ray/257346/),
    // Beauty and the Beast (Signature Collection 4K https://www.blu-ray.com/movies/Beauty-and-the-Beast-4K-Blu-ray/259304/),
    // Aladdin (Signature Collection 4K https://www.blu-ray.com/movies/Aladdin-4K-Blu-ray/246900/),
    // Bram Stoker's Dracula (SteelBook 30th Anniversary 4K https://www.blu-ray.com/movies/Bram-Stokers-Dracula-4K-Blu-ray/319180/),
    // The Fugitive (30th Anniversary 4K https://www.blu-ray.com/movies/The-Fugitive-4K-Blu-ray/342384/),
    // Philadelphia (25th Anniversary 4K https://www.blu-ray.com/movies/Philadelphia-4K-Blu-ray/211292/),
    // Rudy (SteelBook 30th Anniversary 4K https://www.blu-ray.com/movies/Rudy-4K-Blu-ray/344866/),
    // Leaving Las Vegas (https://www.blu-ray.com/movies/Leaving-Las-Vegas-4K-Blu-ray/93662/),
    // Sense and Sensibility (Columbia Classics 4K https://www.blu-ray.com/movies/Sense-and-Sensibility-4K-Blu-ray/293228/, imax preserved).
    // Union-832 (user-accepted title-edition union) adds declared generic HDR
    // to all fourteen rows below.
    for (const id of ["tt0096256", "tt0096438", "tt0097441", "tt0097757", "tt0098067", "tt0098384", "tt0100802", "tt0101414", "tt0103639", "tt0103874", "tt0106977", "tt0107818", "tt0108002", "tt0113627"]) {
      expect(lookupAVSpecs(id)?.formats).toEqual(["dv", "atmos", "hdr"])
    }
    expect(lookupAVSpecs("tt0114388")?.formats).toEqual(["dv", "imax", "atmos", "hdr"])

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms): Rain Man and Willow
    // (atmos sought; English DTS-HD MA 5.1 only), Boyz n the Hood and Groundhog
    // Day (availability-unknown variant pages deferred) — except for the
    // union-832 declared deltas below (user-accepted edition union).
    expect(lookupAVSpecs("tt0095953")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0096446")?.formats).toEqual(["dv", "hdr", "atmos"])
    expect(lookupAVSpecs("tt0101507")?.formats).toEqual(["dv", "hdr"])
    expect(lookupAVSpecs("tt0107048")?.formats).toEqual(["dv", "hdr"])
  })

  it("batch 4 wave2 QC-accepted additions (atmos x32, hdr x1); user-accepted source, additive only", () => {
    // User accepted QualiCache as sufficient source for this batch (captured
    // 2026-10-17; all 32 rows ready/trusted, min_trust high, stale false,
    // fresh <=90d, same 4K tier). NOT independently corroborated against
    // Blu-ray edition pages: pre-existing formats are preserved as a
    // title-level edition union (a format omitted from one QC release is not
    // deletion proof; Kung Fu Panda's dv+atmos+hdr is NOT one single-edition
    // claim).
    // Union-832 (user-accepted title-edition union) adds declared generic HDR
    // to 21 of the 29 rows; four rows carry union-declared HDR10+ instead
    // (authorized prev-conflicts: tt0138704, tt0325980, tt0369610, tt0383574),
    // and four rows had no Torrentio delta and stay curated.
    const ATMOS_21_HDR = ["tt0104257", "tt0116695", "tt0119654", "tt0119822", "tt0120655", "tt0120762", "tt0121164", "tt0139654", "tt0144084", "tt0145487", "tt0177789", "tt0180093", "tt0268126", "tt0311113", "tt0316654", "tt0317219", "tt0318627", "tt0327597", "tt0416449", "tt0434409", "tt0446029"]
    for (const id of ATMOS_21_HDR) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "atmos", "hdr"])
    }
    for (const id of ["tt0138704", "tt0325980", "tt0369610", "tt0383574"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "atmos", "hdr10plus"])
    }
    for (const id of ["tt0110322", "tt0352248", "tt0387564", "tt0399295"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "atmos"])
    }

    // QC observed atmos-only releases here: pre-existing dv preserved via union.
    // Union-832 adds declared generic HDR to both (user-accepted edition union).
    expect(lookupAVSpecs("tt0110148")?.formats).toEqual(["dv", "atmos", "hdr"])
    expect(lookupAVSpecs("tt0110148")?.quality).toBe("4K")
    expect(lookupAVSpecs("tt0230600")?.formats).toEqual(["dv", "atmos", "hdr"])
    expect(lookupAVSpecs("tt0230600")?.quality).toBe("4K")

    // Kung Fu Panda: QC observed HDR10+Atmos; pre-existing dv preserved
    // (title-level edition union, not one DV+HDR+Atmos edition claim).
    // No Torrentio delta for this row: stays byte-identical.
    expect(lookupAVSpecs("tt0441773")?.quality).toBe("4K")
    expect(lookupAVSpecs("tt0441773")?.formats).toEqual(["dv", "atmos", "hdr"])

    // Former no-change controls: union-832 declares additive deltas for eight
    // of the nine rows (user-accepted edition union); tt0104694's declared
    // Atmos is one of the 10 authorized prev-conflicts.
    for (const id of ["tt0268978", "tt0413300", "tt0120791", "tt0289043", "tt0398286"]) {
      const specs = lookupAVSpecs(id)
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "hdr", "atmos"])
    }
    for (const id of ["tt0275847", "tt0298148", "tt0120201"]) {
      const specs = lookupAVSpecs(id)
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(["dv", "hdr"])
    }
    expect(lookupAVSpecs("tt0104694")?.quality).toBe("4K")
    expect(lookupAVSpecs("tt0104694")?.formats).toEqual(["dv", "atmos"])

    // Additive-only batch: no new DB keys from the reviewed manifests (all 32
    // ids already present). The single authorized manual insert (Reacher
    // series tt9288030 via scripts/torrentio-manual-insert.mjs, operator
    // episode-selected S02E04) is the only key outside the 105+832 manifests.
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    expect(Object.keys(db).length).toBe(1431)
  })

  it("batch 5+6 torrentio reviewed imports (105 + union-832 = 937 declared); user-accepted source, additive only", () => {
    // User-accepted Torrentio declared labels (observed 2026-10-21, source
    // torrentio, verification "declared" — NOT curated/MediaInfo-verified).
    // Title-edition union: formats denote editions, no same-stream/playback
    // guarantee. Additive only: pre-existing formats preserved, imax untouched.
    // Phase 1 (105: hdr10plus x104 + atmos x1) stays verbatim; phase 2
    // (union-832: 822 generic-hdr + 10 authorized prev-conflicts) is asserted
    // with its own scope. The 10 prev-conflicts are covered by CONFLICT_UNIONS
    // below with the same curated-evidence notes kept at each batch site.
    expect(REVIEWED_APPROVED).toHaveLength(105)
    expect(REVIEWED832_APPROVED).toHaveLength(832)
    const provenance = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"), "utf8"),
    )
    expect(Object.keys(provenance)).toHaveLength(937)
    for (const { id, added } of REVIEWED_APPROVED) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      for (const token of added) expect(specs?.formats).toContain(token)
      const entry = provenance[id]
      expect(entry).toBeDefined()
      expect(entry.source).toBe("torrentio")
      expect(entry.verification).toBe("declared")
      expect(entry.userAccepted).toBe(true)
      expect(entry.decision).toBe("mutated")
      expect(entry.added).toEqual(added)
      expect(entry.snapshotSha256).toBe(REVIEWED_SNAPSHOT_SHA256)
      expect(entry.scope).toBe(REVIEWED_SCOPE)
      expect(entry.semantics).toContain("title-edition-union")
    }
    for (const { id, added } of REVIEWED832_APPROVED) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      for (const token of added) expect(specs?.formats).toContain(token)
      const entry = provenance[id]
      expect(entry).toBeDefined()
      expect(entry.source).toBe("torrentio")
      expect(entry.verification).toBe("declared")
      expect(entry.userAccepted).toBe(true)
      expect(entry.decision).toBe("mutated")
      expect(entry.added).toEqual(added)
      expect(entry.snapshotSha256).toBe(REVIEWED_SNAPSHOT_SHA256)
      expect(entry.scope).toBe(REVIEWED832_SCOPE)
      expect(entry.semantics).toContain("title-edition-union")
    }
    // The 10 previously excluded curated ids now carry the authorized
    // title-edition unions (exact arrays; curated evidence retained at each
    // batch site above).
    const CONFLICT_UNIONS: Record<string, string[]> = {
      tt0087332: ["dv", "atmos", "hdr10plus"],
      tt0090605: ["dv", "atmos"],
      tt0104694: ["dv", "atmos"],
      tt0138704: ["dv", "atmos", "hdr10plus"],
      tt0325980: ["dv", "atmos", "hdr10plus"],
      tt0369610: ["dv", "atmos", "hdr10plus"],
      tt0383574: ["dv", "atmos", "hdr10plus"],
      tt0425379: ["dv", "atmos"],
      tt0816692: ["imax", "hdr", "dv", "hdr10plus", "atmos"],
      tt1130884: ["dv", "hdr10plus"],
    }
    expect(REVIEWED_EXCLUDED).toHaveLength(10)
    for (const [id, formats] of Object.entries(CONFLICT_UNIONS)) {
      expect(lookupAVSpecs(id)?.formats).toEqual(formats)
      expect(provenance[id]?.scope).toBe(REVIEWED832_SCOPE)
    }

    // No new DB keys across both reviewed phases. The single authorized
    // manual insert (Reacher series tt9288030 via
    // scripts/torrentio-manual-insert.mjs) is the only key outside the
    // 105+832 manifests; its exact record is pinned in
    // torrentio-manual-insert.test.ts.
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    expect(Object.keys(db).length).toBe(1431)
  })

  it("returns null for unknown IDs or invalid inputs", () => {
    expect(lookupAVSpecs("tt00000000000")).toBeNull()
    expect(lookupAVSpecs(null)).toBeNull()
    expect(lookupAVSpecs(undefined)).toBeNull()
    expect(lookupAVSpecs("")).toBeNull()
  })

  it("validates known video format tokens", () => {
    for (const fmt of KNOWN_VIDEO_FORMATS) {
      expect(isVideoFormat(fmt)).toBe(true)
      const relPath = FORMAT_ICON_PATHS[fmt]
      expect(fs.existsSync(path.join(ROOT, "public", relPath)), `missing format icon: ${relPath}`).toBe(true)
    }
    expect(isVideoFormat("mp3")).toBe(false)
    expect(isVideoFormat("avi")).toBe(false)
  })
})

describe("format icons color adaptation", () => {
  it("renders format badges in white on dark background and black on light background", async () => {
    // topLight = false (dark poster) -> icon should be white
    const darkIcon = await renderQualityIconBadge(FORMAT_ICON_PATHS.dv, 380, false)
    expect(darkIcon).not.toBeNull()
    const statsDark = await sharp(darkIcon!.png).stats()
    // R, G, B channels should reach 255 for white pixels
    expect(statsDark.channels[0].max).toBe(255)
    expect(statsDark.channels[1].max).toBe(255)
    expect(statsDark.channels[2].max).toBe(255)

    // topLight = true (light poster) -> icon should be black
    const lightIcon = await renderQualityIconBadge(FORMAT_ICON_PATHS.dv, 380, true)
    expect(lightIcon).not.toBeNull()
    const statsLight = await sharp(lightIcon!.png).stats()
    // Non-alpha channels should stay near 0 (pure black icon)
    expect(statsLight.channels[0].max).toBe(0)
    expect(statsLight.channels[1].max).toBe(0)
    expect(statsLight.channels[2].max).toBe(0)
  })

  it("renders IMAX badge with transparent cutout in the letter A", async () => {
    // Test the raw SVG rasterization without shadow overlay
    const svg = fs.readFileSync(path.join(ROOT, "public", FORMAT_ICON_PATHS.imax), "utf8")
    expect(svg).toContain('fill-rule="evenodd"')
    const rawPng = await sharp(Buffer.from(svg.replace("currentColor", "white"))).png().toBuffer()
    const { data, info } = await sharp(rawPng).raw().toBuffer({ resolveWithObject: true })
    // In raw 980x490, A hole is at x ~558, y ~240 (150.28 + 90)
    let foundHole = false
    for (let y = 230; y <= 250; y++) {
      for (let x = 550; x <= 566; x++) {
        const idx = (y * info.width + x) * info.channels
        if (data[idx + 3] === 0) {
          foundHole = true
          break
        }
      }
      if (foundHole) break
    }
    expect(foundHole).toBe(true)
  })
})

describe("renderQualityBadgeGroup", () => {
  it("renders single resolution badge when formats list is empty", async () => {
    const single = await renderQualityBadgeGroup("4K", "mono", [], 500, false)
    expect(single).not.toBeNull()
    expect(single?.w).toBe(77) // 49 + 28
    expect(single?.h).toBe(68) // 40 + 28
  })

  it("renders vertical composite column with resolution and combined AV format badge", async () => {
    const group = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos"], 500, false)
    expect(group).not.toBeNull()
    // In vertical layout with combined Dolby Vision · Atmos, 2 badges are stacked (4K + DVA)
    expect(group!.w).toBeLessThan(120)
    expect(group!.w).toBeGreaterThan(60)
    // Height stacks 2 badges vertically (saving vertical space): ~115px instead of ~160px
    expect(group!.h).toBeGreaterThan(95)
    expect(group!.h).toBeLessThan(130)
    expect(group!.png.length).toBeGreaterThan(100)

    // With IMAX added, it stacks 3 badges: 4K + DVA + IMAX
    const groupWithImax = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos", "imax"], 500, false)
    expect(groupWithImax).not.toBeNull()
    expect(groupWithImax!.h).toBeGreaterThan(140)
  })

  it("supports all resolution tiers (4K, FHD, HD, SD) stacked above AV formats", async () => {
    for (const tier of ["4K", "FHD", "HD", "SD"]) {
      const g = await renderQualityBadgeGroup(tier, "mono", ["dv"], 380, false)
      expect(g).not.toBeNull()
      expect(g!.h).toBeGreaterThan(g!.w) // vertical column: height exceeds width
      const stats = await sharp(g!.png).stats()
      expect(stats.channels[0].max).toBe(255) // white pixels on dark
    }
  })
})
