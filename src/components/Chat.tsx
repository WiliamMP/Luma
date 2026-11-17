import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AtSign, CornerUpLeft, FileText, Hash, Loader2, Pencil, PlusCircle, Reply, SmilePlus, Trash2, X } from "lucide-react";
import { errorText, fileUrl, isImage, open, supabase, upload, useFileUrl, useProfile, type Message, type Target } from "@/lib";
import { Avatar, Name } from "./ui";
import { useProfileCard } from "./Profile";

const GROUP_MS = 5 * 60 * 1000;
const PAGE = 100;
const COLUMNS = "id, author_id, content, attachment_url, created_at, edited_at, reply_to, reactions";
const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

export function Chat({ me, target, focused, onSeen }: {
  me: string;
  target: Target;
  focused: boolean;
  onSeen: (target: string, lastId: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [replying, setReplying] = useState<Message | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** user id -> time their "typing" expires */
  const [typing, setTyping] = useState<Map<string, number>>(new Map());
  const typingChan = useRef<RealtimeChannel | null>(null);
  const lastTyped = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const loadingOlder = useRef(false);
  /** distance from the bottom to keep after older messages are prepended, so the view does not jump */
  const anchor = useRef<number | null>(null);
  const current = useRef(target.id);
  current.current = target.id;
  const col = target.kind === "channel" ? "channel_id" : "dm_id";

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setReplying(null);
    setEditing(null);
    let live = true;
    supabase
      .from("messages")
      .select(COLUMNS)
      .eq(col, target.id)
      .order("id", { ascending: false })
      .limit(PAGE)
      .then(({ data }) => {
        if (!live) return;
        setMessages((data ?? []).reverse());
        setHasMore(data?.length === PAGE);
      });
    const sub = supabase
      .channel(`messages:${target.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `${col}=eq.${target.id}` }, ({ new: m }) => {
        setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m as Message]));
        setTyping((t) => (t.has(m.author_id) ? new Map([...t].filter(([id]) => id !== m.author_id)) : t));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `${col}=eq.${target.id}` }, ({ new: m }) =>
        replace(m as Message),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, ({ old }) =>
        setMessages((prev) => prev.filter((p) => p.id !== old.id)),
      )
      .subscribe();
    return () => {
      live = false;
      void supabase.removeChannel(sub);
    };
  }, [target.id]);

  // "X está digitando…": private broadcast per channel/DM (supabase/005_features.sql), each ping lasts 4 s
  useEffect(() => {
    const ch = supabase
      .channel(`typing:${target.id}`, { config: { private: true } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const id = (payload as { user: string }).user;
        if (id !== me) setTyping((t) => new Map(t).set(id, Date.now() + 4000));
      })
      .subscribe();
    typingChan.current = ch;
    const sweep = setInterval(() => {
      const now = Date.now();
      setTyping((t) => ([...t.values()].some((until) => until <= now) ? new Map([...t].filter(([, until]) => until > now)) : t));
    }, 1000);
    return () => {
      clearInterval(sweep);
      supabase.removeChannel(ch);
      typingChan.current = null;
      setTyping(new Map());
    };
  }, [target.id]);

  function onType(value: string) {
    setText(value);
    if (!value || Date.now() - lastTyped.current < 2500) return;
    lastTyped.current = Date.now();
    typingChan.current?.send({ type: "broadcast", event: "typing", payload: { user: me } });
  }

  async function loadOlder() {
    const oldest = messages[0]?.id;
    if (!hasMore || loadingOlder.current || !oldest) return;
    loadingOlder.current = true;
    const id = target.id;
    const { data } = await supabase.from("messages").select(COLUMNS).eq(col, id).lt("id", oldest).order("id", { ascending: false }).limit(PAGE);
    loadingOlder.current = false;
    if (!data || id !== current.current) return; // failed (next scroll retries) or the user switched channel meanwhile
    const el = list.current!;
    anchor.current = el.scrollHeight - el.scrollTop;
    setHasMore(data.length === PAGE);
    setMessages((prev) => [...data.reverse(), ...prev]);
  }

  // on screen and the window is in front: everything up to the last message is read
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (focused && lastId) onSeen(target.id, lastId);
  }, [focused, lastId]);

  // stick to the bottom when new messages arrive; keep the position when older ones are prepended
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = anchor.current === null ? el.scrollHeight : el.scrollHeight - anchor.current;
    anchor.current = null;
  }, [messages.length]);

  const replace = (m: Message) => setMessages((prev) => prev.map((p) => (p.id === m.id ? m : p)));

  /** the reply (if any) goes with the first thing sent after picking "Responder" */
  function takeReply() {
    const id = replying?.id ?? null;
    setReplying(null);
    return id;
  }

  async function send(content: string, attachment_url: string | null = null, reply_to: number | null = null) {
    setErr(null);
    const { data, error } = await supabase
      .from("messages")
      .insert({ [col]: target.id, content, attachment_url, reply_to })
      .select(COLUMNS)
      .single();
    if (error) return setErr(errorText(error));
    setMessages((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data]));
  }

  async function attach(files: FileList | File[]) {
    setBusy(true);
    let reply = takeReply();
    try {
      for (const f of files) {
        await send("", await upload(me, f), reply);
        reply = null;
      }
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  }

  async function saveEdit(m: Message, content: string) {
    setEditing(null);
    if (!content || content === m.content) return;
    const { data, error } = await supabase.from("messages").update({ content }).eq("id", m.id).select(COLUMNS).single();
    if (error) setErr(errorText(error));
    else replace(data);
  }

  async function react(m: Message, emoji: string) {
    const { data, error } = await supabase.rpc("toggle_reaction", { mid: m.id, emoji });
    if (error) setErr(errorText(error));
    else setMessages((prev) => prev.map((p) => (p.id === m.id ? { ...p, reactions: data } : p)));
  }

  function startReply(m: Message) {
    setReplying(m);
    composer.current?.focus();
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && replying) return setReplying(null);
    // arrow up in an empty box edits my last text message
    if (e.key === "ArrowUp" && !text) {
      const last = [...messages].reverse().find((m) => m.author_id === me && m.content);
      if (last) (e.preventDefault(), setEditing(last.id));
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    send(t, null, takeReply());
  }

  const byId = new Map(messages.map((m) => [m.id, m]));

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) attach([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-bg/80 text-lg font-semibold">
          Solte para enviar em {target.kind === "channel" ? "#" : "@"}
          {target.name}
        </div>
      )}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 font-semibold">
        {target.kind === "channel" ? <Hash className="size-5 text-dim" /> : <AtSign className="size-5 text-dim" />}
        {target.name}
      </header>
      <div ref={list} className="selectable flex-1 overflow-y-auto py-4" onScroll={(e) => e.currentTarget.scrollTop < 300 && loadOlder()}>
        {hasMore && <Loader2 className="mx-auto mb-2 size-5 animate-spin text-dim" />}
        {messages.length === 0 && <p className="px-4 text-sm text-dim">Nenhuma mensagem ainda. Diga oi!</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && !m.reply_to && prev.author_id === m.author_id && +new Date(m.created_at) - +new Date(prev.created_at) < GROUP_MS;
          return (
            <Row
              key={m.id}
              m={m}
              parent={m.reply_to ? byId.get(m.reply_to) : undefined}
              grouped={!!grouped}
              me={me}
              editing={editing === m.id}
              onReact={(emoji) => react(m, emoji)}
              onReply={() => startReply(m)}
              onEdit={() => setEditing(m.id)}
              onEditDone={(content) => (content === null ? setEditing(null) : saveEdit(m, content))}
            />
          );
        })}
      </div>
      <div className="px-4 pb-1">
        {err && <p className="pb-1 text-sm text-danger">{err}</p>}
        {replying && (
          <div className="flex items-center gap-1 rounded-t-lg bg-raised/60 px-3 py-1.5 text-sm text-dim">
            Respondendo a <Name id={replying.author_id} className="font-medium text-fg" />
            <span className="flex-1" />
            <button title="Cancelar resposta" className="hover:text-fg" onClick={() => setReplying(null)}>
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className={`flex items-start gap-2 bg-raised px-3 py-2.5 ${replying ? "rounded-b-lg" : "rounded-lg"}`}>
          <label title="Enviar arquivo" className="cursor-pointer pt-0.5 text-dim hover:text-fg">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <PlusCircle className="size-5" />}
            <input type="file" multiple hidden onChange={(e) => e.target.files && attach(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          <textarea
            ref={composer}
            rows={1}
            className="max-h-48 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-dim [field-sizing:content]"
            placeholder={`Conversar em ${target.kind === "channel" ? "#" : "@"}${target.name}`}
            value={text}
            maxLength={4000}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) (e.preventDefault(), attach(files));
            }}
            autoFocus
          />
        </div>
        <Typing ids={[...typing.keys()]} />
      </div>
    </div>
  );
}

function Typing({ ids }: { ids: string[] }) {
  const names =
    ids.length === 0 ? null : ids.length > 3 ? (
      "Várias pessoas estão digitando…"
    ) : (
      <>
        {ids.map((id, i) => (
          <span key={id}>
            {i > 0 && (i === ids.length - 1 ? " e " : ", ")}
            <Name id={id} className="font-semibold text-fg" />
          </span>
        ))}
        {ids.length === 1 ? " está digitando…" : " estão digitando…"}
      </>
    );
  return <div className="h-4 truncate px-1 pt-0.5 text-xs text-dim">{names}</div>;
}

function Row({ m, parent, grouped, me, editing, onReact, onReply, onEdit, onEditDone }: {
  m: Message;
  parent: Message | undefined;
  grouped: boolean;
  me: string;
  editing: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  /** new text, or null when cancelled */
  onEditDone: (content: string | null) => void;
}) {
  const author = useProfile(m.author_id);
  const card = useProfileCard();
  const time = new Date(m.created_at);
  const mine = m.author_id === me;
  const [picking, setPicking] = useState(false);
  const tool = "rounded p-1 text-dim hover:bg-raised hover:text-fg";
  const reactions = Object.entries(m.reactions ?? {});
  return (
    <div
      id={`msg-${m.id}`}
      className={`group relative px-4 hover:bg-raised/40 ${grouped ? "py-0.5" : "mt-3 py-0.5"}`}
      onMouseLeave={() => setPicking(false)}
    >
      {m.reply_to && <Quote id={m.reply_to} loaded={parent} />}
      <div className="flex gap-4">
        <div className="w-10 shrink-0">
          {grouped ? (
            <span className="invisible pt-1 text-[11px] text-dim group-hover:visible">
              {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <button className="rounded-full" onClick={() => card.show(m.author_id)}>
              <Avatar id={m.author_id} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <button className="font-medium hover:underline" onClick={() => card.show(m.author_id)}>
                {author?.username ?? "…"}
              </button>
              <span className="text-xs text-dim">{time.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
            </div>
          )}
          {editing ? (
            <EditBox initial={m.content} onDone={onEditDone} />
          ) : (
            m.content && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                {linkify(m.content)}
                {m.edited_at && (
                  <span className="ml-1 text-[11px] text-dim" title={new Date(m.edited_at).toLocaleString()}>
                    (editado)
                  </span>
                )}
              </p>
            )
          )}
          {m.attachment_url && <Attachment path={m.attachment_url} />}
          {reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {reactions.map(([emoji, users]) => (
                <button
                  key={emoji}
                  title={users.length === 1 ? "1 reação" : `${users.length} reações`}
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm ${users.includes(me) ? "border-primary bg-primary/15" : "border-line bg-raised hover:border-dim"}`}
                  onClick={() => onReact(emoji)}
                >
                  <span>{emoji}</span>
                  <span className="text-xs text-dim">{users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {picking && (
        <div className="absolute -top-12 right-4 z-10 flex gap-0.5 rounded-lg border border-line bg-card p-1 shadow-xl">
          {QUICK_EMOJI.map((emoji) => (
            <button key={emoji} className="rounded p-1 text-lg hover:bg-raised" onClick={() => (onReact(emoji), setPicking(false))}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      {!editing && (
        <div className="absolute -top-3 right-4 hidden gap-0.5 rounded border border-line bg-card p-0.5 shadow group-hover:flex">
          <button title="Reagir" className={tool} onClick={() => setPicking(!picking)}>
            <SmilePlus className="size-4" />
          </button>
          <button title="Responder" className={tool} onClick={onReply}>
            <Reply className="size-4" />
          </button>
          {mine && m.content && (
            <button title="Editar" className={tool} onClick={onEdit}>
              <Pencil className="size-4" />
            </button>
          )}
          {mine && (
            <button title="Apagar" className={`${tool} hover:text-danger`} onClick={() => supabase.from("messages").delete().eq("id", m.id)}>
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditBox({ initial, onDone }: { initial: string; onDone: (content: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="py-1">
      <textarea
        className="max-h-60 w-full resize-none rounded-md bg-raised px-3 py-2 text-[15px] outline-none [field-sizing:content]"
        value={value}
        maxLength={4000}
        autoFocus
        onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone(null);
          else if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), onDone(value.trim()));
        }}
      />
      <div className="text-[11px] text-dim">Esc para cancelar · Enter para salvar</div>
    </div>
  );
}

// replied-to messages that are not in the loaded page are fetched once (RLS still applies)
const parents = new Map<number, Promise<Message | null>>();

function Quote({ id, loaded }: { id: number; loaded: Message | undefined }) {
  const [fetched, setFetched] = useState<Message | null | undefined>(undefined); // undefined: loading, null: gone or not visible
  useEffect(() => {
    if (loaded) return;
    if (!parents.has(id)) parents.set(id, Promise.resolve(supabase.from("messages").select(COLUMNS).eq("id", id).maybeSingle()).then(({ data }) => data));
    let live = true;
    parents.get(id)!.then((m) => live && setFetched(m));
    return () => void (live = false);
  }, [id, loaded]);
  const m = loaded ?? fetched;

  function jump() {
    const el = document.getElementById(`msg-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.animate([{ backgroundColor: "rgb(124 92 255 / 0.25)" }, { backgroundColor: "transparent" }], { duration: 1500 });
  }

  return (
    <button className="mb-0.5 ml-5 flex max-w-full items-center gap-1.5 text-left text-[13px] text-dim hover:text-fg" onClick={jump}>
      <CornerUpLeft className="size-3.5 shrink-0" />
      {m ? (
        <>
          <Avatar id={m.author_id} size={16} />
          <Name id={m.author_id} className="shrink-0 font-medium" />
          <span className="truncate">{m.content || "Enviou um arquivo"}</span>
        </>
      ) : (
        <span className="italic">{fetched === null ? "Mensagem indisponível" : "…"}</span>
      )}
    </button>
  );
}

/** `path` is a storage path (private bucket) or, for old messages, a full public URL */
function Attachment({ path }: { path: string }) {
  const url = useFileUrl(path);
  const name = decodeURIComponent(path.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-/, "");
  // signed URLs expire after an hour: ask for a fresh one when opening
  const show = () => fileUrl(path).then((u) => u && open(u));
  return isImage(path) ? (
    url ? (
      <img src={url} alt={name} className="mt-1 max-h-80 max-w-md cursor-pointer rounded-lg" onClick={show} />
    ) : (
      <div className="mt-1 h-40 w-64 animate-pulse rounded-lg bg-raised" />
    )
  ) : (
    <button className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary hover:underline" onClick={show}>
      <FileText className="size-5" /> {name}
    </button>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} className="text-primary hover:underline" onClick={(e) => (e.preventDefault(), open(part))}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}
