import { useEffect, useRef, useState } from "react";
import { ChevronDown, Users, Hash, Headphones, HeadphoneOff, Mic, Pencil, Video, VideoOff, MicOff, PhoneOff, Plus, ScreenShare, ScreenShareOff, Settings, Trash2, Volume2 } from "lucide-react";
import { cn, errorText, openChannel, openDm, supabase, upload, useProfile, type Channel, type Server, type Status, type Target } from "@/lib";
import { useProfileCard } from "./Profile";
import { useVolumes } from "@/voice";
import { GroupIcon, NewGroup } from "./Group";
import { isMuted, toggleMute, type Unread } from "@/unread";
import { Avatar, Badge, Modal, Name, UnreadBadge, button, dangerButton, ghost, input } from "./ui";

/** v: voice protocol version of that person's app (see VOICE_PROTOCOL) */
export type Presence = Map<string, { voice: string | null; screen: boolean; cam: boolean; v: number; status: Status }>;

const row = (active: boolean) =>
  cn(
    "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[15px] transition",
    active ? "bg-raised text-fg" : "text-dim hover:bg-raised/60 hover:text-fg",
  );

// ───────── server: channels ─────────

export function ServerSidebar({ server, me, target, onTarget, unread, presence, voiceRoom, speaking, onVoice, onGone, onRenamed, moderator }: {
  server: Server;
  me: string;
  target: Target | null;
  onTarget: (t: Target) => void;
  unread: Unread;
  presence: Presence;
  voiceRoom: string | null;
  /** people talking in my voice room */
  speaking: Set<string>;
  onVoice: (c: Channel) => void;
  onGone: () => void;
  onRenamed: () => void;
  /** owner or moderator: manages channels */
  moderator: boolean;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<null | "invite" | "channel" | "delete" | "rename">(null);
  const [renaming, setRenaming] = useState<Channel | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  async function setIcon(path: string | null) {
    const { error } = await supabase.from("servers").update({ icon_url: path }).eq("id", server.id);
    if (!error) onRenamed(); // reloads the server list, which carries the icon
  }
  /** right-click on someone in a voice channel: their volume slider at the mouse */
  const [volumeMenu, setVolumeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const owner = server.owner_id === me;
  const current = useRef(target);
  current.current = target;

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("channels").select("id, server_id, name, kind").eq("server_id", server.id).order("created_at");
      const list = (data ?? []) as Channel[];
      setChannels(list);
      // keep the open channel if it still exists, else open the first text channel
      const first = list.find((c) => c.kind === "text");
      const open = list.find((c) => c.id === current.current?.id);
      if (!open && first) onTarget({ kind: "channel", id: first.id, name: first.name });
      else if (open && open.name !== current.current?.name) onTarget({ kind: "channel", id: open.id, name: open.name }); // renamed
    };
    load();
    return openChannel(`channels:${server.id}`, undefined, (ch) =>
      ch.on("postgres_changes", { event: "*", schema: "public", table: "channels" }, load).subscribe(),
    );
  }, [server.id]);

  const card = useProfileCard();
  const inVoice = (cid: string) => [...presence].filter(([, p]) => p.voice === cid).map(([id]) => id);

  const [removing, setRemoving] = useState<Channel | null>(null);

  return (
    <>
      <div className="relative">
        <button className="flex h-12 w-full items-center justify-between border-b border-line px-4 font-semibold hover:bg-raised/60" onClick={() => setMenu(!menu)}>
          <span className="truncate">{server.name}</span>
          <ChevronDown className="size-4" />
        </button>
        {menu && (
          <div className="absolute inset-x-2 top-13 z-10 rounded-lg border border-line bg-bg p-1.5 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
            <MenuItem onClick={() => (setDialog("invite"), setMenu(false))}>Convidar pessoas</MenuItem>
            {moderator && <MenuItem onClick={() => (setDialog("channel"), setMenu(false))}>Criar canal</MenuItem>}
            {owner && <MenuItem onClick={() => (setDialog("rename"), setMenu(false))}>Renomear servidor</MenuItem>}
            {owner && (
              <MenuItem onClick={() => (iconInput.current?.click(), setMenu(false))}>
                {server.icon_url ? "Trocar ícone" : "Adicionar ícone"}
              </MenuItem>
            )}
            {owner && server.icon_url && <MenuItem onClick={() => (setIcon(null), setMenu(false))}>Remover ícone</MenuItem>}
            <MenuItem onClick={() => (toggleMute(server.id), setMenu(false))}>
              {isMuted(server.id) ? "Ativar notificações" : "Silenciar notificações"}
            </MenuItem>
            {owner ? (
              <MenuItem danger onClick={() => (setDialog("delete"), setMenu(false))}>Excluir servidor</MenuItem>
            ) : (
              <MenuItem danger onClick={async () => (await supabase.from("members").delete().match({ server_id: server.id, user_id: me }), onGone())}>
                Sair do servidor
              </MenuItem>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        {(["text", "voice"] as const).map((kind) => (
          <div key={kind}>
            <div className="flex items-center justify-between px-1 pb-1 text-xs font-semibold uppercase text-dim">
              {kind === "text" ? "Canais de texto" : "Canais de voz"}
              {moderator && (
                <button title="Criar canal" className="hover:text-fg" onClick={() => setDialog("channel")}>
                  <Plus className="size-4" />
                </button>
              )}
            </div>
            {channels.filter((c) => c.kind === kind).map((c) => (
              <div key={c.id}>
                <button
                  className={row(kind === "text" ? target?.id === c.id : voiceRoom === c.id)}
                  onClick={() => (kind === "text" ? onTarget({ kind: "channel", id: c.id, name: c.name }) : onVoice(c))}
                >
                  {kind === "text" ? <Hash className="size-4 shrink-0" /> : <Volume2 className="size-4 shrink-0" />}
                  <span className={cn("flex-1 truncate", unread.has(c.id) && "font-semibold text-fg")}>{c.name}</span>
                  <UnreadBadge count={unread.get(c.id)?.count ?? 0} mentions={unread.get(c.id)?.mentions ?? 0} />
                  {moderator && (
                    <>
                      <Pencil className="size-3.5 opacity-0 hover:text-fg group-hover:opacity-100" onClick={(e) => (e.stopPropagation(), setRenaming(c))} />
                      {owner && (
                        <Trash2 className="size-3.5 opacity-0 hover:text-danger group-hover:opacity-100" onClick={(e) => (e.stopPropagation(), setRemoving(c))} />
                      )}
                    </>
                  )}
                </button>
                {kind === "voice" &&
                  inVoice(c.id).map((id) => (
                    <div
                      key={id}
                      className="flex cursor-pointer items-center gap-2 py-1 pl-8 text-sm text-dim hover:text-fg"
                      title={id === me ? undefined : "Botão direito: volume"}
                      onClick={() => card.show(id)}
                      onContextMenu={(e) => id !== me && (e.preventDefault(), setVolumeMenu({ id, x: e.clientX, y: e.clientY }))}
                    >
                      <div className={cn("rounded-full ring-2 transition-shadow", speaking.has(id) ? "ring-online" : "ring-transparent")}>
                        <Avatar id={id} size={22} />
                      </div>
                      <Name id={id} className="truncate" />
                      {presence.get(id)?.cam && <Video className="size-3.5 shrink-0" aria-label="Câmera ligada" />}
                      {presence.get(id)?.screen && <span className="rounded bg-danger px-1 text-[10px] font-bold text-white">AO VIVO</span>}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {removing && (
        <Modal title={`Apagar ${removing.kind === "text" ? "#" : ""}${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="mb-4 text-sm text-dim">{removing.kind === "text" ? "Todas as mensagens do canal serão apagadas. " : ""}Não dá para desfazer.</p>
          <div className="flex justify-end gap-2">
            <button className={ghost} onClick={() => setRemoving(null)}>
              Cancelar
            </button>
            <button
              className={dangerButton}
              onClick={async () => (await supabase.from("channels").delete().eq("id", removing.id), setRemoving(null))}
            >
              Apagar
            </button>
          </div>
        </Modal>
      )}
      {volumeMenu && <VolumeMenu {...volumeMenu} onClose={() => setVolumeMenu(null)} />}
      <input
        ref={iconInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(me, f).then(setIcon, console.error);
        }}
      />
      {dialog === "invite" && <InviteDialog server={server} owner={owner} onClose={() => setDialog(null)} />}
      {dialog === "channel" && <ChannelDialog server={server} onClose={() => setDialog(null)} />}
      {dialog === "rename" && (
        <RenameDialog
          title="Renomear servidor"
          initial={server.name}
          onClose={() => setDialog(null)}
          // ponytail: servers are not in Realtime (invite_code is column-restricted), so other members see the new name on their next load
          onSave={async (name) => {
            const { error } = await supabase.from("servers").update({ name }).eq("id", server.id);
            if (!error) onRenamed();
            return error;
          }}
        />
      )}
      {renaming && (
        <RenameDialog
          title="Renomear canal"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const { error } = await supabase.from("channels").update({ name: channelName(renaming.kind, name) }).eq("id", renaming.id);
            return error;
          }}
        />
      )}
      {dialog === "delete" && (
        <Modal title={`Excluir "${server.name}"?`} onClose={() => setDialog(null)}>
          <p className="mb-4 text-sm text-dim">Todos os canais e mensagens serão apagados. Não dá para desfazer.</p>
          <div className="flex justify-end gap-2">
            <button className={ghost} onClick={() => setDialog(null)}>Cancelar</button>
            <button className={dangerButton} onClick={async () => (await supabase.from("servers").delete().eq("id", server.id), onGone())}>
              Excluir
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function VolumeMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const [volumes, setVolume] = useVolumes();
  const v = Math.round((volumes[id] ?? 1) * 100);
  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div
        className="absolute w-56 rounded-lg border border-line bg-bg p-3 text-sm shadow-xl"
        style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 100) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <Name id={id} className="truncate font-medium" />
          <span className="text-xs text-dim">{v}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={v}
          className="w-full accent-primary"
          onChange={(e) => setVolume(id, Number(e.target.value) / 100)}
          autoFocus
        />
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={cn("w-full rounded px-2 py-1.5 text-left hover:bg-primary hover:text-white", danger && "text-danger")} onClick={onClick}>
      {children}
    </button>
  );
}

function InviteDialog({ server, owner, onClose }: { server: Server; owner: boolean; onClose: () => void }) {
  const [code, setCode] = useState("…");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // a new code stops the old one from working (e.g. after kicking someone)
  async function regenerate() {
    const next = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("servers").update({ invite_code: next }).eq("id", server.id);
    if (error) setErr(errorText(error));
    else (setCode(next), setCopied(false));
  }
  useEffect(() => {
    supabase.rpc("get_invite", { sid: server.id }).then(({ data }) => setCode(data ?? "?"));
  }, [server.id]);
  return (
    <Modal title={`Convidar para ${server.name}`} onClose={onClose}>
      <p className="mb-2 text-sm text-dim">Mande este código. A pessoa usa "Adicionar servidor › Entrar com convite".</p>
      <div className="flex gap-2">
        <input className={cn(input, "font-mono")} readOnly value={code} />
        <button className={button} onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true))}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {owner && (
        <button className={cn(ghost, "mt-3 px-0 hover:bg-transparent")} onClick={regenerate}>
          Gerar novo código (o atual para de funcionar)
        </button>
      )}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </Modal>
  );
}

/** text channels are lowercase-with-dashes, voice channels keep the name as typed */
const channelName = (kind: Channel["kind"], name: string) => (kind === "text" ? name.trim().toLowerCase().replace(/\s+/g, "-") : name.trim());

function RenameDialog({ title, initial, onSave, onClose }: {
  title: string;
  initial: string;
  onSave: (name: string) => Promise<{ message: string } | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const error = await onSave(name.trim());
          if (error) setErr(errorText(error));
          else onClose();
        }}
      >
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required autoFocus />
        <button className={button}>Salvar</button>
      </form>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </Modal>
  );
}

function ChannelDialog({ server, onClose }: { server: Server; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [err, setErr] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("channels").insert({ server_id: server.id, name: channelName(kind, name), kind });
    if (error) setErr(errorText(error));
    else onClose();
  }
  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form onSubmit={create} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(["text", "voice"] as const).map((k) => (
            <button type="button" key={k} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", kind === k ? "border-primary bg-primary/15" : "border-line")} onClick={() => setKind(k)}>
              {k === "text" ? <Hash className="size-4" /> : <Volume2 className="size-4" />}
              {k === "text" ? "Texto" : "Voz"}
            </button>
          ))}
        </div>
        <input className={input} placeholder="nome-do-canal" value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} autoFocus />
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end">
          <button className={button}>Criar</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── home: direct messages ─────────

export function DmSidebar({ me, target, onTarget, unread, presence }: {
  me: string;
  target: Target | null;
  onTarget: (t: Target) => void;
  unread: Unread;
  presence: Presence;
}) {
  /** 1:1 DMs have `other`, groups have `name` */
  const [dms, setDms] = useState<{ id: string; other: string | null; name: string | null }[]>([]);
  const [adding, setAdding] = useState<null | "dm" | "group">(null);

  useEffect(() => {
    const load = () =>
      supabase.from("dms").select("id, user_a, user_b, name").order("created_at", { ascending: false }).then(({ data }) =>
        setDms((data ?? []).map((d) => ({ id: d.id, other: d.name ? null : d.user_a === me ? d.user_b : d.user_a, name: d.name }))),
      );
    load();
    // being added to a group arrives as an UPDATE of its dms row (add_to_group touches it)
    const sub = supabase.channel("dms").on("postgres_changes", { event: "*", schema: "public", table: "dms" }, load).subscribe();
    return () => void supabase.removeChannel(sub);
  }, [me]);

  return (
    <>
      <div className="flex h-12 items-center border-b border-line px-4 font-semibold">Mensagens diretas</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <button className={row(false)} onClick={() => setAdding("dm")}>
          <Plus className="size-4" /> Nova conversa
        </button>
        <button className={row(false)} onClick={() => setAdding("group")}>
          <Users className="size-4" /> Novo grupo
        </button>
        {dms.map((d) =>
          d.other ? (
            <DmRow key={d.id} id={d.other} active={target?.id === d.id} online={presence.get(d.other)?.status ?? false} unread={unread.get(d.id)?.count ?? 0} onClick={(name) => onTarget({ kind: "dm", id: d.id, name })} />
          ) : (
            <button key={d.id} className={row(target?.id === d.id)} onClick={() => onTarget({ kind: "dm", id: d.id, name: d.name ?? "", group: true })}>
              <GroupIcon />
              <span className={cn("flex-1 truncate", unread.has(d.id) && "font-semibold text-fg")}>{d.name}</span>
              <Badge n={unread.get(d.id)?.count ?? 0} />
            </button>
          ),
        )}
      </div>
      {adding === "dm" && <NewDm onClose={() => setAdding(null)} onOpen={(t) => (setAdding(null), onTarget(t))} />}
      {adding === "group" && <NewGroup onClose={() => setAdding(null)} onOpen={(t) => (setAdding(null), onTarget(t))} />}
    </>
  );
}

function DmRow({ id, active, online, unread, onClick }: { id: string; active: boolean; online: Status | false; unread: number; onClick: (name: string) => void }) {
  const p = useProfile(id);
  return (
    <button className={row(active)} onClick={() => onClick(p?.username ?? "")}>
      <Avatar id={id} size={32} online={online} />
      <span className={cn("flex-1 truncate", unread > 0 && "font-semibold text-fg")}>{p?.username ?? "…"}</span>
      <Badge n={unread} />
    </button>
  );
}

function NewDm({ onClose, onOpen }: { onClose: () => void; onOpen: (t: Target) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { data } = await supabase.from("profiles").select("id, username").eq("username", name.trim()).maybeSingle();
    if (!data) return setErr("Usuário não encontrado");
    openDm(data.id, data.username).then(onOpen, (e) => setErr(errorText(e)));
  }
  return (
    <Modal title="Nova conversa" onClose={onClose}>
      <form onSubmit={go} className="flex gap-2">
        <input className={input} placeholder="Nome de usuário" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <button className={button}>Abrir</button>
      </form>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </Modal>
  );
}

// ───────── bottom: me + voice controls ─────────

export function UserPanel({ me, voiceName, voiceState, muted, deafened, onMute, onDeafen, onHangUp, sharing, onShare, camera, onCamera, status }: {
  me: string;
  voiceName: string | null;
  voiceState: { ready: boolean; error: string | null };
  muted: boolean;
  deafened: boolean;
  onMute: () => void;
  onDeafen: () => void;
  onHangUp: () => void;
  sharing: boolean;
  onShare: () => void;
  camera: boolean;
  onCamera: () => void;
  /** my status as others see it (auto-away included) */
  status: Status;
}) {
  const card = useProfileCard();
  const icon = "grid size-8 place-items-center rounded-md text-dim hover:bg-raised hover:text-fg";
  return (
    <div className="border-t border-line bg-bg/60">
      {voiceName && (
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <div className="min-w-0">
            <div className={cn("text-sm font-semibold", voiceState.error ? "text-danger" : voiceState.ready ? "text-online" : "text-dim")}>
              {voiceState.error ? "Erro na voz" : voiceState.ready ? "Voz conectada" : "Conectando…"}
            </div>
            <div className="truncate text-xs text-dim">{voiceState.error ?? voiceName}</div>
          </div>
          <div className="flex">
            <button title={camera ? "Desligar câmera" : "Ligar câmera"} className={cn(icon, camera && "text-online")} onClick={onCamera} disabled={!voiceState.ready}>
              {camera ? <VideoOff className="size-4" /> : <Video className="size-4" />}
            </button>
            <button title={sharing ? "Parar de compartilhar" : "Compartilhar tela"} className={cn(icon, sharing && "text-online")} onClick={onShare} disabled={!voiceState.ready}>
              {sharing ? <ScreenShareOff className="size-4" /> : <ScreenShare className="size-4" />}
            </button>
            <button title="Desconectar" className={cn(icon, "hover:text-danger")} onClick={onHangUp}>
              <PhoneOff className="size-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-2 py-2">
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-raised/60" onClick={() => card.show(me)}>
          <Avatar id={me} size={32} online={status} />
          <Name id={me} className="min-w-0 flex-1 truncate text-sm font-medium" />
        </button>
        <button title={muted ? "Ativar microfone" : "Silenciar"} className={cn(icon, muted && "text-danger")} onClick={onMute}>
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button title={deafened ? "Ativar áudio" : "Desativar áudio"} className={cn(icon, deafened && "text-danger")} onClick={onDeafen}>
          {deafened ? <HeadphoneOff className="size-4" /> : <Headphones className="size-4" />}
        </button>
        <button title="Perfil e configurações" className={icon} onClick={card.edit}>
          <Settings className="size-4" />
        </button>
      </div>
    </div>
  );
}
