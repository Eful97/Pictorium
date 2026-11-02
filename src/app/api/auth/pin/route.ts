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
  validatePinSecret,
  MAX_PIN_SECRET_LENGTH,
} from "@/lib/pin-auth"
import { isSameOrigin, originMismatchResponse, checkAdminToken, hasAdminTokenConfigured } from "@/lib/auth"
import { isMultiUserEnabled } from "@/lib/user-auth"
import { createLogger } from "@/lib/logger"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

const log = createLogger("auth-pin")

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
    return Response.json({ error: "PIN mancante", code: "pin_missing" }, { status: 400 })
  }

  const hasPin = await hasPinConfigured()
  if (!hasPin) {
    return Response.json({ error: "Nessun PIN configurato", code: "pin_not_configured" }, { status: 400 })
  }

  const isValid = await verifyPin(pin)
  if (!isValid) {
    // Messaggio unico per credenziale errata: nessun oracolo su PIN vs password.
    return Response.json({ error: "PIN non corretto", code: "pin_wrong" }, { status: 401 })
  }

  const token = await createSessionToken()
  if (!token) {
    return Response.json({ error: "Errore generazione sessione", code: "pin_session_error" }, { status: 500 })
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

  // PIN numerico (6+ cifre) oppure password libera (8+ caratteri), max 128.
  // Unica fonte della regola: validatePinSecret (stessa usata da setPin).
  const validated = validatePinSecret(body?.newPin)
  if (!validated.ok) {
    if (validated.reason === "too_long") {
      return Response.json(
        { error: `PIN o password troppo lunghi (max ${MAX_PIN_SECRET_LENGTH} caratteri)`, code: "pin_too_long" },
        { status: 400 },
      )
    }
    return Response.json(
      { error: "Il PIN o la password sono troppo corti (min. 6 cifre o 8 caratteri)", code: "pin_too_short" },
      { status: 400 },
    )
  }
  const newPin = validated.value

  const hasPin = await hasPinConfigured()
  const currentPin = typeof body?.currentPin === "string" ? body.currentPin.trim() : ""
  const isCurrentValid = currentPin ? await verifyPin(currentPin) : false
  const isAdmin = await checkAdminToken(req)
  if (hasPin) {
    if (!isCurrentValid && !isAdmin) {
      return Response.json({ error: "PIN attuale non corretto", code: "pin_current_wrong" }, { status: 401 })
    }
  } else if (!isAdmin) {
    // Primo set (nessun PIN ancora attivo): questa richiesta CREA l'unica
    // credenziale d'istanza, quindi è un claim dell'istanza (= admin + chiavi
    // d'istanza), non un semplice salvataggio. Regole, in ordine:
    //  1. ADMIN_TOKEN configurato → serve il token (comportamento invariato).
    //  2. MULTI_USER=1 senza token → nessun claim libero: fail-closed, l'accesso
    //     admin passa dal token (la UI nasconde già la card PIN e il setup
    //     wizard salta lo step PIN in multi-utente). Un'istanza condivisa non
    //     deve poter essere conquistata dal primo visitatore.
    //  3. Istanza single-user senza token → il primo set resta libero per
    //     l'onboarding (contratto storico, README), ma con warning esplicito:
    //     finché il PIN non esiste chiunque raggiunga l'istanza può reclamarla.
    //     Chiude la finestra: impostare PICTORIUM_ADMIN_TOKEN.
    if (hasAdminTokenConfigured()) {
      return Response.json({ error: "Unauthorized. Set x-admin-token or Authorization: Bearer header." }, { status: 401 })
    }
    if (isMultiUserEnabled()) {
      log.warn(
        "First PIN set blocked: PICTORIUM_MULTI_USER=1 without PICTORIUM_ADMIN_TOKEN — the instance PIN cannot be claimed anonymously. Set PICTORIUM_ADMIN_TOKEN and retry with x-admin-token.",
      )
      return Response.json(
        {
          error: "Unauthorized. Set x-admin-token or Authorization: Bearer header.",
          code: "pin_claim_requires_admin_token",
        },
        { status: 401 },
      )
    }
    log.warn(
      "First PIN set is open to anyone who can reach this single-user instance (no ADMIN_TOKEN configured and no PIN yet). Set PICTORIUM_ADMIN_TOKEN to close the first-claim window.",
    )
  }

  // Binding rotazione (v1.23.0): impostato via token (non via PIN) → il PIN
  // muore con la rotazione dell'env. Via PIN o senza token: nessun binding.
  const success = await setPin(newPin, { viaAdminToken: isAdmin && !isCurrentValid })
  if (!success) {
    return Response.json({ error: "Impossibile salvare il PIN", code: "pin_save_error" }, { status: 500 })
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
  const isAdmin = await checkAdminToken(req)

  if (!isCurrentValid && !isAdmin) {
    return Response.json({ error: "PIN attuale non corretto", code: "pin_current_wrong" }, { status: 401 })
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
