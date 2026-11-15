import { useEffect, useRef, useState } from "preact/hooks";
import { loadMedia } from "../data/testsets.ts";
import type { TestSet } from "../lib/testset.ts";
import { toast } from "./common.tsx";

/**
 * The audio of a Listening set: one element, the files read from the device store. Used by the test (TestSets.tsx) and
 * by the Part marks screen (PartMarks.tsx).
 */
export interface Player {
  /** The track playing or paused on, null before the first play. */
  track: number | null;
  playing: boolean;
  at: number;
  duration: number;
  play(track: number, chain?: boolean): Promise<void>;
  /** Plays one stretch of a file (ms), then stops: a question heard again. */
  playRange(track: number, from: number, to: number): Promise<void>;
  /** Plays a Part's window: from `from` (ms) to `to`, or to the end of the file when `to` is null. */
  playWindow(track: number, from: number, to: number | null): Promise<void>;
  /** Moves to `ms` in `track` without playing (marking a Part). */
  seekTo(track: number, ms: number): Promise<void>;
  /** Moves the position by `ms` (negative = back) within the file, playing or not; `bounds` (ms) keeps it inside a Part's window. */
  skip(ms: number, bounds?: { min: number; max: number | null }): void;
  toggle(): void;
  pause(): void;
}

/**
 * One audio element for the set. `chain` plays the next file when one ends (a test whose Part is split over files);
 * a file is read from the device store once and kept as an object URL while the test is open.
 */
export function usePlayer(set: TestSet): Player | null {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<number, string>());
  const chain = useRef(false);
  const stopAt = useRef<number | null>(null);
  const [state, setState] = useState({ track: null as number | null, playing: false, at: 0, duration: 0 });
  const tracks = set.tracks ?? [];

  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    audio.current = a;
    const sync = () => setState((s) => ({ ...s, playing: !a.paused, at: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0 }));
    for (const ev of ["play", "pause", "timeupdate", "loadedmetadata"]) a.addEventListener(ev, sync);
    a.addEventListener("timeupdate", () => {
      if (stopAt.current !== null && a.currentTime * 1000 >= stopAt.current) {
        stopAt.current = null;
        a.pause();
      }
    });
    a.addEventListener("ended", () => {
      const i = Number(a.dataset.track);
      if (chain.current && i + 1 < tracks.length) void play(i + 1, true);
      else sync();
    });
    const onHide = () => document.visibilityState === "hidden" && a.pause();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      a.pause();
      document.removeEventListener("visibilitychange", onHide);
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current.clear();
    };
  }, [set.id]);

  /** Points the audio element at `track` (read from the device store once), ready to play. */
  async function ensure(track: number): Promise<HTMLAudioElement | null> {
    const a = audio.current;
    const t = tracks[track];
    if (!a || !t) return null;
    let url = urls.current.get(track);
    if (!url) {
      const blob = await loadMedia(t.key);
      if (!blob) {
        toast(`Không thấy file nghe “${t.name}” trên máy này`);
        return null;
      }
      url = URL.createObjectURL(blob);
      urls.current.set(track, url);
    }
    if (a.dataset.track !== String(track)) {
      a.src = url;
      a.dataset.track = String(track);
    } else if (a.ended) a.currentTime = 0;
    return a;
  }

  async function seek(a: HTMLAudioElement, ms: number) {
    if (a.readyState < 1) await new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }));
    a.currentTime = Math.max(0, ms) / 1000;
  }

  async function play(track: number, keepGoing = false, from?: number, to?: number | null) {
    chain.current = keepGoing;
    stopAt.current = to ?? null;
    const a = await ensure(track);
    if (!a) return;
    if (from !== undefined) await seek(a, from);
    setState((s) => ({ ...s, track }));
    await a.play().catch(() => toast("Trình duyệt chặn phát âm thanh: bấm phát lại"));
  }

  if (!tracks.length) return null;
  return {
    ...state,
    play: (track, keepGoing) => play(track, keepGoing),
    playRange: (track, from, to) => play(track, false, from, to),
    playWindow: (track, from, to) => play(track, false, from, to),
    seekTo: async (track, ms) => {
      stopAt.current = null;
      chain.current = false;
      const a = await ensure(track);
      if (!a) return;
      await seek(a, ms);
      setState((s) => ({ ...s, track, at: ms / 1000, duration: Number.isFinite(a.duration) ? a.duration : s.duration }));
    },
    skip: (ms, bounds) => {
      const a = audio.current;
      if (!a || state.track === null) return;
      const file = Number.isFinite(a.duration) ? a.duration : Infinity;
      const lo = Math.max(0, (bounds?.min ?? 0) / 1000);
      const hi = Math.min(file, bounds?.max != null ? bounds.max / 1000 : Infinity);
      a.currentTime = Math.min(hi, Math.max(lo, a.currentTime + ms / 1000));
      setState((s) => ({ ...s, at: a.currentTime }));
    },
    toggle: () => {
      const a = audio.current;
      if (!a) return;
      if (state.track === null) void play(0, true);
      else if (a.paused) void a.play();
      else a.pause();
    },
    pause: () => audio.current?.pause(),
  };
}

