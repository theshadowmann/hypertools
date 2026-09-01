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
  const observed = typeof WeakSet === "function" ? new WeakSet() : null;

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

  function zeroChrome(el, paintText) {
    if (!el || !el.style || !el.style.setProperty) return;
    el.style.setProperty("background", "transparent", "important");
    el.style.setProperty("background-color", "transparent", "important");
    el.style.setProperty("background-image", "none", "important");
    el.style.setProperty("box-shadow", "none", "important");
    el.style.setProperty("border", "0", "important");
    el.style.setProperty("border-color", "transparent", "important");
    el.style.setProperty("outline", "none", "important");
    if (paintText) {
      el.style.setProperty("color", "#06B6D4", "important");
      el.style.setProperty("fill", "#06B6D4", "important");
    }
  }

  function flattenActive(root) {
    if (!root.querySelectorAll) return;
    const nodes = root.querySelectorAll(
      '[class*="isActive"], [class*="isSelected"], [class*="isChecked"], [class*="isOpened"], [aria-checked="true"], [aria-pressed="true"]'
    );
    for (let i = 0; i < nodes.length; i++) {
      zeroChrome(nodes[i], true);
      const kids = nodes[i].querySelectorAll("*");
      for (let k = 0; k < kids.length; k++) zeroChrome(kids[k], true);
    }
  }

  function flattenToolbarTiles(root) {
    if (!root.querySelectorAll) return;
    const areas = root.querySelectorAll('.layout__area--top, .layout__area--left, [class*="layout__area--top"], [class*="layout__area--left"]');
    const view = root.defaultView || (root.ownerDocument && root.ownerDocument.defaultView);
    for (let a = 0; a < areas.length; a++) {
      const nodes = areas[a].querySelectorAll("button, [class*='button'], [class*='isInteractive'], [class*='apply-common-tooltip'], [class*='item-'], [class*='bg-'], [class*='buttonInner']");
      for (let i = 0; i < nodes.length; i++) {
        zeroChrome(nodes[i], false);
      }
      if (!view || !view.getComputedStyle) continue;
      const all = areas[a].querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        let bg = "";
        try {
          bg = view.getComputedStyle(el).backgroundColor || "";
        } catch {
          continue;
        }
        if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
        if (bg === "rgb(15, 23, 42)" || bg === "rgba(15, 23, 42, 1)") continue;
        zeroChrome(el, false);
      }
    }
  }

  function observe(root) {
    const node = root.documentElement || root;
    if (!node || (observed && observed.has(node))) return;
    if (observed) observed.add(node);
    try {
      new MutationObserver(schedule).observe(node, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-checked", "aria-pressed"],
      });
    } catch {
      /* detached */
    }
  }

  function walk(root) {
    if (!root) return;
    try {
      putSheet(root);
      if (root.documentElement) setVars(root.documentElement);
      else if (root.host) setVars(root.host);
      flattenActive(root);
      flattenToolbarTiles(root);
      observe(root);
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
    document.addEventListener("DOMContentLoaded", apply);
    window.addEventListener("load", apply);
  }

  const fromDoc = document.getElementById("ht-tv-chrome");
  const embedded = fromDoc && fromDoc.textContent ? fromDoc.textContent : "";
  boot(embedded);
  const link = document.getElementById("ht-tv-chrome-file");
  const href =
    (link && link.href) ||
    (typeof location !== "undefined" && location.origin ? location.origin + "/tv-chrome.css" : "/tv-chrome.css");
  fetch(href)
    .then((r) => r.text())
    .then((css) => {
      if (css && css !== cssText) boot(css);
    })
    .catch(() => {});
})();
