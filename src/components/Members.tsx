import { useEffect, useState } from "react";
import { Crown, Shield, ShieldOff, UserMinus, Volume2 } from "lucide-react";
import { openChannel, supabase, useProfile, type Server } from "@/lib";
import { Avatar, Modal, Name, dangerButton, ghost } from "./ui";
import { useProfileCard } from "./Profile";
import type { Presence } from "./Sidebar";

export function Members({ server, me, moderator, presence }: { server: Server; me: string; moderator: boolean; presence: Presence }) {
  const card = useProfileCard();
  /** member id -> role */
  const [roles, setRoles] = useState<Map<string, "member" | "mod">>(new Map());
  const ids = [...roles.keys()];
  const [kicking, setKicking] = useState<string | null>(null);
  const owner = server.owner_id === me;
  // the owner removes anyone; a moderator removes regular members (the database enforces the same)
  const canKick = (id: string) => id !== me && id !== server.owner_id && (owner || (moderator && roles.get(id) === "member"));

  async function setRole(id: string, role: "member" | "mod") {
    await supabase.from("members").update({ role }).match({ server_id: server.id, user_id: id });
  }

  useEffect(() => {
    const load = () =>
      supabase
        .from("members")
        .select("user_id, role")
        .eq("server_id", server.id)
        .then(({ data }) => setRoles(new Map((data ?? []).map((m) => [m.user_id, m.role ?? "member"]))));
    load();
    return openChannel(`members:${server.id}`, undefined, (ch) =>
      ch.on("postgres_changes", { event: "*", schema: "public", table: "members" }, load).subscribe(),
    );
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
              <div
                key={id}
                role="button"
                className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-raised/60"
                style={{ opacity: presence.has(id) ? 1 : 0.45 }}
                onClick={() => card.show(id)}
              >
                <Avatar id={id} size={32} online={presence.get(id)?.status ?? false} />
                <div className="min-w-0 flex-1">
                  <Name id={id} className="block truncate text-sm" />
                  <Status id={id} />
                </div>
                {presence.get(id)?.voice && <Volume2 className="size-3.5 text-online" />}
                {server.owner_id === id && <Crown className="size-3.5 text-[#f5a524]" aria-label="Dono" />}
                {roles.get(id) === "mod" && server.owner_id !== id && <Shield className="size-3.5 text-primary" aria-label="Moderador" />}
                {owner && id !== me && (
                  <button
                    title={roles.get(id) === "mod" ? "Remover moderador" : "Tornar moderador"}
                    className="hidden text-dim hover:text-fg group-hover:block"
                    onClick={(e) => (e.stopPropagation(), setRole(id, roles.get(id) === "mod" ? "member" : "mod"))}
                  >
                    {roles.get(id) === "mod" ? <ShieldOff className="size-4" /> : <Shield className="size-4" />}
                  </button>
                )}
                {canKick(id) && (
                  <button title="Expulsar" className="hidden text-dim hover:text-danger group-hover:block" onClick={(e) => (e.stopPropagation(), setKicking(id))}>
                    <UserMinus className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null,
      )}
      {kicking && (
        <Modal title="Expulsar do servidor?" onClose={() => setKicking(null)}>
          <p className="mb-4 text-sm text-dim">
            <Name id={kicking} className="font-medium text-fg" /> sai de {server.name}. A pessoa pode voltar se tiver um convite.
          </p>
          <div className="flex justify-end gap-2">
            <button className={ghost} onClick={() => setKicking(null)}>
              Cancelar
            </button>
            <button
              className={dangerButton}
              onClick={async () => (await supabase.from("members").delete().match({ server_id: server.id, user_id: kicking }), setKicking(null))}
            >
              Expulsar
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

function Status({ id }: { id: string }) {
  const status = useProfile(id)?.status;
  return status ? <div className="truncate text-xs text-dim">{status}</div> : null;
}
