/**
 * Lesson tags as people read them. Anki decks and the importer give machine-looking tags ("05-conferences",
 * "lesson-12", "04-business-planning"); the screens show a number and a title instead ("05", "Conferences").
 */

/** Tags that look like a lesson of a course (numbered or named lesson/unit/chapter), as opposed to topic tags. */
export const isLesson = (t: string) => /^(\d|lesson|bai|unit|chapter)/i.test(t);

export interface LessonName {
  /** "05", or null when the tag carries no number. */
  num: string | null;
  title: string;
}

export function lessonName(tag: string): LessonName {
  const m = /^(?:(?:lesson|bai|unit|chapter)[\s_-]*)?(\d+)(?:[\s._-]+(.*))?$/i.exec(tag.trim());
  // The importer slugs "Doctor's office" to "doctor-s-office": put the apostrophe back.
  const words = (s: string) => s.replace(/([a-z])[_-]s(?=[_-]|$)/gi, "$1's").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase("vi") + s.slice(1) : s);
  if (!m) return { num: null, title: cap(words(tag)) };
  const num = m[1].padStart(2, "0");
  const rest = words(m[2] ?? "");
  return { num, title: rest ? cap(rest) : `Bài ${Number(m[1])}` };
}

/** One line for pickers: "05 · Conferences". */
export const lessonTitle = (tag: string) => {
  const n = lessonName(tag);
  return n.num ? `${n.num} · ${n.title}` : n.title;
};
