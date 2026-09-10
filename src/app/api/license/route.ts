import { NextResponse } from "next/server"

// Offerta sorgente AGPL-3.0 §13 via rete: chi usa un'istanza (anche di un
// fork modificato) trova qui licenza + dove chiedere il Corresponding Source.
// Volutamente statico e fuori dal rate-limit (come il probe di liveness):
// zero I/O, nessun segreto, nessun failure mode.
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      program: "Pictorium",
      license: "AGPL-3.0-only",
      licenseUrl: "https://www.gnu.org/licenses/agpl-3.0.html",
      licenseFile: "/LICENSE",
      source: "https://github.com/Eful97/Pictorium",
      copyright: "Copyright (C) 2025 Eful97",
      notice:
        "If you received this program over a network from a modified instance, " +
        "you have the right to the Corresponding Source of that modified version " +
        "(GNU AGPLv3, section 13). Ask the operator of this instance.",
    },
    { status: 200 },
  )
}
