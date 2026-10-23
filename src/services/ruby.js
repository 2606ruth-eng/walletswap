import { requireSupabase } from "./supabase.js";

const MAX_MESSAGE_LENGTH = 4000;

export function rubyErrorMessage(error) {
  const status = Number(error?.context?.status || error?.status || 0);
  if (status === 401) return "Your session expired. Sign in again to continue the conversation.";
  if (status === 403) return "Ruby is not enabled for this app origin. Check the deployed Supabase function's allowed origins.";
  if (status === 404) return "That Ruby conversation is unavailable for this account. Start a new conversation.";
  if (status === 429) return "Ruby is temporarily limited by its request or monthly usage cap. Wait a minute and retry; if this continues, the monthly cap may be reached.";
  if (status >= 500) return "Ruby's service is temporarily unavailable. Your message is still here to retry.";
  return "Ruby couldn't reach WalletSwap. Check your connection and retry.";
}

export async function listRubyConversations() {
  const { data, error } = await requireSupabase().from("ruby_conversations")
    .select("id,title,created_at,updated_at").order("updated_at", { ascending: false }).limit(30);
  if (error) throw error;
  return data || [];
}

export async function createRubyConversation(title = "WalletSwap assistant") {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in before starting a Ruby conversation.");
  const safeTitle = String(title || "").trim().slice(0, 120) || "WalletSwap assistant";
  const { data, error } = await client.from("ruby_conversations")
    .insert({ user_id: authData.user.id, title: safeTitle })
    .select("id,title,created_at,updated_at").single();
  if (error) throw error;
  return data;
}

export async function getRubyMessages(conversationId) {
  const { data, error } = await requireSupabase().from("ruby_messages")
    .select("id,role,content,created_at").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).reverse();
}

export async function deleteRubyConversation(conversationId) {
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    throw new Error("Conversation reference is invalid.");
  }
  const { error } = await requireSupabase().from("ruby_conversations").delete().eq("id", conversationId);
  if (error) throw error;
}

export async function sendRubyMessage({ message, conversationId = null }) {
  const content = String(message || "").trim();
  if (!content || content.length > MAX_MESSAGE_LENGTH) throw new Error("Ruby messages must be 1–4,000 characters.");
  const { data, error } = await requireSupabase().functions.invoke("ruby-chat", {
    body: { message: content, conversationId },
  });
  if (error) throw error;
  return data;
}
