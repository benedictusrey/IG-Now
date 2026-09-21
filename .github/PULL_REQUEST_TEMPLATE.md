<!-- 
  IG-Now Pull Request Template
  Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
  Repository: https://github.com/benedictusrey/IG-Now
-->

## 💜 Welcome to the IG-Now Contributor Community!

Thank you so much for taking the time to contribute to **IG-Now**! Every contribution—whether fixing a tiny bug, optimizing audio/video playback, polishing the UI, or improving documentation—helps make the Instagram desktop experience faster, leaner, and more enjoyable for everyone.

---

### 📝 Summary of Changes

*Please describe what this PR does, why it is needed, and any context that helps reviewers understand your approach:*

- **What problem does this PR address?**: 
- **What is the proposed solution?**: 
- **Key changes included**:
  - 

---

### 🔍 Type of Change

*Select all that apply:*

- [ ] 🐛 **Bug fix** (non-breaking change fixing an issue)
- [ ] ⚡ **Performance improvement** (reduces CPU/RAM, coalesces events, speeds up launch)
- [ ] 🎨 **UI / UX enhancement** (refines overlays, tray menu, window behavior, styling)
- [ ] 🎛️ **Media Controls / Audio Engine** (seeking, volume slider, watchdog, keyboard shortcuts)
- [ ] 📦 **Build & Packaging / CI** (GitHub Actions, Tauri config, platform installers)
- [ ] 📚 **Documentation** (README, guides, comments, release notes)

---

### 🧪 Verification & Testing Checklist

*Please check off the tests and checks verified before opening this PR:*

- [ ] JavaScript syntax passes: `node --check frontend/instagram-tools.js`
- [ ] Rust format & compile checks pass:
  ```bash
  cd src-tauri
  cargo fmt --all -- --check
  cargo check
  cargo test --lib
  ```
- [ ] Manual smoke testing performed (window launch, video seekbar, volume toggle/slider, minimize pause, close-to-tray).
- [ ] All code changes follow existing conventions, defensive try/catch blocks, and clean logging.

---

### 🛡️ Attribution & Intellectual Property Agreement

*To protect project integrity, preserve open-source trust, and prevent plagiarism, please confirm the following:*

- [ ] **Author Attribution:** I acknowledge that **IG-Now** is conceived, designed, and solely authored by **Benedictus Reynaldo Hartanto** ([@benedictusrey](https://github.com/benedictusrey)).
- [ ] **Upstream Intent:** I confirm this contribution is intended directly for the upstream **IG-Now** repository ([https://github.com/benedictusrey/IG-Now](https://github.com/benedictusrey/IG-Now)).
- [ ] **No Rebranding / Plagiarism:** I confirm that I will not strip copyright notices, rename the project, rebrand the application, or claim false authorship of IG-Now or this codebase.
- [ ] **License Acceptance:** I agree that my submitted code will be licensed under the project's [LICENSE](https://github.com/benedictusrey/IG-Now/blob/main/LICENSE).

---

*Thank you for helping make IG-Now awesome!* 🚀
