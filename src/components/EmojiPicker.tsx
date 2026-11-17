import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

// ponytail: a fixed list instead of an emoji library; add a dataset with search if people miss emoji
const EMOJI = [
  "😀", "😁", "😂", "🤣", "😅", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳",
  "🤔", "🤨", "😐", "🙄", "😏", "😴", "😮", "😲", "😳", "🥺", "😢", "😭",
  "😤", "😡", "🤯", "😱", "🤗", "🤭", "🫡", "🤝", "👍", "👎", "👏", "🙌",
  "🙏", "💪", "👀", "👋", "✌️", "🤞", "👌", "🫶", "❤️", "🧡", "💛", "💚",
  "💙", "💜", "🖤", "💔", "🔥", "✨", "⭐", "🎉", "🎂", "🎁", "🏆", "⚽",
  "🎮", "🎧", "🎵", "📸", "💻", "📱", "☕", "🍕", "🍔", "🍺", "🌙", "☀️",
  "🌧️", "🌈", "🐶", "🐱", "💯", "✅", "❌", "⚠️", "❓", "💤", "💀", "👻",
];

/** smiley button in the composer; a click on an emoji inserts it where the caret is */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // click anywhere else or Esc closes it
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => (window.removeEventListener("mousedown", close), window.removeEventListener("keydown", close));
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button title="Emoji" className="pt-0.5 text-dim hover:text-fg" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        <Smile className="size-5" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-9 z-20 grid w-[332px] grid-cols-9 gap-0.5 rounded-lg border border-line bg-bg p-2 shadow-2xl">
          {EMOJI.map((e) => (
            // mousedown keeps the focus (and the caret) in the text box
            <button key={e} className="rounded p-1 text-xl hover:bg-raised" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
