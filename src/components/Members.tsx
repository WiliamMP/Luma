import { useEffect, useState } from "react";
import { Crown, Volume2 } from "lucide-react";
import { supabase, useProfile, type Server } from "@/lib";
import { Avatar, Name } from "./ui";
import { useProfileCard } from "./Profile";
import type { Presence } from "./Sidebar";

export function Members({ server, presence }: { server: Server; presence: Presence }) {
  const card = useProfileCard();
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const load = () =>
      supabase.from("members").select("user_id").eq("server_id", server.id).then(({ data }) => setIds((data ?? []).map((m) => m.user_id)));
    load();
    const sub = supabase.channel(`members:${server.id}`).on("postgres_changes", { event: "*", schema: "public", table: "members" }, load).subscribe();
    return () => void supabase.removeChannel(sub);
  }, [server.id]);

  const groups = [
    { label: "Online", list: ids.filter((id) => presence.has(id)) },
    { label: "Offline", list: ids.filter((id) => !presence.has(id)) },
  ];

  return (
    <aside className="w-60 shrink-0 overflow-y-auto bg-panel p-3">
      {groups.map((g) =>
        g.list.length ? (
          <div key={g.label} className="mb-4">
            <div className="px-2 pb-1 text-xs font-semibold uppercase text-dim">
              {g.label} — {g.list.length}
            </div>
            {g.list.map((id) => (
              <button
                key={id}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-raised/60"
                style={{ opacity: presence.has(id) ? 1 : 0.45 }}
                onClick={() => card.show(id)}
              >
                <Avatar id={id} size={32} online={presence.has(id)} />
                <div className="min-w-0 flex-1">
                  <Name id={id} className="block truncate text-sm" />
                  <Status id={id} />
                </div>
                {presence.get(id)?.voice && <Volume2 className="size-3.5 text-online" />}
                {server.owner_id === id && <Crown className="size-3.5 text-[#f5a524]" />}
              </button>
            ))}
          </div>
        ) : null,
      )}
    </aside>
  );
}

function Status({ id }: { id: string }) {
  const status = useProfile(id)?.status;
  return status ? <div className="truncate text-xs text-dim">{status}</div> : null;
}
