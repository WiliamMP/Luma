import { useEffect, useState } from "react";
import { LogOut, UserPlus, Users } from "lucide-react";
import { errorText, openChannel, supabase, type Target } from "@/lib";
import { Avatar, Modal, button, dangerButton, ghost, input } from "./ui";
import { useProfileCard } from "./Profile";

/** round "group" icon used in the DM list for group conversations */
export function GroupIcon({ size = 32 }: { size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-full bg-primary text-white" style={{ width: size, height: size }}>
      <Users style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  );
}

/** chat header extras for a group DM: who is in it, add someone, leave */
export function GroupHeader({ dm, onLeft }: { dm: string; onLeft: () => void }) {
  const card = useProfileCard();
  const [people, setPeople] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | "add" | "leave">(null);

  useEffect(() => {
    const load = () =>
      supabase
        .from("dm_members")
        .select("user_id")
        .eq("dm_id", dm)
        .order("joined_at")
        .then(({ data }) => setPeople((data ?? []).map((m) => m.user_id)));
    load();
    // add_to_group / leave_group touch the dms row, so its UPDATE means "the people changed"
    return openChannel(`dm-members:${dm}`, undefined, (ch) =>
      ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "dms", filter: `id=eq.${dm}` }, load).subscribe(),
    );
  }, [dm]);

  return (
    <div className="flex items-center gap-2 font-normal">
      <div className="flex -space-x-2">
        {people.slice(0, 6).map((id) => (
          <button key={id} title="Ver perfil" className="rounded-full ring-2 ring-card" onClick={() => card.show(id)}>
            <Avatar id={id} size={24} />
          </button>
        ))}
      </div>
      {people.length > 6 && <span className="text-xs text-dim">+{people.length - 6}</span>}
      <button title="Adicionar pessoa" className="text-dim hover:text-fg" onClick={() => setDialog("add")}>
        <UserPlus className="size-4" />
      </button>
      <button title="Sair do grupo" className="text-dim hover:text-danger" onClick={() => setDialog("leave")}>
        <LogOut className="size-4" />
      </button>
      {dialog === "add" && <AddPerson dm={dm} onClose={() => setDialog(null)} />}
      {dialog === "leave" && (
        <Modal title="Sair do grupo?" onClose={() => setDialog(null)}>
          <p className="mb-4 text-sm text-dim">Você para de ver as mensagens. Alguém do grupo pode te adicionar de novo.</p>
          <div className="flex justify-end gap-2">
            <button className={ghost} onClick={() => setDialog(null)}>
              Cancelar
            </button>
            <button
              className={dangerButton}
              onClick={async () => {
                const { error } = await supabase.rpc("leave_group", { did: dm });
                if (!error) onLeft();
              }}
            >
              Sair
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddPerson({ dm, onClose }: { dm: string; onClose: () => void }) {
  const [who, setWho] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Adicionar ao grupo" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const { error } = await supabase.rpc("add_to_group", { did: dm, who: who.trim().replace(/^@/, "") });
          if (error) setErr(errorText(error));
          else onClose();
        }}
      >
        <input className={input} placeholder="Nome de usuário" value={who} onChange={(e) => setWho(e.target.value)} required autoFocus />
        <button className={button}>Adicionar</button>
      </form>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </Modal>
  );
}

/** "Novo grupo": a name and a few usernames */
export function NewGroup({ onClose, onOpen }: { onClose: () => void; onOpen: (t: Target) => void }) {
  const [name, setName] = useState("");
  const [people, setPeople] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Novo grupo" onClose={onClose}>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const usernames = people.split(/[\s,;]+/).map((u) => u.replace(/^@/, "")).filter(Boolean);
          const { data, error } = await supabase.rpc("create_group", { name: name.trim(), usernames });
          if (error) return setErr(errorText(error));
          onOpen({ kind: "dm", id: data as string, name: name.trim(), group: true });
        }}
      >
        <input className={input} placeholder="Nome do grupo" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required pattern=".*\S.*" title="Dê um nome ao grupo" autoFocus />
        <input className={input} placeholder="Pessoas: nomes de usuário separados por vírgula" value={people} onChange={(e) => setPeople(e.target.value)} required />
        <div className="flex justify-end">
          <button className={button}>Criar grupo</button>
        </div>
      </form>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </Modal>
  );
}
