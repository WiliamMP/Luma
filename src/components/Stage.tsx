import { useEffect, useRef, useState } from "react";
import { Maximize, MonitorUp } from "lucide-react";
import { cn } from "@/lib";
import { Name } from "./ui";

type Feed = { id: string; stream: MediaStream | null };

/**
 * Video in my voice room, above the chat. With a shared screen: the screen big (tabs when several
 * people share) and the cameras in a column beside it. Cameras only: a grid of tiles.
 */
export function Stage({ me, shares, cams }: { me: string; shares: Feed[]; cams: Feed[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const current = shares.find((s) => s.id === pick) ?? shares[0];
  const big = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (big.current) big.current.srcObject = current?.stream ?? null;
  }, [current?.stream]);

  return (
    <div className="flex h-[55%] shrink-0 flex-col border-b border-line bg-black">
      {current && (
        <div className="flex items-center gap-1 bg-bg px-3 py-1.5 text-sm">
          <MonitorUp className="mr-1 size-4 text-online" />
          {shares.map((s) => (
            <button
              key={s.id}
              className={cn("rounded px-2 py-0.5", s.id === current.id ? "bg-raised text-fg" : "text-dim hover:text-fg")}
              onClick={() => setPick(s.id)}
            >
              <Name id={s.id} />
            </button>
          ))}
          <span className="flex-1" />
          <button title="Tela cheia" className="text-dim hover:text-fg" onClick={() => big.current?.requestFullscreen()}>
            <Maximize className="size-4" />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {current && <video ref={big} autoPlay muted playsInline className="min-h-0 min-w-0 flex-1 object-contain" />}
        {cams.length > 0 && (
          <div className={cn("flex min-h-0 gap-2 overflow-auto", current ? "w-56 shrink-0 flex-col" : "flex-1 flex-wrap content-center justify-center")}>
            {cams.map((c) => (
              <Tile key={c.id} feed={c} mirror={c.id === me} className={current ? "w-full" : "h-full max-h-60 min-h-32"} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** one camera; my own is mirrored, like looking in a mirror */
function Tile({ feed, mirror, className }: { feed: Feed; mirror: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = feed.stream;
  }, [feed.stream]);
  return (
    <div className={cn("relative aspect-video shrink-0 overflow-hidden rounded-lg bg-raised", className)}>
      <video ref={ref} autoPlay muted playsInline className={cn("size-full object-cover", mirror && "-scale-x-100")} />
      <Name id={feed.id} className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white" />
    </div>
  );
}
