// Controlled layout reproduction for issue #3; not a live Instagram account test.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, 'instagram-tools.js'), 'utf8');
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel:process.env.PLAYWRIGHT_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });

const viewports = [
  { width:900, height:680, scale:1 },
  { width:1180, height:1032, scale:1 },
  { width:1280, height:720, scale:2 },
  { width:1920, height:1080, scale:2 },
  { width:2560, height:1440, scale:1.5 },
  { width:3840, height:2160, scale:1 }
];
for (const viewport of viewports) for (const zoom of [0.8, 1, 1.25]) {
  test(`native geometry: ${viewport.width}x${viewport.height}, DPR ${viewport.scale}, body zoom ${zoom}`, async () => {
    const context = await browser.newContext({ viewport:{ width:viewport.width, height:viewport.height }, deviceScaleFactor:viewport.scale });
    try {
      const page = await context.newPage();
      await page.setContent(`<style>
        body { margin:0; background:#101316; color:white; zoom:${zoom}; }
        main { position:relative; height:2200px; margin-left:100px; }
        .host { width:300px; height:180px; }
        #absolute { position:absolute; top:100px; left:20px; }
        #fixed { position:fixed; top:300px; left:120px; }
        #sticky { position:sticky; top:20px; margin-top:500px; }
        #profile { position:absolute; top:100px; left:500px; width:300px; }
        video { width:100%; height:100%; }
      </style><main>
        <div class="host" id="absolute"><video></video></div>
        <div class="host" id="fixed"><video></video></div>
        <div class="host" id="sticky"><video></video></div>
        <div class="host" id="static"><video></video></div>
        <aside id="profile"><img width="50" height="50" alt="Profile"><h2>My profile</h2><p>Suggested for you</p></aside>
      </main>`);
      const geometry = () => page.evaluate(() => Object.fromEntries(['absolute','fixed','sticky','profile'].map(id => {
        const node = document.getElementById(id), rect = node.getBoundingClientRect();
        return [id, { position:getComputedStyle(node).position, x:rect.x, y:rect.y, width:rect.width, height:rect.height }];
      })));
      const beforeGeometry = await geometry();
      await page.addScriptTag({ content:source });
      await page.waitForFunction(() => document.querySelectorAll('.ignow-video-controls').length === 4);
      assert.deepEqual(await geometry(), beforeGeometry, 'controls must not move native hosts or the profile sidebar');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('static')).position), 'relative');
      await page.addStyleTag({ content:'#static { position:absolute; top:800px; left:20px; }' });
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('static')).position), 'absolute', 'later native layout must override our anchor fallback');
      const fixedTop = await page.evaluate(() => document.getElementById('fixed').getBoundingClientRect().top);
      await page.evaluate(() => window.scrollTo(0, 400));
      assert.equal(await page.evaluate(() => document.getElementById('fixed').getBoundingClientRect().top), fixedTop);
    } finally { await context.close(); }
  });
}
