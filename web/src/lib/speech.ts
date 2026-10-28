/** Text-to-speech via the browser (uses the OS voices, works offline when the voice is installed). */

let voices: SpeechSynthesisVoice[] = [];

function refresh() {
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    voices = [];
  }
}

if (typeof speechSynthesis !== "undefined") {
  refresh();
  speechSynthesis.addEventListener?.("voiceschanged", refresh);
}

export const speechAvailable = () => typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

function pickVoice(): SpeechSynthesisVoice | undefined {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  return (
    en.find((v) => /en[-_]US/i.test(v.lang) && /google|natural|premium|enhanced/i.test(v.name)) ??
    en.find((v) => /en[-_]US/i.test(v.lang)) ??
    en[0]
  );
}

export function speak(text: string, rate = 0.92): boolean {
  if (!speechAvailable() || !text.trim()) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = rate;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
