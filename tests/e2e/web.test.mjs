import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addWord, chromium, open, serve } from "./harness.mjs";

let server, base, browser;
before(async () => {
  ({ server, base } = await serve());
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

describe("core flow (local-only mode)", () => {
  it("add a word from the offline dictionary, study it, rate it, and it persists", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await page.goto(`${base}/#/add`);
    await page.fill('[data-testid=word-input]', "serendipity");
    await page.waitForSelector('[data-testid=preview]');
    const preview = await page.textContent('[data-testid=preview]');
    assert.match(preview, /serendipity/);
    assert.match(preview, /ˌsɛrənˈdɪpɪti/);
    assert.match(preview, /good luck in making unexpected/);
    // The Vietnamese meaning is suggested from the offline pack (Wiktionary) and can be overwritten.
    assert.match(await page.inputValue('[data-testid=vi-input]'), /khả năng cầu may/);
    await page.waitForSelector('[data-testid=vi-source]');
    await page.fill('[data-testid=vi-input]', "sự tình cờ may mắn");
    assert.equal(await page.locator('[data-testid=vi-source]').count(), 0);
    await page.click('[data-testid=save-word]');

    // The study tab opens on Today: what is left, one button to start. Same-document navigation: a full reload
    // right after saving could race the IndexedDB write.
    await page.click('.tabbar a[href="#/today"], [data-testid=nav-today]');
    await page.waitForSelector('[data-testid=today]');
    assert.match(await page.textContent('[data-testid=today-ring]'), /0\/1/);
    assert.equal(await page.textContent('[data-testid=today-new]'), "1");
    assert.equal(await noOverflow(page), true);
    await page.click('[data-testid=start-study]');
    await page.waitForSelector('[data-testid=study-card]');
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-revealed'), "false");
    assert.match(await page.textContent('[data-testid=counts]'), /Mới\s*1/);
    await page.click('[data-testid=show-answer]');
    assert.match(await page.textContent('[data-testid=study-card]'), /sự tình cờ may mắn/);
    await page.click('[data-testid=rate-3]');
    // Its next learning step is minutes away: like Anki's learn-ahead limit it comes back now, not "in 10 minutes".
    await page.waitForSelector('[data-testid=show-answer]');
    assert.match(await page.textContent('[data-testid=counts]'), /Đang học\s*1/);
    await page.click('[data-testid=show-answer]');
    await page.click('[data-testid=rate-3]');
    await page.waitForSelector('[data-testid=session-done]');
    assert.match(await page.textContent('[data-testid=recap]'), /serendipity/);
    // Settings report what the two ratings cost on this device (same document: the traces live in memory).
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=latency-summary]');
    assert.match(await page.textContent('[data-testid=latency-summary]'), /^2 lần chấm · chuyển thẻ trung vị \d+ ms/);
    assert.match(await page.textContent('[data-testid=build-id]'), /Phiên bản: \S+ · \d{4}-\d\d-\d\d/);
    await page.goto(`${base}/#/today`);
    await page.waitForSelector('[data-testid=today-ring]');
    assert.match(await page.textContent('[data-testid=today-ring]'), /1\/1/);

    await page.reload();
    await page.goto(`${base}/#/library`);
    await page.waitForSelector('[data-testid=lib-item]');
    assert.match(await page.textContent('[data-testid=lib-list]'), /serendipity/);
    await page.goto(`${base}/#/stats`);
    await page.waitForSelector('[data-testid=stat-words]');
    assert.equal(await page.textContent('[data-testid=stat-words]'), "1");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("inflected input resolves to the base word; unknown words can be entered manually", async () => {
    const { ctx, page } = await open(browser, base);
    await page.goto(`${base}/#/add`);
    await page.fill('[data-testid=word-input]', "procrastinating");
    await page.waitForFunction(() => /là dạng của\s*procrastinate/.test(document.querySelector('.area-input')?.textContent ?? ""));
    await page.fill('[data-testid=word-input]', "zzyzx");
    await page.waitForSelector('[data-testid=not-found]');
    await page.fill('[data-testid=vi-input]', "tên một địa danh");
    assert.equal(await page.isEnabled('[data-testid=save-word]'), true);
    await ctx.close();
  });

  it("keyboard: Space reveals, 3 rates, U undoes", async () => {
    const { ctx, page } = await open(browser, base);
    await addWord(page, base, "resilient", "kiên cường");
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=study-card]');
    await page.keyboard.press("Space");
    await page.waitForSelector('[data-testid=rate-3]');
    await page.keyboard.press("4"); // Easy: straight to review, so the session ends
    await page.waitForSelector('[data-testid=session-done]');
    await page.keyboard.press("u");
    await page.waitForSelector('[data-testid=study-card]');
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-revealed'), "false");
    await ctx.close();
  });

  it("typed templates: recall and cloze check the answer and suggest a rating", async () => {
    const { ctx, page } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=tpl-recall]');
    await page.check('[data-testid=tpl-recall]');
    await page.uncheck('[data-testid=tpl-recognize]');
    await page.uncheck('[data-testid=tpl-cloze]');
    await addWord(page, base, "ubiquitous", "có mặt khắp nơi");
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=type-input]');
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-template'), "recall");
    await page.fill('[data-testid=type-input]', "ubiquitus");
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.textContent('[data-testid=verdict]'), /Gần đúng/);
    assert.match(await page.getAttribute('[data-testid=rate-2]', 'class'), /suggest/);
    await page.click('[data-testid=rate-2]');
    await page.waitForSelector('[data-testid=session-done], [data-testid=study-card]');
    await ctx.close();
  });

  it("two new words with the same meaning are not introduced on the same day", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await addWord(page, base, "convince", "thuyết phục, làm cho tin");
    await addWord(page, base, "persuade", "thuyết phục, làm cho tin");
    await addWord(page, base, "deliver", "giao hàng");
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=counts]');
    // convince and deliver start today; persuade waits until convince is settled.
    assert.equal(await page.textContent('[data-testid=counts] .c-new b'), "2");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("typing cards name the target word and treat a same-meaning word as a retry, not a lapse", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=tpl-recall]');
    await page.check('[data-testid=tpl-recall]');
    await page.uncheck('[data-testid=tpl-recognize]');
    await page.uncheck('[data-testid=tpl-cloze]');
    // convince is already settled (10-day interval, due now), so the new near-synonym persuade may start today.
    const T = Date.now() - 60_000;
    const vocab = (id, word) => ({ id, type: "vocab", deckId: "d1", createdAt: T, updatedAt: T, fields: { word, vi: "thuyết phục, làm cho tin", pos: "verb", en: `${word} definition` } });
    const card = (noteId, over) => ({ id: `${noteId}.recall`, noteId, deckId: "d1", template: "recall", state: 0, due: T, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, createdAt: T, updatedAt: T, ...over });
    const file = join(tmpdir(), `lexi-synonyms-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({
      app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "TOEIC", createdAt: T, updatedAt: T }],
      notes: [vocab("n1", "convince"), vocab("n2", "persuade")],
      cards: [card("n1", { state: 2, stability: 10, difficulty: 5, scheduledDays: 10, reps: 3, lastReview: T - 10 * 86_400_000 }), card("n2", {})],
    }));
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=type-input]');
    assert.match(await page.textContent('[data-testid=card-mode]'), /Gõ từ tiếng Anh/);
    // Which of the two is on screen: the other one is listed as "not this".
    const notThese = await page.textContent('[data-testid=not-these]');
    const [target, other] = /persuade/.test(notThese) ? ["convince", "persuade"] : ["persuade", "convince"];
    assert.match(notThese, new RegExp(other));
    assert.equal(await page.getAttribute('[data-testid=answer-hint]', 'aria-label'), `Đáp án có 8 chữ cái, bắt đầu bằng ${target[0]}`);
    assert.equal((await page.textContent('[data-testid=answer-hint]')).trim(), target[0]);

    // The other word (inflected, even): told which word it was, the card stays open for one more try.
    await page.fill('[data-testid=type-input]', `${other}d`);
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=mixed-up]');
    assert.match(await page.textContent('[data-testid=mixed-up]'), new RegExp(`Đúng nghĩa, nhưng là từ khác: ${other}`));
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-revealed'), "false");
    assert.equal(await page.inputValue('[data-testid=type-input]'), "");

    // One more hint letter, then the right word: correct, but the suggestion drops to Hard.
    await page.click('[data-testid=more-hint]');
    assert.equal((await page.textContent('[data-testid=answer-hint]')).trim(), target.slice(0, 2));
    await page.fill('[data-testid=type-input]', target);
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.textContent('[data-testid=verdict]'), new RegExp(`Chính xác · lần đầu gõ “${other}”`));
    assert.match(await page.getAttribute('[data-testid=rate-2]', 'class'), /suggest/);
    assert.match(await page.textContent('[data-testid=compare]'), new RegExp(`Dễ nhầm với.*${other}`));
    await page.click('[data-testid=rate-2]');

    // A second same-meaning slip on the next card is a plain miss.
    await page.waitForSelector('[data-testid=type-input]');
    await page.fill('[data-testid=type-input]', target);
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=mixed-up]');
    await page.fill('[data-testid=type-input]', target);
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.textContent('[data-testid=verdict]'), /Chưa đúng/);
    assert.match(await page.getAttribute('[data-testid=rate-1]', 'class'), /suggest/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("listening card plays the sentence, takes the typed word, then shows the example highlighted and translated", async () => {
    const { ctx, page, errors } = await open(browser, base);
    // Count what the page asks the browser to read aloud (headless Chromium has no voices).
    await page.addInitScript(() => {
      window.__spoken = [];
      const orig = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = (u) => (window.__spoken.push([u.text, u.rate]), orig(u));
    });
    const T = Date.UTC(2026, 9, 29);
    const note = {
      id: "n1", type: "vocab", deckId: "d1", createdAt: T, updatedAt: T,
      fields: { word: "desire", vi: "mong muốn", en: "to want strongly", examples: ["We desire to have our own home."], examplesVi: ["Chúng tôi ao ước có nhà riêng."], mnemonic: "đì-zai-ơ" },
    };
    const card = { id: "n1.listen", noteId: "n1", deckId: "d1", template: "listen", state: 0, due: T, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, createdAt: T, updatedAt: T };
    const file = join(tmpdir(), `lexi-listen-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "TOEIC", createdAt: T, updatedAt: T }], notes: [note], cards: [card] }));
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=listen-play]');
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-template'), "listen");
    assert.match(await page.textContent('[data-testid=card-mode]'), /Nghe và gõ từ/);
    // The sentence plays on its own when the card appears; the blanked sentence is on screen, the word is not.
    await page.waitForFunction(() => window.__spoken.some(([t]) => t === "We desire to have our own home."));
    assert.match(await page.textContent('[data-testid=study-card]'), /We _____ to have our own home\./);
    await page.click('[data-testid=listen-slow]');
    assert.ok(await page.evaluate(() => window.__spoken.some(([t, r]) => t.startsWith("We desire") && r < 0.8)));
    await page.fill('[data-testid=type-input]', "desire");
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.textContent('[data-testid=verdict]'), /Chính xác/);
    assert.equal(await page.textContent('[data-testid=example] mark'), "desire");
    assert.match(await page.textContent('[data-testid=example]'), /Chúng tôi ao ước có nhà riêng\./);
    assert.match(await page.textContent('[data-testid=memory]'), /đì-zai-ơ/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("deleting needs confirmation: Cancel keeps the word, Delete removes it", async () => {
    const { ctx, page } = await open(browser, base);
    await addWord(page, base, "leverage", "đòn bẩy");
    await page.goto(`${base}/#/library`);
    await page.click('[data-testid=lib-item]');
    await page.click('[data-testid=note-delete]');
    await page.click('[data-testid=confirm-cancel]');
    await page.click('[data-testid=note-save]');
    await page.waitForSelector('[data-testid=lib-item]');
    await page.click('[data-testid=lib-item]');
    await page.click('[data-testid=note-delete]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=lib-item]'));
    await ctx.close();
  });

  it("custom study: one lesson only, review ahead, and card info with the answer history", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    const T = Date.now() - 60_000;
    const D = 86_400_000;
    const vocab = (id, word, tag) => ({ id, type: "vocab", deckId: "d1", createdAt: T, updatedAt: T, tags: [tag], fields: { word, vi: `nghĩa ${word}` } });
    const card = (noteId, over) => ({ id: `${noteId}.recognize`, noteId, deckId: "d1", template: "recognize", state: 2, due: T, stability: 5, difficulty: 5, scheduledDays: 5, learningSteps: 0, reps: 3, lapses: 1, lastReview: T - 5 * D, createdAt: T, updatedAt: T, ...over });
    const file = join(tmpdir(), `lexi-custom-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({
      app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "600", createdAt: T, updatedAt: T }],
      notes: [vocab("n1", "contract", "lesson-01"), vocab("n2", "warranty", "lesson-02"), vocab("n3", "invoice", "lesson-02")],
      // contract and warranty are due now; invoice 24 h from now, which always falls in the next study day.
      cards: [card("n1", {}), card("n2", {}), card("n3", { due: T + D })],
      reviews: [1, 3].map((rating, i) => ({ id: `n1.recognize@${T - (10 - i * 5) * D}`, cardId: "n1.recognize", noteId: "n1", deckId: "d1", rating, state: 2, stability: 5, difficulty: 5, scheduledDays: 5, reviewedAt: T - (10 - i * 5) * D, durationMs: 3000, device: "anki" })),
      daily: [],
    }));
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=study-card]');
    assert.match(await page.textContent('[data-testid=counts]'), /Ôn\s*2/);
    await page.selectOption('[data-testid=tag-pick]', "lesson-02");
    await page.waitForFunction(() => /Ôn\s*1/.test(document.querySelector('[data-testid=counts]')?.textContent ?? ""));
    assert.match(await page.textContent('[data-testid=study-card]'), /warranty/);
    await page.click('[data-testid=show-answer]');
    await page.click('[data-testid=rate-3]');
    // Lesson 2 is done for today; reviewing ahead brings in invoice (due tomorrow).
    await page.waitForSelector('[data-testid=review-ahead]');
    assert.match(await page.textContent('[data-testid=review-ahead]'), /Ôn trước 1 thẻ/);
    await page.click('[data-testid=review-ahead]');
    await page.waitForFunction(() => /invoice/.test(document.querySelector('[data-testid=study-card]')?.textContent ?? ""));

    // Card info: memory state and the history imported from Anki.
    await page.goto(`${base}/#/library`);
    await page.click('[data-testid=lib-item] >> text=contract');
    await page.waitForSelector('[data-testid=card-info]');
    const info = await page.textContent('[data-testid=card-info]');
    assert.match(info, /Khả năng nhớ\s*\d+%/);
    assert.match(info, /Lượt ôn · quên\s*3 · 1/);
    await page.click('[data-testid=card-info] summary');
    const hist = await page.textContent('[data-testid=card-history]');
    assert.match(hist, /Tốt.*Anki.*Quên.*Anki/s);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("imports an Anki package under the production CSP: preview, mapping, progress kept", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    // Real package written by Anki's own library (tools/anki/make-fixture.py): 6 words in 2 lessons, 3 studied.
    await page.setInputFiles('[data-testid=import-anki-file]', fileURLToPath(new URL("../../web/test/fixtures/anki-fsrs.apkg", import.meta.url)));
    await page.waitForSelector('[data-testid=anki-report]');
    assert.equal(await page.inputValue('[data-testid=anki-field-word]'), "Target word");
    assert.equal(await page.inputValue('[data-testid=anki-field-vi]'), "Vietnamese");
    assert.match(await page.textContent('[data-testid=anki-sample]'), /abide by.*verb.*tôn trọng, tuân theo/s);
    const report = await page.textContent('[data-testid=anki-report]');
    assert.match(report, /6 từ mới vào bộ thẻ mới “600 Essential”, chia theo 2 bài/);
    assert.match(report, /3 thẻ giữ tiến độ ôn từ Anki/);
    assert.equal(await noOverflow(page), true);
    await page.click('[data-testid=anki-run]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=anki-report]'));
    await page.goto(`${base}/#/library`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-item]').length === 6);
    // An Anki new card can be answered (the first importer stored a memory state that made "show answer" throw).
    // Short screen (small phone with the keyboard bar): the rating row is pinned to the bottom, never below the fold.
    await page.setViewportSize({ width: 360, height: 480 });
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=show-answer]');
    await page.click('[data-testid=show-answer]');
    const box = await page.locator('[data-testid=rate-3]').boundingBox();
    const mainBottom = await page.evaluate(() => document.querySelector("#main").getBoundingClientRect().bottom);
    assert.ok(box && box.y + box.height <= mainBottom, `rating row at ${JSON.stringify(box)}, visible area ends at ${mainBottom}`);
    assert.equal(await noOverflow(page), true);
    await page.goto(`${base}/#/today`);
    await page.goto(`${base}/#/study`);
    let answeredNew = false;
    for (let i = 0; i < 12 && !answeredNew; i++) {
      const ask = await page.waitForSelector('[data-testid=show-answer], [data-testid=type-input]');
      answeredNew = (await page.locator('[data-testid=counts] .c-new.on').count()) > 0
        && (await page.getAttribute('[data-testid=study-card]', "data-template")) === "recognize";
      if ((await ask.getAttribute("data-testid")) === "show-answer") await ask.click();
      else await page.click('text=Không nhớ');
      await page.click('[data-testid=rate-3]', { timeout: 5000 });
      await page.waitForSelector('[data-testid=rate-3]', { state: "detached" });
    }
    assert.equal(answeredNew, true);
    // Importing the same file again adds nothing and keeps the progress.
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles('[data-testid=import-anki-file]', fileURLToPath(new URL("../../web/test/fixtures/anki-fsrs.apkg", import.meta.url)));
    await page.waitForSelector('[data-testid=anki-report]');
    assert.match(await page.textContent('[data-testid=anki-report]'), /^0 từ mới.*Bỏ qua 6 từ đã có/s);
    assert.equal(await page.isEnabled('[data-testid=anki-run]'), false);
    await page.click('[data-testid=anki-cancel]');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("FSRS optimizer: fits the learner's history in the browser, applies on request, and the schedule follows", async () => {
    const { ctx, page, errors } = await open(browser, base);
    // A learner who forgets fast (recall exp(-t/s), s x2.5 per success): 1200 cards, about 11k answers.
    const DAY = 86_400_000;
    const T0 = Date.now() - 400 * DAY;
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const reviews = [];
    const log = (cardId, at, rating, state) => reviews.push({ id: `${cardId}@${at}`, cardId, noteId: cardId.split(".")[0], deckId: "d1", rating, state, stability: 1, difficulty: 5, scheduledDays: 0, reviewedAt: at, durationMs: 5000, device: "web" });
    for (let c = 0; c < 1200; c++) {
      const id = `h${c}.recognize`;
      let t = T0 + Math.floor(rnd() * 120) * DAY;
      log(id, t, 3, 0);
      log(id, (t += 600_000), 3, 1);
      let st = 2 + rnd() * 3, ivl = 1, state = 2;
      for (let k = 0; k < 7; k++) {
        t += ivl * DAY;
        const ok = rnd() < Math.exp(-ivl / st);
        log(id, t, ok ? 3 : 1, state);
        if (ok) (st *= 2.5), (ivl = Math.max(1, Math.round(st * 0.1))), (state = 2);
        else (st = Math.max(1, st * 0.3)), (ivl = 1), (state = 3);
      }
    }
    const file = join(tmpdir(), `lexi-history-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ app: "vhub-lexi", version: 1, exportedAt: Date.now(), decks: [], notes: [], cards: [], reviews, daily: [], prefs: null }));
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=fsrs]');
    assert.match(await page.textContent('[data-testid=fsrs-status]'), /tham số mặc định/);
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');

    // A new word: what "Dễ" would schedule with the default parameters.
    await addWord(page, base, "serendipity", "sự tình cờ may mắn");
    const easyLabel = async () => {
      await page.goto(`${base}/#/study`);
      await page.waitForSelector('[data-testid=show-answer]');
      await page.click('[data-testid=show-answer]');
      return (await page.textContent('[data-testid=rate-4]')).trim();
    };
    const before = await easyLabel();

    await page.goto(`${base}/#/settings`);
    await page.click('[data-testid=fsrs-optimize]');
    await page.waitForSelector('[data-testid=fsrs-apply]', { timeout: 60_000 });
    const result = await page.textContent('[data-testid=fsrs-result]');
    const [, from, to] = result.match(/giảm từ ([\d,]+)% xuống ([\d,]+)%/) ?? [];
    assert.ok(from && to, result);
    assert.ok(Number(to.replace(",", ".")) < Number(from.replace(",", ".")), result);
    assert.match(result, new RegExp(`Trên ${reviews.length.toLocaleString("vi-VN").replace(".", "\\.")} lượt ôn`));
    await page.click('[data-testid=fsrs-apply]');
    await page.waitForFunction(() => /tham số tối ưu ngày/.test(document.querySelector('[data-testid=fsrs-status]')?.textContent ?? ""));

    // The study screen now schedules with them: this learner's first "Easy" interval is much shorter.
    const after = await easyLabel();
    assert.notEqual(after, before);
    await page.reload();
    await page.goto(`${base}/#/settings`);
    // Kept across a reload (IndexedDB), once the stored settings have loaded.
    await page.waitForFunction(() => /tham số tối ưu ngày .* trên 10\.\d{3} lượt ôn/.test(document.querySelector('[data-testid=fsrs-status]')?.textContent ?? ""));
    // Running it again on the same history keeps what is there.
    await page.click('[data-testid=fsrs-optimize]');
    await page.waitForSelector('[data-testid=fsrs-result]', { timeout: 60_000 });
    assert.match(await page.textContent('[data-testid=fsrs-result]'), /không cần đổi/);
    console.log(`fsrs e2e: easy ${before} -> ${after}; ${result.trim()}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("works offline after the first visit (service worker + cached dictionary shards)", async () => {
    const { ctx, page } = await open(browser, base);
    await page.goto(`${base}/#/add`);
    await page.fill('[data-testid=word-input]', "ephemeral");
    await page.waitForSelector('[data-testid=preview]');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    // Look the word up once while the service worker is in control so its shard is cached.
    await page.fill('[data-testid=word-input]', "ephemeral");
    await page.waitForFunction(() => document.querySelector('[data-testid=preview]')?.textContent?.includes("lasting a very short time"));
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('[data-testid=word-input]');
    await page.fill('[data-testid=word-input]', "ephemeral");
    await page.waitForFunction(() => document.querySelector('[data-testid=preview]')?.textContent?.includes("lasting a very short time"));
    await ctx.close();
  });
});

describe("practice loop: test result -> missed words and grammar -> cards -> progress", () => {
  const PASSAGE = "Dear Ms. Tran,\nThe merger with Acme Corp. was postponed until the invoice is approved. Please review the agenda.";
  const shot = async (page, name) => {
    if (!process.env.SHOTS) return;
    await page.waitForTimeout(1300); // entrance animations and toasts settle
    await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`), fullPage: true });
  };

  it("logs a test, turns a missed passage and a grammar question into cards, and shows the target on Today", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/#/practice`);
    await page.waitForSelector('[data-testid=result-form]');

    // 1. result of a test: 53/100, 47 wrong, all classified
    await page.fill('[data-testid=t-name]', "Test 1 TOEIC NEW 2026");
    await page.fill('[data-testid=t-p5]', "20");
    await page.fill('[data-testid=t-p6]', "8");
    await page.fill('[data-testid=t-p7]', "25");
    await page.fill('[data-testid=t-min]', "57");
    for (const [k, v] of [["v", "20"], ["g", "15"], ["p", "8"], ["t", "4"]]) await page.fill(`[data-testid=t-c-${k}]`, v);
    assert.match(await page.textContent('[data-testid=result-form]'), /đã phân loại 47\/47/);
    await shot(page, "1-result");
    await page.click('[data-testid=t-save]');
    await page.waitForSelector('[data-testid=words-tab]');

    // 2. paste the passage of a missed question: unknown words are marked, coverage is shown
    await page.fill('[data-testid=passage]', PASSAGE);
    await page.waitForSelector('[data-testid=coverage]');
    const keys = await page.locator('[data-testid=unknown-chip]').allTextContents();
    assert.deepEqual(keys.map((k) => k.replace(/ ×\d+/, "")).sort(), ["approved", "merger", "postponed", "review", "invoice", "agenda"].sort());
    assert.match(await page.textContent('[data-testid=coverage]'), /Bạn quen khoảng \d+% số từ/);
    assert.equal(await page.locator('[data-testid=unknown-word]').filter({ hasText: /^Acme$|^Corp$|^Tran$/ }).count(), 0); // names are not "unknown words"
    await shot(page, "2-words");
    await page.locator('[data-testid=unknown-chip]', { hasText: "merger" }).click();
    await page.waitForSelector('[data-testid=wp-vi]');
    await page.waitForFunction(() => document.querySelector('[data-testid=wp-vi]').value.length > 0);
    assert.match(await page.inputValue('[data-testid=wp-ex]'), /merger with Acme/);
    await shot(page, "3-word-panel");
    await page.click('[data-testid=wp-add]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=word-panel]'));
    // the added word is no longer "chưa có": it is in the deck but not learned yet
    assert.equal(await page.locator('[data-testid=unknown-chip]', { hasText: "merger" }).count(), 0);
    // "Biết rồi" removes a word from the unknown list and raises coverage
    const before = Number((await page.textContent('[data-testid=coverage]')).match(/Bạn quen khoảng (\d+)%/)[1]);
    await page.locator('[data-testid=unknown-chip]', { hasText: "review" }).click();
    await page.click('[data-testid=wp-know]');
    const after = Number((await page.textContent('[data-testid=coverage]')).match(/Bạn quen khoảng (\d+)%/)[1]);
    assert.ok(after > before, `coverage ${before} -> ${after}`);

    // 3. a missed grammar question becomes a fill-in card
    await page.click('[data-testid=tab-grammar]');
    await page.fill('[data-testid=g-sentence]', "___ you need any help, please call us.");
    await page.fill('[data-testid=g-answer]', "Should");
    await page.fill('[data-testid=g-rule]', "Đảo ngữ điều kiện: Should + S + V = If + S + should + V");
    await page.waitForSelector('[data-testid=g-preview]');
    assert.match(await page.textContent('[data-testid=g-preview]'), /_____ you need any help/);
    // An answer that is not in a finished sentence cannot make a card
    await page.fill('[data-testid=g-sentence]', "Should you need any help, please call us.");
    await page.fill('[data-testid=g-answer]', "Would");
    await page.waitForSelector('[data-testid=g-notfound]');
    assert.equal(await page.isDisabled('[data-testid=g-save]'), true);
    await page.fill('[data-testid=g-sentence]', "___ you need any help, please call us.");
    await page.fill('[data-testid=g-answer]', "Should");
    await shot(page, "4-grammar");
    await page.click('[data-testid=g-save]');
    await page.waitForFunction(() => document.querySelector('[data-testid=g-sentence]').value === "");

    // 4. Today shows the result against the target and links to what to study
    await page.goto(`${base}/#/today`);
    await page.waitForSelector('[data-testid=target]');
    assert.match(await page.textContent('[data-testid=target-score]'), /53\/100/);
    assert.match(await page.textContent('[data-testid=target]'), /mục tiêu 70/);
    assert.match(await page.textContent('[data-testid=target-advice]'), /thiếu từ/);
    assert.match(await page.textContent('[data-testid=target-study-words]'), /Học 1 từ của bài này/);
    assert.equal(await noOverflow(page), true);
    await shot(page, "5-today");

    // Library lists the word and the sentence, never the test result; the count in Stats matches.
    await page.goto(`${base}/#/library`);
    await page.waitForSelector('[data-testid=lib-item]');
    const lib = await page.locator('[data-testid=lib-item]').allTextContents();
    assert.equal(lib.length, 2);
    assert.ok(!lib.some((t) => /Test 1 TOEIC/.test(t)));
    await page.goto(`${base}/#/stats`);
    assert.equal(await page.textContent('[data-testid=stat-words]'), "2");

    // 5. the grammar card is studied like any other: typed answer, back shows the rule
    await page.goto(`${base}/#/study?tag=ngu-phap`);
    await page.waitForSelector('[data-testid=study-card]');
    assert.match(await page.textContent('[data-testid=study-card]'), /_____ you need any help/);
    assert.doesNotMatch(await page.textContent('[data-testid=study-card]'), /Should you/);
    await shot(page, "6-grammar-front");
    await page.fill('[data-testid=type-input]', "should");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Đảo ngữ điều kiện/.test(document.querySelector('[data-testid=study-card]')?.textContent ?? ""));
    await shot(page, "7-grammar-back");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("deleting a result needs confirmation and keeps the cards made from it", async () => {
    const { ctx, page } = await open(browser, base);
    await page.goto(`${base}/#/practice?tab=result`);
    await page.fill('[data-testid=t-name]', "Test 2");
    await page.fill('[data-testid=t-p5]', "27");
    await page.click('[data-testid=t-save]');
    await page.waitForSelector('[data-testid=words-tab]');
    await page.click('[data-testid=tab-result]');
    await page.waitForSelector('[data-testid=test-history]');
    await page.click('[data-testid=test-history] button:has-text("Xoá")');
    await page.click('[data-testid=confirm-cancel]');
    assert.equal(await page.locator('[data-testid=test-history]').count(), 1);
    await page.click('[data-testid=test-history] button:has-text("Xoá")');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=test-history]'));
    await ctx.close();
  });
});

describe("responsive layout", () => {
  for (const [name, vp] of [["phone", { width: 390, height: 780 }], ["tablet", { width: 820, height: 1000 }], ["desktop", { width: 1440, height: 900 }]]) {
    it(`${name}: every screen fits without horizontal scrolling`, async () => {
      const { ctx, page, errors } = await open(browser, base, { viewport: vp });
      await addWord(page, base, "resilient", "kiên cường");
      for (const r of ["study", "add", "library", "stats", "settings"]) {
        await page.goto(`${base}/#/${r}`);
        await page.waitForTimeout(150);
        assert.equal(await noOverflow(page), true, `${r} overflows at ${vp.width}px`);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }

  it("phone shows the bottom tab bar, desktop the sidebar", async () => {
    const phone = await open(browser, base, { viewport: { width: 390, height: 780 } });
    await phone.page.goto(`${base}/#/study`);
    assert.equal(await phone.page.isVisible(".tabbar"), true);
    assert.equal(await phone.page.isVisible(".side"), false);
    await phone.ctx.close();
    const desk = await open(browser, base);
    await desk.page.goto(`${base}/#/study`);
    assert.equal(await desk.page.isVisible(".side"), true);
    assert.equal(await desk.page.isVisible(".tabbar"), false);
    await desk.ctx.close();
  });
});

describe("nhập nhanh: screenshots -> reviewed rows -> grammar cards and a passage for the unknown-words check", () => {
  // What the Cloud Function returns for the Q131-134 screenshots (there is no Gemini in CI).
  const OPTS = (a, b, c, d) => ({ A: a, B: b, C: c, D: d });
  const ANSWER = {
    passages: [{ id: 1, label: "Questions 131-134", truncated: true, text: "OSAKA (14 October) - Maruya Interactive revealed this morning that it will unveil its newest video game later this week. A preview of the game _____ a presentation from the design team will be streamed on Thursday." }],
    questions: [
      { number: 131, part: 6, kind: "fill", stem: "A preview of the game _____ a presentation from the design team will be streamed on Thursday.", options: OPTS("how", "as well as", "but", "even though"), correct: "B", result: "right", passage: 1, topic: "Giới từ / liên từ", rule: "as well as nối hai danh từ.", translation: "Bản xem trước cùng bài thuyết trình sẽ được phát trực tuyến.", flags: [] },
      { number: 132, part: 6, kind: "fill", stem: "Many fans are already _____ that it will be a sequel to the beloved series.", options: OPTS("requesting", "analyzing", "confirming", "speculating"), correct: "D", result: "wrong", passage: 1, topic: "Khác", rule: "speculating that: đoán rằng.", translation: "Nhiều người hâm mộ đã suy đoán đây là phần tiếp theo.", flags: [] },
      { number: 133, part: 6, kind: "fill", stem: "The first title was a _____ success for the company.", options: OPTS("remarking", "remark", "remarkable", "remarkably"), correct: "C", result: "wrong", passage: 1, topic: "Dạng từ", rule: "Sau mạo từ a, trước danh từ success: tính từ.", translation: "Tựa đầu tiên là một thành công đáng kể.", flags: [] },
      { number: 135, part: 5, kind: "fill", stem: "The report will be _____ by Friday.", options: OPTS("complete", "completed", "completing", "completion"), correct: null, result: "unknown", passage: null, topic: "", rule: "", translation: "", flags: ["no-answer"] },
      { number: 134, part: 6, kind: "insert", stem: "Which sentence fits?", options: OPTS("Its worldwide sales were double that number.", "b", "c", "d"), correct: "A", result: "unknown", passage: 1, topic: "", rule: "", translation: "", flags: [] },
    ],
  };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  it("reads a screenshot, lets the learner correct a row, and saves only what was checked", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    let calls = 0;
    await page.exposeFunction("__stubExtract", (input) => (calls++, input.images.length === 1 && input.images[0].mime === "image/jpeg" && input.images[0].data.length > 20 ? ANSWER : { passages: [], questions: [] }));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await page.goto(`${base}/#/practice?tab=grammar`);
    await page.waitForSelector('[data-testid=import]');
    await page.click('[data-testid=import-toggle]');
    assert.equal(await page.locator('[data-testid=import-run]').isDisabled(), true); // nothing to read yet
    await page.setInputFiles('[data-testid=import-file]', { name: "q131.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector('.thumb img');
    await page.click('[data-testid=import-run]');
    await page.waitForSelector('[data-testid=import-review]');
    assert.equal(calls, 1);

    const rows = page.locator('[data-testid=import-draft]');
    assert.equal(await rows.count(), 4); // the "insert" question is not a grammar row
    assert.match(await page.textContent('[data-testid=import-skipped]'), /1 câu/);
    // Missed questions are selected, the one answered right and the one without an answer are not.
    const checked = await page.locator('[data-testid=draft-include]').evaluateAll((els) => els.map((e) => [e.checked, e.disabled]));
    assert.deepEqual(checked, [[false, false], [true, false], [true, false], [false, true]]);
    assert.match(await rows.nth(3).textContent(), /Chưa có đáp án đúng/);
    assert.match(await page.textContent('[data-testid=import-save]'), /Lưu 2 thẻ/);
    // Cards from a test do not land among unrelated words: the default is a deck of their own, to be created on save.
    assert.equal(await page.inputValue('[data-testid=deck-name]'), "Luyện đề TOEIC");

    // The learner picks the answer of the unanswered row: it becomes savable and selected.
    await rows.nth(3).locator('label.opt', { hasText: "completed" }).click();
    assert.match(await page.textContent('[data-testid=import-save]'), /Lưu 3 thẻ/);
    assert.equal(await rows.nth(3).locator('[data-testid=draft-include]').isChecked(), true);
    // Edit a rule by hand, and look at the card that will be saved.
    await rows.nth(1).locator('[data-testid=draft-edit]').click();
    await rows.nth(1).locator('[data-testid=draft-rule]').fill("Quy tắc do tôi viết.");
    assert.match(await rows.nth(1).locator('[data-testid=draft-preview]').textContent(), /speculating/);
    // Unchecking a row keeps it out.
    await rows.nth(2).locator('[data-testid=draft-include]').uncheck();
    await page.click('[data-testid=import-save]');
    await page.waitForFunction(() => /Đã thêm 2 thẻ ngữ pháp/.test(document.body.textContent));

    // The deck now exists and is the selected one; the cards are in it, not in the default deck.
    await page.waitForSelector('[data-testid=deck-select]');
    assert.equal(await page.locator('[data-testid=deck-select] option:checked').textContent(), "Luyện đề TOEIC");
    assert.equal(await page.locator('[data-testid=deck-select] option').count(), 1);
    // The two saved rows left the list; the others stay for a later look. The passage is still offered.
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=import-draft]').length === 2);
    assert.match(await page.textContent('[data-testid=import-truncated]'), /bị cắt/);
    assert.match(await page.textContent('[data-testid=grammar-tab]'), /2 thẻ ngữ pháp/);

    // Reading the same screenshot again flags what was saved as a duplicate and does not preselect it.
    await page.click('text=Làm lại');
    await page.setInputFiles('[data-testid=import-file]', { name: "q131.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector('.thumb img');
    await page.click('[data-testid=import-run]');
    await page.waitForSelector('[data-testid=import-review]');
    const dup = await page.locator('[data-testid=draft-include]').evaluateAll((els) => els.map((e) => e.checked));
    // 132 and 135 were saved (133 was unchecked): only 133 is still new.
    assert.deepEqual(dup, [false, false, true, false]);
    assert.match(await page.textContent('[data-testid=import-review]'), /Câu này đã có thẻ/);

    // The passage goes to the unknown-words tab.
    await page.click('[data-testid=import-use-passage]');
    await page.waitForSelector('[data-testid=coverage]');
    assert.match(await page.inputValue('[data-testid=passage]'), /^OSAKA \(14 October\)/);
    assert.equal(await noOverflow(page), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("shows a clear message when the AI is unreachable and keeps what was typed", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { window.__lexiExtract = async () => { throw Object.assign(new Error("x"), { code: "functions/resource-exhausted" }); }; });
    await page.goto(`${base}/#/practice?tab=grammar`);
    await page.click('[data-testid=import-toggle]');
    await page.fill('[data-testid=import-text]', "101. ___ you need any help, please call us. (A) Should (B) Because Đáp án: A");
    await page.click('[data-testid=import-run]');
    assert.match(await page.textContent('[data-testid=import-error]'), /Hết lượt AI hôm nay/);
    assert.match(await page.inputValue('[data-testid=import-text]'), /Should/);
    assert.equal(errors.filter((e) => !/resource-exhausted/.test(e)).length, 0);
    await ctx.close();
  });

  it("without sign-in the panel says what it needs and the manual tabs still work", async () => {
    const { ctx, page } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/#/practice?tab=grammar`);
    await page.click('[data-testid=import-toggle]');
    await page.fill('[data-testid=import-text]', "x".repeat(40));
    assert.match(await page.textContent('[data-testid=import-off]'), /đăng nhập/);
    assert.equal(await page.locator('[data-testid=import-run]').isDisabled(), true);
    await page.fill('[data-testid=g-sentence]', "Please ___ us.");
    await ctx.close();
  });

  it("hints on the front: wait, cue, whole tip with the answer blanked, rating capped, tip and notes edited in place", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shots = process.env.LEXI_SHOTS;
    // Let the card and dialog animations settle so the pictures show the resting state.
    const shot = async (name) => shots && (await page.waitForTimeout(500), await page.screenshot({ path: join(shots, `${name}.png`) }));
    const T = Date.now() - 60_000;
    const DAY = 86_400_000;
    const file = join(tmpdir(), `lexi-hints-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({
      app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "TOEIC", createdAt: T, updatedAt: T }],
      notes: [{
        id: "n1", type: "vocab", deckId: "d1", createdAt: T, updatedAt: T,
        fields: {
          word: "protect", ipa: "prəˈtɛkt", pos: "verb", vi: "bảo vệ, che chở",
          examples: ["Consumer laws protect the public.", "The warranty protects you against defects."],
          examplesVi: ["Luật tiêu dùng bảo vệ công chúng.", "Bảo hành bảo vệ bạn khỏi lỗi sản xuất."],
          mnemonic: 'Đọc như "pờ-rô tếch": thủ môn Tếch lao ra bảo vệ khung thành.',
          notes: "Khác prevent (ngăn chuyện xảy ra).\nprotect A from/against B",
        },
      }],
      cards: [{ id: "n1.recognize", noteId: "n1", deckId: "d1", template: "recognize", state: 2, due: T, stability: 10, difficulty: 5, scheduledDays: 10, learningSteps: 0, reps: 3, lapses: 0, lastReview: T - 10 * DAY, createdAt: T, updatedAt: T }],
    }));
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=hint-memo]');
    await shot("01-front-waiting");

    // Asleep for the first seconds: a tap opens nothing.
    await page.click('[data-testid=hint-memo]');
    assert.equal(await page.locator('[data-testid=hint-box-memo]').count(), 0);
    await page.waitForFunction(() => document.querySelector(".hint-tools")?.classList.contains("awake"), null, { timeout: 6000 });
    // Level 1: only the sound.
    await page.click('[data-testid=hint-memo]');
    assert.equal((await page.textContent('[data-testid=hint-box-memo] p')).trim(), 'Đọc như "pờ-rô tếch"…');
    await shot("02-front-cue");
    // Level 2: the whole tip, the Vietnamese meaning blanked.
    await page.click('[data-testid=hint-memo]');
    assert.match(await page.textContent('[data-testid=hint-box-memo] p'), /thủ môn Tếch lao ra/);
    assert.equal(await page.textContent('[data-testid=hint-box-memo] .hint-mask'), "bảo vệ");
    // The notes: first line only at level 1, nothing of the meaning in it to blank.
    await page.keyboard.press("g");
    assert.equal((await page.textContent('[data-testid=hint-box-notes] p')).trim(), "Khác prevent (ngăn chuyện xảy ra)…");
    await shot("03-front-full");

    await page.click('[data-testid=show-answer]');
    // Whole tip seen: Good and Easy are out this time; a click on them does nothing.
    assert.equal(await page.getAttribute('[data-testid=rate-3]', 'aria-disabled'), "true");
    assert.equal(await page.getAttribute('[data-testid=rate-4]', 'aria-disabled'), "true");
    assert.equal(await page.getAttribute('[data-testid=rate-2]', 'aria-disabled'), "false");
    // Examples start at a different one each review (reps = 3, two examples → the second first).
    assert.match(await page.textContent('[data-testid=example]'), /warranty/);
    assert.match(await page.textContent('[data-testid=memory]'), /Khác prevent/);
    await shot("04-back-capped");
    await page.click('[data-testid=rate-3]', { force: true });
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-revealed'), "true");

    // Edit the notes without leaving the session.
    await page.click('[data-testid=memory-edit]');
    await page.fill('[data-testid=notes-input]', "protect A from B. Khác prevent.");
    await shot("05-edit");
    await page.click('[data-testid=memory-save]');
    await page.waitForFunction(() => /protect A from B\. Khác prevent\./.test(document.querySelector('[data-testid=memory]')?.textContent ?? ""));
    await shot("06-back-saved");
    await page.click('[data-testid=rate-2]');
    await page.waitForSelector('[data-testid=session-done]');

    // The answer was logged with the hint level, so the next reviews know this word leaned on it.
    const logs = await page.evaluate(async () => {
      const req = indexedDB.open("vhub-lexi");
      const db = await new Promise((ok, ko) => ((req.onsuccess = () => ok(req.result)), (req.onerror = ko)));
      return new Promise((ok) => {
        const r = db.transaction("reviews").objectStore("reviews").getAll();
        r.onsuccess = () => ok(r.result);
      });
    });
    assert.ok(logs.some((l) => l.hint === 2 && l.rating === 2), JSON.stringify(logs));
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("a word that leaned on hints lately has them locked until the answer is shown", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const T = Date.now() - 60_000;
    const DAY = 86_400_000;
    const file = join(tmpdir(), `lexi-hints-lock-${process.pid}.json`);
    const log = (n, hint) => ({ id: `n1.recognize@${T - n * DAY}`, cardId: "n1.recognize", noteId: "n1", deckId: "d1", rating: 2, state: 2, stability: 3, difficulty: 6, scheduledDays: 3, reviewedAt: T - n * DAY, durationMs: 5000, device: "web", ...(hint ? { hint } : {}) });
    writeFileSync(file, JSON.stringify({
      app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "TOEIC", createdAt: T, updatedAt: T }],
      notes: [{ id: "n1", type: "vocab", deckId: "d1", createdAt: T, updatedAt: T, fields: { word: "convince", vi: "thuyết phục", mnemonic: 'Đọc như "con vịt": cố thuyết phục một con vịt biết nói tiếng Anh.' } }],
      cards: [{ id: "n1.recognize", noteId: "n1", deckId: "d1", template: "recognize", state: 2, due: T, stability: 3, difficulty: 6, scheduledDays: 3, learningSteps: 0, reps: 5, lapses: 0, lastReview: T - 3 * DAY, createdAt: T, updatedAt: T }],
      reviews: [log(20, 2), log(12, 1), log(8), log(3, 2)],
    }));
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=hint-memo]');
    // The history is read only when a hint is about to open (no read per card): no lock shown before that.
    assert.equal(await page.locator('[data-testid=hint-memo] .hint-dot').count(), 0);
    await page.waitForTimeout(4200);
    await page.click('[data-testid=hint-memo]');
    await page.waitForSelector('[data-testid=hint-memo] .hint-dot');
    assert.equal(await page.locator('[data-testid=hint-box-memo]').count(), 0);
    // A second tap knows already and still does not open it.
    await page.click('[data-testid=hint-memo]');
    assert.equal(await page.locator('[data-testid=hint-box-memo]').count(), 0);
    if (process.env.LEXI_SHOTS) await page.screenshot({ path: join(process.env.LEXI_SHOTS, "07-locked.png") });
    // After the answer the tip is there to read, and every rating is allowed (no hint was used).
    await page.click('[data-testid=show-answer]');
    assert.match(await page.textContent('[data-testid=memory]'), /con vịt/);
    assert.equal(await page.getAttribute('[data-testid=rate-4]', 'aria-disabled'), "false");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
