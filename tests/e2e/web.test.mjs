import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
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
    await page.fill('[data-testid=vi-input]', "sự tình cờ may mắn");
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
