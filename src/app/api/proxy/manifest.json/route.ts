import { NextRequest } from "next/server"
import { GET as proxyGet } from "../[...path]/route"

// Alias canonico per Stremio: il protocollo addon richiede che la transport
// URL termini con `/manifest.json` ("protocol violation" altrimenti).
// Delega interamente alla logica del proxy: nessuna duplicazione.
// La vecchia `/api/proxy/manifest` resta funzionante per retrocompatibilità.
export async function GET(req: NextRequest) {
  return proxyGet(req, { params: Promise.resolve({ path: ["manifest"] }) })
}
