import { NextRequest } from "next/server"
import { pictoriumCatalog } from "@/lib/catalog-handler"

export const maxDuration = 60

type RouteParams = { user: string; type: string; id: string; extra: string[] }

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { user, type: mediaType, id: rawId, extra } = await params
  const configParam = req.nextUrl.searchParams.get("config") || req.nextUrl.searchParams.get("c")
  return pictoriumCatalog(req, mediaType, rawId, user, configParam, extra)
}
