import { requireSupabase } from "./supabase.js";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  buildExpiryNotifications,
  notificationIdFromString,
  resolveNotificationPermission,
  safeStoredNotificationContent,
} from "./notification-runtime.js";

export async function getNotifications(limit = 50) {
  const { data, error } = await requireSupabase().from("notifications")
    .select("id,notification_type,title,message,related_card_id,read_at,created_at")
    .order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return data || [];
}

export function subscribeToNotifications(userId, onNotification, onStatus) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Notification account is invalid.");
  }
  return requireSupabase().channel(`wallet-notifications:${userId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "notifications",
      filter: `user_id=eq.${userId}`,
    }, event => {
      if (event.new?.user_id === userId) onNotification(event.new);
    })
    .subscribe(onStatus);
}

export async function getNotificationPreferences() {
  const { data, error } = await requireSupabase().from("notification_preferences")
    .select("card_activity_enabled,balance_change_enabled,expiry_reminders_enabled,weekly_summary_enabled,marketplace_alerts_enabled")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateNotificationPreferences(preferences) {
  const allowed = [
    "card_activity_enabled",
    "balance_change_enabled",
    "expiry_reminders_enabled",
    "weekly_summary_enabled",
    "marketplace_alerts_enabled",
  ];
  const update = Object.fromEntries(Object.entries(preferences).filter(([key, value]) => allowed.includes(key) && typeof value === "boolean"));
  if (!Object.keys(update).length) return;
  const { error } = await requireSupabase().from("notification_preferences").update(update);
  if (error) throw error;
}

export async function markNotificationRead(id) {
  const { error } = await requireSupabase().from("notifications")
    .update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function reportCardActivityProblem(activityId) {
  const { error } = await requireSupabase().rpc("report_card_activity_problem", {
    p_activity_id: activityId,
  });
  if (error) throw error;
}

export async function requestLocalNotificationPermission() {
  if (Capacitor.isNativePlatform()) {
    const current = await LocalNotifications.checkPermissions();
    return resolveNotificationPermission(current.display, async () =>
      (await LocalNotifications.requestPermissions()).display);
  }
  if (typeof Notification === "undefined") return "unavailable";
  return resolveNotificationPermission(Notification.permission, () => Notification.requestPermission());
}

export async function showStoredNotification(notice, enabled) {
  if (!enabled) return "suppressed";
  const permission = Capacitor.isNativePlatform()
    ? (await LocalNotifications.checkPermissions()).display
    : typeof Notification === "undefined" ? "unavailable" : Notification.permission;
  if (permission !== "granted") return permission;
  const type = notice.notification_type === "balance_change" && notice.title === "Test balance update"
    ? "test_balance_change"
    : notice.notification_type;
  const { title, body } = safeStoredNotificationContent(type);
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationIdFromString(`stored:${notice.id}`),
        title,
        body,
        schedule: { at: new Date(Date.now() + 1000) },
      }],
    });
  } else {
    new Notification(title, { body });
  }
  return "delivered";
}

export async function syncExpiryReminders(cards, enabled) {
  if (!Capacitor.isNativePlatform()) return { scheduled: 0, supported: false };
  const existing = await LocalNotifications.getPending();
  const oldReminderIds = (existing.notifications || [])
    .filter(item => item.extra?.walletswapType === "expiry")
    .map(item => item.id);
  if (oldReminderIds.length) await LocalNotifications.cancel({ notifications: oldReminderIds.map(id => ({ id })) });
  if (!enabled) return { scheduled: 0, supported: true };
  const permission = (await LocalNotifications.checkPermissions()).display;
  if (permission !== "granted") return { scheduled: 0, supported: true, permission };
  const notifications = buildExpiryNotifications(cards)
    .map(item => ({ ...item }));
  if (notifications.length) await LocalNotifications.schedule({ notifications });
  return { scheduled: notifications.length, supported: true, permission: "granted" };
}

export async function registerDeviceToken({ platform, provider, token }) {
  if (!["ios", "android", "web"].includes(platform) || !["apns", "fcm", "webpush"].includes(provider)) {
    throw new Error("Push platform is not supported.");
  }
  const value = String(token || "").trim();
  if (value.length < 20 || value.length > 4096) throw new Error("Push token is invalid.");
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in before registering this device.");
  const { error } = await client.from("device_tokens").upsert({
    user_id: authData.user.id,
    platform,
    provider,
    token: value,
    enabled: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider,token" });
  if (error) throw error;
}
