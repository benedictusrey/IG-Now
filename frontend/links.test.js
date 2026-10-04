const test = require("node:test");
const assert = require("node:assert/strict");
const { safeUrl, extractLinks, parsePayload, badgeCount } = require("./direct-messages.js");
const payload = (thread, text, url) => ({ thread_id: thread, items: [{ item_id: "m1", xma: {
  title_text: text, cta_buttons: [{ cta_type: "xma_web_url", title: "Open", action_url: url }]
} }] });
test("extracts hidden CTA links with thread and message identity", () => {
  assert.deepEqual(extractLinks(payload("t1", " Here you go ", "https://example.com/a")), [
    { text: "Here you go", thread: "t1", item: "m1", title: "Open", url: "https://example.com/a" }
  ]);
});
test("rejects unsafe destinations and unscoped links", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///c:/x", "https://user:pass@example.com"]) {
    assert.equal(safeUrl(url), "");
    assert.deepEqual(extractLinks(payload("t1", "x", url)), []);
  }
  assert.deepEqual(extractLinks(payload("", "x", "https://example.com")), []);
});
test("parses anti-JSON prefixes and streamed GraphQL", () => {
  assert.equal(parsePayload('for (;;);{"data":1}\n{"data":2}\ninvalid').length, 2);
  assert.deepEqual(parsePayload("x".repeat(4 * 1024 * 1024 + 1)), []);
});
test("bounds cyclic traversal and ignores postbacks", () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.deepEqual(extractLinks(cyclic), []);
  const p = payload("t1", "x", "https://example.com/a");
  p.items[0].xma.cta_buttons.push({ cta_type: "postback", action_url: "https://example.com" });
  assert.equal(extractLinks(p).length, 1);
});
test("reads badges without confusing other message text for a count", () => {
  assert.equal(badgeCount("9+"), 9);
  assert.equal(badgeCount("3"), 3);
  assert.equal(badgeCount("Messages"), null);
  assert.equal(badgeCount("1 new story"), null);
});
