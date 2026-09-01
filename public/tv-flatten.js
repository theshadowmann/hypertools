/** Re-apply frameless toolbar CSS after TradingView mounts (incl. shadow roots). */
(() => {
  const ID = "ht-tv-chrome-late";
  const VARS = {
    "--tv-color-toolbar-button-background-hover": "transparent",
    "--tv-color-toolbar-button-background-secondary-hover": "transparent",
    "--tv-color-toolbar-button-background-expanded": "transparent",
    "--tv-color-toolbar-button-background-active": "transparent",
    "--tv-color-toolbar-button-background-active-hover": "transparent",
    "--tv-color-toolbar-toggle-button-background-active": "transparent",
    "--tv-color-toolbar-toggle-button-background-active-hover": "transparent",
    "--tv-color-toolbar-button-text": "#F8FAFC",
    "--tv-color-toolbar-button-text-hover": "#F8FAFC",
    "--tv-color-toolbar-button-text-active": "#06B6D4",
    "--tv-color-toolbar-button-text-active-hover": "#06B6D4",
    "--tv-color-item-active-text": "#06B6D4",
    "--tv-color-pane-background": "#0F172A",
    "--tv-color-platform-background": "#0F172A",
    "--tv-color-pane-background-secondary": "#0F172A",
  };

  let cssText = "";
  let queued = false;
  let booted = false;

  function setVars(el) {
    if (!el || !el.style || !el.style.setProperty) return;
    Object.keys(VARS).forEach((k) => {
      el.style.setProperty(k, VARS[k], "important");
    });
  }

  function putSheet(root) {
    if (!root || !cssText) return;
    const head = root.head || root;
    let style = null;
    if (root.getElementById) style = root.getElementById(ID);
    if (!style && root.querySelector) style = root.querySelector("#" + ID);
    if (!style) {
      style = document.createElement("style");
      style.id = ID;
      try {
        head.appendChild(style);
      } catch {
        return;
      }
    }
    if (style.textContent !== cssText) style.textContent = cssText;
  }

  function flattenActive(root) {
    if (!root.querySelectorAll) return;
    const nodes = root.querySelectorAll(
      '[class*="isActive"], [class*="isSelected"], [class*="isChecked"], [aria-checked="true"], [aria-pressed="true"]'
    );
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      el.style.setProperty("background", "transparent", "important");
      el.style.setProperty("background-color", "transparent", "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("border", "0", "important");
      el.style.setProperty("color", "#06B6D4", "important");
      el.style.setProperty("fill", "#06B6D4", "important");
      const kids = el.querySelectorAll("*");
      for (let k = 0; k < kids.length; k++) {
        kids[k].style.setProperty("background", "transparent", "important");
        kids[k].style.setProperty("background-color", "transparent", "important");
        kids[k].style.setProperty("box-shadow", "none", "important");
        kids[k].style.setProperty("color", "#06B6D4", "important");
        kids[k].style.setProperty("fill", "#06B6D4", "important");
      }
    }
  }

  function walk(root) {
    if (!root) return;
    try {
      putSheet(root);
      if (root.documentElement) setVars(root.documentElement);
      flattenActive(root);
      const nodes = root.querySelectorAll("*");
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].shadowRoot) walk(nodes[i].shadowRoot);
      }
    } catch {
      /* cross-origin or detached */
    }
  }

  function apply() {
    queued = false;
    walk(document);
    const frames = document.querySelectorAll("iframe");
    for (let i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentDocument) walk(frames[i].contentDocument);
      } catch {
        /* nested cross-origin */
      }
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(apply, 50);
  }

  function boot(css) {
    if (css) cssText = css;
    apply();
    if (booted) return;
    booted = true;
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", apply);
    window.addEventListener("load", apply);
  }

  const fromDoc = document.getElementById("ht-tv-chrome");
  const embedded = fromDoc && fromDoc.textContent ? fromDoc.textContent : "";
  boot(embedded);
  fetch("/tv-chrome.css")
    .then((r) => r.text())
    .then((css) => {
      if (css && css !== cssText) boot(css);
    })
    .catch(() => {});
})();
