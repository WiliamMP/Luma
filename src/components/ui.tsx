import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn, useFileUrl, useProfile, type Status } from "@/lib";

export const STATUS_DOT: Record<Status, string> = { online: "bg-online", away: "bg-[#f5a524]", dnd: "bg-danger" };

const hues = ["#7c5cff", "#3ecf8e", "#f0475b", "#f5a524", "#23b5d3", "#e85dce"];

export function Initials({ name, url, size = 40, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  const color = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return url ? (
    <img src={url} alt="" className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
  ) : (
    <div
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** `online`: a status shows its colored dot, false a grey (offline) dot, undefined no dot */
export function Avatar({ id, size = 40, online }: { id: string; size?: number; online?: Status | false }) {
  const p = useProfile(id);
  const url = useFileUrl(p?.avatar_url);
  return (
    <div className="relative shrink-0">
      <Initials name={p?.username ?? "?"} url={url} size={size} />
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-panel",
            online ? STATUS_DOT[online] : "bg-dim",
          )}
        />
      )}
    </div>
  );
}

export function Name({ id, className }: { id: string; className?: string }) {
  return <span className={className}>{useProfile(id)?.username ?? "…"}</span>;
}

/** red unread pill */
export function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[11px] leading-none font-bold text-white", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-[420px] rounded-xl border border-line bg-card p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-dim hover:text-fg" onClick={onClose} aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const input =
  "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-dim focus:border-primary";
export const button =
  "rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50";
/** red variant: adding bg-danger to `button` loses to bg-primary in the generated CSS, so it gets its own string */
export const dangerButton = button.replace("bg-primary", "bg-danger");
export const ghost = "rounded-md px-4 py-2 text-sm text-dim transition hover:bg-raised hover:text-fg";
