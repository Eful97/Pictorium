import { describe, expect, it } from "vitest"
import { buildNoticeDetail, noticeCatalogId, NOTICE_MISSING_TVDB_KEY, NOTICE_MISSING_KEY_TITLE, NOTICE_MISSING_KEY_DESCRIPTION, NOTICE_MISSING_TVDB_KEY_TITLE, NOTICE_MISSING_TVDB_KEY_DESCRIPTION } from "@/lib/notice-meta"

describe("notice metadata", () => {
  it.each([
    [noticeCatalogId(), NOTICE_MISSING_KEY_TITLE, NOTICE_MISSING_KEY_DESCRIPTION],
    [noticeCatalogId(NOTICE_MISSING_TVDB_KEY), NOTICE_MISSING_TVDB_KEY_TITLE, NOTICE_MISSING_TVDB_KEY_DESCRIPTION],
  ])("keeps the provider-specific message when opening %s", (id, name, description) => {
    expect(buildNoticeDetail({ id, type: "series", poster: "/pictorium.png" })).toMatchObject({ id, name, description })
  })
})
