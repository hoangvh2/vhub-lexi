import { describe, expect, it } from "vitest";
import type { Note } from "@shared/model.ts";
import {
  REMIND_EMPTY, REMIND_GRACE, afterNotYet, afterShown, dueSlot, nextSlot, pickWord, pruneState, remindMessage, restoreForgot, slotHandled,
  suggestDone, type RemindSettings, type RemindState,
} from "@shared/remind.ts";

const H = 3600_000;
const DAY = 24 * H;
const VN = 420;
/** 2026-11-23 00:00 in Vietnam (UTC+7). */
const MIDNIGHT_VN = Date.UTC(2026, 10, 23) - 7 * H;
const ON: RemindSettings = { on: true, perDay: 3, start: 480, end: 1290 };
const v = (id: string, word: string, forgot: Array<"meaning" | "sound">, forgotAt = 1): Note => ({
  id, type: "vocab", deckId: "d", fields: { word, vi: `nghĩa ${word}`, ipa: "/x/" }, createdAt: 1, updatedAt: 1, forgot, forgotAt,
});

/** Run every slot from `from` for `days` days; returns the ids shown per local day. */
function run(notes: Note[], days: number, s = ON, onShow?: (id: string, st: RemindState, now: number) => RemindState) {
  let st = REMIND_EMPTY;
  const perDay: string[][] = Array.from({ length: days }, () => []);
  let now = MIDNIGHT_VN;
  for (;;) {
    const t = nextSlot(now, s, VN)!;
    if (t >= MIDNIGHT_VN + days * DAY) break;
    now = t + 60_000;
    const slot = dueSlot(now, s, VN, st.lastSlot);
    if (slot === null) continue;
    const n = pickWord(notes, st, now);
    if (!n) { st = slotHandled(st, slot); continue; }
    st = afterShown(st, n.id, now, slot);
    if (onShow) st = onShow(n.id, st, now);
    perDay[Math.floor((now - MIDNIGHT_VN) / DAY)].push(n.id);
  }
  return { perDay, st };
}

describe("reminder schedule", () => {
  it("puts 3 slots a day inside 8:00–21:30 local time, evenly spread", () => {
    const t1 = nextSlot(MIDNIGHT_VN, ON, VN)!;
    const t2 = nextSlot(t1, ON, VN)!;
    const t3 = nextSlot(t2, ON, VN)!;
    const t4 = nextSlot(t3, ON, VN)!;
    expect([t1, t2, t3, t4].map((t) => (t - MIDNIGHT_VN) / 60_000)).toEqual([615, 885, 1155, 1440 + 615]); // 10:15, 14:45, 19:15
    expect(nextSlot(MIDNIGHT_VN, { ...ON, on: false }, VN)).toBeNull();
  });

  it("handles a slot once, and skips one that is too old (phone off, browser closed)", () => {
    const slot = MIDNIGHT_VN + 615 * 60_000;
    expect(dueSlot(slot - 1, ON, VN, 0)).not.toBe(slot);
    expect(dueSlot(slot + 5 * 60_000, ON, VN, 0)).toBe(slot);
    expect(dueSlot(slot + 5 * 60_000, ON, VN, slot)).toBeNull();
    expect(dueSlot(slot + REMIND_GRACE + 1, ON, VN, 0)).toBeNull();
    // Just after midnight, yesterday's last slot is hours old: nothing to show.
    expect(dueSlot(MIDNIGHT_VN + 30 * 60_000, ON, VN, 0)).toBeNull();
  });

  it("never shows more than perDay a day, one word each, and spaces a word out 1, 2, 4, 8, 16 days", () => {
    const { perDay } = run([v("a", "alpha", ["meaning"])], 60);
    expect(Math.max(...perDay.map((d) => d.length))).toBe(1);
    const days = perDay.flatMap((d, i) => (d.length ? [i] : []));
    expect(days.slice(0, 6)).toEqual([0, 1, 3, 7, 15, 31]);
    expect(days[6] - days[5]).toBe(16); // capped
  });

  it("shows several words before any word comes back, and stops when nothing is due", () => {
    const words = ["a", "b", "c", "d", "e"].map((id, i) => v(id, id, ["meaning"], 10 + i));
    const { perDay } = run(words, 4);
    expect(perDay[0]).toEqual(["a", "b", "c"]);
    expect(perDay[1]).toEqual(["d", "e", "a"]);
    for (const d of perDay) expect(d.length).toBeLessThanOrEqual(3);
  });

  it("brings a word back the next day after Chưa nhớ, and asks Đã nhớ? after 5 clean shows", () => {
    const words = [v("a", "alpha", ["meaning"])];
    const { perDay } = run(words, 12, ON, (id, st, now) => afterNotYet(st, id, now));
    expect(perDay.every((d) => d.length === 1)).toBe(true);
    const { st } = run(words, 40);
    expect(suggestDone(st, "a")).toBe(true);
    expect(remindMessage(words[0], st).prompt).toContain("Đã nhớ");
    expect(remindMessage(words[0], REMIND_EMPTY).prompt).not.toContain("Đã nhớ");
  });

  it("forgets the schedule of a word once its mark is cleared; undo puts the marks back", () => {
    const a = v("a", "alpha", ["meaning", "sound"], 500);
    const st = afterShown(REMIND_EMPTY, "a", 1000, 900);
    const cleared = restoreForgot(a, [], undefined, 2000);
    expect(cleared.forgot).toBeUndefined();
    expect(cleared.forgotAt).toBeUndefined();
    expect(pruneState(st, [cleared]).words).toEqual({});
    const back = restoreForgot(cleared, ["meaning", "sound"], 500, 3000);
    expect(back.forgot).toEqual(["meaning", "sound"]);
    expect(back.forgotAt).toBe(500);
    expect(pruneState(st, [back]).words.a.level).toBe(1);
  });

  it("hides the meaning from the prompt; the answer line carries it", () => {
    const m = remindMessage(v("a", "allocate", ["meaning"]), REMIND_EMPTY);
    expect(m.title).toBe("allocate /x/");
    expect(m.prompt).not.toContain("nghĩa allocate");
    expect(m.answer).toBe("nghĩa allocate");
  });
});
