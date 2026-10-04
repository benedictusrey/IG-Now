const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, 'direct-messages.js'), 'utf8');
const wait = () => new Promise(resolve => setTimeout(resolve, 300));
function fixture(route = '/direct/t/t1/') {
  const dom = new JSDOM('<a href="/direct/inbox/"><span id="badge">2</span></a><main><div role="row"><span dir="auto">Here you go</span></div></main>', {
    url: 'https://www.instagram.com' + route, runScripts: 'outside-only'
  });
  const calls = [];
  const win = dom.window;
  win.__TAURI__ = { core: { invoke: async (command, args) => { calls.push({ command, args }); } } };
  win.fetch = async () => ({ url: 'https://www.instagram.com/graphql/query', headers: { get: () => null },
    clone: () => ({ text: async () => JSON.stringify({ thread_id: 't1', items: [{ item_id: 'm1', xma: {
      title_text: 'Here you go', cta_buttons: [{ cta_type: 'xma_web_url', title: 'Download', action_url: 'https://example.com/a' }]
    } }] }) }) });
  let writes = 0;
  const realTimeout = win.setTimeout.bind(win);
  win.setTimeout = (callback, delay) => { writes++; return realTimeout(callback, delay); };
  win.eval(source);
  return { dom, win, calls, timers: () => writes };
}
test('renders only the correct chat link once and opens via native bridge', async () => {
  const f = fixture();
  try {
    await f.win.fetch('/graphql/query'); await wait();
    assert.equal(f.win.document.querySelectorAll('.ignow-dmlink').length, 1);
    f.win.document.querySelector('.ignow-dmlink').click();
    assert(f.calls.some(call => call.command === 'open_external_url' && call.args.url === 'https://example.com/a'));
    await f.win.fetch('/graphql/query'); await wait();
    assert.equal(f.win.document.querySelectorAll('.ignow-dmlink').length, 1);
    const before = f.timers(); await wait(); await wait();
    assert.equal(f.timers(), before, 'enhancement DOM does not self-trigger a scan loop');
    f.win.history.pushState({}, '', '/direct/t/t2/'); await wait();
    assert.equal(f.win.document.querySelectorAll('.ignow-dmlink').length, 0);
  } finally { f.win.dispatchEvent(new f.win.Event('pagehide')); f.dom.window.close(); }
});
test('outer DM scroll fix follows routes and keeps native unread reports deduplicated', async () => {
  const f = fixture('/');
  try {
    assert(!f.win.document.documentElement.classList.contains('ignow-direct-page'));
    f.win.document.getElementById('badge').textContent = '3'; await wait();
    assert.equal(f.calls.filter(call => call.command === 'report_dm_unread').length, 2);
    f.win.document.getElementById('badge').textContent = '3'; await wait();
    assert.equal(f.calls.filter(call => call.command === 'report_dm_unread').length, 2);
    f.win.history.pushState({}, '', '/direct/inbox/'); await wait();
    assert(f.win.document.documentElement.classList.contains('ignow-direct-page'));
    f.win.history.pushState({}, '', '/reels/'); await wait();
    assert(!f.win.document.documentElement.classList.contains('ignow-direct-page'));
  } finally { f.win.dispatchEvent(new f.win.Event('pagehide')); f.dom.window.close(); }
});
