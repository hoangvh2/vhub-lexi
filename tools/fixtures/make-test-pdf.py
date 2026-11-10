"""
Builds the PDF fixtures of the "Bộ đề" import tests: a short TOEIC-style Reading test written for Lexi (no ETS or
book content), laid out the way real test books are: Part 5 in two columns, Part 6 and 7 as passages, the answer
key on the last page. Writes a text PDF, a "scanned" PDF (each page an image, no text layer) and a copier scan of
page 1 (1-bit CCITT, upside down).

    python tools/fixtures/make-test-pdf.py   (needs reportlab and pdftoppm/Pillow for the scanned copy)
"""
import io, os, shutil, subprocess, tempfile
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "web", "test", "fixtures")
W, H = A4

PART5 = [
    (101, "Ms. Tran asked the staff to submit their travel ------- by Friday.", ["receipts", "receive", "received", "receiving"], "A"),
    (102, "The new printer is ------- faster than the one we used last year.", ["much", "very", "many", "most"], "A"),
    (103, "------- the heavy rain, the outdoor concert started on time.", ["Although", "Despite", "Because", "However"], "B"),
    (104, "All visitors must sign in at the front desk ------- entering the lab.", ["before", "until", "during", "since"], "A"),
    (105, "The marketing team has ------- finished the report for the client.", ["yet", "already", "still", "ever"], "B"),
    (106, "Mr. Kim is the manager ------- office is on the third floor.", ["who", "whom", "whose", "which"], "C"),
    (107, "The contract will be signed ------- both parties agree on the price.", ["once", "unless", "despite", "whereas"], "A"),
    (108, "Applicants should have at least two years of ------- experience.", ["relevance", "relevant", "relevantly", "relevancy"], "B"),
    (109, "The shipment ------- to the warehouse yesterday afternoon.", ["delivers", "is delivering", "was delivered", "will deliver"], "C"),
    (110, "Please keep your receipt ------- you need to return the item.", ["in case", "so that", "even if", "as if"], "A"),
]
PART6 = (
    "Questions 131-134 refer to the following e-mail.",
    [
        "To: All staff",
        "From: Linh Pham, Facilities",
        "Subject: Parking garage",
        "",
        "The east parking garage will be closed for repairs from June 3 to June 14. During this time, employees",
        "are asked to ------- (131) in the west lot. Shuttle buses will run every ten minutes between the west lot",
        "and the main entrance. ------- (132). We apologize for any inconvenience and thank you for your",
        "------- (133). If you have questions, please contact the facilities office at extension 204. Updates",
        "will be posted on the company intranet ------- (134) the work progresses.",
    ],
    [
        (131, ["park", "parks", "parked", "parking"], "A"),
        (132, ["The garage was built in 1998.", "Please allow extra time to reach your desk.", "Shuttle drivers are hiring now.", "The west lot is closed on weekends."], "B"),
        (133, ["patient", "patience", "patiently", "patients"], "B"),
        (134, ["as", "so", "or", "but"], "A"),
    ],
)
PART7 = (
    "Questions 147-149 refer to the following notice.",
    [
        "Greenway Public Library: Summer Reading Program",
        "",
        "Children aged 6 to 12 can join our summer reading program starting July 1. Each child who reads ten",
        "books by August 15 will receive a free pass to the city science museum. Registration is free and can",
        "be completed at the front desk or on our website. Parents are invited to a short welcome session on",
        "June 28 at 10 A.M. in the community room, where librarians will explain how to record the books read.",
    ],
    [
        (147, "Who is the program for?", ["Library staff", "Young children", "Museum visitors", "Parents only"], "B"),
        (148, "What will a child receive for reading ten books?", ["A library card", "A book", "A museum pass", "A certificate"], "C"),
        (149, "What will happen on June 28?", ["The program will end.", "A welcome session will be held.", "The museum will open.", "Registration will close."], "B"),
    ],
)


def build() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Lexi Practice Reading Test (fixture)")

    # Page 1: Part 5 in two columns.
    c.setFont("Helvetica-Bold", 13)
    c.drawString(40, H - 50, "READING TEST")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, H - 72, "PART 5")
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 88, "Directions: A word or phrase is missing in each of the sentences below. Select the best answer.")
    col_w = (W - 100) / 2
    for i, (n, stem, opts, _) in enumerate(PART5):
        x = 40 if i < 5 else 60 + col_w
        y = H - 120 - (i % 5) * 120
        c.setFont("Helvetica", 10)
        words, line, lines = stem.split(), "", []
        for w in words:
            if c.stringWidth(f"{line} {w}", "Helvetica", 10) > col_w - 20:
                lines.append(line)
                line = w
            else:
                line = f"{line} {w}".strip()
        lines.append(line)
        c.drawString(x, y, f"{n}. {lines[0]}")
        for k, l in enumerate(lines[1:]):
            c.drawString(x + 20, y - 13 * (k + 1), l)
        oy = y - 13 * len(lines) - 4
        for k, o in enumerate(opts):
            c.drawString(x + 20, oy - 13 * k, f"({'ABCD'[k]}) {o}")
    c.showPage()

    # Page 2: Part 6 then Part 7, full width.
    y = H - 50
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "PART 6")
    y -= 20
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, y, PART6[0])
    y -= 18
    c.setFont("Helvetica", 9.5)
    for l in PART6[1]:
        c.drawString(40, y, l)
        y -= 13
    y -= 6
    for n, opts, _ in PART6[2]:
        c.drawString(40, y, f"{n}.")
        for k, o in enumerate(opts):
            c.drawString(70, y - 12 * k, f"({'ABCD'[k]}) {o}")
        y -= 12 * 4 + 6
    y -= 10
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "PART 7")
    y -= 20
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, y, PART7[0])
    y -= 18
    c.setFont("Helvetica", 9.5)
    for l in PART7[1]:
        c.drawString(40, y, l)
        y -= 13
    y -= 6
    for n, q, opts, _ in PART7[2]:
        c.drawString(40, y, f"{n}. {q}")
        for k, o in enumerate(opts):
            c.drawString(70, y - 12 * (k + 1), f"({'ABCD'[k]}) {o}")
        y -= 12 * 5 + 6
    c.showPage()

    # Page 3: answer key.
    c.setFont("Helvetica-Bold", 12)
    c.drawString(40, H - 50, "ANSWER KEY")
    c.setFont("Helvetica", 10)
    key = [(n, a) for n, _, _, a in PART5] + [(n, a) for n, _, a in PART6[2]] + [(n, a) for n, _, _, a in PART7[2]]
    for i, (n, a) in enumerate(key):
        c.drawString(40 + (i // 9) * 110, H - 80 - (i % 9) * 16, f"{n}. ({a})")
    c.showPage()
    c.save()
    return buf.getvalue()


def scanned(text_pdf: bytes) -> bytes:
    """Each page rasterised (pdftoppm) and put back as an image only: what a phone scan of a test book looks like."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "t.pdf")
        open(src, "wb").write(text_pdf)
        subprocess.run(["pdftoppm", "-r", "110", "-jpeg", src, os.path.join(d, "p")], check=True)
        pages = sorted(f for f in os.listdir(d) if f.startswith("p") and f.endswith(".jpg"))
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        for p in pages:
            c.drawImage(ImageReader(os.path.join(d, p)), 0, 0, W, H)
            c.showPage()
        c.save()
        return buf.getvalue()


def copier(text_pdf: bytes) -> bytes:
    """Page 1 the way an office copier scans a book: 1-bit, CCITT G4 (pdf.js decodes it with its jbig2 wasm), and
    fed in upside down. Needs ImageMagick (`magick`, or `convert` on older installs)."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "t.pdf")
        open(src, "wb").write(text_pdf)
        subprocess.run(["pdftoppm", "-r", "150", "-mono", "-f", "1", "-l", "1", src, os.path.join(d, "p")], check=True)
        page = next(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".pbm"))
        out = os.path.join(d, "c.pdf")
        tool = "magick" if shutil.which("magick") else "convert"
        subprocess.run([tool, page, "-rotate", "180", "-compress", "Group4", "-density", "150", "-units", "PixelsPerInch", out], check=True)
        return open(out, "rb").read()


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    pdf = build()
    open(os.path.join(OUT, "reading-test.pdf"), "wb").write(pdf)
    open(os.path.join(OUT, "reading-test-scan.pdf"), "wb").write(scanned(pdf))
    open(os.path.join(OUT, "reading-test-copier.pdf"), "wb").write(copier(pdf))
    print("ok")
