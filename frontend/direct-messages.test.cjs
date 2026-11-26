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
    // Outside /direct/, text-node characterData mutations (e.g. Reel timer ticks) must not trigger observer work.
    const before = f.timers();
    const timerText = f.win.document.createTextNode('0:01');
    f.win.document.body.appendChild(timerText);
    await wait();
    const afterAppend = f.timers();
    timerText.data = '0:02';
    await wait();
    assert.equal(f.timers(), afterAppend, 'characterData outside /direct/ must not schedule DM render');
    assert(afterAppend >= before);
  } finally { f.win.dispatchEvent(new f.win.Event('pagehide')); f.dom.window.close(); }
});
test('top-frame guard skips embedded iframe initialization', () => {
  const dom = new JSDOM('<!doctype html><html><body><iframe></iframe></body></html>', {
    url: 'https://www.instagram.com/', runScripts: 'outside-only'
  });
  try {
    const iframeWin = dom.window.document.querySelector('iframe').contentWindow;
    iframeWin.eval(source);
    assert.equal(iframeWin.__ignowDirectMessagesInstalled, undefined);
  } finally { dom.window.close(); }
});
test('DM MutationObserver stays disconnected outside /direct/ once inboxCount is known and re-attaches on /direct/', async () => {
  const dom = new JSDOM('<a href="/direct/inbox/"><span id="badge">2</span></a><main></main>', {
    url: 'https://www.instagram.com/', runScripts: 'outside-only'
  });
  const win = dom.window;
  let timers = 0;
  const realTimeout = win.setTimeout.bind(win);
  win.setTimeout = (cb, delay) => {
    if (delay < 5000) timers++;
    return realTimeout(cb, delay === 5000 ? 15 : delay);
  };
  win.__TAURI__ = { core: { invoke: async () => {} } };
  win.fetch = async () => ({ ok: true, url: 'https://www.instagram.com/api/v1/direct_v2/inbox/?limit=20', headers: { get: () => null }, json: async () => ({ inbox: { unseen_count: 5 } }) });
  try {
    win.eval(source);
    await wait();
    const before = timers;
    const div = win.document.createElement('div');
    div.textContent = 'feed update';
    win.document.querySelector('main').appendChild(div);
    await wait();
    assert.equal(timers, before, 'outside /direct/ with inboxCount known, DOM mutations must not schedule DM render');

    win.history.pushState({}, '', '/direct/t/t1/');
    await wait();
    assert(win.document.documentElement.classList.contains('ignow-direct-page'));
  } finally { win.dispatchEvent(new win.Event('pagehide')); dom.window.close(); }
});
