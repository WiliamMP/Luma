import { createClient } from "@supabase/supabase-js";
import { useEffect, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing");

export type Profile = { id: string; username: string; avatar_url: string | null };
export type Server = { id: string; name: string; owner_id: string };
export type Channel = { id: string; server_id: string; name: string; kind: "text" | "voice" };
export type Message = {
  id: number;
  author_id: string;
  content: string;
  attachment_url: string | null;
  created_at: string;
};
/** what the chat pane shows: a server text channel or a DM thread */
export type Target = { kind: "channel" | "dm"; id: string; name: string };

// ───────── profile cache: every avatar/name on screen reads from here, missing ids are fetched in one batch ─────────

const profiles = new Map<string, Profile>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
let timer = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function putProfile(p: Profile) {
  profiles.set(p.id, p);
  emit();
}

function request(id: string) {
  if (profiles.has(id) || pending.has(id)) return;
  pending.add(id);
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const ids = [...pending];
    const { data } = await supabase.from("profiles").select("id, username, avatar_url").in("id", ids);
    data?.forEach((p) => profiles.set(p.id, p));
    ids.forEach((i) => pending.delete(i));
    emit();
  });
}

export function useProfile(id: string | null | undefined) {
  const p = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (id ? profiles.get(id) : undefined),
  );
  useEffect(() => {
    if (id) request(id);
  }, [id]);
  return p;
}

/** non-hook read, fetching the profile if it is not cached yet */
export async function getProfile(id: string) {
  if (!profiles.has(id)) {
    const { data } = await supabase.from("profiles").select("id, username, avatar_url").eq("id", id).maybeSingle();
    if (data) putProfile(data);
  }
  return profiles.get(id);
}

// ───────── misc ─────────

export async function upload(userId: string, file: File) {
  const safe = file.name.replace(/[^\w.-]/g, "_").slice(-80);
  const path = `${userId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("uploads").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("uploads").getPublicUrl(path).data.publicUrl;
}

/** links open in the system browser, not inside the app webview */
export function open(href: string) {
  openUrl(href).catch(() => window.open(href, "_blank"));
}

export const isImage = (u: string) => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(u.split("?")[0]);

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
