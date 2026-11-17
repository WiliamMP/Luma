import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { configured, errorText, supabase, type Server, type Target } from "./lib";
import { useVoice } from "./voice";
import { useInbox } from "./unread";
import { Auth } from "./components/Auth";
import { Rail } from "./components/Rail";
import { DmSidebar, ServerSidebar, UserPanel, type Presence } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { Members } from "./components/Members";
import { Stage } from "./components/Stage";
import { ProfileProvider } from "./components/Profile";
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

/** checks GitHub Releases once on startup; installers are signed, the app only accepts our key (pubkey in tauri.conf.json) */
function UpdateBar() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    check().then(setUpdate, () => {}); // no internet / dev build: stay quiet
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
  const [voice, setVoice] = useState<{ id: string; name: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const online = useRef<RealtimeChannel | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [focused, setFocused] = useState(document.hasFocus());
  const { unread, markRead } = useInbox(me, target, focused);

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => (window.removeEventListener("focus", on), window.removeEventListener("blur", off));
  }, []);

  const peers = [...presence].filter(([, p]) => voice && p.voice === voice.id).map(([id]) => id);
  const voiceState = useVoice(me, voice?.id ?? null, peers, muted || deafened, deafened);

  const loadServers = () =>
    supabase.from("servers").select("id, name, owner_id").order("created_at").then(({ data }) => setServers(data ?? []));

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
      const state = ch.presenceState<{ voice: string | null; screen?: boolean }>();
      setPresence(new Map(Object.entries(state).map(([id, metas]) => [id, { voice: metas[0]?.voice ?? null, screen: !!metas[0]?.screen }])));
    }).subscribe((s) => setSubscribed(s === "SUBSCRIBED"));
    online.current = ch;
    return () => void supabase.removeChannel(ch);
  }, [me]);

  // announce our voice room only once the signalling channel is up, so peers do not call us too early
  useEffect(() => {
    const room = voiceState.ready ? voice?.id ?? null : null;
    if (subscribed) online.current?.track({ voice: room, screen: !!room && !!voiceState.screen });
  }, [subscribed, voiceState.ready, voice?.id, !!voiceState.screen]);

  // screens shared in my voice room (mine included)
  const shares = voice
    ? peers.filter((id) => presence.get(id)?.screen).map((id) => ({ id, stream: id === me ? voiceState.screen : voiceState.remote.get(id) ?? null }))
    : [];

  const server = servers.find((s) => s.id === selected);
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

  return (
    <ProfileProvider me={me} onDm={toDm}>
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
              onVoice={(c) => setVoice({ id: c.id, name: `${c.name} / ${server.name}` })}
              onGone={() => (loadServers(), pick("home"))}
              onRenamed={loadServers}
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
            sharing={!!voiceState.screen}
            onShare={() => (voiceState.screen ? voiceState.stopShare() : voiceState.share())}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {shares.length > 0 && <Stage shares={shares} />}
          {target ? (
            <Chat key={target.id} me={me} target={target} focused={focused} onSeen={markRead} />
          ) : (
            <div className="grid flex-1 place-items-center bg-card text-sm text-dim">
              {server ? "Este servidor não tem canais de texto." : "Escolha uma conversa ou comece uma nova."}
            </div>
          )}
        </div>
        {server && <Members server={server} me={me} presence={presence} />}
      </div>
    </ProfileProvider>
  );
}
