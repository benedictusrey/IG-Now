// Hidden-link support originated in PR #2 by @yash-8923.
// IG-Now 2.2.0: bounded, thread-scoped DM enhancements and native alerts.
(function (root) {
  "use strict";
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  function extractLinks(payload, fallbackThread = "") {
    const links = [];
    const stack = [{ node: payload, text: "", thread: fallbackThread, item: "", depth: 0 }];
    let visited = 0;
    while (stack.length && visited++ < 20000) {
      const { node, text, thread, item, depth } = stack.pop();
      if (!node || typeof node !== "object" || depth > 40) continue;
      const nextThread = String(node.thread_v2_id || node.thread_id || thread);
      const nextItem = String(node.item_id || node.message_id || item);
      const nextText = typeof (node.title_text || node.text) === "string" ? (node.title_text || node.text).trim() : text;
      if (node.cta_type === "xma_web_url") {
        const url = safeUrl(node.action_url);
        if (url && nextText && nextThread) links.push({ text: nextText.slice(0, 4000), thread: nextThread.slice(0, 128),
          item: nextItem.slice(0, 128), title: String(node.title || "Open link").slice(0, 160), url });
      }
      const children = Object.values(node);
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i] && typeof children[i] === "object") stack.push({ node: children[i], text: nextText,
          thread: nextThread, item: nextItem, depth: depth + 1 });
      }
    }
    return links;
  }
  function parsePayload(text) {
    if (typeof text !== "string" || text.length > 4 * 1024 * 1024) return [];
    return text.replace(/^\s*for\s*\(;;\);/, "").split("\n").flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
  function badgeCount(text) {
    const match = String(text).trim().match(/^(\d{1,4})(\+)?$/);
    return match ? Math.min(9999, Number(match[1])) : null;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = { safeUrl, extractLinks, parsePayload, badgeCount };
    return;
  }
  if (!root.document || root.__ignowDirectMessagesInstalled) return;
  root.__ignowDirectMessagesInstalled = true;
  const document = root.document;
  const invoke = root.__TAURI__?.core?.invoke;
  const cache = new Map();
  let timer = null, lastCount = null, lastRoute = "", observer;
  let inboxCount = null;
  let inboxFailures = 0;
  let inboxTimer = null;
  let disposed = false;
  const threadId = () => root.location.pathname.match(/^\/direct\/t\/([^/]+)/)?.[1] || "";
  const isDirect = () => /^\/direct(?:\/|$)/.test(root.location.pathname);
  const normalize = text => String(text).replace(/\s+/g, " ").trim();
  function capture(text, requestThread) {
    for (const payload of parsePayload(text)) {
      const fallback = requestThread === threadId() ? requestThread : "";
      for (const link of extractLinks(payload, fallback)) {
        cache.set(`${link.thread}\0${link.item}\0${link.text}\0${link.url}`, link);
        while (cache.size > 250) cache.delete(cache.keys().next().value);
      }
    }
    if (isDirect()) schedule();
  }
  function readUnreadCount() {
    if (inboxCount !== null) return inboxCount;
    const anchor = document.querySelector('a[href="/direct/inbox/"], a[href="/direct/inbox"]');
    if (!anchor) return null;
    for (const node of anchor.querySelectorAll("span, div")) {
      if (node.children.length) continue;
      const count = badgeCount(node.textContent);
      if (count !== null) return count;
    }
    const count = (anchor.getAttribute("aria-label") || "").match(/(\d+)\+?\s*(?:unread|new)/i);
    return count ? Number(count[1]) : 0;
  }
  function render() {
    timer = null;
    observer?.disconnect();
    try {
      const route = root.location.pathname;
      document.documentElement.classList.toggle("ignow-direct-page", isDirect());
      if (route !== lastRoute) {
        document.querySelectorAll(".ignow-dmlinks").forEach(node => node.remove());
        lastRoute = route;
      }
      const count = readUnreadCount();
      if (count !== null && count !== lastCount && typeof invoke === "function") {
        lastCount = count;
        invoke("report_dm_unread", { count, viewingInbox: isDirect() }).catch(() => {});
      }
      const thread = threadId();
      if (!thread || !cache.size) return;
      const candidates = Array.from(document.querySelectorAll('[role="row"] [dir="auto"], main [dir="auto"]'))
        .filter(node => !node.closest(".ignow-dmlinks"));
      for (const link of cache.values()) {
        if (link.thread !== thread) continue;
        const matches = candidates.filter(node => normalize(node.textContent) === normalize(link.text));
        if (matches.length !== 1) continue;
        const row = matches[0].closest('[role="row"]') || matches[0].parentElement;
        if (Array.from(row.querySelectorAll(".ignow-dmlink")).some(button => button.dataset.url === link.url)) continue;
        let box = row.querySelector(".ignow-dmlinks");
        if (!box) { box = document.createElement("div"); box.className = "ignow-dmlinks"; row.appendChild(box); }
        const button = document.createElement("button");
        button.type = "button"; button.className = "ignow-dmlink"; button.textContent = link.title;
        button.dataset.url = link.url; button.title = new URL(link.url).hostname;
        button.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          if (typeof invoke === "function") invoke("open_external_url", { url: link.url }).catch(() => {});
          else root.open(link.url, "_blank", "noopener,noreferrer");
        });
        box.appendChild(button);
      }
    } finally {
      observer?.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }
  function schedule() { if (!disposed && timer === null) timer = root.setTimeout(render, 250); }
  function isDmResponse(url) {
    try {
      const parsed = new URL(url, root.location.origin);
      return parsed.origin === root.location.origin && (/\/direct\//.test(parsed.pathname) || /graphql/i.test(parsed.pathname));
    } catch { return false; }
  }
  const originalFetch = root.fetch;
  // The badge is capped at 9+; the signed-in inbox response provides the
  // uncapped unseen count. One sequential request per 30 s also works in tray.
  async function refreshInbox() {
    try {
      const response = await originalFetch.call(root, "/api/v1/direct_v2/inbox/?limit=20", {
        credentials: "same-origin", headers: { "X-IG-App-ID": "936619743392459" },
        signal: root.AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error("Inbox unavailable");
      const payload = await response.json();
      if (Number.isInteger(payload.inbox?.unseen_count) && payload.inbox.unseen_count >= 0) {
        inboxCount = payload.inbox.unseen_count;
        schedule();
      }
      if (isDirect()) capture(JSON.stringify(payload), "");
      inboxFailures = 0;
    } catch {
      inboxCount = null;
      inboxFailures = Math.min(inboxFailures + 1, 4);
    } finally {
      if (!disposed) inboxTimer = root.setTimeout(refreshInbox, Math.min(300000, 30000 * (2 ** inboxFailures)));
    }
  }
  root.fetch = function (...args) {
    const requestThread = threadId();
    const pending = originalFetch.apply(this, args);
    pending.then(response => {
      if (!isDmResponse(response.url) || !isDirect()) return;
      if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024) return;
      response.clone().text().then(text => capture(text, requestThread)).catch(() => {});
    }).catch(() => {});
    return pending;
  };
  const originalOpen = root.XMLHttpRequest.prototype.open;
  const requestContext = new WeakMap();
  root.XMLHttpRequest.prototype.open = function (method, url) {
    if (!requestContext.has(this)) this.addEventListener("load", () => {
      const context = requestContext.get(this);
      if (!context?.capture || !isDirect()) return;
      try { capture(this.responseType === "json" ? JSON.stringify(this.response) : this.responseText, context.thread); }
      catch { /* Binary and failed responses are not DM payloads. */ }
    });
    requestContext.set(this, { capture: isDmResponse(url), thread: threadId() });
    return originalOpen.apply(this, arguments);
  };
  function start() {
    const style = document.createElement("style");
    style.textContent = `
      html.ignow-direct-page, html.ignow-direct-page > body { overflow: hidden !important; }
      .ignow-dmlinks { display: flex; flex-direction: column; gap: 6px; max-width: 300px; margin: 6px 12px; }
      .ignow-dmlink { padding: 10px 16px; border: 1px solid #80808066; border-radius: 20px; background: #80808022; color: inherit; font: 600 14px "Segoe UI", sans-serif; cursor: pointer; }
      .ignow-dmlink:hover { background: #80808044; }
      .ignow-dmlink:focus-visible { outline: 2px solid #0095f6; outline-offset: 2px; }
    `;
    document.documentElement.appendChild(style);
    observer = new root.MutationObserver(records => {
      if (records.some(record => !record.target.parentElement?.closest(".ignow-video-controls, .ignow-dmlinks") &&
        (isDirect() || record.target.closest?.('a[href*="/direct/inbox"]') ||
          Array.from(record.addedNodes).some(node => node.nodeType === 1 &&
            (node.matches('a[href*="/direct/inbox"]') || node.querySelector('a[href*="/direct/inbox"]')))))) schedule();
    });
    root.addEventListener("popstate", schedule);
    for (const method of ["pushState", "replaceState"]) {
      const original = root.history[method];
      root.history[method] = function (...args) { const result = original.apply(this, args); schedule(); return result; };
    }
    render();
    inboxTimer = root.setTimeout(refreshInbox, 2000);
    root.addEventListener("pagehide", () => {
      disposed = true;
      observer.disconnect();
      root.clearTimeout(timer);
      root.clearTimeout(inboxTimer);
    }, { once: true });
  }
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
