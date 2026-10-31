"""Builds the small .apkg files the Anki importer tests read (web/test/fixtures/anki-*.apkg).

    pip install anki==26.9.3
    python3 tools/anki/make-fixture.py web/test/fixtures

The collection imitates the shared "600 Essential Words for the TOEIC" deck (note type TOEIC2, one
sub-deck per lesson, HTML in fields) with made-up words, and carries real scheduling: cards answered
through Anki's own scheduler (so cards.data / revlog are what Anki writes), one card moved to an
old review state, one suspended. Two packages: modern (collection.anki21b, FSRS on) and legacy
(collection.anki21, SM-2).
"""
import os
import sys
import tempfile

from anki.collection import Collection, ExportAnkiPackageOptions
from anki.import_export_pb2 import ExportLimit  # noqa: F401  (documents the API used below)

FIELDS = ["Target word", "Transcription", "Word type", "Vietnamese", "Explanation", "Example",
          "Translation", "Image", "Suggestion", "Pronouncing", "Sound_a", "Sound_b"]

WORDS = [
    # lesson, word, ipa, pos, vi, en, examples html, translation html
    (1, "abide by", "/əˈbaɪd baɪ/", "(v)", "tôn trọng, tuân theo", "to comply with; to conform",
     "<div>a. The two parties agreed to <b>abide by</b> the contract.</div><div>b. Employees must abide by the rules.</div>",
     "<div>a. Hai bên đồng ý tuân theo hợp đồng.</div><div>b. Nhân viên phải tuân theo quy định.</div>"),
    (1, "agreement", "/əˈɡriːmənt/", "(n)", "sự đồng ý, hợp đồng", "a mutual arrangement between parties",
     "<div>The <i>agreement</i> was signed&nbsp;yesterday.</div>", "<div>Hợp đồng được ký hôm qua.</div>"),
    (1, "assurance", "/əˈʃʊərəns/", "(n)", "sự cam đoan, bảo đảm", "a guarantee; a promise",
     "He gave his assurance that the work would be done.", ""),
    (2, "attract", "/əˈtrækt/", "(v)", "thu hút, hấp dẫn", "to draw by appeal",
     "<div>The new ad will attract customers.</div>", "<div>Quảng cáo mới sẽ thu hút khách hàng.</div>"),
    (2, "compare", "/kəmˈpeər/", "(v)", "so sánh", "to examine similarities and differences",
     "Compare the prices before you buy.", "So sánh giá trước khi mua."),
    (2, "competition", "/ˌkɒmpəˈtɪʃn/", "(n)", "sự cạnh tranh, cuộc thi", "rivalry",
     "The competition between the two firms is fierce.", ""),
]


def build(path: str, fsrs: bool, legacy: bool) -> None:
    tmp = tempfile.mkdtemp()
    col = Collection(os.path.join(tmp, "collection.anki2"))
    col.set_config("fsrs", fsrs)
    mm = col.models
    m = mm.new("TOEIC2")
    for f in FIELDS:
        mm.add_field(m, mm.new_field(f))
    t = mm.new_template("Card 1")
    t["qfmt"] = "{{Target word}}"
    t["afmt"] = "{{FrontSide}}<hr id=answer>{{Vietnamese}}"
    mm.add_template(m, t)
    mm.add(m)
    m = mm.by_name("TOEIC2")
    for lesson, word, ipa, pos, vi, en, ex, tr in WORDS:
        did = col.decks.id(f"600 Essential::Lesson {lesson:02d}")
        n = col.new_note(m)
        for k, v in zip(FIELDS, [word, ipa, pos, vi, en, ex, tr, '<img src="x.jpg">', "a__d_ b_", "[sound:p.mp3]", "", ""]):
            n[k] = v
        n.tags = [f"lesson{lesson}"]
        col.add_note(n, did)

    cids = sorted(col.find_cards(""))
    # Answer the first three new cards through the real scheduler.
    col.decks.select(col.decks.id("600 Essential"))
    for ease in (3, 4, 1):
        c = col.sched.getCard()
        col.sched.answerCard(c, ease)
    # Turn the card answered Easy into a mature review card studied over the last six weeks: interval
    # 30 days, due in 5 days, with older log entries (written the way Anki stores them).
    c = next(col.get_card(i) for i in cids if col.get_card(i).type == 2)
    c.ivl = 30
    c.due = col.sched.today + 5
    c.reps = 4
    col.update_card(c)
    day = 86_400_000
    now = col.db.scalar("select max(id) from revlog")
    for k, (ago, ease, ivl, last, kind) in enumerate([(45, 3, -600, 0, 0), (44, 3, 4, -600, 0), (40, 3, 12, 4, 1), (28, 3, 30, 12, 1)]):
        col.db.execute("insert into revlog values (?,?,?,?,?,?,?,?,?)", now - ago * day - k, c.id, -1, ease, ivl, last, 2500, 8000, kind)
    col.db.execute("delete from revlog where cid = ? and id > ?", c.id, now - 20 * day)
    # Suspend the last card.
    col.sched.suspend_cards([cids[-1]])

    opts = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=False, legacy=legacy)
    col.export_anki_package(out_path=path, options=opts, limit=None)
    col.close()


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    build(os.path.join(out, "anki-fsrs.apkg"), fsrs=True, legacy=False)
    build(os.path.join(out, "anki-legacy.apkg"), fsrs=False, legacy=True)
    print("ok")
