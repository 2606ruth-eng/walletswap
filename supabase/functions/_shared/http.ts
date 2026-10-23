const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "walletswap://auth",
];

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const configured = (Deno.env.get("WALLET_SWAP_ALLOWED_ORIGINS") || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const allowed = configured.length ? configured : DEFAULT_ORIGINS;
  return {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-walletswap-signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

export function jsonResponse(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

export function rejectDisallowedOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  const configured = (Deno.env.get("WALLET_SWAP_ALLOWED_ORIGINS") || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const allowed = configured.length ? configured : DEFAULT_ORIGINS;
  return origin && !allowed.includes(origin)
    ? jsonResponse(request, 403, { error: "Origin is not allowed." })
    : null;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || null;
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
