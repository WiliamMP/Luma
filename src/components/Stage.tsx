import { useEffect, useRef, useState } from "react";
import { Maximize, MonitorUp } from "lucide-react";
import { cn } from "@/lib";
import { Name } from "./ui";

/** screens shared in my voice room, above the chat; tabs when more than one person shares */
export function Stage({ shares }: { shares: { id: string; stream: MediaStream | null }[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const current = shares.find((s) => s.id === pick) ?? shares[0];
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = current?.stream ?? null;
  }, [current?.stream]);

  return (
    <div className="flex h-[55%] shrink-0 flex-col border-b border-line bg-black">
      <div className="flex items-center gap-1 bg-bg px-3 py-1.5 text-sm">
        <MonitorUp className="mr-1 size-4 text-online" />
        {shares.map((s) => (
          <button
            key={s.id}
            className={cn("rounded px-2 py-0.5", s.id === current?.id ? "bg-raised text-fg" : "text-dim hover:text-fg")}
            onClick={() => setPick(s.id)}
          >
            <Name id={s.id} />
          </button>
        ))}
        <span className="flex-1" />
        <button title="Tela cheia" className="text-dim hover:text-fg" onClick={() => video.current?.requestFullscreen()}>
          <Maximize className="size-4" />
        </button>
      </div>
      <video ref={video} autoPlay muted playsInline className="min-h-0 flex-1 object-contain" />
    </div>
  );
}
