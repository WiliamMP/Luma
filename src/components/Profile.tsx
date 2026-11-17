import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useMic } from "@/voice";
import { useMyStatus } from "@/unread";
import { cn, errorText, openDm, putProfile, supabase, upload, useProfile, PROFILE_COLUMNS, STATUS_LABEL, type Profile, type Status, type Target } from "@/lib";
import { Avatar, Modal, STATUS_DOT, button, dangerButton, ghost, input } from "./ui";

const Ctx = createContext({ show: (_id: string) => {}, edit: () => {} });

/** `show(id)` opens someone's profile card, `edit()` my profile settings, from anywhere inside Main */
export const useProfileCard = () => useContext(Ctx);

export function ProfileProvider({ me, onDm, children }: { me: string; onDm: (t: Target) => void; children: ReactNode }) {
  const [card, setCard] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value] = useState(() => ({ show: setCard, edit: () => setEditing(true) }));

  // name/avatar/status changes from other people reach the cache live
  useEffect(() => {
    const sub = supabase
      .channel("profiles")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, ({ new: p }) => putProfile(p as Profile))
      .subscribe();
    return () => void supabase.removeChannel(sub);
  }, []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {card && (
        <ProfileCard
          id={card}
          me={me}
          onClose={() => setCard(null)}
          onDm={(t) => (setCard(null), onDm(t))}
          onEdit={() => (setCard(null), setEditing(true))}
        />
      )}
      {editing && <ProfileDialog me={me} onClose={() => setEditing(false)} />}
    </Ctx.Provider>
  );
}

function ProfileCard({ id, me, onClose, onDm, onEdit }: { id: string; me: string; onClose: () => void; onDm: (t: Target) => void; onEdit: () => void }) {
  const p = useProfile(id);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Perfil" onClose={onClose}>
      <div className="flex items-center gap-4">
        <Avatar id={id} size={80} />
        <div className="min-w-0">
          <div className="selectable truncate text-xl font-semibold">{p?.username ?? "…"}</div>
          {p?.status && <div className="text-sm break-words text-dim">{p.status}</div>}
        </div>
      </div>
      {p?.bio && (
        <>
          <div className="mt-5 mb-1 text-xs font-semibold uppercase text-dim">Sobre mim</div>
          <p className="selectable whitespace-pre-wrap break-words text-sm">{p.bio}</p>
        </>
      )}
      {id === me && <StatusPicker />}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      <div className="mt-5 flex justify-end">
        {id === me ? (
          <button className={button} onClick={onEdit}>
            Editar perfil
          </button>
        ) : (
          <button className={button} onClick={() => openDm(id, p?.username ?? "").then(onDm, (e) => setErr(errorText(e)))}>
            Enviar mensagem
          </button>
        )}
      </div>
    </Modal>
  );
}

// the form starts from the saved profile, so it waits until that is loaded (an empty form would wipe status/bio on save)
function ProfileDialog({ me, onClose }: { me: string; onClose: () => void }) {
  const p = useProfile(me);
  return p ? (
    <ProfileForm me={me} p={p} onClose={onClose} />
  ) : (
    <Modal title="Perfil e configurações" onClose={onClose}>
      <p className="text-sm text-dim">Carregando…</p>
    </Modal>
  );
}

function ProfileForm({ me, p, onClose }: { me: string; p: Profile; onClose: () => void }) {
  const [form, setForm] = useState({ username: p.username, status: p.status ?? "", bio: p.bio ?? "" });
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function save(patch: Partial<Pick<Profile, "username" | "status" | "bio" | "avatar_url">>) {
    setMsg(null);
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", me).select(PROFILE_COLUMNS).single();
    if (error) return setMsg({ text: error.code === "23505" ? "Nome já em uso" : errorText(error) });
    putProfile(data as Profile);
    setMsg({ text: "Salvo.", ok: true });
  }

  return (
    <Modal title="Perfil e configurações" onClose={onClose}>
      <div className="flex items-start gap-4">
        <label className="cursor-pointer" title="Trocar avatar">
          <Avatar id={me} size={72} />
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(me, f).then((path) => save({ avatar_url: path }), (e) => setMsg({ text: errorText(e) }));
            }}
          />
        </label>
        <form
          className="flex flex-1 flex-col gap-2"
          onSubmit={(e) => (e.preventDefault(), save({ username: form.username.trim(), status: form.status.trim(), bio: form.bio.trim() }))}
        >
          <input className={input} placeholder="Nome de usuário" value={form.username} onChange={set("username")} minLength={2} maxLength={32} pattern="[a-zA-Z0-9_.]+" title="Letras, números, _ e ." required />
          <input className={input} placeholder="Status (ex.: jogando, estudando…)" value={form.status} onChange={set("status")} maxLength={60} />
          <textarea className={cn(input, "h-24 resize-none")} placeholder="Sobre mim" value={form.bio} onChange={set("bio")} maxLength={190} />
          <button className={cn(button, "self-end")}>Salvar</button>
        </form>
      </div>
      <p className="mt-2 text-xs text-dim">Clique no avatar para trocar a imagem.</p>
      {msg && <p className={cn("mt-2 text-sm", msg.ok ? "text-online" : "text-danger")}>{msg.text}</p>}
      <MicPicker />
      <Account />
      <div className="mt-5 flex items-center justify-between">
        <button className={cn(ghost, "flex items-center gap-2 px-0 text-danger hover:bg-transparent")} onClick={() => supabase.auth.signOut()}>
          <LogOut className="size-4" /> Sair da conta
        </button>
        <Version />
      </div>
    </Modal>
  );
}

function MicPicker() {
  const [mic, setMic] = useMic();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () => navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "audioinput" && x.deviceId && x.deviceId !== "default")));
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, []);
  return (
    <label className="mt-5 block">
      <span className="mb-1 block text-xs font-semibold uppercase text-dim">Microfone</span>
      <select className={input} value={mic} onChange={(e) => setMic(e.target.value)}>
        <option value="">Padrão do sistema</option>
        {devices.map((d, i) => (
          // labels only show once the app has had microphone access (after joining voice once)
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microfone ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Version() {
  const [v, setV] = useState("");
  useEffect(() => void getVersion().then(setV, () => {}), []);
  return v ? <span className="text-xs text-dim">Luma v{v}</span> : null;
}

function StatusPicker() {
  const [status, setStatus] = useMyStatus();
  return (
    <div className="mt-5">
      <div className="mb-1 text-xs font-semibold uppercase text-dim">Status</div>
      <div className="flex gap-1">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <button
            key={s}
            className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm", s === status ? "bg-raised text-fg" : "text-dim hover:bg-raised/60 hover:text-fg")}
            onClick={() => setStatus(s)}
          >
            <span className={cn("size-2.5 rounded-full", STATUS_DOT[s])} />
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {status === "dnd" && <p className="mt-1 text-xs text-dim">Sem notificações enquanto estiver em Não perturbe.</p>}
    </div>
  );
}

/** my uploads first (avatar, attachments), then the account; everything else cascades in the database */
async function deleteAccount() {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return { error: new Error("Sessão expirada. Entre de novo.") };
  for (;;) {
    const { data: files, error } = await supabase.storage.from("uploads").list(me, { limit: 1000 });
    if (error) return { error };
    if (!files?.length) break;
    const { error: e2 } = await supabase.storage.from("uploads").remove(files.map((f) => `${me}/${f.name}`));
    if (e2) return { error: e2 };
  }
  return await supabase.rpc("delete_account");
}

/** password, email and account deletion */
function Account() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  async function run(action: () => Promise<{ error: unknown }>, ok: string) {
    setMsg(null);
    const { error } = await action();
    setMsg(error ? { text: errorText(error) } : { text: ok, ok: true });
    return !error;
  }

  if (!open)
    return (
      <button className={cn(ghost, "mt-4 px-0 hover:bg-transparent")} onClick={() => setOpen(true)}>
        Conta: senha, email, excluir…
      </button>
    );

  return (
    <div className="mt-5 space-y-2">
      <div className="text-xs font-semibold uppercase text-dim">Conta</div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => supabase.auth.updateUser({ password }), "Senha trocada.")) setPassword("");
        }}
      >
        <input className={input} type="password" placeholder="Senha nova" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className={button}>Trocar</button>
      </form>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => supabase.auth.updateUser({ email }), "Enviamos links de confirmação: abra o do email novo (e o do atual, se chegar).")) setEmail("");
        }}
      >
        <input className={input} type="email" placeholder="Email novo" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className={button}>Trocar</button>
      </form>
      {confirmDelete ? (
        <div className="rounded-md border border-danger/50 p-3 text-sm">
          <p className="mb-2">
            Isso apaga sua conta, seus servidores (com canais e mensagens), suas mensagens e DMs. <strong>Não dá para desfazer.</strong>
          </p>
          <div className="flex justify-end gap-2">
            <button className={ghost} onClick={() => setConfirmDelete(false)}>
              Cancelar
            </button>
            <button
              className={dangerButton}
              onClick={async () => {
                if (await run(deleteAccount, "Conta excluída.")) supabase.auth.signOut();
              }}
            >
              Excluir minha conta
            </button>
          </div>
        </div>
      ) : (
        <button className={cn(ghost, "px-0 text-danger hover:bg-transparent")} onClick={() => setConfirmDelete(true)}>
          Excluir conta…
        </button>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-online" : "text-danger")}>{msg.text}</p>}
    </div>
  );
}
