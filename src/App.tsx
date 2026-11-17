import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { configured, errorText, supabase, type Server, type Status, type Target } from "./lib";
import { chime, useVoice, VOICE_PROTOCOL } from "./voice";
import { useInbox, useMyStatus } from "./unread";
import { Auth } from "./components/Auth";
import { Rail } from "./components/Rail";
import { DmSidebar, ServerSidebar, UserPanel, type Presence } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { Members } from "./components/Members";
import { Stage } from "./components/Stage";
import { ProfileProvider } from "./components/Profile";
import { QuickSwitch } from "./components/QuickSwitch";
import { syncSettings } from "./settings";
import { WindowControls, dragWindow } from "./components/WindowControls";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center bg-bg pl-3 text-xs font-semibold text-dim" onMouseDown={dragWindow}>
        <img src="/icon.svg" alt="" className="pointer-events-none mr-2 size-4" />
        <span className="pointer-events-none flex-1">Luma</span>
        <WindowControls />
      </div>
      <UpdateBar />
      <div className="min-h-0 flex-1">
        {!configured ? <Setup /> : session === undefined ? null : session ? <Main me={session.user.id} /> : <Auth />}
      </div>
    </div>
  );
}

/**
 * Looks for a new release on startup, when the release workflow announces one on the public
 * "releases" broadcast topic (so open apps hear about it right away), and every 30 min as a fallback
 * for apps that were offline at that moment. Installers are signed: the app only accepts our key
 * (pubkey in tauri.conf.json), so a fake announcement can at most trigger a harmless check.
 */
function UpdateBar() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // keep the first update found: replacing it mid-download would confuse the bar
    const look = () => check().then((u) => u && setUpdate((prev) => prev ?? u), () => {}); // offline / dev build: stay quiet
    look();
    const every = setInterval(look, 30 * 60 * 1000);
    // the announcement can arrive a moment before GitHub serves the new latest.json: look again shortly after
    const ch = supabase
      .channel("releases")
      .on("broadcast", { event: "published" }, () => (look(), setTimeout(look, 60 * 1000)))
      .subscribe();
    return () => {
      clearInterval(every);
      supabase.removeChannel(ch);
    };
  }, []);

  async function install(u: Update) {
    let total = 0;
    let done = 0;
    try {
      await u.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          setStatus(total ? `Baixando... ${Math.round((done / total) * 100)}%` : "Baixando...");
        } else setStatus("Instalando...");
      });
      await relaunch();
    } catch (e) {
      setStatus(`Não foi possível atualizar: ${errorText(e)}`);
    }
  }

  if (!update) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 bg-primary px-3 py-1.5 text-sm text-white">
      <span className="flex-1">{status ?? `Nova versão ${update.version} disponível.`}</span>
      {!status?.startsWith("Baix") && status !== "Instalando..." && (
        <button className="rounded bg-white/20 px-3 py-0.5 font-medium hover:bg-white/30" onClick={() => install(update)}>
          Atualizar
        </button>
      )}
    </div>
  );
}

type Meta = { voice: string | null; screen?: boolean; cam?: boolean; v?: number; status?: Status };

/**
 * One person can have Luma open in several places (one presence entry each). Voice comes from the
 * one that is in a call; the status from any that is not idle ("away" only when all of them are).
 */
function merge(metas: Meta[]) {
  const call = metas.find((m) => m.voice) ?? metas[0];
  const status: Status = metas.map((m) => m.status ?? "online").find((s) => s !== "away") ?? "away";
  return { voice: call?.voice ?? null, screen: !!call?.screen, cam: !!call?.cam, v: call?.v ?? 1, status };
}

function Setup() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">Supabase não configurado</h1>
        <p className="text-sm text-dim">
          Copie <code>.env.example</code> para <code>.env</code>, preencha a URL e a anon key do projeto e reinicie o app.
        </p>
      </div>
    </div>
  );
}

function Main({ me }: { me: string }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [selected, setSelected] = useState("home");
  const [target, setTarget] = useState<Target | null>(null);
  const [presence, setPresence] = useState<Presence>(new Map());
  const [voice, setVoice] = useState<{ id: string; name: string; server: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const online = useRef<RealtimeChannel | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [focused, setFocused] = useState(document.hasFocus());
  const { unread, markRead } = useInbox(me, target, focused);

  // "Online" turns into "Ausente" after 10 minutes with the window in the background
  const [chosen] = useMyStatus();
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (focused) return setIdle(false);
    const t = setTimeout(() => setIdle(true), 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [focused]);
  const status: Status = chosen === "online" && idle ? "away" : chosen;

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => (window.removeEventListener("focus", on), window.removeEventListener("blur", off));
  }, []);

  // only peers speaking the same voice protocol: an older app version could not follow the signalling
  const peers = [...presence].filter(([, p]) => voice && p.voice === voice.id && p.v === VOICE_PROTOCOL).map(([id]) => id);
  const voiceState = useVoice(me, voice?.id ?? null, peers, muted || deafened, deafened);

  /** servers where I am a moderator (the owner is checked against owner_id) */
  const [mods, setMods] = useState<Set<string>>(new Set());

  const loadServers = () =>
    Promise.all([
      supabase.from("servers").select("id, name, owner_id, icon_url").order("created_at"),
      supabase.from("members").select("server_id").eq("user_id", me).eq("role", "mod"),
    ]).then(([{ data, error }, { data: modRows }]) => {
      if (error) return;
      const list = data ?? [];
      setServers(list);
      setMods(new Set((modRows ?? []).map((r) => r.server_id)));
      // kicked from / left / deleted the server whose voice channel I am in: hang up
      setVoice((v) => (v && !list.some((s) => s.id === v.server) ? null : v));
    });

  useEffect(() => syncSettings(me), [me]);

  // a server renamed / given an icon: refetch the list (the event only says something changed)
  useEffect(() => {
    const ch = supabase.channel("servers-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "servers" }, () => loadServers()).subscribe();
    return () => void supabase.removeChannel(ch);
  }, [me]);

  useEffect(() => {
    loadServers();
    // joined, left, kicked or server deleted: refresh the rail
    const sub = supabase.channel("my-servers").on("postgres_changes", { event: "*", schema: "public", table: "members" }, loadServers).subscribe();
    return () => void supabase.removeChannel(sub);
  }, [me]);

  // who is online, and which voice channel each person is in
  useEffect(() => {
    const ch = supabase.channel("online", { config: { presence: { key: me } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<Meta>();
      setPresence(new Map(Object.entries(state).map(([id, metas]) => [id, merge(metas)])));
    }).subscribe((s) => setSubscribed(s === "SUBSCRIBED"));
    online.current = ch;
    return () => void supabase.removeChannel(ch);
  }, [me]);

  // announce our voice room only once the signalling channel is up, so peers do not call us too early
  useEffect(() => {
    const room = voiceState.ready ? voice?.id ?? null : null;
    if (subscribed) online.current?.track({ voice: room, screen: !!room && !!voiceState.screen, cam: !!room && !!voiceState.cam, v: VOICE_PROTOCOL, status });
  }, [subscribed, voiceState.ready, voice?.id, !!voiceState.screen, !!voiceState.cam, status]);

  // chime when someone joins or leaves my call (and when I join or leave it); quiet while deafened
  const others = voiceState.ready ? peers.filter((id) => id !== me).sort().join(",") : null;
  const lastOthers = useRef<string | null>(null);
  useEffect(() => {
    const before = lastOthers.current;
    lastOthers.current = others;
    if (deafened || before === others) return;
    if (before === null || others === null) return chime(others !== null); // I joined / left
    chime(others.split(",").filter(Boolean).length > before.split(",").filter(Boolean).length);
  }, [others]);

  // screens shared in my voice room (mine included)
  const shares = voice
    ? peers.filter((id) => presence.get(id)?.screen).map((id) => ({ id, stream: id === me ? voiceState.screen : voiceState.remote.get(id) ?? null }))
    : [];
  // cameras turned on in my voice room (mine included)
  const cams = voice
    ? peers.filter((id) => presence.get(id)?.cam).map((id) => ({ id, stream: id === me ? voiceState.cam : voiceState.remoteCam.get(id) ?? null }))
    : [];

  const server = servers.find((s) => s.id === selected);
  /** owner or moderator of the open server */
  const moderator = !!server && (server.owner_id === me || mods.has(server.id));
  // the selected server vanished (left / deleted / kicked): go home
  useEffect(() => {
    if (selected !== "home" && servers.length && !server) (setSelected("home"), setTarget(null));
  }, [servers, server, selected]);

  function pick(id: string) {
    if (id === selected) return;
    setSelected(id);
    setTarget(null);
  }

  const toDm = (t: Target) => (setSelected("home"), setTarget(t));
  // Ctrl+K: server + channel at once (ServerSidebar keeps an open target that belongs to the server)
  const jump = (t: Target, serverId: string | null) => (setSelected(serverId ?? "home"), setTarget(t));

  return (
    <ProfileProvider me={me} onDm={toDm}>
      <QuickSwitch me={me} servers={servers} onPick={jump} />
      <div className="flex h-full">
        <Rail servers={servers} unread={unread} selected={selected} onSelect={pick} onJoined={(id) => loadServers().then(() => pick(id))} />
        <div className="flex w-60 shrink-0 flex-col bg-panel">
          {server ? (
            <ServerSidebar
              key={server.id}
              server={server}
              me={me}
              target={target}
              onTarget={setTarget}
              unread={unread}
              presence={presence}
              voiceRoom={voice?.id ?? null}
              speaking={voiceState.speaking}
              onVoice={(c) => setVoice({ id: c.id, name: `${c.name} / ${server.name}`, server: server.id })}
              onGone={() => (loadServers(), pick("home"))}
              onRenamed={loadServers}
              moderator={moderator}
            />
          ) : (
            <DmSidebar me={me} target={target} onTarget={setTarget} unread={unread} presence={presence} />
          )}
          <UserPanel
            me={me}
            voiceName={voice?.name ?? null}
            voiceState={voiceState}
            muted={muted}
            deafened={deafened}
            onMute={() => setMuted(!muted)}
            onDeafen={() => setDeafened(!deafened)}
            onHangUp={() => setVoice(null)}
          status={status}
            sharing={!!voiceState.screen}
            onShare={() => (voiceState.screen ? voiceState.stopShare() : voiceState.share())}
            camera={!!voiceState.cam}
            onCamera={() => (voiceState.cam ? voiceState.stopCamera() : voiceState.startCamera())}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {shares.length + cams.length > 0 && <Stage me={me} shares={shares} cams={cams} />}
          {target ? (
            <Chat key={target.id} me={me} target={target} moderator={target.kind === "channel" && moderator} onLeft={() => setTarget(null)} focused={focused} onSeen={markRead} />
          ) : (
            <div className="grid flex-1 place-items-center bg-card text-sm text-dim">
              {server ? "Este servidor não tem canais de texto." : "Escolha uma conversa ou comece uma nova."}
            </div>
          )}
        </div>
        {server && <Members server={server} me={me} moderator={moderator} presence={presence} />}
      </div>
    </ProfileProvider>
  );
}
