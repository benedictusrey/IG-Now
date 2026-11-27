"use strict";

const { contextBridge, ipcRenderer, webFrame } = require("electron");

const ALLOWED_COMMANDS = new Set([
  "download_media",
  "save_media_bytes",
  "open_external_url",
  "prepare_download_folder",
  "report_dm_unread",
  "open_downloader_window",
  "submit_downloader_probe",
]);

async function invoke(command, args = {}) {
  if (typeof command !== "string" || !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command "${String(command)}" is not allowed from remote Instagram origin.`);
  }
  const result = await ipcRenderer.invoke("ignow:invoke", command, args || {});
  if (!result || !result.ok) {
    throw new Error(result?.error || "IG-Now IPC command failed.");
  }
  return result.value;
}

contextBridge.exposeInMainWorld("__TAURI__", {
  core: { invoke },
});

try {
  const isTop = window.top === window;
  const proto = window.location?.protocol || "";
  const host = (window.location?.hostname || "").toLowerCase();
  const isIg = proto === "https:" && (host === "instagram.com" || host.endsWith(".instagram.com"));
  if (isTop && isIg) {
    const scripts = ipcRenderer.sendSync("ignow:get-init-scripts");
    if (scripts?.disableBackdropBlur) {
      contextBridge.exposeInMainWorld("__ignowDisableBackdropBlur", true);
    }
    if (scripts?.dmScript) {
      webFrame.executeJavaScript(scripts.dmScript, true).catch(() => {});
    }
    if (scripts?.toolsScript) {
      webFrame.executeJavaScript(scripts.toolsScript, true).catch(() => {});
    }
  }
} catch {
  // Ignore non-DOM or restricted frame contexts.
}
