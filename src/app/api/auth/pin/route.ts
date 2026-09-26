import { NextRequest } from "next/server"
import {
  hasPinConfigured,
  verifyPin,
  setPin,
  removePin,
  createSessionToken,
  buildSessionCookie,
  buildClearSessionCookie,
  verifySessionFromRequest,
} from "@/lib/pin-auth"
import { isSameOrigin, originMismatchResponse, checkAdminToken, hasAdminTokenConfigured } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

export async function GET(req: NextRequest) {
  const hasPin = await hasPinConfigured()
  const authenticated = hasPin ? await verifySessionFromRequest(req) : true
  // Flag pubblico (solo booleano, come hasInstanceKeys in /api/defaults): dice
  // al client se mostrare lo sblocco "Token admin" in Impostazioni. Il valore
  // resta dietro requireAdminToken/checkAdminToken — un booleano non espone
  // alcun segreto (e lo stato 401/aperto delle route lo rivela già da sé).
  return Response.json({ hasPin, authenticated, hasAdminToken: hasAdminTokenConfigured() })
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { pin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { pin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const pin = typeof body?.pin === "string" ? body.pin.trim() : ""
  if (!pin) {
    return Response.json({ error: "PIN mancante" }, { status: 400 })
  }

  const hasPin = await hasPinConfigured()
  if (!hasPin) {
    return Response.json({ error: "Nessun PIN configurato" }, { status: 400 })
  }

  const isValid = await verifyPin(pin)
  if (!isValid) {
    return Response.json({ error: "PIN non corretto" }, { status: 401 })
  }

  const token = await createSessionToken()
  if (!token) {
    return Response.json({ error: "Errore generazione sessione" }, { status: 500 })
  }

  const cookie = buildSessionCookie(token)
  // Il token viaggia solo nel cookie HttpOnly: non lo echoiamo nel JSON
  // (un XSS che legge il body non deve poter riusare la sessione altrove).
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  })
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { currentPin?: string; newPin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { currentPin?: string; newPin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const newPin = typeof body?.newPin === "string" ? body.newPin.trim() : ""
  if (!newPin || newPin.length < 6) {
    return Response.json({ error: "Il nuovo PIN deve avere almeno 6 cifre" }, { status: 400 })
  }

  const hasPin = await hasPinConfigured()
  const currentPin = typeof body?.currentPin === "string" ? body.currentPin.trim() : ""
  const isCurrentValid = currentPin ? await verifyPin(currentPin) : false
  const isAdmin = checkAdminToken(req)
  if (hasPin) {
    if (!isCurrentValid && !isAdmin) {
      return Response.json({ error: "PIN attuale non corretto" }, { status: 401 })
    }
  } else if (hasAdminTokenConfigured() && !isAdmin) {
    // Primo set con ADMIN_TOKEN configurato: chi non ha il token non può
    // impossessarsi dell'istanza impostando un PIN prima del proprietario.
    // (Senza ADMIN_TOKEN il primo set resta libero per l'onboarding wizard.)
    return Response.json({ error: "Unauthorized. Set x-admin-token or Authorization: Bearer header." }, { status: 401 })
  }

  // Binding rotazione (v1.23.0): impostato via token (non via PIN) → il PIN
  // muore con la rotazione dell'env. Via PIN o senza token: nessun binding.
  const success = await setPin(newPin, { viaAdminToken: isAdmin && !isCurrentValid })
  if (!success) {
    return Response.json({ error: "Impossibile salvare il PIN" }, { status: 500 })
  }

  const token = await createSessionToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) {
    headers["Set-Cookie"] = buildSessionCookie(token)
  }

  // Come sopra: sessione solo via cookie HttpOnly, niente token nel JSON.
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers,
  })
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { currentPin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { currentPin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const currentPin = typeof body?.currentPin === "string" ? body.currentPin.trim() : ""
  const isCurrentValid = currentPin ? await verifyPin(currentPin) : false
  const isAdmin = checkAdminToken(req)

  if (!isCurrentValid && !isAdmin) {
    return Response.json({ error: "PIN attuale non corretto" }, { status: 401 })
  }

  if (currentPin) {
    await removePin(currentPin)
  } else {
    // Admin token rimuove direttamente
    const { writeSecurityConfig, readSecurityConfig } = await import("@/lib/pin-auth")
    const cfg = await readSecurityConfig()
    await writeSecurityConfig({ ...cfg, pinHash: undefined, sessionSecret: undefined })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildClearSessionCookie(),
    },
  })
}
