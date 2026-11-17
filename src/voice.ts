import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { errorText, supabase } from "./lib";

const STUN: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * TURN relays audio for peers behind strict NAT. Short-lived credentials come from the
 * `turn` edge function (supabase/functions/turn); if it is not deployed or fails, STUN only.
 */
async function iceServers(): Promise<RTCIceServer[]> {
  const { data, error } = await supabase.functions.invoke<{ iceServers: RTCIceServer[] }>("turn");
  return error || !data?.iceServers ? STUN : [...STUN, ...data.iceServers];
}

type Signal = { from: string; to: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; queue: RTCIceCandidateInit[] };

/**
 * Mesh voice chat: one RTCPeerConnection per other person in the room, signalling over a
 * Supabase broadcast channel. `peers` comes from presence (who is in this room right now).
 * Only the lower user id sends the offer for a pair, so two peers never offer at once.
 * ponytail: mesh = every peer uploads to every other, fine for ~8 people. An SFU (LiveKit) beyond that.
 * The channel is private: Realtime only lets members of the voice channel's server in (supabase/004_private_voice.sql).
 */
export function useVoice(me: string, room: string | null, peers: string[], muted: boolean, deafened: boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const conns = useRef(new Map<string, Peer>());
  const chan = useRef<RealtimeChannel | null>(null);
  const ice = useRef<RTCConfiguration>({ iceServers: STUN });
  const deaf = useRef(deafened);
  deaf.current = deafened;

  const send = (s: Omit<Signal, "from">) =>
    chan.current?.send({ type: "broadcast", event: "signal", payload: { ...s, from: me } });

  function connect(id: string) {
    const existing = conns.current.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection(ice.current);
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = deaf.current;
    const peer: Peer = { pc, audio, queue: [] };
    stream.current?.getTracks().forEach((t) => pc.addTrack(t, stream.current!));
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };
    pc.onicecandidate = (e) => e.candidate && send({ to: id, candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") drop(id);
    };
    conns.current.set(id, peer);
    return peer;
  }

  function drop(id: string) {
    const p = conns.current.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    conns.current.delete(id);
  }

  async function onSignal(s: Signal) {
    if (s.to !== me) return;
    const peer = connect(s.from);
    if (s.description) {
      await peer.pc.setRemoteDescription(s.description);
      if (s.description.type === "offer") {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        send({ to: s.from, description: peer.pc.localDescription!.toJSON() });
      }
      for (const c of peer.queue.splice(0)) await peer.pc.addIceCandidate(c);
    } else if (s.candidate) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.candidate);
      else peer.queue.push(s.candidate);
    }
  }

  // join / leave the room: mic first, then the signalling channel; `ready` tells the caller to announce us in presence
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    setError(null);
    Promise.all([navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), iceServers()])
      .then(([s, servers]) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        ice.current = { iceServers: servers };
        chan.current = supabase
          .channel(`voice:${room}`, { config: { private: true } })
          .on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload as Signal).catch(console.error))
          .subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") setReady(true);
            else if (status === "CHANNEL_ERROR") setError("Sem permissão para entrar neste canal de voz.");
          });
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      cancelled = true;
      setReady(false);
      [...conns.current.keys()].forEach(drop);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (chan.current) supabase.removeChannel(chan.current);
      chan.current = null;
    };
  }, [room, me]);

  // presence changed: call new peers (if we are the lower id), hang up on peers that left
  const key = peers.slice().sort().join(",");
  useEffect(() => {
    if (!ready) return;
    const want = new Set(peers.filter((p) => p !== me));
    for (const id of conns.current.keys()) if (!want.has(id)) drop(id);
    for (const id of want) {
      if (conns.current.has(id) || me > id) continue;
      const { pc } = connect(id);
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => send({ to: id, description: pc.localDescription!.toJSON() }))
        .catch(console.error);
    }
  }, [ready, key]);

  useEffect(() => {
    stream.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, [muted, ready]);

  useEffect(() => {
    conns.current.forEach((p) => (p.audio.muted = deafened));
  }, [deafened]);

  return { ready, error };
}
