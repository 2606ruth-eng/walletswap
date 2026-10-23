import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticatedUser } from "../_shared/client.ts";
import { jsonResponse, rejectDisallowedOrigin } from "../_shared/http.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  const originError = rejectDisallowedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedUser(request);
    if (!context) return jsonResponse(request, 401, { error: "Authentication required." });
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return jsonResponse(request, 503, { error: "Account deletion is not configured." });

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(context.user.id);
    if (error) {
      console.error("Account deletion failed for authenticated user.");
      return jsonResponse(request, 500, { error: "The account could not be deleted. Contact support." });
    }
    return jsonResponse(request, 200, { deleted: true });
  } catch {
    return jsonResponse(request, 500, { error: "Account deletion could not be completed." });
  }
});
