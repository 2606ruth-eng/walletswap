import { requireSupabase } from "./supabase.js";

const RETAILER_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function retailerFavoritesErrorMessage(error) {
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    return "Pinned retailers are unavailable until the favorites migration is applied.";
  }
  if (error?.code === "42501" || error?.status === 401 || error?.status === 403) {
    return "Sign in again to manage your pinned retailers.";
  }
  return "Pinned retailers couldn't be loaded. Search and alphabetical browsing are still available.";
}

async function authenticatedUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to save favorite retailers.");
  return data.user;
}

export async function getFavoriteRetailers(client = requireSupabase()) {
  const user = await authenticatedUser(client);
  const { data, error } = await client.from("retailer_favorites")
    .select("retailer,display_name,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function setFavoriteRetailer({ retailer, displayName, pinned }, client = requireSupabase()) {
  if (typeof retailer !== "string" || !RETAILER_KEY.test(retailer) || retailer === "other") {
    throw new Error("Choose a valid retailer to pin.");
  }
  const label = String(displayName || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 48);
  if (!label) throw new Error("Enter a retailer name before pinning it.");
  const user = await authenticatedUser(client);
  if (pinned) {
    const { error } = await client.from("retailer_favorites")
      .insert({ user_id: user.id, retailer, display_name: label });
    if (error && error.code !== "23505") throw error;
    return;
  }
  const { error } = await client.from("retailer_favorites")
    .delete().eq("user_id", user.id).eq("retailer", retailer);
  if (error) throw error;
}
