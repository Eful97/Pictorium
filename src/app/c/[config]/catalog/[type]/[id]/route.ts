import { NextRequest } from "next/server"
import { pictoriumCatalog } from "@/lib/catalog-handler"

export const maxDuration = 60

type RouteParams = { config: string; type: string; id: string }

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { config, type: mediaType, id: rawId } = await params
  const userParam = req.nextUrl.searchParams.get("u") || req.nextUrl.searchParams.get("user")
  return pictoriumCatalog(req, mediaType, rawId, userParam, config)
}
