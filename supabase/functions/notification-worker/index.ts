import { serviceClient } from "../_shared/client.ts";
import { jsonResponse } from "../_shared/http.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });
  const expected = Deno.env.get("NOTIFICATION_WORKER_SECRET");
  if (!expected) return jsonResponse(request, 503, { error: "Scheduled notifications are not configured." });
  if (request.headers.get("Authorization") !== `Bearer ${expected}`) {
    return jsonResponse(request, 401, { error: "Not authorized." });
  }
  const admin = serviceClient();
  if (!admin) return jsonResponse(request, 503, { error: "Notification storage is not configured." });
  const { data, error } = await admin.rpc("create_expiry_notifications", { p_days: 14 });
  if (error) {
    console.error("Scheduled expiry notification job failed.");
    return jsonResponse(request, 500, { error: "The notification job could not be completed." });
  }
  const { data: weeklyData, error: weeklyError } = await admin.rpc("create_weekly_wallet_summary_notifications");
  if (weeklyError) {
    console.error("Scheduled weekly summary notification job failed.");
    return jsonResponse(request, 500, { error: "The notification job could not be completed." });
  }
  return jsonResponse(request, 200, {
    expiry_created: Number(data || 0),
    weekly_summaries_created: Number(weeklyData || 0),
  });
});
