import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
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

    // The ladder: the letters appear by themselves (a new one every 2 s); then the right word: correct, but the best
    // rating is Hard. (This word has one phrase at most, so the first press goes to the letters rung.)
    await page.waitForSelector('[data-testid=ladder].awake', { timeout: 6000 });
    await page.click('[data-testid=ladder-btn]');
    await page.waitForFunction((t) => document.querySelector('[data-testid=answer-hint]')?.textContent?.trim() === t, target.slice(0, 2), { timeout: 6000 });
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

  it("recall ladder: another meaning's phrase, letters by themselves, four words flash, the flashed answer caps the rating at Again", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=tpl-cloze]');
    await page.check('[data-testid=tpl-cloze]');
    await page.uncheck('[data-testid=tpl-recognize]');
    const T = Date.now() - 60_000;
    const vocab = (id, word, vi, extra = {}) => ({ id, type: "vocab", deckId: "d1", createdAt: T, updatedAt: T, fields: { word, vi, pos: "verb", en: `${word} definition`, ...extra } });
    const card = (noteId) => ({ id: `${noteId}.cloze`, noteId, deckId: "d1", template: "cloze", state: 0, due: T, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, createdAt: T, updatedAt: T });
    const file = join(tmpdir(), `lexi-ladder-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({
      app: "vhub-lexi", version: 1, exportedAt: T, decks: [{ id: "d1", name: "TOEIC", createdAt: T, updatedAt: T }],
      notes: [
        vocab("n1", "accommodate", "chứa được; đáp ứng", { phrases: ["accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu"] }),
        vocab("n2", "negotiate", "đàm phán"), vocab("n3", "implement", "triển khai"), vocab("n4", "postpone", "hoãn lại"),
      ],
      cards: [card("n1")],
    }));
    await page.setInputFiles('[data-testid=import-file]', file);
    await page.click('[data-testid=confirm-ok]');
    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=type-input]');
    // The card asks with the first phrase (reps 0); rung 1 shows the OTHER one with the word blanked.
    await page.click('[data-testid=ladder-btn]');
    const phrase = await page.textContent('[data-testid=ladder-phrase]');
    assert.match(phrase, /a request/);
    assert.doesNotMatch(phrase, /accommodate/);
    // Rung 2: a second letter appears by itself.
    await page.click('[data-testid=ladder-btn]');
    await page.waitForFunction(() => document.querySelector('[data-testid=answer-hint]')?.textContent?.trim() === "ac", null, { timeout: 6000 });
    // Rung 3: four words flash, can't be clicked, then are gone.
    await page.click('[data-testid=ladder-btn]');
    await page.waitForSelector('[data-testid=ladder-flash]');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=ladder-flash]')).pointerEvents), "none");
    assert.equal((await page.$$('[data-testid=ladder-flash] b')).length, 4);
    await page.waitForSelector('[data-testid=ladder-flash]', { state: "detached", timeout: 4000 });
    // Rung 4: the answer flashes 0.6 s and is gone; typing it is correct but the best rating is Again.
    await page.click('[data-testid=ladder-btn]');
    await page.waitForSelector('[data-testid=ladder-flash]');
    await page.waitForSelector('[data-testid=ladder-flash]', { state: "detached", timeout: 3000 });
    assert.equal(await page.$('[data-testid=ladder-btn]'), null);
    await page.fill('[data-testid=type-input]', "accommodate");
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.getAttribute('[data-testid=rate-1]', 'class'), /suggest/);
    await page.click('[data-testid=rate-1]');
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
    await page.click('[data-testid=view-edit]');
    await page.click('[data-testid=note-delete]');
    await page.click('[data-testid=confirm-cancel]');
    await page.click('[data-testid=note-save]');
    await page.waitForSelector('[data-testid=lib-item]');
    await page.click('[data-testid=lib-item]');
    await page.click('[data-testid=view-edit]');
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
      // contract and warranty are due now; invoice a little over 24 h from now, which always falls in the next study day
      // (the day starts at most 24 h away; with exactly 24 h minus the minute in T, a run just after 04:00 counted it as today).
      cards: [card("n1", {}), card("n2", {}), card("n3", { due: T + D + 120_000 })],
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
    // The read view shows each card's schedule from what is on the device; the history loads on request.
    await page.waitForSelector('[data-testid=view-schedule]');
    const sched = await page.textContent('[data-testid=view-schedule]');
    assert.match(sched, /Nhớ \d+%/);
    assert.match(sched, /3 lượt, quên 1/);
    assert.equal(await page.locator('[data-testid=view-history]').count(), 0);
    await page.click('[data-testid=view-history-load]');
    await page.waitForSelector('[data-testid=view-history]');
    assert.match(await page.textContent('[data-testid=view-history]'), /Tốt.*Quên/s);
    await page.click('[data-testid=view-edit]');
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
    // Leave the study screen for real before coming back: two hash changes in a row can land in one render, and the
    // study screen then stays mounted with the card above still revealed (no "show answer" button to wait for).
    await page.goto(`${base}/#/today`);
    await page.waitForSelector('[data-testid=today]');
    await page.goto(`${base}/#/study`);
    let answeredNew = false;
    const seen = [];
    for (let i = 0; i < 12 && !answeredNew; i++) {
      // On a timeout, say which cards came and what the screen shows instead of a card (the failure is otherwise blind).
      const ask = await page.waitForSelector('[data-testid=show-answer], [data-testid=type-input]', { timeout: 15000 }).catch(async (e) => {
        throw new Error(`${e.message.split("\n")[0]}\ncards so far: ${seen.join(" | ")}\nscreen: ${(await page.textContent("#main"))?.replace(/\s+/g, " ").slice(0, 400)}`);
      });
      seen.push(`${await page.getAttribute('[data-testid=study-card]', "data-template")}: ${(await page.textContent('[data-testid=counts]'))?.replace(/\s+/g, " ")} ${(await page.textContent('[data-testid=study-card]'))?.replace(/\s+/g, " ").slice(0, 40)}`);
      answeredNew = (await page.locator('[data-testid=counts] .c-new.on').count()) > 0
        && (await page.getAttribute('[data-testid=study-card]', "data-template")) === "recognize";
      if ((await ask.getAttribute("data-testid")) === "show-answer") await ask.click();
      else await page.click('text=Không nhớ');
      await page.click('[data-testid=rate-3]', { timeout: 5000 });
      await page.waitForSelector('[data-testid=rate-3]', { state: "detached" });
    }
    assert.equal(answeredNew, true, `no new recognize card among: ${seen.join(" | ")}`);
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
    // Noon UTC: a 10-minute gap between two answers must never straddle the 04:00 study-day boundary (at 03:50-04:00 it did,
    // the history changed and the optimizer found nothing to improve).
    const T0 = Math.floor((Date.now() - 400 * DAY) / DAY) * DAY + 12 * 3_600_000;
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

describe("library: move the chosen words to another deck", () => {
  it("selects words, moves them (to an existing or a new deck), keeps their study state, and it persists", async () => {
    const { ctx, page, errors } = await open(browser, base);
    await addWord(page, base, "resilient", "kiên cường");
    await addWord(page, base, "diligent", "siêng năng");
    await addWord(page, base, "candid", "thẳng thắn");
    // Study one so the move has a non-new card whose schedule must survive.
    await page.goto(`${base}/#/today`);
    await page.click('[data-testid=start-study]');
    await page.waitForSelector('[data-testid=study-card]');
    const studied = (await page.textContent('[data-testid=study-card]')).match(/resilient|diligent|candid/)[0];
    await page.click('[data-testid=show-answer]');
    await page.click('[data-testid=rate-4]');

    await page.goto(`${base}/#/library`);
    await page.click('text=+ Bộ thẻ');
    await page.fill('[data-testid=deck-name]', "TOEIC Part 5");
    await page.click('[data-testid=deck-save]');
    await page.waitForSelector('[data-testid=deck-name]', { state: "detached" });
    const dueBefore = await page.locator('[data-testid=lib-item]', { hasText: studied }).locator('.pill').last().textContent();

    // Selecting works without AI (local-only mode); the move button is in the selection bar.
    await page.click('[data-testid=lib-select]');
    await page.locator('[data-testid=lib-item]', { hasText: "resilient" }).click();
    await page.locator('[data-testid=lib-item]', { hasText: "diligent" }).click();
    assert.match(await page.textContent('[data-testid=bulk-bar]'), /2 từ đã chọn/);
    await page.click('[data-testid=bulk-move]');
    await page.selectOption('[data-testid=move-target]', { label: "TOEIC Part 5" });
    assert.equal(await page.textContent('[data-testid=move-start]'), "Chuyển 2 từ");
    await page.click('[data-testid=move-start]');
    await page.waitForSelector('[data-testid=move-start]', { state: "detached" });
    assert.equal(await page.locator('[data-testid=bulk-bar]').count(), 0);

    const deckOf = async (w) => (await page.locator('[data-testid=lib-item]', { hasText: w }).locator('.muted').first().textContent()).trim();
    assert.equal(await deckOf("resilient"), "TOEIC Part 5");
    assert.equal(await deckOf("diligent"), "TOEIC Part 5");
    assert.equal(await deckOf("candid"), "Mặc định");
    assert.equal(await page.locator('[data-testid=lib-item]', { hasText: studied }).locator('.pill').last().textContent(), dueBefore);

    // Choosing all, a new deck: "Chọn hết" then "+ Bộ thẻ mới…".
    await page.click('[data-testid=lib-select]');
    await page.click('text=Chọn hết 3');
    await page.click('[data-testid=bulk-move]');
    await page.selectOption('[data-testid=move-target]', "__new__");
    assert.equal(await page.isDisabled('[data-testid=move-start]'), true);
    await page.fill('[data-testid=move-name]', "Ôn lại");
    await page.click('[data-testid=move-start]');
    await page.waitForSelector('[data-testid=move-start]', { state: "detached" });
    for (const w of ["resilient", "diligent", "candid"]) assert.equal(await deckOf(w), "Ôn lại");

    await page.reload();
    await page.goto(`${base}/#/library`);
    await page.waitForSelector('[data-testid=lib-item]');
    for (const w of ["resilient", "diligent", "candid"]) assert.equal(await deckOf(w), "Ôn lại");
    assert.equal(await page.locator('[data-testid=lib-item]', { hasText: studied }).locator('.pill').last().textContent(), dueBefore);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});

describe("built-in TOEIC grammar pack: grammar trap cards", () => {
  it("local mode starts empty; Settings adds the pack once; a trap card is studied by typing the right option", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shots = process.env.LEXI_SHOTS;
    const shot = async (name) => shots && (await page.waitForTimeout(600), await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));
    await page.goto(`${base}/#/stats`);
    await page.waitForSelector('[data-testid=stat-words]');
    assert.equal(await page.textContent('[data-testid=stat-words]'), "0");
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=patterns]');
    await page.waitForFunction(() => /\d+ bẫy, \d+ câu/.test(document.querySelector("[data-testid=patterns]")?.textContent ?? ""));
    await shot("grammar-1-settings");
    await page.click('[data-testid=seed-restore]');
    await page.waitForFunction(() => /Đã thêm \d+ bẫy còn thiếu/.test(document.body.textContent ?? ""));
    await page.click('[data-testid=seed-restore]');
    await page.waitForFunction(() => /Bộ ngữ pháp đã đầy đủ/.test(document.body.textContent ?? ""));

    await page.goto(`${base}/#/study?tag=ngu-phap-toeic`);
    await page.waitForSelector('[data-testid=study-card]');
    // Learn the rule card first if it comes up, so the next one is a fill card.
    for (let i = 0; i < 6 && (await page.getAttribute('[data-testid=study-card]', 'data-template')) !== "fill"; i++) {
      await page.click('[data-testid=show-answer]');
      await page.click('[data-testid=rate-3]');
      await page.waitForSelector('[data-testid=study-card]');
    }
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-template'), "fill");
    const front = await page.textContent('[data-testid=study-card]');
    assert.match(front, /_____/);
    assert.match(front, / · /); // the options are listed, the learner still types one
    assert.equal(await page.locator('[data-testid=answer-hint]').count(), 0);
    await shot("grammar-2-fill-front");
    // The pack's own sentence for this card: the text before the blank names it.
    const pack = JSON.parse(readFileSync(new URL("../../shared/seed/grammar-toeic.json", import.meta.url), "utf8"));
    const item = pack.notes.flatMap((n) => n.fields.items.map((line) => ({ n, line })))
      .find(({ line }) => { const before = line.split("[")[0].trim(); return before.length > 8 && front.includes(before); });
    assert.ok(item, `no pack sentence matches: ${front}`);
    const right = item.line.slice(item.line.indexOf("[") + 1, item.line.indexOf("]"));
    await page.fill('[data-testid=type-input]', right);
    await page.click('[data-testid=type-check]');
    await page.waitForSelector('[data-testid=verdict]');
    assert.match(await page.textContent("[data-testid=verdict]"), /Chính xác/);
    assert.match(await page.textContent('[data-testid=study-card]'), new RegExp(item.n.fields.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await shot("grammar-3-fill-back");
    await ctx.close();
    assert.deepEqual(errors, []);
  });
});

describe("library read view (Xem)", () => {
  it("tapping a word opens a read view: meaning, examples, cover, step through the list, edit, close", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shots = process.env.LEXI_SHOTS;
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`) }));
    await addWord(page, base, "resilient", "kiên cường");
    await addWord(page, base, "diligent", "siêng năng");
    await page.goto(`${base}/#/library`);
    await page.waitForSelector('[data-testid=lib-item]');
    // Newest first: diligent, then resilient.
    await page.locator('[data-testid=lib-item]', { hasText: "diligent" }).click();
    await page.waitForSelector('[data-testid=note-view]');
    assert.equal(await page.locator('[data-testid=note-editor], .modal').count(), 0);
    const view = page.locator('[data-testid=note-view]');
    assert.match(await view.textContent(), /diligent/);
    assert.match(await view.textContent(), /siêng năng/);
    assert.equal(await page.textContent('[data-testid=view-pos]'), "1 / 2");
    assert.equal(await page.isDisabled('[data-testid=view-prev]'), true);
    assert.ok(await noOverflow(page));
    await shot("view-1-word");

    // Cover: the meaning is hidden, the word stays; the choice is remembered for the next note.
    await page.click('[data-testid=view-cover]');
    assert.equal(await page.getAttribute('[data-testid=view-cover]', 'aria-checked'), "true");
    assert.doesNotMatch(await view.textContent(), /siêng năng/);
    assert.match(await view.textContent(), /Nghĩa đang được che/);
    await shot("view-2-covered");
    await page.click('[data-testid=view-next]');
    await page.waitForFunction(() => document.querySelector('[data-testid=view-pos]')?.textContent === "2 / 2");
    assert.match(await view.textContent(), /resilient/);
    assert.doesNotMatch(await view.textContent(), /kiên cường/);
    await page.click('[data-testid=view-cover]');
    assert.match(await view.textContent(), /kiên cường/);
    assert.equal(await page.isDisabled('[data-testid=view-next]'), true);

    // Sửa opens the editor over the view; saving updates the view in place.
    await page.click('[data-testid=view-edit]');
    await page.fill('#f-vi', "kiên cường, mau phục hồi");
    await page.click('[data-testid=note-save]');
    await page.waitForFunction(() => /mau phục hồi/.test(document.querySelector('[data-testid=note-view]')?.textContent ?? ""));
    await page.click('[data-testid=view-close]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=note-view]'));
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("a grammar trap reads as rule, signals, all its sentences with the traps struck out; desktop shows it next to the list", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 1440, height: 900 } });
    const shots = process.env.LEXI_SHOTS;
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`) }));
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-testid=seed-restore]');
    await page.click('[data-testid=seed-restore]');
    await page.waitForFunction(() => /Đã thêm \d+ bẫy còn thiếu/.test(document.body.textContent ?? ""));
    const pack = JSON.parse(readFileSync(new URL("../../shared/seed/grammar-toeic.json", import.meta.url), "utf8"));
    const trap = pack.notes.find((n) => n.fields.title === "Tính từ đứng trước danh từ");
    assert.ok(trap);
    await page.goto(`${base}/#/library`);
    await page.fill('[data-testid=lib-search]', "Tính từ đứng trước danh từ");
    await page.locator('[data-testid=lib-item]', { hasText: "Tính từ đứng trước danh từ" }).first().click();
    const view = page.locator('[data-testid=note-view]');
    await view.waitFor();
    // Docked: the list stays on screen next to the view.
    assert.ok(await page.locator('[data-testid=lib-list]').isVisible());
    assert.ok((await view.boundingBox()).x > (await page.locator('[data-testid=lib-list]').boundingBox()).x);
    const text = await view.textContent();
    assert.ok(text.includes(trap.fields.rule));
    assert.ok(text.includes(trap.fields.signals));
    assert.equal(await page.locator('[data-testid=note-view] [data-testid=example]').count(), trap.fields.items.length);
    assert.match(await page.locator('[data-testid=example-wrong]').first().textContent(), /Bẫy: competitively · competition · compete/);
    await shot("view-3-trap-desktop");
    // Cover hides the answers and the rule, keeps the blanked sentences and their options.
    await page.click('[data-testid=view-cover]');
    const covered = await view.textContent();
    assert.ok(!covered.includes(trap.fields.rule));
    assert.match(covered, /The company offers a _____ salary/);
    assert.match(covered, /compete · competition · competitive · competitively/);
    await page.click('[data-testid=view-cover]');
    // Keyboard: Escape closes the panel.
    await page.locator('[data-testid=lib-search]').blur();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-testid=note-view]'));
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});

describe("bộ đề: a test PDF -> questions on this device -> timed attempt -> result + cards from missed questions", () => {
  const FIXTURES = fileURLToPath(new URL("../../web/test/fixtures/", import.meta.url));
  const shots = process.env.LEXI_SHOTS;

  /**
   * Stands in for the Cloud Function on the text path: reads the questions, options, passages and the answer key out
   * of the text the app sent, the way the model is asked to. So the test checks that the PDF text carries all of it.
   */
  function fakeRead(text) {
    const key = new Map([...(/Answer key[^:]*:([^\n]*)/.exec(text)?.[1] ?? "").matchAll(/(\d+) \(([A-D])\)/g)].map((m) => [Number(m[1]), m[2]]));
    const body = text.replace(/\n\nAnswer key[\s\S]*$/, "");
    const passages = [];
    for (const m of body.matchAll(/Questions (\d+)-(\d+) refer to the following ([^.]+)\.\n([\s\S]*?)\n(?=\d{3}\.)/g)) {
      passages.push({ id: passages.length + 1, label: `Questions ${m[1]}-${m[2]}`, text: m[4].replace(/-{4,} \(\d+\)/g, "_____"), truncated: false, from: Number(m[1]), to: Number(m[2]), raw: m[4] });
    }
    const questions = [];
    for (const m of body.matchAll(/(?:^|\n)(\d{3})\. ([\s\S]*?)(?=\n\d{3}\. |\n\nPART|\n*$)/g)) {
      const n = Number(m[1]);
      const opts = { A: "", B: "", C: "", D: "" };
      for (const o of m[2].matchAll(/\(([A-D])\) ([^\n]*)/g)) opts[o[1]] = o[2].trim();
      let stem = m[2].split("(A)")[0].replace(/\s+/g, " ").replace(/-{4,}/g, "_____").trim();
      const p = passages.find((x) => n >= x.from && n <= x.to);
      let kind = n >= 147 ? "reading" : "fill";
      if (!stem && p) {
        const s = p.raw.replace(/\n/g, " ").split(/(?<=\.)\s+/).find((x) => x.includes(`(${n})`)) ?? "";
        if (/^-{4,} \(\d+\)\.?$/.test(s.trim())) (kind = "insert"), (stem = "Which sentence fits the blank?");
        else stem = s.replace(/-{4,} \(\d+\)/, "_____").trim();
      }
      const correct = key.get(n) ?? null;
      questions.push({ number: n, part: null, kind, stem, options: opts, correct, result: "unknown", passage: p?.id ?? null, topic: kind === "fill" ? "Khác" : "", rule: correct && kind === "fill" ? `Đáp án ${correct} hợp ngữ cảnh.` : "", translation: "", flags: [] });
    }
    return { passages: passages.map(({ from, to, raw, ...x }) => x), questions };
  }

  async function importPdf(page, file) {
    await page.goto(`${base}/#/practice?tab=sets`);
    await page.waitForSelector('[data-testid=sets-empty]');
    await page.click('[data-testid=pdf-toggle]');
    await page.setInputFiles('[data-testid=pdf-file]', join(FIXTURES, file));
    await page.waitForSelector('[data-testid=pdf-facts]', { timeout: 20_000 });
  }

  it("imports the text PDF, takes the test with a clock, grades it per part, logs it and makes cards from the misses", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false }));
    const calls = [];
    await page.exposeFunction("__stubExtract", (input) => (calls.push(input), fakeRead(input.text)));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await importPdf(page, "reading-test.pdf");
    const facts = await page.textContent('[data-testid=pdf-facts]');
    assert.match(facts, /3 trang/);
    assert.match(await page.textContent('[data-testid=pdf-key]'), /17 câu \(trang 3\)/);
    assert.match(await page.textContent('[data-testid=pdf-read]'), /1 phần, ≈ 2 lượt AI/);
    assert.equal(await page.inputValue('[data-testid=set-name]'), "reading test");
    await page.fill('[data-testid=set-name]', "Đề PDF mẫu");
    await shot("1-pdf-facts");
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');

    // One call, with the two question pages in reading order and only their answers; the key page is not sent.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].images.length, 0);
    assert.ok(calls[0].text.indexOf("105.") < calls[0].text.indexOf("106."));
    assert.match(calls[0].text, /Answer key \(data, from the same test\): 101 \(A\), 102 \(A\)/);
    assert.doesNotMatch(calls[0].text, /ANSWER KEY/);
    assert.match(await page.textContent('[data-testid=pdf-total]'), /17 câu/);
    const preview = await page.textContent('[data-testid=pdf-preview]');
    assert.match(preview, /Part 5: 10/);
    assert.match(preview, /Part 6: 4/);
    assert.match(preview, /Part 7: 3/);
    assert.equal(await page.locator('[data-testid=pdf-fix]').count(), 0); // every question has its answer from the key
    assert.equal(await page.locator('[data-testid=pdf-missing]').count(), 0); // 110 -> 131 is a new part, not a gap
    await shot("2-pdf-preview");
    await page.click('[data-testid=pdf-save]');
    await page.waitForSelector('[data-testid=set-row]');
    assert.match(await page.textContent('[data-testid=sets]'), /Riêng tư · chỉ trên máy này/);

    // Take it: passages show once above their questions; answers are kept when the screen is left and reopened.
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner]');
    assert.equal(await page.locator('[data-testid=runner-q]').count(), 17);
    assert.equal(await page.locator('[data-testid=runner-passage]').count(), 2);
    assert.match(await page.textContent('[data-testid=runner-clock]'), /^\d\d:\d\d$/);
    const q = (n) => page.locator('[data-testid=runner-q]', { hasText: new RegExp(`^${n}\\.`) });
    const pick = async (n, text) => q(n).locator('label.opt', { hasText: text }).first().click();
    await pick(101, "receipts"); // right
    await pick(102, "very"); // wrong
    await pick(103, "Despite"); // right
    await shot("3-runner-part5");
    await page.click('[data-testid=runner-exit]');
    await page.waitForSelector('[data-testid=set-row]');
    assert.match(await page.textContent('[data-testid=set-row]'), /Đang làm · 3\/17 câu/);
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner]');
    assert.equal(await q(102).locator('input:checked').count(), 1);
    await pick(131, "parks"); // wrong (fill inside the e-mail)
    await pick(147, "Young children"); // right
    await q(147).scrollIntoViewIfNeeded();
    await shot("4-runner-part7");
    if (shots) (await page.emulateMedia({ colorScheme: "dark" }), await shot("4b-runner-dark"), await page.emulateMedia({ colorScheme: "light" }));
    assert.match(await page.textContent('[data-testid=runner-count]'), /5\/17/);
    await page.waitForTimeout(2200); // the clock runs while the test is open
    await page.click('[data-testid=runner-submit]');
    assert.match(await page.textContent('.modal'), /Còn 12 câu chưa làm/);
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=runner-result]');
    assert.equal(await page.textContent('[data-testid=result-score]'), "3/17");
    assert.match(await page.textContent('[data-testid=result-time]'), /^00:0[2-9]$/);
    assert.match(await page.textContent('[data-testid=result-p5]'), /2\/10/);
    assert.match(await page.textContent('[data-testid=result-p6]'), /0\/4/);
    assert.match(await page.textContent('[data-testid=result-p7]'), /1\/3/);
    await shot("5-result");
    if (shots) (await page.emulateMedia({ colorScheme: "dark" }), await shot("5b-result-dark"), await page.emulateMedia({ colorScheme: "light" }));

    // Log it: it shows in "Kết quả bài" as a short test (not compared with the full-RC target).
    await page.click('[data-testid=result-save]');
    await page.waitForFunction(() => /Đã lưu vào Kết quả bài/.test(document.querySelector('[data-testid=result-save]').textContent));
    assert.equal(await page.locator('[data-testid=result-save]').isDisabled(), true);

    // Cards from the misses: the fill-in ones are rows (selected), reading/insert ones are counted, passages offered.
    await page.click('[data-testid=result-cards]');
    await page.waitForSelector('[data-testid=import-review]');
    const rows = page.locator('[data-testid=import-draft]');
    const n = await rows.count();
    assert.ok(n >= 10, `rows: ${n}`); // 102, 104–110 blank, 131, 133, 134
    // The deck choice sits with the rows it applies to; the default is the practice deck.
    assert.equal(await page.inputValue('[data-testid=runner-result] [data-testid=deck-name]'), "Luyện đề TOEIC");
    assert.match(await page.textContent('[data-testid=import-skipped]'), /đọc hiểu \/ chèn câu/);
    assert.ok((await page.locator('[data-testid=import-passage]').count()) >= 1);
    await shot("6-cards-review");
    await page.click('[data-testid=import-save]');
    await page.waitForFunction(() => /Đã thêm \d+ thẻ ngữ pháp · Đề PDF mẫu/.test(document.body.textContent));

    // "Làm lại" wipes the answers, so it asks: "Không" keeps the result, "Làm lại" starts a clean attempt.
    await page.click('[data-testid=result-again]');
    await page.click('[data-testid=confirm-cancel]');
    assert.equal(await page.textContent('[data-testid=result-score]'), "3/17");
    await page.click('[data-testid=result-again]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=runner-submit]');
    assert.match(await page.textContent('[data-testid=runner-count]'), /0\/17/);
    assert.equal(await page.locator('[data-testid=runner-q] input:checked').count(), 0);

    // The result is a test note: "Kết quả bài" lists it.
    await page.click('[data-testid=runner-exit]');
    await page.click('[data-testid=tab-result]');
    await page.waitForFunction(() => /Đề PDF mẫu/.test(document.querySelector('[data-testid=practice]').textContent));
    assert.match(await page.textContent('[data-testid=practice]'), /RC 3\/17/);
    assert.equal(await noOverflow(page), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("a scanned PDF goes to the function as page pictures, two at a time, and a pasted key fills the answers", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 1280, height: 800 } });
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`) }));
    const calls = [];
    // No OCR in the stub: whatever the pictures, it "reads" two Part 5 questions without answers.
    const READ = { passages: [], questions: [101, 102].map((n) => ({ number: n, part: 5, kind: "fill", stem: n === 101 ? "Ms. Tran asked the staff to submit their travel _____ by Friday." : "The new printer is _____ faster than the one we used last year.", options: n === 101 ? { A: "receipts", B: "receive", C: "received", D: "receiving" } : { A: "much", B: "very", C: "many", D: "most" }, correct: null, result: "unknown", passage: null, topic: "", rule: "", translation: "", flags: ["no-answer"] })) };
    await page.exposeFunction("__stubExtract", (input) => (calls.push({ n: input.images.length, jpeg: input.images.every((i) => i.mime === "image/jpeg" && i.data.startsWith("/9j/")), size: Math.max(...input.images.map((i) => i.data.length)), text: input.text }), READ));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await importPdf(page, "reading-test-scan.pdf");
    assert.match(await page.textContent('[data-testid=pdf-scanned]'), /3 trang scan/);
    assert.match(await page.textContent('[data-testid=pdf-nokey]'), /Không thấy bảng đáp án/);
    await page.fill('[data-testid=set-key]', "101 A 102 A");
    assert.match(await page.textContent('[data-testid=set-key-count]'), /2 đáp án/);
    assert.match(await page.textContent('[data-testid=pdf-read]'), /2 phần, ≈ 6 lượt AI/);
    await shot("7-scan-facts-desktop");
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]', { timeout: 30_000 });
    assert.deepEqual(calls.map((c) => [c.n, c.jpeg]), [[2, true], [1, true]]);
    assert.ok(calls.every((c) => c.size < 1_400_000 && c.size > 20_000), JSON.stringify(calls.map((c) => c.size)));
    assert.match(calls[0].text, /101 \(A\), 102 \(A\)/);
    assert.match(await page.textContent('[data-testid=pdf-total]'), /2 câu/);
    assert.equal(await page.locator('[data-testid=pdf-fix]').count(), 0);
    await page.click('[data-testid=pdf-save]');
    await page.waitForSelector('[data-testid=set-row]');

    // Deleting asks first: "Không" keeps it, "Xoá" removes it from this device.
    await page.click('[data-testid=set-delete]');
    await page.click('[data-testid=confirm-cancel]');
    assert.equal(await page.locator('[data-testid=set-row]').count(), 1);
    await page.reload();
    await page.waitForSelector('[data-testid=set-row]');
    await page.click('[data-testid=set-delete]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=sets-empty]');
    await page.reload();
    await page.waitForSelector('[data-testid=sets-empty]');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("a big file: only the chosen pages are read, the key is looked for among them, a bad choice is refused", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const calls = [];
    await page.exposeFunction("__stubExtract", (input) => (calls.push(input), fakeRead(input.text)));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await importPdf(page, "reading-test.pdf");
    // Not a page of this file: said so, nothing can be read.
    await page.fill('[data-testid=set-range]', "4");
    await page.waitForSelector('[data-testid=set-range-bad]');
    assert.equal(await page.isEnabled('[data-testid=pdf-read]'), false);
    // Part 5 only: the key page (3) is outside the choice, so no key.
    await page.fill('[data-testid=set-range]', "1");
    await page.waitForSelector('[data-testid=pdf-nokey]');
    assert.match(await page.textContent('[data-testid=pdf-nokey]'), /trong các trang đã chọn/);
    assert.match(await page.textContent('[data-testid=pdf-pages]'), /^1\/3 trang$/);
    // Part 6–7 with the key page at the back.
    await page.fill('[data-testid=set-range]', "2 - 3");
    await page.waitForSelector('[data-testid=pdf-key]');
    assert.equal(await page.locator('[data-testid=set-range-bad]').count(), 0);
    assert.match(await page.textContent('[data-testid=pdf-pages]'), /^2\/3 trang$/);
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].text, /\n101\. /, "a page that was not chosen went to the AI");
    assert.doesNotMatch(calls[0].text, /ANSWER KEY/, "the key page itself is never sent (only the key note for these numbers)");
    assert.match(calls[0].text, /Answer key[^\n]*131 \(/, "the key found on the chosen page 3 goes with the questions");
    const total = Number((await page.textContent('[data-testid=pdf-total]')).match(/\d+/)[0]);
    assert.ok(total > 0 && total < 17, `only Part 6–7 questions expected, got ${total}`);
    assert.equal(await page.locator('[data-testid=pdf-noanswer]').count(), 0);
    assert.equal(await noOverflow(page), true);
    await page.click('[data-testid=pdf-save]');
    await page.waitForSelector('[data-testid=set-row]');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("a copier scan (1-bit CCITT, fed in upside down): the page is drawn, not blank, and the turn reaches the AI", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const sent = [];
    await page.exposeFunction("__stubExtract", (input) => (sent.push(...input.images.map((i) => `data:${i.mime};base64,${i.data}`)), { passages: [], questions: [] }));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await importPdf(page, "reading-test-copier.pdf");
    // Ink per horizontal band, top to bottom: a page turned 180° has the same bands in reverse.
    const bands = (src) => page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 60; c.height = 80;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 60, 80);
      const d = g.getImageData(0, 0, 60, 80).data;
      const out = Array(8).fill(0);
      for (let i = 0; i < d.length; i += 4) out[Math.floor(i / 4 / 60 / 10)] += 255 - d[i];
      return out;
    }, src);
    await page.waitForSelector('[data-testid=pdf-thumb-img][data-turn="0"]');
    const upright = await bands(await page.getAttribute('[data-testid=pdf-thumb-img]', "src"));
    await page.click('[data-testid=pdf-turn]');
    await page.waitForSelector('[data-testid=pdf-thumb-img][data-turn="180"]');
    assert.equal(await page.getAttribute('[data-testid=pdf-turn]', "aria-pressed"), "true");
    assert.equal(await noOverflow(page), true);
    await page.fill('[data-testid=set-range]', "1");
    await page.click('[data-testid=pdf-read]');
    await page.waitForFunction(() => document.querySelector('[data-testid=pdf-error]'));
    assert.equal(sent.length, 1);
    const turned = await bands(sent[0]);
    const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= Math.max(800, Math.max(...b) * 0.15));
    // Without pdf.js's image decoders (wasmUrl) this page renders white: the AI would get an empty picture.
    const ink = (b) => b.reduce((a, x) => a + x, 0) / (60 * 80);
    assert.ok(ink(upright) > 2 && ink(turned) > 2, `page drawn blank: ink ${ink(upright)} / ${ink(turned)}`);
    assert.ok(!close(upright, [...upright].reverse()), "the fixture page must not read the same upside down");
    assert.ok(close(turned, [...upright].reverse()), `sent page is not turned: ${turned} vs ${upright}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("listening: Part 1–2 made from their numbers, Part 3 by the AI, the audio plays file after file, LC is graded and the media is deleted with the set", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false }));
    const calls = [];
    const PART3 = [
      [32, "Where most likely are the speakers?", ["At a bank", "At a hotel", "At a train station", "At a bookstore"]],
      [33, "What does the woman ask for?", ["A receipt", "A gift bag", "A discount", "A catalog"]],
      [34, "What will the man do next?", ["Check the storage room", "Call a manager", "Print a coupon", "Close the store"]],
    ];
    // The model also "reads" question 4 of Part 2 from the page text: Lexi must drop it (Part 2 is made from numbers).
    await page.exposeFunction("__stubExtract", (input) => (calls.push(input), {
      passages: [],
      questions: [
        { number: 4, part: null, kind: "reading", stem: "Mark your answer on your answer sheet.", options: { A: "", B: "", C: "", D: "" }, correct: null, result: "unknown", passage: null, topic: "", rule: "", translation: "", flags: [] },
        ...PART3.map(([n, stem, o]) => ({ number: n, part: 5, kind: "reading", stem, options: { A: o[0], B: o[1], C: o[2], D: o[3] }, correct: null, result: "unknown", passage: null, topic: "", rule: "", translation: "", flags: [] })),
      ],
    }));
    await page.addInitScript(() => { window.__lexiExtract = (input) => window.__stubExtract(input); });
    await importPdf(page, "listening-test.pdf");
    await page.click('[data-testid=set-section] >> text=Listening');
    await page.waitForSelector('[data-testid=lc-setup]');
    await page.fill('[data-testid=lc-p1]', "1-2");
    await page.fill('[data-testid=lc-p2]', "3-5");
    // The photo page is found from its "PART 1" heading and shown small, the way it will show in the test.
    assert.equal(await page.inputValue('[data-testid=lc-photos]'), "1");
    assert.match(await page.textContent('[data-testid=lc-photos-found]'), /trang 1\./);
    await page.waitForSelector('[data-testid=lc-photo-thumb]');
    assert.match(await page.textContent('[data-testid=lc-parts-help]'), /Part 2: không có ảnh.*3 câu đáp \(A–C\)/);
    await page.fill('[data-testid=set-range]', "2-4");
    await page.setInputFiles('[data-testid=lc-audio]', ["listening-03.mp3", "listening-01.mp3", "listening-02.mp3"].map((f) => join(FIXTURES, f)));
    assert.match(await page.textContent('[data-testid=lc-audio-list]'), /listening-01.*listening-02.*listening-03/s);
    assert.match(await page.textContent('[data-testid=lc-audio-count]'), /3 file/);
    assert.match(await page.textContent('[data-testid=pdf-key]'), /8 câu \(trang 4\)/);
    assert.match(await page.textContent('[data-testid=pdf-read]'), /1 phần, ≈ 2 lượt AI/);
    assert.equal(await noOverflow(page), true);
    await shot("9-lc-setup");
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].text, /PART 1/, "the photo page went to the AI");
    assert.match(calls[0].text, /32 \(D\)/);
    assert.match(await page.textContent('[data-testid=pdf-total]'), /8 câu/);
    assert.match(await page.textContent('[data-testid=pdf-total-p1]'), /Part 1: 2/);
    assert.match(await page.textContent('[data-testid=pdf-total-p2]'), /Part 2: 3/);
    assert.match(await page.textContent('[data-testid=pdf-total-p3]'), /Part 3: 3/);
    assert.match(await page.textContent('[data-testid=pdf-audio]'), /^3 file nghe$/);
    assert.equal(await page.locator('[data-testid=pdf-noanswer]').count(), 0);
    await page.click('[data-testid=pdf-save]');
    await page.waitForSelector('[data-testid=set-row]');
    assert.match(await page.textContent('[data-testid=set-lc]'), /Listening · 3 file nghe/);

    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner]');
    await page.waitForSelector('[data-testid=runner-picture]');
    assert.equal(await page.locator('[data-testid=runner-picture]').count(), 1);
    assert.match(await page.textContent('[data-testid=part-help-1]'), /nhìn ảnh, nghe 4 câu/);
    assert.match(await page.textContent('[data-testid=part-help-2]'), /3 câu đáp \(A–C\)/);
    assert.equal(await page.locator('[data-testid=part1-no-photos]').count(), 0);
    assert.deepEqual(await page.$$eval('[data-testid=runner-q] .opts', (els) => els.map((e) => e.querySelectorAll("input").length)), [4, 4, 3, 3, 3, 4, 4, 4]);
    // Straight through, file after file, like the exam: the position moves to the second file by itself.
    await page.click('[data-testid=listen-toggle]');
    await page.waitForFunction(() => /File 1\/3/.test(document.querySelector('[data-testid=listen-pos]')?.textContent ?? ""));
    await page.waitForFunction(() => /File 2\/3/.test(document.querySelector('[data-testid=listen-pos]')?.textContent ?? ""), null, { timeout: 10_000 });
    await shot("10-lc-runner");
    await page.click('[data-testid=listen-toggle]');
    await page.waitForFunction(() => /Nghe tiếp/.test(document.querySelector('[data-testid=listen-toggle]')?.textContent ?? ""));
    // Key: 1 A, 2 C, 3 B, 4 A, 5 C, 32 D, 33 B, 34 A. Right on 1, 3, 32; wrong on 2; the rest blank.
    const qs = page.locator('[data-testid=runner-q]');
    await qs.nth(0).locator('label:has-text("A")').click();
    await qs.nth(1).locator('label:has-text("A")').click();
    await qs.nth(2).locator('label:has-text("B")').click();
    await qs.nth(5).locator('label:has-text("At a bookstore")').click();
    await page.click('[data-testid=runner-submit]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=runner-result]');
    assert.equal(await page.textContent('[data-testid=result-score]'), "3/8");
    assert.match(await page.textContent('[data-testid=result-lc]'), /LC: 3\/8/);
    assert.match(await page.textContent('[data-testid=result-p1]'), /Part 1: 1\/2/);
    assert.match(await page.textContent('[data-testid=result-p2]'), /Part 2: 1\/3/);
    assert.match(await page.textContent('[data-testid=result-p3]'), /Part 3: 1\/3/);
    assert.equal(await page.locator('[data-testid=result-p5]').count(), 0);
    await page.click('[data-testid=result-save]');
    await page.waitForFunction(() => /Đã lưu/.test(document.querySelector('[data-testid=result-save]')?.textContent ?? ""));
    await page.click('[data-testid=runner-exit]');

    // Deleting asks first; "Xoá" takes the audio and the photo off the device too.
    const media = () => page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("lexi-private");
      r.onsuccess = () => { const q = r.result.transaction("media").objectStore("media").count(); q.onsuccess = () => { res(q.result); r.result.close(); }; };
    }));
    assert.equal(await media(), 4);
    await page.click('[data-testid=set-delete]');
    await page.click('[data-testid=confirm-cancel]');
    assert.equal(await media(), 4);
    await page.click('[data-testid=set-delete]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=sets-empty]');
    assert.equal(await media(), 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("listening: Part 1 cannot be saved without its photo pages; a set saved without them says so in the test", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    const shot = async (name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));
    // A scanned book: no text layer, so Lexi cannot find the photo pages and asks for them.
    await importPdf(page, "reading-test-scan.pdf");
    await page.click('[data-testid=set-section] >> text=Listening');
    await page.fill('[data-testid=lc-p1]', "1-2");
    await page.fill('[data-testid=lc-p2]', "");
    await page.fill('[data-testid=set-range]', "3");
    assert.equal(await page.inputValue('[data-testid=lc-photos]'), "");
    assert.equal(await page.locator('[data-testid=lc-photos-found]').count(), 0);
    assert.match(await page.textContent('[data-testid=lc-photos-need]'), /Part 1 cần trang ảnh/);
    assert.equal(await page.isDisabled('[data-testid=pdf-read]'), true);
    await shot("12-lc-photos-need");
    await page.fill('[data-testid=lc-photos]', "1-2");
    assert.equal(await page.locator('[data-testid=lc-photos-need]').count(), 0);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lc-photo-thumb]').length === 2);
    await shot("13-lc-photos-typed");
    // No Part 1 in the test: nothing to ask.
    await page.fill('[data-testid=lc-photos]', "");
    await page.fill('[data-testid=lc-p1]', "");
    assert.equal(await page.locator('[data-testid=lc-photos-need]').count(), 0);
    // Part 1 on the photo pages 1-2, Part 2 numbers only: nothing for the AI to read.
    await page.fill('[data-testid=lc-p1]', "1-2");
    await page.fill('[data-testid=lc-p2]', "3-5");
    await page.fill('[data-testid=lc-photos]', "1-2");
    await page.fill('[data-testid=set-range]', "1-2");
    assert.match(await page.textContent('[data-testid=pdf-read]'), /không cần AI/);
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');
    await page.click('[data-testid=pdf-save]');
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=runner-picture]').length === 2);
    assert.deepEqual(await page.$$eval('[data-testid=runner-q] .opts', (els) => els.map((e) => e.querySelectorAll("input").length)), [4, 4, 3, 3, 3]);
    assert.match(await page.textContent('[data-testid=part-help-1]'), /nhìn ảnh, nghe 4 câu mô tả/);
    assert.match(await page.textContent('[data-testid=part-help-2]'), /không có ảnh và không in câu hỏi/);
    assert.equal(await page.locator('[data-testid=part1-no-photos]').count(), 0);
    await shot("15-lc-runner-photos");
    await page.click('[data-testid=runner-exit]');
    // A set saved before photos were asked for (Part 1, no pictures): the test says why there is no photo.
    await page.waitForSelector('[data-testid=set-open]');
    await page.waitForTimeout(500); // leaving the test saves the attempt: let that write land first
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open("lexi-private");
      r.onsuccess = () => {
        const db = r.result;
        const store = db.transaction("testsets").objectStore("testsets");
        const all = store.getAll();
        all.onsuccess = () => {
          const set = all.result[0];
          set.pictures = [];
          const tx = db.transaction("testsets", "readwrite");
          tx.objectStore("testsets").put(set);
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
      };
    }));
    await page.reload();
    await page.waitForSelector('[data-testid=set-open]');
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=part1-no-photos]');
    assert.match(await page.textContent('[data-testid=part1-no-photos]'), /Nhập lại file PDF và điền “Trang ảnh Part 1”/);
    await shot("14-lc-old-set-no-photos");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("listening without AI: Part 1 only, one audio file per question, each question plays its own", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 1280, height: 800 } });
    await importPdf(page, "listening-test.pdf");
    await page.click('[data-testid=set-section] >> text=Listening');
    await page.fill('[data-testid=lc-p1]', "1-2");
    await page.fill('[data-testid=lc-p2]', "");
    await page.fill('[data-testid=set-range]', "4");
    await page.setInputFiles('[data-testid=lc-audio]', ["listening-01.mp3", "listening-02.mp3"].map((f) => join(FIXTURES, f)));
    assert.match(await page.textContent('[data-testid=pdf-read]'), /không cần AI/);
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');
    assert.match(await page.textContent('[data-testid=pdf-audio]'), /mỗi câu một file/);
    await page.click('[data-testid=pdf-save]');
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner]');
    assert.equal(await page.locator('[data-testid=listen-bar]').count(), 0);
    assert.equal(await page.locator('[data-testid=q-play]').count(), 2);
    await page.locator('[data-testid=q-play]').nth(1).click();
    await page.waitForFunction(() => /Dừng/.test(document.querySelectorAll('[data-testid=q-play]')[1]?.textContent ?? ""));
    assert.match(await page.locator('[data-testid=q-play]').nth(0).textContent(), /Nghe/);
    await page.locator('[data-testid=q-play]').nth(1).click();
    await page.waitForFunction(() => /Nghe/.test(document.querySelectorAll('[data-testid=q-play]')[1]?.textContent ?? ""));
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("listening, one long file: after the test each question is found from its answer pause and heard again, nudged ±2 s", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 } });
    await importPdf(page, "listening-test.pdf");
    await page.click('[data-testid=set-section] >> text=Listening');
    await page.fill('[data-testid=lc-p1]', "");
    await page.fill('[data-testid=lc-p2]', "3-5");
    await page.fill('[data-testid=set-range]', "4");
    await page.setInputFiles('[data-testid=lc-audio]', join(FIXTURES, "listening-part2.mp3"));
    await page.click('[data-testid=pdf-read]');
    await page.waitForSelector('[data-testid=pdf-preview]');
    await page.click('[data-testid=pdf-save]');
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=listen-bar]');
    await page.locator('[data-testid=runner-q]').nth(0).locator('label:has-text("B")').click();
    await page.click('[data-testid=runner-submit]');
    await page.click('[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=runner-result]');
    assert.equal(await page.locator('[data-testid=q-replay]').count(), 0);
    await page.click('[data-testid=result-split]');
    await page.waitForSelector('[data-testid=q-replay]', { timeout: 20_000 });
    // Missed: 4 and 5 (left blank). The fixture's questions start at 7 s, 15.5 s and 24 s.
    const ranges = await page.$$eval('[data-testid=q-replay-range]', (els) => els.map((e) => e.textContent));
    assert.equal(ranges.length, 2);
    assert.match(ranges[0], /^File 1 · 0:15–0:19$/);
    assert.match(ranges[1], /^File 1 · 0:24–0:2[78]$/);
    await page.click('[data-testid=result-toggle]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=q-replay]').length === 3);
    assert.equal(await page.locator('[data-testid=q-replay-range]').first().textContent(), "File 1 · 0:07–0:10");
    await page.locator('[data-testid=q-replay-play]').nth(1).click();
    await page.waitForFunction(() => /Tạm dừng/.test(document.querySelector('[data-testid=listen-toggle]')?.textContent ?? ""));
    assert.match(await page.textContent('[data-testid=listen-pos]'), /File 1\/1 · 0:1[5-6]/);
    // It stops at the end of the question by itself (0:19), not running into the next one.
    await page.waitForFunction(() => /Nghe tiếp/.test(document.querySelector('[data-testid=listen-toggle]')?.textContent ?? ""), null, { timeout: 10_000 });
    assert.match(await page.textContent('[data-testid=listen-pos]'), /0:19/);
    // Started too late: 2 s earlier, kept after a reload.
    await page.locator('[data-testid=q-replay-earlier]').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=q-replay-range]')[1]?.textContent === "File 1 · 0:13–0:19");
    await page.reload();
    await page.click('[data-testid=set-open]');
    await page.waitForSelector('[data-testid=runner-result]');
    await page.click('[data-testid=result-toggle]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=q-replay-range]')[1]?.textContent === "File 1 · 0:13–0:19");
    assert.equal(await page.locator('[data-testid=result-split]').count(), 0);
    assert.equal(await noOverflow(page), true);
    if (shots) await page.locator("[data-testid=runner-q]").nth(1).screenshot({ path: join(shots, "11-lc-replay.png") });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("the JSON backup says it is private and holds no imported test", async () => {
    const { ctx, page } = await open(browser, base);
    await page.goto(`${base}/#/settings`);
    assert.match(await page.textContent('[data-testid=export-private]'), /không đưa lên repo/);
    await ctx.close();
  });

  /**
   * Two devices of one account: separate browser profiles (their own IndexedDB) over one in-memory account that
   * stands in for Firestore + Cloud Storage (the real ones are covered by web/test-int/sets.int.test.ts).
   */
  async function device(account) {
    const d = await open(browser, base, { viewport: { width: 390, height: 844 } });
    await d.page.exposeFunction("__stubExtract", (input) => fakeRead(input.text));
    await d.page.exposeFunction("__acct", (op, ...a) => {
      if (op === "list") return [...account.docs.values()];
      if (op === "put") return void account.files.set(`${a[0]}/${a[1]}`, { b64: a[2], type: a[3] });
      if (op === "get") return account.files.get(`${a[0]}/${a[1]}`) ?? null;
      if (op === "meta") return void account.docs.set(a[0].id, a[0]);
      if (op === "remove") {
        account.docs.delete(a[0]);
        for (const f of a[1]) account.files.delete(`${a[0]}/${f}`);
      }
    });
    await d.page.addInitScript(() => {
      window.__lexiExtract = (input) => window.__stubExtract(input);
      const b64 = async (blob) => btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), (c) => String.fromCharCode(c)).join(""));
      window.__lexiSetsCloud = {
        list: () => window.__acct("list"),
        putFile: async (id, path, blob, onSent) => (await window.__acct("put", id, path, await b64(blob), blob.type), onSent?.(blob.size)),
        getFile: async (id, path) => {
          const f = await window.__acct("get", id, path);
          if (!f) throw Object.assign(new Error("missing"), { code: "storage/object-not-found" });
          return new Blob([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], { type: f.type });
        },
        putMeta: (m) => window.__acct("meta", m),
        remove: (id, files) => window.__acct("remove", id, files),
      };
    });
    return d;
  }

  it("sync: a set imported on one device is listed on another, downloaded, continued there, and a delete reaches both", async () => {
    const account = { docs: new Map(), files: new Map() };
    const a = await device(account);
    await importPdf(a.page, "reading-test.pdf");
    await a.page.click('[data-testid=pdf-read]');
    await a.page.waitForSelector('[data-testid=pdf-preview]');
    await a.page.click('[data-testid=pdf-save]');
    await a.page.waitForSelector('[data-testid=set-row]');
    assert.match(await a.page.textContent('[data-testid=sets-cloud]'), /Đồng bộ · mọi thiết bị/);
    // Uploaded a moment after saving: the questions file, then the document; the PDF itself never.
    await a.page.waitForFunction(() => !document.querySelector('[data-testid=set-unsynced]'), null, { timeout: 10_000 });
    assert.equal(account.docs.size, 1);
    const [id] = account.docs.keys();
    assert.deepEqual([...account.files.keys()], [`${id}/set.json`]);
    assert.deepEqual(account.docs.get(id).files, ["set.json"]);
    assert.equal(account.docs.get(id).questions, 17);

    // Answer one question on A; the progress reaches the document.
    await a.page.click('[data-testid=set-open]');
    await a.page.waitForSelector('[data-testid=runner]');
    const q = (page, n) => page.locator('[data-testid=runner-q]', { hasText: new RegExp(`^${n}\\.`) });
    await q(a.page, 101).locator('label.opt', { hasText: "receipts" }).first().click();
    await a.page.click('[data-testid=runner-exit]');
    const deadline = Date.now() + 10_000;
    while (!/"answers":\{"0":/.test(account.docs.get(id).state) && Date.now() < deadline) await a.page.waitForTimeout(200);
    assert.match(account.docs.get(id).state, /"answers":\{"0":"[A-D]"\}/);

    // B: listed from the account, downloaded on open, the answer from A is there.
    const b = await device(account);
    // Opened straight on this screen: the account is ready only after the screen is up, and it still syncs.
    await b.page.goto(`${base}/#/practice?tab=sets`);
    await b.page.waitForSelector('[data-testid=set-remote]');
    assert.equal(await b.page.locator('[data-testid=set-row]').count(), 0);
    assert.match(await b.page.textContent('[data-testid=set-remote]'), /17 câu/);
    if (shots) await b.page.screenshot({ path: join(shots, "sync-1-remote.png") });
    await b.page.click('[data-testid=set-download]');
    await b.page.waitForSelector('[data-testid=runner]');
    assert.equal(await q(b.page, 101).locator('input:checked').count(), 1);
    await b.page.click('[data-testid=runner-exit]');
    await b.page.waitForSelector('[data-testid=set-row]');
    assert.match(await b.page.textContent('[data-testid=set-row]'), /Đang làm · 1\/17 câu/);
    if (shots) await b.page.screenshot({ path: join(shots, "sync-2-downloaded.png") });

    // Delete on B: Cancel keeps it everywhere, Delete removes it from the account; A drops it on its next sync.
    await b.page.click('[data-testid=set-delete]');
    assert.match(await b.page.textContent('.dialog, [role=dialog]'), /khỏi tài khoản và mọi thiết bị/);
    await b.page.click('[data-testid=confirm-cancel]');
    assert.equal(await b.page.locator('[data-testid=set-row]').count(), 1);
    assert.equal(account.docs.size, 1);
    await b.page.click('[data-testid=set-delete]');
    await b.page.click('[data-testid=confirm-ok]');
    await b.page.waitForSelector('[data-testid=sets-empty]');
    assert.equal(account.docs.size, 0);
    assert.equal(account.files.size, 0);
    await a.page.reload();
    await a.page.waitForSelector('[data-testid=sets-empty]');
    assert.deepEqual([...a.errors, ...b.errors], []);
    await a.ctx.close();
    await b.ctx.close();
  });
});

describe("stats: roadmap, forecast and week", () => {
  /** A small library written straight into the local database: 30 words, 10 of them learned. */
  async function seedLibrary(page, base) {
    await page.goto(`${base}/#/stats`);
    await page.evaluate(async () => {
      const DAY = 86_400_000;
      const now = Date.now();
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("vhub-lexi", 1);
        r.onupgradeneeded = () => { for (const s of ["decks", "notes", "cards", "reviews", "daily", "kv"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: "id" }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(["decks", "notes", "cards", "daily", "kv"], "readwrite");
      tx.objectStore("decks").put({ id: "d1", name: "Test", createdAt: now, updatedAt: now });
      for (let i = 0; i < 30; i++) {
        const id = `w${String(i).padStart(2, "0")}`;
        const created = now - 30 * DAY + i * 1000;
        tx.objectStore("notes").put({ id, type: "vocab", deckId: "d1", createdAt: created, updatedAt: created, fields: { word: `word${i}`, vi: `nghĩa ${i}`, pos: "noun", ipa: "", en: "", examples: [`This is word${i}.`], mnemonic: "" } });
        for (const template of ["recognize", "cloze"]) {
          const learned = i < 10;
          tx.objectStore("cards").put({
            id: `${id}.${template}`, noteId: id, deckId: "d1", template, state: learned ? 2 : 0, due: learned ? now + (i % 5) * DAY - DAY : now,
            stability: learned ? 12 : 0, difficulty: learned ? 5 : 0, scheduledDays: learned ? 12 : 0, learningSteps: 0, reps: learned ? 4 : 0, lapses: 0,
            ...(learned ? { lastReview: now - 10 * DAY } : {}), createdAt: created, updatedAt: created,
          });
        }
      }
      const id = (k) => { const d = new Date(now - k * DAY - 4 * 3_600_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      for (let k = 1; k <= 12; k++) tx.objectStore("daily").put({ id: id(k), newCards: k <= 10 ? 1 : 0, reviews: 10 + k, again: 2, hard: 1, good: 8 + k, easy: 0, ms: 90_000, updatedAt: now });
      tx.objectStore("kv").put({ id: "seeds", value: { "grammar-toeic": 99 } });
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    });
    await page.reload();
  }

  it("shows the dates the forecast gives, the numbers on every bar, and a week compared with the last one", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 2600 } });
    await seedLibrary(page, base);
    await page.goto(`${base}/#/stats`);
    await page.waitForSelector(".rm-eta b");
    await page.waitForFunction(() => document.querySelector(".chart text.v") && !document.body.textContent.includes("Đang tính"), null, { timeout: 30000 });
    assert.equal(await page.textContent("[data-testid=stat-words]"), "30");
    const eta = await page.locator(".rm-eta b").allTextContents();
    assert.equal(eta.length, 2);
    assert.match(eta[0], /^\d\d\/\d\d$|^Chưa rõ$|^Đã xong$/);
    const text = await page.textContent(".page");
    assert.match(text, /Học hết từ mới/);
    assert.match(text, /Sắp đến hạn · 14 ngày/);
    assert.match(text, /Tuần này/);
    assert.match(text, /\d+ lượt ôn/);
    // 12 days of history is enough for the learner's own pace; the "Thực tế" choice is offered and picked.
    assert.equal(await page.locator('.chip[aria-pressed="true"]').textContent().then((t) => /Thực tế/.test(t)), true);
    // Every one of the 14 bars carries its number.
    assert.equal(await page.locator('svg[aria-label^="Số thẻ đến hạn"] text.v').count(), 14);
    // Choosing another pace recomputes the forecast.
    await page.click('.chip:has-text("25 từ/ngày")');
    await page.waitForFunction(() => /Với 25 từ\/ngày/.test(document.querySelector(".whatif")?.textContent ?? ""), null, { timeout: 30000 });
    assert.equal(await noOverflow(page), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});

describe("từ hay quên: mark from the card, its own screen, practice outside FSRS", () => {
  const WORDS = [
    ["postpone", "hoãn lại; trì hoãn", "verb", 0, true],
    ["receipt", "biên lai", "noun", 4, false],
    ["venue", "địa điểm tổ chức", "noun", 2, false],
    ["attend", "tham dự", "verb", 0, false],
    ["budget", "ngân sách", "noun", 0, false],
    ["colleague", "đồng nghiệp", "noun", 1, false],
    ["launch", "ra mắt sản phẩm", "verb", 0, false],
  ];
  const backup = () => {
    const now = Date.now();
    const DAY = 86_400_000;
    const notes = WORDS.map(([word, vi, pos], i) => ({ id: `f${i}`, type: "vocab", deckId: "d1", fields: { word, vi, pos, ipa: `/${word}/`, examples: [`We will ${word} it next week.`] }, createdAt: now - 30 * DAY, updatedAt: now - 30 * DAY }));
    const cards = WORDS.map(([, , , lapses, isNew], i) => ({
      id: `f${i}.recognize`, noteId: `f${i}`, deckId: "d1", template: "recognize", state: isNew ? 0 : 2, due: isNew ? now - DAY : now + 5 * DAY,
      stability: isNew ? 0 : 12.5, difficulty: isNew ? 0 : 6.25, scheduledDays: isNew ? 0 : 9, learningSteps: 0, reps: isNew ? 0 : 6, lapses,
      ...(isNew ? {} : { lastReview: now - 4 * DAY }), createdAt: now - 30 * DAY, updatedAt: now - 4 * DAY,
    }));
    const reviews = WORDS.flatMap(([, , , , isNew], i) => (isNew ? [] : [{ id: `f${i}.recognize@${now - 4 * DAY}`, cardId: `f${i}.recognize`, noteId: `f${i}`, deckId: "d1", rating: 3, state: 2, stability: 12.5, difficulty: 6.25, scheduledDays: 9, reviewedAt: now - 4 * DAY, durationMs: 4000, device: "web" }]));
    return { app: "vhub-lexi", version: 1, exportedAt: now, decks: [{ id: "d1", name: "TOEIC", createdAt: now, updatedAt: now }], notes, cards, reviews, daily: [], prefs: null };
  };
  const shots = process.env.LEXI_SHOTS;
  // Screenshots for the PR (LEXI_SHOTS=dir): after toasts and the card's ease-in have settled.
  const shot = async (page, name) => {
    if (!shots) return;
    await page.waitForFunction(() => !document.querySelector(".toast"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(shots, `${name}.png`) });
  };

  /** Cards, review log and day counters from the JSON backup: what FSRS and the statistics read. */
  async function fsrsState(page) {
    await page.goto(`${base}/#/settings`);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export]")]);
    const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
    const sorted = (a) => [...(a ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1));
    return { file: data, fsrs: { cards: sorted(data.cards), reviews: sorted(data.reviews), daily: sorted(data.daily) } };
  }

  it("marks meaning and sound from a study card, lists them on their own screen, and a practice round changes no FSRS data", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
    const file = join(tmpdir(), `lexi-forgot-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(backup()));
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles("[data-testid=import-file]", file);
    await page.click("[data-testid=confirm-ok]");
    await page.waitForFunction(() => !document.querySelector(".scrim"));
    const before = (await fsrsState(page)).fsrs;
    assert.equal(before.cards.length, WORDS.length);

    // The mark sits next to the hint buttons on the front, and stays on the back.
    await page.goto(`${base}/#/study`);
    await page.waitForSelector("[data-testid=forgot-btn]");
    assert.equal(await page.locator(".card-tools [data-testid=hint-memo]").count(), 1, "next to the hint buttons");
    await page.click("[data-testid=forgot-btn]");
    await page.click("[data-testid=forgot-meaning]");
    await page.waitForSelector('[data-testid=forgot-meaning][aria-pressed="true"]');
    await page.click("[data-testid=forgot-sound]");
    await page.waitForSelector('[data-testid=forgot-btn][data-marked="meaning,sound"]');
    await shot(page, "1-mark-front");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-testid=forgot-pop]", { state: "detached" });
    await page.click("[data-testid=show-answer]");
    await page.waitForSelector('[data-testid=study-card][data-revealed="true"] [data-testid=forgot-btn][data-marked="meaning,sound"]');
    // Not rated: the card stays new.

    // Today leads to the list; FSRS's most-forgotten words are suggested and marked with one tap.
    await page.goto(`${base}/#/today`);
    await page.waitForSelector("[data-testid=today-forgot-marked]");
    assert.match(await page.textContent("[data-testid=today-forgot-marked]"), /1 từ đã đánh dấu/);
    await page.click("[data-testid=open-forgot]");
    await page.waitForSelector("[data-testid=forgot-list]");
    assert.equal(await page.locator("[data-testid=forgot-row]").count(), 1);
    const suggested = await page.locator("[data-testid=forgot-suggested] li b").allTextContents();
    assert.deepEqual(suggested, ["receipt", "venue", "colleague"], "most lapses first, marked words left out");
    await page.locator("[data-testid=forgot-suggest-add]").first().click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=forgot-row]").length === 2);
    assert.deepEqual(await page.locator("[data-testid=forgot-row]").evaluateAll((r) => r.map((e) => e.dataset.word)), ["receipt", "postpone"], "newest mark first");
    assert.match(await page.textContent("[data-testid=forgot-hero]"), /2 từ.*2 quên nghĩa · 1 quên phát âm/s);
    await shot(page, "2-list-phone");
    // Filter: sound only.
    await page.click("[data-testid=forgot-filter-sound]");
    assert.equal(await page.locator("[data-testid=forgot-row]").count(), 1);
    await page.click("[data-testid=forgot-filter-all]");

    // A practice round: one wrong choice, a typed word, a heard word, a self-graded pronunciation.
    await page.click("[data-testid=drill-start]");
    await page.waitForSelector("[data-testid=drill-card]");
    const byMeaning = Object.fromEntries(WORDS.map(([w, vi]) => [vi.split(";")[0].trim(), w]));
    let wrong = false;
    const seen = new Set();
    for (let step = 0; !(await page.locator("[data-testid=drill-done]").count()); step++) {
      assert.ok(step < 30, "the round ends");
      const mode = await page.getAttribute("[data-testid=drill]", "data-mode");
      if (!seen.has(mode)) await shot(page, `3-drill-${mode}`);
      seen.add(mode);
      if (mode === "meaning") {
        if (!wrong) {
          await page.locator('[data-testid=drill-opt][data-right="false"]').first().click();
          wrong = true;
          await page.waitForSelector("[data-testid=drill-answer]");
          assert.match(await page.textContent("[data-testid=drill-verdict]"), /sẽ hỏi lại/);
          await shot(page, "4-drill-wrong");
        } else await page.click('[data-testid=drill-opt][data-right="true"]');
      } else if (mode === "recall") {
        await page.fill("[data-testid=drill-input]", byMeaning[(await page.textContent("[data-testid=drill-meaning]")).trim()]);
        await page.click("[data-testid=drill-check]");
      } else if (mode === "listen") {
        await page.fill("[data-testid=drill-input]", "postpone");
        await page.click("[data-testid=drill-check]");
      } else {
        await page.click("[data-testid=drill-hear]");
        await page.click("[data-testid=drill-say-yes]");
      }
      await page.click("[data-testid=drill-next]");
    }
    assert.deepEqual([...seen].sort(), ["listen", "meaning", "recall", "say"]);
    // 2 words: postpone (meaning, say, recall, listen) + receipt (meaning, recall) = 6 exercises, one missed once.
    assert.match(await page.textContent("[data-testid=drill-score]"), /6 bài, đúng ngay lần đầu 5\/6/);
    assert.match(await page.textContent("[data-testid=drill-missed]"), /postpone|receipt/);
    await shot(page, "5-drill-done");

    // FSRS untouched: the same cards, review log and day counters as before anything was marked.
    const after = await fsrsState(page);
    assert.deepEqual(after.fsrs, before);
    const marks = after.file.notes.filter((n) => n.forgot).map((n) => [n.id, n.forgot]).sort();
    assert.deepEqual(marks, [["f0", ["meaning", "sound"]], ["f1", ["meaning"]]]);

    // Clearing both marks of a word removes it from the list; it persists over a reload.
    await page.goto(`${base}/#/forgot`);
    const row = page.locator('[data-testid=forgot-row][data-word="postpone"]');
    await row.locator("[data-testid=row-meaning]").click();
    await row.locator("[data-testid=row-sound]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=forgot-row]").length === 1);
    await page.reload();
    await page.waitForSelector("[data-testid=forgot-row]");
    assert.equal(await page.locator("[data-testid=forgot-row]").count(), 1);
    assert.equal(await noOverflow(page), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it("desktop: the list next to the round fits, dark theme readable", async () => {
    const { ctx, page, errors } = await open(browser, base, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: shots ? 2 : 1, colorScheme: "dark" });
    const data = backup();
    data.notes[0].forgot = ["meaning", "sound"];
    data.notes[0].forgotAt = Date.now();
    data.notes[2].forgot = ["sound"];
    data.notes[2].forgotAt = Date.now() - 1000;
    const file = join(tmpdir(), `lexi-forgot-d-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(data));
    await page.goto(`${base}/#/settings`);
    await page.setInputFiles("[data-testid=import-file]", file);
    await page.click("[data-testid=confirm-ok]");
    await page.goto(`${base}/#/forgot`);
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=forgot-row]").length === 2);
    await shot(page, "6-list-desktop-dark");
    await page.click("[data-testid=drill-start]");
    await page.waitForSelector("[data-testid=drill-card]");
    await shot(page, "7-drill-desktop-dark");
    await page.goto(`${base}/#/study`);
    await page.waitForSelector("[data-testid=forgot-btn]");
    await page.click("[data-testid=forgot-btn]");
    await page.waitForSelector("[data-testid=forgot-pop]");
    await shot(page, "8-mark-desktop-dark");
    assert.equal(await noOverflow(page), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
