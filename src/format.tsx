import type { ReactNode } from "react";
import { open } from "./lib";

/**
 * Message text -> React nodes. A small Markdown subset, no HTML is ever injected:
 * ```code block```, `code`, **bold**, *italic*, ~~strike~~, links and @mentions.
 * No nesting (bold inside italic etc. stays literal).
 */
export function format(text: string, me: string | undefined): ReactNode[] {
  return text.split(/```(?:\w*\n)?([\s\S]*?)```/g).flatMap<ReactNode>((part, i) =>
    i % 2
      ? [
          <pre key={`b${i}`} className="selectable my-1 overflow-x-auto rounded-md bg-bg px-3 py-2 font-mono text-[13px]">
            {part.replace(/\n$/, "")}
          </pre>,
        ]
      : inlineCode(part, me, `b${i}`),
  );
}

function inlineCode(text: string, me: string | undefined, key: string): ReactNode[] {
  return text.split(/`([^`\n]+)`/g).flatMap<ReactNode>((part, i) =>
    i % 2
      ? [
          <code key={`${key}c${i}`} className="rounded bg-bg px-1 py-0.5 font-mono text-[13px]">
            {part}
          </code>,
        ]
      : spans(part, me, `${key}c${i}`),
  );
}

// *italic* only when the stars are not glued to a word, so "2*3 e 4*5" stays as typed;
// @mention not inside an email, and a trailing "." ends the sentence, not the name
const TOKEN = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<![\w*])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![\w*])|https?:\/\/\S+|(?<![\w.])@[a-zA-Z0-9_.]*[a-zA-Z0-9_])/g;

function spans(text: string, me: string | undefined, key: string): ReactNode[] {
  return text.split(TOKEN).map((t, i) => {
    const k = `${key}s${i}`;
    if (i % 2 === 0) return t;
    if (t.startsWith("**")) return <strong key={k}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("~~")) return <s key={k}>{t.slice(2, -2)}</s>;
    if (t.startsWith("*")) return <em key={k}>{t.slice(1, -1)}</em>;
    if (t.startsWith("@")) {
      const mine = !!me && t.slice(1).toLowerCase() === me.toLowerCase();
      return (
        <span key={k} className={`rounded px-0.5 font-medium ${mine ? "bg-primary/30 text-white" : "bg-primary/15 text-primary"}`}>
          {t}
        </span>
      );
    }
    return (
      <a key={k} href={t} className="text-primary hover:underline" onClick={(e) => (e.preventDefault(), open(t))}>
        {t}
      </a>
    );
  });
}

/** does this text @mention `username`? (whole name, any case) */
export function mentions(text: string, username: string | undefined) {
  if (!username) return false;
  const name = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // any character, in case a name was set outside the app
  // a "." right after the name ends the sentence ("valeu @will."), but "@will.dev" is someone else
  return new RegExp(`(^|[^\\w.])@${name}(?!\\w|\\.\\w)`, "i").test(text);
}

// ponytail: self-check for the parts that are easy to break; runs only in dev
if (import.meta.env.DEV) {
  console.assert(mentions("oi @Will!", "will"), "mention at end");
  console.assert(!mentions("oi @william", "will"), "prefix is not a mention");
  console.assert(!mentions("mail a@will", "will"), "email is not a mention");
  console.assert(mentions("@will.dev ok", "will.dev"), "dot in name");
  console.assert(!mentions("@willxdev", "will.dev"), "dot is literal");
  console.assert(mentions("valeu @will.", "will"), "sentence-ending period");
  console.assert(!mentions("@will.dev", "will"), "longer dotted name");
  console.assert(!mentions("@a", "a(b"), "odd characters do not throw");
}
