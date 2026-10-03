// Run: node frontend/links.test.js
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/instagram-tools.js", "utf8");
const walkLinks = new Function(src.match(/function walkLinks[\s\S]*?\n  }\n/)[0] + "return walkLinks;")();
const cta = (t, u, c = "xma_web_url") => ({ title: t, action_url: u, cta_type: c });
const out = [];
walkLinks({ msg: { xma: { title_text: " Here you go 👇 ", cta_buttons: [cta("A", "https://x/a"), cta("B", "https://x/b"), cta("C", "https://x/c", "postback")] } } }, "", out);
assert.deepStrictEqual(out.map(l => [l.text, l.title]), [["Here you go 👇", "A"], ["Here you go 👇", "B"]]);
console.log("ok");
