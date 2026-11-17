import { useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";
import { cn, errorText, supabase, useFileUrl, type Server } from "@/lib";
import type { Unread } from "@/unread";
import { Badge, Initials, Modal, button, input } from "./ui";

/** left column: DMs button, one icon per server, add-server button */
export function Rail({ servers, unread, selected, onSelect, onJoined }: {
  servers: Server[];
  unread: Unread;
  selected: string;
  onSelect: (id: string) => void;
  onJoined: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const count = (server: string | null) => [...unread.values()].reduce((n, u) => (u.server === server ? n + u.count : n), 0);
  // badge sits outside the button so the button's overflow-hidden does not clip it
  const badge = (n: number) => <Badge n={n} className="pointer-events-none absolute -right-1 -bottom-1 border-[3px] border-bg h-5.5! min-w-5.5!" />;
  const item = (active: boolean) =>
    cn(
      "relative grid size-12 place-items-center overflow-hidden transition-all",
      active ? "rounded-2xl bg-primary" : "rounded-3xl bg-card hover:rounded-2xl hover:bg-primary",
    );
  // white bar on the left edge: tall = selected, short = has unread
  const pill = (active: boolean, unread: boolean) => (
    <span className={cn("absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r bg-fg transition-all", active ? "h-10" : unread ? "h-2" : "h-0")} />
  );

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-bg py-3">
      <div className="relative">
        <button title="Mensagens diretas" className={item(selected === "home")} onClick={() => onSelect("home")}>
          <MessagesSquare className="size-6" />
        </button>
        {pill(selected === "home", count(null) > 0)}
        {badge(count(null))}
      </div>
      <div className="h-px w-8 bg-line" />
      {servers.map((s) => (
        <div key={s.id} className="relative">
          <button title={s.name} className={item(selected === s.id)} onClick={() => onSelect(s.id)}>
            <ServerIcon server={s} />
          </button>
          {pill(selected === s.id, count(s.id) > 0)}
          {badge(count(s.id))}
        </div>
      ))}
      <button title="Adicionar servidor" className={cn(item(false), "text-online hover:text-white")} onClick={() => setAdding(true)}>
        <Plus className="size-6" />
      </button>
      {adding && <AddServer onClose={() => setAdding(false)} onDone={(id) => (setAdding(false), onJoined(id))} />}
    </nav>
  );
}

function AddServer({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: "create_server" | "join_server", args: Record<string, string>) {
    setErr(null);
    const { data, error } = await supabase.rpc(fn, args);
    if (error) setErr(errorText(error));
    else onDone(data as string);
  }

  return (
    <Modal title="Adicionar servidor" onClose={onClose}>
      <form className="space-y-2" onSubmit={(e) => (e.preventDefault(), run("create_server", { server_name: name }))}>
        <label className="text-xs font-semibold uppercase text-dim">Criar novo</label>
        <div className="flex gap-2">
          <input className={input} placeholder="Nome do servidor" value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} />
          <button className={button}>Criar</button>
        </div>
      </form>
      <form className="mt-5 space-y-2" onSubmit={(e) => (e.preventDefault(), run("join_server", { code }))}>
        <label className="text-xs font-semibold uppercase text-dim">Entrar com convite</label>
        <div className="flex gap-2">
          <input className={input} placeholder="Código, ex: a1b2c3d4" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button className={button}>Entrar</button>
        </div>
      </form>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </Modal>
  );
}

function ServerIcon({ server }: { server: Server }) {
  const url = useFileUrl(server.icon_url);
  return <Initials name={server.name} url={url} size={48} className="rounded-none!" />;
}
