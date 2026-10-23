import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { bearerToken } from "./http.ts";

export function userClient(request: Request): SupabaseClient | null {
  const token = bearerToken(request);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

export async function authenticatedUser(request: Request): Promise<{ client: SupabaseClient; user: User } | null> {
  const client = userClient(request);
  if (!client) return null;
  const token = bearerToken(request);
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { client, user: data.user };
}

export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
