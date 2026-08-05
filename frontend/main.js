const { invoke } = window.__TAURI__.core;

const aboutModal = document.getElementById("ignow-about-modal");
const aboutClose = document.getElementById("about-close");
const aboutAction = document.getElementById("about-action");
const aboutAuthor = document.getElementById("about-author");

async function closeAbout() {
  aboutModal.hidden = true;
  try {
    await invoke("hide_about");
  } catch (error) {
    console.error("Failed to hide the About window:", error);
  }
}

aboutClose.addEventListener("click", closeAbout);
aboutAction.addEventListener("click", closeAbout);
aboutModal.addEventListener("click", event => {
  if (event.target === aboutModal) closeAbout();
});

aboutAuthor.addEventListener("click", event => {
  event.preventDefault();
  invoke("open_external_url", { url: aboutAuthor.href }).catch(error => {
    console.error("Failed to open the author link:", error);
  });
});
