import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getProfile, supabase, type Target } from "./lib";

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
        if (!focused) notify(m).catch(console.error); // app in front: the badge is enough
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

// ponytail: notifies for every server message. Add per-server mute when busy servers get noisy.
async function notify(m: Incoming) {
  const author = await getProfile(m.author_id);
  let title = author?.username ?? "Nova mensagem";
  if (m.channel_id) {
    const { data } = await supabase.from("channels").select("name, servers(name)").eq("id", m.channel_id).maybeSingle();
    if (data) title += ` em #${data.name} (${(data.servers as unknown as { name: string } | null)?.name ?? ""})`;
  }
  sendNotification({ title, body: m.content ? m.content.slice(0, 200) : "Enviou um arquivo" });
  getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}
