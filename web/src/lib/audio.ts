/**
 * Finding each question inside a long Listening file, on the device: the file is decoded at a low rate, its loudness
 * measured every 50 ms, and the answer pauses (the silence after each question, 5 s in Part 1–2 and 8 s in Part 3–4
 * of a real test) mark where one question ends. Pure functions over the samples; decoding is in `decodeLevels`.
 */

export const FRAME_MS = 50;
/** Below this level (dBFS) a frame is silence: well above a studio recording's noise floor, below speech. */
export const SILENCE_DB = -40;
/** An answer pause is at least this long; the gaps between the options of one question are about 1 s. */
export const ANSWER_PAUSE_MS = 2500;

/** Loudness of each frame in dBFS (-100 for digital silence). */
export function frameLevels(samples: Float32Array, rate: number, frameMs = FRAME_MS): Float32Array {
  const size = Math.max(1, Math.round((rate * frameMs) / 1000));
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, end - f * size));
    out[f] = rms > 1e-5 ? 20 * Math.log10(rms) : -100;
  }
  return out;
}

/** Silent stretches of at least `minMs`, as [start, end] in ms; one that runs to the end of the file is kept. */
export function findGaps(levels: ArrayLike<number>, frameMs = FRAME_MS, minMs = 600, silenceDb = SILENCE_DB): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let start = -1;
  for (let f = 0; f <= levels.length; f++) {
    const quiet = f < levels.length && levels[f] < silenceDb;
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) {
      if ((f - start) * frameMs >= minMs) gaps.push([start * frameMs, f * frameMs]);
      start = -1;
    }
  }
  return gaps;
}

/**
 * Where each of `count` questions is in a file of `durationMs`: question k ends where its answer pause begins.
 * The answer pauses are the `count` longest gaps of at least ANSWER_PAUSE_MS (the directions before the first
 * question end in a pause too, usually shorter, and are left out; a set of pauses of uneven length means the count is
 * wrong). The first question starts after the
 * last long gap before its pause (the end of the directions), else at 0. Null when the file does not hold that many
 * answer pauses: then it cannot be split, and the learner replays the whole file.
 */
export function questionSpans(gaps: ReadonlyArray<[number, number]>, durationMs: number, count: number): Array<[number, number]> | null {
  if (count < 1) return [];
  const long = gaps.filter(([a, b]) => b - a >= ANSWER_PAUSE_MS);
  if (long.length < count) return null;
  // Of the long gaps, the answer pauses are the last `count` that are as long as the shortest of the `count` longest.
  const pauses = [...long].sort((x, y) => y[1] - y[0] - (x[1] - x[0])).slice(0, count).sort((x, y) => x[0] - y[0]);
  // The exam gives every question of a part the same pause; one much shorter than the rest is something else (the
  // end of the directions), so the file holds fewer questions than asked and is not split.
  const lens = pauses.map(([a, b]) => b - a).sort((x, y) => x - y);
  if (lens[0] < 0.75 * lens[Math.floor(lens.length / 2)]) return null;
  const before = long.filter(([, b]) => b <= pauses[0][0]);
  const spans: Array<[number, number]> = [];
  let from = before.length ? before[before.length - 1][1] : 0;
  for (const [a, b] of pauses) {
    spans.push([from, Math.min(a + 300, durationMs)]);
    from = b;
  }
  return spans;
}

/** "0:09" */
export const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/**
 * Decodes an audio file at 8 kHz mono (a 15-minute Part is about 30 MB of samples, not the 170 MB of a 48 kHz decode)
 * and returns its frame levels and length. Browser only.
 */
export async function decodeLevels(blob: Blob): Promise<{ levels: Float32Array; durationMs: number }> {
  const RATE = 8000;
  const Ctx = (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
  const ctx = new Ctx(1, RATE, RATE);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);
  return { levels: frameLevels(data, buf.sampleRate), durationMs: Math.round(buf.duration * 1000) };
}

/** What one file holds for splitting: its answer-pause candidates and length. */
export interface TrackLevels {
  gaps: Array<[number, number]>;
  durationMs: number;
}

/**
 * Each question's place in the files, by position in `parts` (the questions' parts in test order). One file holds
 * every question; or there is one file per part present (Part 1, Part 2… each recorded on its own). Anything else is
 * ambiguous and gives null for every question, as does a file whose pauses do not match its questions.
 */
export function placeQuestions(tracks: readonly TrackLevels[], parts: ReadonlyArray<number | null>): Array<{ track: number; from: number; to: number } | null> {
  const none = parts.map(() => null);
  const groups: number[][] = [];
  if (tracks.length === 1) groups.push(parts.map((_, i) => i));
  else {
    const order = [...new Set(parts)];
    if (order.length !== tracks.length) return none;
    for (const p of order) groups.push(parts.flatMap((x, i) => (x === p ? [i] : [])));
  }
  const out: Array<{ track: number; from: number; to: number } | null> = [...none];
  groups.forEach((qs, t) => {
    const spans = questionSpans(tracks[t].gaps, tracks[t].durationMs, qs.length);
    if (spans) qs.forEach((qi, k) => (out[qi] = { track: t, from: spans[k][0], to: spans[k][1] }));
  });
  return out;
}
