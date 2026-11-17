import { useEffect, useRef, useState } from "react";
import { AtSign, Hash } from "lucide-react";
import { cn, getProfile, supabase, type Server, type Target } from "@/lib";

type Item = { target: Target; server: string | null; sub: string };

/** Ctrl+K: jump to any text channel or DM by typing part of its name */
export function QuickSwitch({ me, servers, onPick }: { me: string; servers: Server[]; onPick: (target: Target, server: string | null) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") (e.preventDefault(), setOpen((o) => !o));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return open ? <Switcher me={me} servers={servers} onClose={() => setOpen(false)} onPick={(t, s) => (setOpen(false), onPick(t, s))} /> : null;
}

function Switcher({ me, servers, onClose, onPick }: { me: string; servers: Server[]; onClose: () => void; onPick: (target: Target, server: string | null) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // everything RLS lets me see: text channels of my servers and my DMs
  useEffect(() => {
    const names = new Map(servers.map((s) => [s.id, s.name]));
    Promise.all([
      supabase.from("channels").select("id, name, server_id").eq("kind", "text").order("name"),
      supabase.from("dms").select("id, user_a, user_b, name").order("created_at", { ascending: false }),
    ]).then(async ([{ data: channels }, { data: dms }]) => {
      const dmItems = await Promise.all(
        (dms ?? []).map(async (d) => {
          if (d.name) return { target: { kind: "dm", id: d.id, name: d.name, group: true }, server: null, sub: "Grupo" } as Item;
          const p = await getProfile(d.user_a === me ? d.user_b : d.user_a);
          const name = p?.username ?? "…";
          return { target: { kind: "dm", id: d.id, name }, server: null, sub: "Mensagem direta" } as Item;
        }),
      );
      const channelItems = (channels ?? []).map(
        (c) => ({ target: { kind: "channel", id: c.id, name: c.name }, server: c.server_id, sub: names.get(c.server_id) ?? "" }) as Item,
      );
      setItems([...dmItems, ...channelItems]);
    });
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => `${i.target.name} ${i.sub}`.toLowerCase().includes(needle)).slice(0, 50);
  const current = Math.min(pick, Math.max(shown.length - 1, 0));

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length || 1;
      setPick((current + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" && shown[current]) {
      e.preventDefault(); // or the Enter lands as a newline in the chat box that gets focus next
      onPick(shown[current].target, shown[current].server);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-[15vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="h-fit w-[520px] overflow-hidden rounded-xl border border-line bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-dim"
          placeholder="Ir para um canal ou conversa…"
          value={q}
          onChange={(e) => (setQ(e.target.value), setPick(0))}
          onKeyDown={onKey}
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-dim">{items.length ? "Nada encontrado" : "Carregando…"}</p>}
          {shown.map((i, n) => (
            <button
              key={i.target.id}
              className={cn("flex w-full items-center gap-2 px-4 py-2 text-left text-sm", n === current ? "bg-primary text-white" : "hover:bg-raised")}
              onMouseEnter={() => setPick(n)}
              onClick={() => onPick(i.target, i.server)}
            >
              {i.target.kind === "channel" ? <Hash className="size-4 shrink-0 opacity-70" /> : <AtSign className="size-4 shrink-0 opacity-70" />}
              <span className="truncate font-medium">{i.target.name}</span>
              <span className={cn("ml-auto truncate text-xs", n === current ? "text-white/80" : "text-dim")}>{i.sub}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-4 py-1.5 text-[11px] text-dim">↑ ↓ para escolher · Enter para abrir · Esc para fechar</div>
      </div>
    </div>
  );
}
