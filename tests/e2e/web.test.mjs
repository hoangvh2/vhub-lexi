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

    await page.goto(`${base}/#/study`);
    await page.waitForSelector('[data-testid=study-card]');
    assert.equal(await page.getAttribute('[data-testid=study-card]', 'data-revealed'), "false");
    assert.match(await page.textContent('[data-testid=counts]'), /Mới\s*1/);
    await page.click('[data-testid=show-answer]');
    assert.match(await page.textContent('[data-testid=study-card]'), /sự tình cờ may mắn/);
    await page.click('[data-testid=rate-3]');
    await page.waitForSelector('[data-testid=session-done]');

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
    await page.keyboard.press("3");
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
    assert.match(await page.textContent('[data-testid=memo]'), /đì-zai-ơ/);
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
