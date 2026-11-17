import { createClient, type RealtimeChannel, type RealtimeChannelOptions } from "@supabase/supabase-js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing");

export type Profile = { id: string; username: string; avatar_url: string | null; status: string; bio: string };
export const PROFILE_COLUMNS = "id, username, avatar_url, status, bio";
export type Server = { id: string; name: string; owner_id: string; icon_url: string | null };
export type Channel = { id: string; server_id: string; name: string; kind: "text" | "voice" };
export type Message = {
  id: number;
  author_id: string;
  content: string;
  attachment_url: string | null;
  created_at: string;
  edited_at: string | null;
  reply_to: number | null;
  /** emoji -> ids of who reacted */
  reactions: Record<string, string[]>;
  pinned_at: string | null;
};
/** presence status; "away" is also set automatically after 10 min with the window in the background */
export type Status = "online" | "away" | "dnd";
export const STATUS_LABEL: Record<Status, string> = { online: "Online", away: "Ausente", dnd: "Não perturbe" };

/** what the chat pane shows: a server text channel or a DM thread */
export type Target = { kind: "channel" | "dm"; id: string; name: string; group?: boolean };

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
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
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
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
    if (data) putProfile(data);
  }
  return profiles.get(id);
}

// ───────── misc ─────────

/**
 * A value kept in localStorage that components can watch. Values saved by older versions as a
 * bare string (not JSON) are still read.
 */
export function stored<T>(key: string, initial: T) {
  let value: T = initial;
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw as T;
    }
  }
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
  return {
    get: () => value,
    set(v: T) {
      value = v;
      localStorage.setItem(key, JSON.stringify(v));
      listeners.forEach((l) => l());
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

/**
 * Opens a Realtime channel; returns the cleanup. supabase.channel(topic) hands back a channel with
 * the same topic that is still leaving, and subscribe() on it does nothing, so leaving a view and
 * coming back quickly (or React StrictMode in dev) left it without live updates. This removes the
 * old one first. `setup` adds the listeners and calls subscribe().
 */
export function openChannel(topic: string, opts: RealtimeChannelOptions | undefined, setup: (ch: RealtimeChannel) => void) {
  let ch: RealtimeChannel | null = null;
  let closed = false;
  const old = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
  Promise.resolve(old && supabase.removeChannel(old)).then(() => {
    if (closed) return;
    ch = supabase.channel(topic, opts);
    setup(ch);
  });
  return () => {
    closed = true;
    if (ch) void supabase.removeChannel(ch);
  };
}

/** opens (or creates) the DM with `other` */
export async function openDm(other: string, name: string): Promise<Target> {
  const { data, error } = await supabase.rpc("open_dm", { other });
  if (error) throw error;
  return { kind: "dm", id: data as string, name };
}

export async function upload(userId: string, file: File) {
  const safe = file.name.replace(/[^\w.-]/g, "_").slice(-80);
  const path = `${userId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("uploads").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

// private bucket: stored values are paths, shown through signed URLs cached until shortly before they expire
const SIGNED_FOR = 3600;
const signed = new Map<string, { url: Promise<string | null>; until: number }>();

export function fileUrl(path: string): Promise<string | null> {
  if (path.startsWith("http")) return Promise.resolve(path); // saved before the bucket went private
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const url = supabase.storage
    .from("uploads")
    .createSignedUrl(path, SIGNED_FOR)
    .then(({ data }) => data?.signedUrl ?? null);
  signed.set(path, { url, until: Date.now() + (SIGNED_FOR - 300) * 1000 });
  url.then((u) => u || signed.delete(path)); // failed: try again next time
  return url;
}

export function useFileUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let live = true;
    fileUrl(path).then((u) => live && setUrl(u));
    return () => void (live = false);
  }, [path]);
  return url;
}

const errorsPt: [string, string][] = [
  ["Failed to fetch", "Sem conexão com o servidor. Verifique a internet e tente de novo."],
  ["Invalid login credentials", "Email ou senha incorretos."],
  ["User already registered", "Já existe uma conta com esse email."],
  ["Token has expired or is invalid", "Código inválido ou expirado."],
  ["rate limit", "Muitas tentativas. Espere um pouco e tente de novo."],
  ["should be different from the old password", "A senha nova precisa ser diferente da antiga."],
];

/** any thrown/returned error as text for the user, known Supabase/network messages in Portuguese */
export function errorText(e: unknown) {
  const m = typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
  return errorsPt.find(([k]) => m.includes(k))?.[1] ?? m;
}

/** links open in the system browser, not inside the app webview */
export function open(href: string) {
  openUrl(href).catch(() => window.open(href, "_blank"));
}

export const isImage = (u: string) => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(u.split("?")[0]);

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
