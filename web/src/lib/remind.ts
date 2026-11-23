/**
 * "Từ hay quên" reminders on the web: notifications shown while a Lexi tab is open (in the background too). The schedule
 * comes from shared/remind.ts and is kept in this browser's localStorage; nothing about it goes to Firestore. The only
 * synced write is "Đã nhớ", which clears the mark on the note.
 *
 * Browsers cannot wake a closed web page without a push server, so with every Lexi tab closed a slot is skipped (the
 * Android app does not have this limit).
 */
import type { Note } from "@shared/model.ts";
import { forgotOf, type ForgotKind } from "@shared/drill.ts";
import {
  REMIND_EMPTY, afterNotYet, afterShown, cleanSettings, dueSlot, nextSlot, pickWord, pruneState, remindMessage, restoreForgot, slotHandled,
  type RemindSettings, type RemindState,
} from "@shared/remind.ts";
import { str } from "@shared/notetypes.ts";
import { currentRepo, loaded, notes } from "../data/state.ts";
import { createStore } from "./store.ts";

const SETTINGS_KEY = "lexi.remind.settings";
const STATE_KEY = "lexi.remind.state";
const TAG = "lexi-remind";
/** Longest sleep between two checks: a background tab's timer can be held back, and the clock can jump. */
const MAX_SLEEP = 10 * 60_000;

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / storage full: the schedule then lives for this tab only */
  }
}

export const remindSettings = createStore<RemindSettings>(cleanSettings(read<Partial<RemindSettings>>(SETTINGS_KEY)));

function loadState(): RemindState {
  const s = read<RemindState>(STATE_KEY);
  return s && typeof s === "object" && s.words && typeof s.lastSlot === "number" ? s : REMIND_EMPTY;
}
function saveState(s: RemindState) {
  write(STATE_KEY, s);
}

export const tzOffset = (now: number) => -new Date(now).getTimezoneOffset();

export const notificationsSupported = () => typeof Notification !== "undefined";
export const permission = (): NotificationPermission | "unsupported" => (notificationsSupported() ? Notification.permission : "unsupported");

/** Turning reminders on asks for the permission first; false (and still off) when the browser says no. */
export async function setRemindSettings(next: RemindSettings): Promise<boolean> {
  const s = cleanSettings(next);
  if (s.on && !remindSettings.get().on) {
    if (!notificationsSupported()) return false;
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (p !== "granted") return false;
  }
  remindSettings.set(s);
  write(SETTINGS_KEY, s);
  // Turned on (or the window moved) inside a slot's grace time: that slot is shown now.
  void checkNow().finally(schedule);
  return true;
}

/** When the next reminder is due (null when off). */
export const nextReminder = (now = Date.now()) => nextSlot(now, remindSettings.get(), tzOffset(now));

async function show(n: Note, st: RemindState) {
  const m = remindMessage(n, st);
  const body = `${m.prompt}\n${m.answer}`;
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) {
    await reg.showNotification(m.title, {
      body,
      tag: TAG,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { kind: TAG, noteId: n.id },
      // Chrome shows two buttons; a tap on the notification itself opens practice for the word.
      actions: [{ action: "done", title: "Đã nhớ" }, { action: "notyet", title: "Chưa nhớ" }],
    } as NotificationOptions);
    return;
  }
  // No service worker (development build): a plain notification without buttons.
  const plain = new Notification(m.title, { body, tag: TAG, icon: "/icons/icon-192.png", data: { kind: TAG, noteId: n.id } });
  plain.onclick = () => {
    window.focus();
    void handleAction("open", n.id);
  };
}

/** Runs the check under a lock shared by every Lexi tab of this browser, so two tabs never show the same slot twice. */
async function locked<T>(f: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? (locks.request("lexi-remind", f) as Promise<T>) : f();
}

/** Shows the reminder of the current slot if it has not been shown yet. Returns the id shown, if any. */
export async function checkNow(now = Date.now()): Promise<string | null> {
  const s = remindSettings.get();
  if (!s.on || permission() !== "granted" || !loaded.get()) return null;
  return locked(async () => {
    const st = pruneState(loadState(), notes.get());
    const slot = dueSlot(now, s, tzOffset(now), st.lastSlot);
    if (slot === null) return null;
    const n = pickWord(notes.get(), st, now);
    if (!n) {
      saveState(slotHandled(st, slot));
      return null;
    }
    await show(n, st);
    saveState(afterShown(st, n.id, now, slot));
    return n.id;
  });
}

/** "Gửi thử": the word the next reminder would show, now, without moving the schedule. */
export async function sendTest(): Promise<string | null> {
  if (permission() !== "granted") return null;
  const st = pruneState(loadState(), notes.get());
  const n = pickWord(notes.get(), st, Number.MAX_SAFE_INTEGER);
  if (n) await show(n, st);
  return n ? str(n.fields.word) : null;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** (Re)arms the timer for the next slot. */
export function schedule() {
  clearTimeout(timer);
  const now = Date.now();
  const next = nextReminder(now);
  if (next === null) return;
  timer = setTimeout(() => void checkNow().finally(schedule), Math.max(1000, Math.min(next - now + 1000, MAX_SLEEP)));
}

export type RemindAction = "done" | "notyet" | "open";

/** What the page should do after an action (show a toast with an undo, open practice). */
export interface ActionResult {
  action: RemindAction;
  note: Note;
  undo?: () => Promise<void>;
}

export const remindEvents = createStore<ActionResult | null>(null);

/** "Đã nhớ": clears both marks (one note write); the returned undo puts them back. */
export async function rememberWord(n: Note): Promise<() => Promise<void>> {
  const latest = notes.get().find((x) => x.id === n.id) ?? n;
  const kinds: ForgotKind[] = forgotOf(latest);
  const at = latest.forgotAt;
  await currentRepo().saveNote(restoreForgot(latest, [], undefined, Date.now()), []);
  saveState(pruneState(loadState(), notes.get().filter((x) => x.id !== n.id)));
  return async () => {
    const now = notes.get().find((x) => x.id === n.id) ?? latest;
    if (forgotOf(now).length) return;
    await currentRepo().saveNote(restoreForgot(now, kinds, at, Date.now()), []);
  };
}

/** "Chưa nhớ" on a notification, or a miss in practice: the word comes back from tomorrow, level 0. */
export function notYet(noteId: string, now = Date.now()) {
  saveState(afterNotYet(loadState(), noteId, now));
}

/** A button or tap on a notification, handed over by the service worker (or the address when no tab was open). */
export async function handleAction(action: RemindAction, noteId: string) {
  const wait = () => new Promise<void>((ok) => {
    if (loaded.get()) return ok();
    const off = loaded.subscribe(() => loaded.get() && (off(), ok()));
  });
  await wait();
  const n = notes.get().find((x) => x.id === noteId);
  if (!n) return;
  if (action === "done") {
    if (!forgotOf(n).length) return;
    const undo = await rememberWord(n);
    remindEvents.set({ action, note: n, undo });
  } else if (action === "notyet") {
    notYet(noteId);
    remindEvents.set({ action, note: n });
  } else {
    remindEvents.set({ action, note: n });
  }
}

let started = false;

/** Starts the reminder loop once per tab: timer, return to the tab, messages from the service worker. */
export function startReminders() {
  if (started) return;
  started = true;
  schedule();
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkNow().finally(schedule);
  });
  addEventListener("storage", (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY) {
      remindSettings.set(cleanSettings(read<Partial<RemindSettings>>(SETTINGS_KEY)));
      schedule();
    }
  });
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; action?: RemindAction; noteId?: string } | null;
    if (d?.type === "lexi-remind" && d.action && d.noteId) void handleAction(d.action, d.noteId);
  });
  // A slot that came while the data was still loading.
  const off = loaded.subscribe(() => {
    if (!loaded.get()) return;
    off();
    void checkNow().finally(schedule);
  });
}
