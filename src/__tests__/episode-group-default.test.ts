import { afterEach, describe, expect, it, vi } from "vitest"
import {
  groupDetailsEpisodeCount,
  pickDefaultEpisodeGroupId,
  resolveDefaultEpisodeGroupId,
} from "@/lib/episode-group-default"
import type { TMDBEpisodeGroupItem } from "@/lib/tmdb"

// La Casa di Carta: standard TMDB = 3 stagioni, 41 episodi totali
const STD_SEASONS = 3
const STD_EPISODES = 41

function item(partial: Partial<TMDBEpisodeGroupItem> & { id: string }): TMDBEpisodeGroupItem {
  return { name: "", ...partial } as TMDBEpisodeGroupItem
}

const ORIGINAL_PARTS = item({
  id: "grp_original_parts",
  name: "Original Parts",
  description: "Antena 3 released the first season in two parts",
  group_count: 5,
  episode_count: 41,
})

const NETFLIX_RECUT = item({
  id: "grp_netflix_recut",
  name: "Parts (edited version)",
  description: "Netflix international re-cut",
  group_count: 5,
  episode_count: 48,
})

describe("pickDefaultEpisodeGroupId", () => {
  it("sceglie Original Parts (5 parti, 41ep) sullo standard 3 stagioni/41ep", () => {
    expect(pickDefaultEpisodeGroupId([ORIGINAL_PARTS, NETFLIX_RECUT], STD_SEASONS, STD_EPISODES)).toBe(
      "grp_original_parts",
    )
  })

  it("scarta il re-cut con totale episodi diverso dallo standard", () => {
    expect(pickDefaultEpisodeGroupId([NETFLIX_RECUT], STD_SEASONS, STD_EPISODES)).toBeNull()
  })

  it("ritorna null senza gruppi o con input non valido", () => {
    expect(pickDefaultEpisodeGroupId([], STD_SEASONS, STD_EPISODES)).toBeNull()
    expect(pickDefaultEpisodeGroupId(null, STD_SEASONS, STD_EPISODES)).toBeNull()
    expect(pickDefaultEpisodeGroupId([ORIGINAL_PARTS], 0, STD_EPISODES)).toBeNull()
    expect(pickDefaultEpisodeGroupId([ORIGINAL_PARTS], STD_SEASONS, 0)).toBeNull()
  })

  it("scarta gruppi con tante parti quante le stagioni (nessun valore aggiunto)", () => {
    const sameCount = item({ id: "g3", name: "Original Parts", group_count: 3, episode_count: 41 })
    expect(pickDefaultEpisodeGroupId([sameCount], STD_SEASONS, STD_EPISODES)).toBeNull()
  })

  it("scarta gruppi con un solo gruppo o senza episodi", () => {
    const single = item({ id: "g1", name: "Original Parts", group_count: 1, episode_count: 41 })
    const empty = item({ id: "g0", name: "Original Parts", group_count: 5, episode_count: 0 })
    expect(pickDefaultEpisodeGroupId([single, empty], STD_SEASONS, STD_EPISODES)).toBeNull()
  })

  it("non scarta Original Parts se la descrizione cita 'edited' per escluderlo (caso reale 71446)", () => {
    const real = item({
      id: "5ae0275b0e0a26156c00de9f",
      name: "Original Parts",
      description:
        "These are the five original parts released in Spain. Note: This order does not include the edited episodes of season 1 that were released internationally by Netflix.",
      group_count: 5,
      episode_count: 41,
    })
    expect(pickDefaultEpisodeGroupId([real], STD_SEASONS, STD_EPISODES)).toBe("5ae0275b0e0a26156c00de9f")
  })

  it("scarta varianti editoriali anche col totale giusto", () => {
    const directors = item({ id: "gd", name: "Director's Cut Parts", group_count: 5, episode_count: 41 })
    expect(pickDefaultEpisodeGroupId([directors], STD_SEASONS, STD_EPISODES)).toBeNull()
  })

  it("scarta raggruppamenti non riconoscibili come Parti", () => {
    const other = item({ id: "go", name: "Italian Order", group_count: 5, episode_count: 41 })
    expect(pickDefaultEpisodeGroupId([other], STD_SEASONS, STD_EPISODES)).toBeNull()
  })

  it("preferisce Original a un generico Parts a parità di totale", () => {
    const generic = item({ id: "gp", name: "Parts", group_count: 5, episode_count: 41 })
    expect(pickDefaultEpisodeGroupId([generic, ORIGINAL_PARTS], STD_SEASONS, STD_EPISODES)).toBe(
      "grp_original_parts",
    )
  })

  it("seleziona il gruppo con type: 1 (Original Air Date) anche se denominato 'Seasons' (caso reale Lupin 96677)", () => {
    const lupinGroup = item({
      id: "6074e65418864b00439afa4f",
      name: "Seasons",
      description: "",
      type: 1,
      group_count: 4,
      episode_count: 25,
    })
    // Lupin standard: 3 stagioni (S1 10ep, S2 7ep, S3 8ep), totale 25ep
    expect(pickDefaultEpisodeGroupId([lupinGroup], 3, 25)).toBe("6074e65418864b00439afa4f")
  })

  it("seleziona il gruppo Seasons spacchettando la stagione unica anime con speciali inclusi (caso reale Re:ZERO 65942)", () => {
    const rezeroGroup = item({
      id: "641eb9d6b234b9007ac67063",
      name: "Seasons",
      description: "There are 4 seasons of the show. First season comprises of 25 episodes. Second one is also 25 episodes...",
      type: 6,
      group_count: 5,
      episode_count: 166,
    })
    const storyArcGroup = item({
      id: "69ec40bc75c2e8fbcd17cb5f",
      name: "Story Arc",
      description: "Arcs...",
      type: 5,
      group_count: 5,
      episode_count: 66,
    })
    // Re:ZERO standard: 1 stagione regolare (85ep), 81 speciali (totale 166ep)
    expect(
      pickDefaultEpisodeGroupId(
        [storyArcGroup, rezeroGroup],
        1,
        85,
        166,
      ),
    ).toBe("641eb9d6b234b9007ac67063")
  })
})

describe("groupDetailsEpisodeCount", () => {
  it("somma gli episodi dei gruppi", () => {
    const details = {
      id: "g",
      name: "Original Parts",
      description: "",
      group_count: 2,
      groups: [
        { id: "a", name: "Parte 1", order: 1, episodes: [{}, {}, {}] },
        { id: "b", name: "Parte 2", order: 2, episodes: [{}, {}] },
      ],
    } as unknown as Parameters<typeof groupDetailsEpisodeCount>[0]
    expect(groupDetailsEpisodeCount(details)).toBe(5)
  })

  it("ritorna 0 su input nullo", () => {
    expect(groupDetailsEpisodeCount(null)).toBe(0)
    expect(groupDetailsEpisodeCount(undefined)).toBe(0)
  })
})

describe("resolveDefaultEpisodeGroupId", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("risolve via API TMDB e degrada a null in caso di errore", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ results: [ORIGINAL_PARTS, NETFLIX_RECUT] }),
    )
    // tvId diverso per non collidere con la cache di altri test
    await expect(resolveDefaultEpisodeGroupId(7144601, STD_SEASONS, STD_EPISODES, "k")).resolves.toBe(
      "grp_original_parts",
    )

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("rete giù"))
    await expect(resolveDefaultEpisodeGroupId(7144602, STD_SEASONS, STD_EPISODES, "k")).resolves.toBeNull()
  })
})
