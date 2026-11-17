import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AtSign, FileText, Hash, Loader2, PlusCircle, Trash2 } from "lucide-react";
import { errorText, fileUrl, isImage, open, supabase, upload, useFileUrl, useProfile, type Message, type Target } from "@/lib";
import { Avatar } from "./ui";
import { useProfileCard } from "./Profile";

const GROUP_MS = 5 * 60 * 1000;
const PAGE = 100;
const COLUMNS = "id, author_id, content, attachment_url, created_at";

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
  const list = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  /** distance from the bottom to keep after older messages are prepended, so the view does not jump */
  const anchor = useRef<number | null>(null);
  const current = useRef(target.id);
  current.current = target.id;
  const col = target.kind === "channel" ? "channel_id" : "dm_id";

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `${col}=eq.${target.id}` }, ({ new: m }) =>
        setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m as Message])),
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

  async function send(content: string, attachment_url: string | null = null) {
    setErr(null);
    const { data, error } = await supabase
      .from("messages")
      .insert({ [col]: target.id, content, attachment_url })
      .select(COLUMNS)
      .single();
    if (error) return setErr(errorText(error));
    setMessages((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data]));
  }

  async function attach(files: FileList | File[]) {
    setBusy(true);
    try {
      for (const f of files) await send("", await upload(me, f));
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    send(t);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 font-semibold">
        {target.kind === "channel" ? <Hash className="size-5 text-dim" /> : <AtSign className="size-5 text-dim" />}
        {target.name}
      </header>
      <div ref={list} className="selectable flex-1 overflow-y-auto py-4" onScroll={(e) => e.currentTarget.scrollTop < 300 && loadOlder()}>
        {hasMore && <Loader2 className="mx-auto mb-2 size-5 animate-spin text-dim" />}
        {messages.length === 0 && <p className="px-4 text-sm text-dim">Nenhuma mensagem ainda. Diga oi!</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.author_id === m.author_id && +new Date(m.created_at) - +new Date(prev.created_at) < GROUP_MS;
          return <Row key={m.id} m={m} grouped={!!grouped} mine={m.author_id === me} />;
        })}
      </div>
      <div className="px-4 pb-5">
        {err && <p className="pb-1 text-sm text-danger">{err}</p>}
        <div className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5">
          <label title="Enviar arquivo" className="cursor-pointer pt-0.5 text-dim hover:text-fg">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <PlusCircle className="size-5" />}
            <input type="file" multiple hidden onChange={(e) => e.target.files && attach(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          <textarea
            rows={1}
            className="max-h-48 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-dim [field-sizing:content]"
            placeholder={`Conversar em ${target.kind === "channel" ? "#" : "@"}${target.name}`}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) (e.preventDefault(), attach(files));
            }}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

function Row({ m, grouped, mine }: { m: Message; grouped: boolean; mine: boolean }) {
  const author = useProfile(m.author_id);
  const card = useProfileCard();
  const time = new Date(m.created_at);
  return (
    <div className={`group relative flex gap-4 px-4 hover:bg-raised/40 ${grouped ? "py-0.5" : "mt-3 py-0.5"}`}>
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
        {m.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{linkify(m.content)}</p>}
        {m.attachment_url && <Attachment path={m.attachment_url} />}
      </div>
      {mine && (
        <button
          title="Apagar"
          className="absolute top-0 right-4 hidden rounded border border-line bg-card p-1 text-dim hover:text-danger group-hover:block"
          onClick={() => supabase.from("messages").delete().eq("id", m.id)}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
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
