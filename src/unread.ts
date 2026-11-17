import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useSyncExternalStore } from "react";
import { getProfile, supabase, type Status, type Target } from "./lib";
import { mentions } from "./format";

/** target (channel id or dm id) -> unread count; server is null for DMs */
export type Unread = Map<string, { server: string | null; count: number }>;

type Incoming = { id: number; author_id: string; channel_id: string | null; dm_id: string | null; content: string };

/**
 * Unread counts from the database, refreshed whenever a message arrives anywhere,
 * plus a Windows notification (and taskbar flash) while the app is in the background.
 */
export function useInbox(me: string, open: Target | null, focused: boolean) {
  const [unread, setUnread] = useState<Unread>(new Map());
  const view = useRef({ open, focused });
  view.current = { open, focused };

  useEffect(() => {
    let timer = 0;
    const load = () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const { data } = await supabase.rpc("unread_counts");
        const rows = (data ?? []) as { target: string; server_id: string | null; unread: number }[];
        setUnread(new Map(rows.map((r) => [r.target, { server: r.server_id, count: Number(r.unread) }])));
      }, 300);
    };
    load();
    isPermissionGranted().then((ok) => void (ok || requestPermission()));

    // no filter: RLS only delivers messages from channels/DMs this user can read
    const sub = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: row }) => {
        const m = row as Incoming;
        if (m.author_id === me) return;
        const { open, focused } = view.current;
        if (focused && open?.id === (m.channel_id ?? m.dm_id)) return; // reading it right now
        load();
        if (!focused) notify(m, me).catch(console.error); // app in front: the badge is enough
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(sub);
    };
  }, [me]);

  const markRead = useCallback((target: string, lastId: number) => {
    supabase.rpc("mark_read", { t: target, mid: lastId }).then();
    setUnread((prev) => {
      if (!prev.has(target)) return prev;
      const next = new Map(prev);
      next.delete(target);
      return next;
    });
  }, []);

  // a refresh that was in flight while marking read can bring the open target back: never show it
  const shown = focused && open?.id && unread.has(open.id) ? new Map([...unread].filter(([t]) => t !== open.id)) : unread;
  return { unread: shown, markRead };
}

// my chosen status, saved on this device; "Não perturbe" stops every notification
const STATUS_KEY = "luma:status";
let myStatus = (localStorage.getItem(STATUS_KEY) as Status | null) ?? "online";
const statusListeners = new Set<() => void>();

export function useMyStatus(): [Status, (s: Status) => void] {
  const value = useSyncExternalStore(
    (l) => (statusListeners.add(l), () => statusListeners.delete(l)),
    () => myStatus,
  );
  return [
    value,
    (s) => {
      myStatus = s;
      localStorage.setItem(STATUS_KEY, s);
      statusListeners.forEach((l) => l());
    },
  ];
}

// ponytail: mute is kept per device in localStorage. Move it to a table if it should follow the account.
const MUTED_KEY = "luma:muted-servers";
const muted = new Set<string>(JSON.parse(localStorage.getItem(MUTED_KEY) ?? "[]"));

/** muted servers keep their unread badges but send no Windows notification (except @mentions) */
export const isMuted = (server: string) => muted.has(server);

export function toggleMute(server: string) {
  if (!muted.delete(server)) muted.add(server);
  localStorage.setItem(MUTED_KEY, JSON.stringify([...muted]));
}

async function notify(m: Incoming, me: string) {
  if (myStatus === "dnd") return;
  // an @mention gets through a muted server
  const mentioned = mentions(m.content, (await getProfile(me))?.username);
  let title = "";
  if (m.channel_id) {
    const { data } = await supabase.from("channels").select("name, server_id, servers(name)").eq("id", m.channel_id).maybeSingle();
    if (data && isMuted(data.server_id) && !mentioned) return;
    if (data) title = ` em #${data.name} (${(data.servers as unknown as { name: string } | null)?.name ?? ""})`;
  }
  const author = await getProfile(m.author_id);
  title = (author?.username ?? "Nova mensagem") + (mentioned ? " mencionou você" : "") + title;
  sendNotification({ title, body: m.content ? m.content.slice(0, 200) : "Enviou um arquivo" });
  getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}
