"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_COMMANDS = new Set([
  "open_downloader_window",
  "take_pending_downloader_context",
  "inspect_instagram_post",
  "download_post_selection",
  "save_caption_file",
  "open_downloads_folder",
  "open_external_url",
  "prepare_download_folder",
]);

async function invoke(command, args = {}) {
  if (typeof command !== "string" || !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command "${String(command)}" is not allowed from Downloader origin.`);
  }
  const result = await ipcRenderer.invoke("ignow:invoke", command, args || {});
  if (!result || !result.ok) {
    throw new Error(result?.error || "IG-Now Downloader IPC command failed.");
  }
  return result.value;
}

async function listen(eventName, callback) {
  if (eventName !== "downloader-progress" || typeof callback !== "function") {
    throw new Error(`Unsupported event "${String(eventName)}".`);
  }
  const handler = (_event, payload) => {
    callback({ event: eventName, payload });
  };
  ipcRenderer.on("ignow:downloader-progress", handler);
  return () => {
    ipcRenderer.removeListener("ignow:downloader-progress", handler);
  };
}

contextBridge.exposeInMainWorld("__TAURI__", {
  core: { invoke },
  event: { listen },
});
