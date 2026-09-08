export const CONNECT_MODAL_ID = "ht-connect-modal";
export const LOOKING_MSG = "Looking for wallets…";
export const OPENING_WALLET_MSG = "Opening wallet…";
export const NO_WALLET_MSG = "Install MetaMask or Rabby";
export const CHECK_POPUP_MSG =
  "Check the MetaMask / Rabby popup (fox / Rabby icon, top-right of Chrome)";

function text(el, value) {
  if (!el) return;
  el.textContent = value == null ? "" : String(value);
}

export function popupHint(name) {
  const n = String(name || "");
  if (/rabby/i.test(n)) return CHECK_POPUP_MSG;
  if (/metamask/i.test(n)) return CHECK_POPUP_MSG;
  return CHECK_POPUP_MSG;
}

export function setConnectUiStatus(msg, kind) {
  const nodes = [
    typeof document !== "undefined" ? document.getElementById("ticket-status") : null,
    typeof document !== "undefined" ? document.getElementById("nav-connect-status") : null,
    typeof document !== "undefined" ? document.getElementById("ht-connect-status") : null,
  ];
  nodes.forEach((el) => {
    if (!el) return;
    text(el, msg || "");
    el.classList.toggle("err", kind === "err");
    el.classList.toggle("ok", kind === "ok");
  });
}

export function markConnectButtonsOpening() {
  if (typeof document === "undefined") return;
  const nav = document.getElementById("btn-nav-connect");
  if (nav) {
    if (!nav.dataset.htLabel) nav.dataset.htLabel = nav.textContent || "Connect to trade";
    nav.textContent = OPENING_WALLET_MSG;
  }
  const ticket = document.getElementById("ticket-submit");
  if (ticket && ticketWantsConnect(ticket)) {
    if (!ticket.dataset.htLabel) ticket.dataset.htLabel = ticket.textContent || "Connect wallet";
    ticket.textContent = OPENING_WALLET_MSG;
    ticket.type = "button";
    ticket.classList.add("connect");
  }
}

export function restoreConnectButtons() {
  if (typeof document === "undefined") return;
  const nav = document.getElementById("btn-nav-connect");
  if (nav && nav.dataset.htLabel) nav.textContent = nav.dataset.htLabel;
  const ticket = document.getElementById("ticket-submit");
  if (ticket && ticket.dataset.htLabel && ticketWantsConnect(ticket)) {
    ticket.textContent = ticket.dataset.htLabel;
  }
}

export function ticketWantsConnect(btn) {
  if (!btn) return false;
  const label = String(btn.textContent || "");
  if (/enable trading/i.test(label)) return false;
  if (/connect wallet/i.test(label) || /opening wallet/i.test(label)) return true;
  return btn.classList.contains("connect") && /connect/i.test(label);
}

function ensureModalChrome() {
  if (typeof document === "undefined") return null;
  let overlay = document.getElementById(CONNECT_MODAL_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = CONNECT_MODAL_ID;
  overlay.className = "ht-connect-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "ht-connect-title");

  const panel = document.createElement("div");
  panel.className = "ht-connect-panel";
  panel.setAttribute("data-ht-panel", "1");

  const title = document.createElement("h2");
  title.id = "ht-connect-title";
  title.className = "ht-connect-title";
  title.textContent = "Connect a wallet";

  const status = document.createElement("p");
  status.id = "ht-connect-status";
  status.className = "ht-connect-status";
  status.setAttribute("role", "status");
  status.textContent = LOOKING_MSG;

  const body = document.createElement("div");
  body.id = "ht-connect-body";
  body.className = "ht-connect-body";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ht-connect-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "Close";
  close.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeConnectModal();
  });

  panel.appendChild(title);
  panel.appendChild(status);
  panel.appendChild(body);
  panel.appendChild(close);
  overlay.appendChild(panel);

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeConnectModal();
  });

  if (!document._htConnectEsc) {
    document._htConnectEsc = true;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && isConnectModalOpen()) closeConnectModal();
    });
  }

  if (document.body) document.body.appendChild(overlay);
  return overlay;
}

export function ensureConnectModal() {
  return ensureModalChrome();
}

export function isConnectModalOpen() {
  const overlay = typeof document !== "undefined" ? document.getElementById(CONNECT_MODAL_ID) : null;
  return !!(overlay && overlay.classList.contains("is-open"));
}

export function openConnectModal() {
  const overlay = ensureModalChrome();
  if (!overlay) return null;
  const status = overlay.querySelector("#ht-connect-status");
  const body = overlay.querySelector("#ht-connect-body");
  const title = overlay.querySelector("#ht-connect-title");
  if (title) title.textContent = "Connect a wallet";
  if (status) {
    status.textContent = LOOKING_MSG;
    status.classList.remove("err", "ok");
  }
  if (body) {
    while (body.firstChild) body.removeChild(body.firstChild);
  }
  overlay.classList.add("is-open");
  return overlay;
}

export function closeConnectModal() {
  const overlay = typeof document !== "undefined" ? document.getElementById(CONNECT_MODAL_ID) : null;
  if (!overlay) return;
  overlay.classList.remove("is-open");
  restoreConnectButtons();
}

export function paintConnectLooking() {
  const overlay = ensureModalChrome();
  const status = overlay && overlay.querySelector("#ht-connect-status");
  const body = overlay && overlay.querySelector("#ht-connect-body");
  if (status) {
    status.textContent = LOOKING_MSG;
    status.classList.remove("err", "ok");
  }
  if (body) {
    while (body.firstChild) body.removeChild(body.firstChild);
  }
  setConnectUiStatus(LOOKING_MSG);
}

export function paintConnectInstall() {
  const overlay = ensureModalChrome();
  if (!overlay) return;
  overlay.classList.add("is-open");
  const status = overlay.querySelector("#ht-connect-status");
  const body = overlay.querySelector("#ht-connect-body");
  if (status) {
    status.textContent = NO_WALLET_MSG;
    status.classList.add("err");
    status.classList.remove("ok");
  }
  if (body) {
    while (body.firstChild) body.removeChild(body.firstChild);
    const note = document.createElement("p");
    note.className = "ht-connect-note";
    note.textContent = NO_WALLET_MSG;
    const links = document.createElement("p");
    links.className = "ht-connect-links";
    const mm = document.createElement("a");
    mm.href = "https://metamask.io";
    mm.target = "_blank";
    mm.rel = "noopener noreferrer";
    mm.textContent = "MetaMask";
    const sep = document.createTextNode(" · ");
    const rb = document.createElement("a");
    rb.href = "https://rabby.io";
    rb.target = "_blank";
    rb.rel = "noopener noreferrer";
    rb.textContent = "Rabby";
    links.appendChild(mm);
    links.appendChild(sep);
    links.appendChild(rb);
    body.appendChild(note);
    body.appendChild(links);
  }
  setConnectUiStatus(NO_WALLET_MSG, "err");
}

export function paintConnectTargets(targets, onPick) {
  const overlay = ensureModalChrome();
  if (!overlay) return;
  overlay.classList.add("is-open");
  const status = overlay.querySelector("#ht-connect-status");
  const body = overlay.querySelector("#ht-connect-body");
  if (status) {
    status.textContent = "Choose a wallet";
    status.classList.remove("err", "ok");
  }
  setConnectUiStatus("Choose a wallet");
  if (body) {
    while (body.firstChild) body.removeChild(body.firstChild);
    (targets || []).forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ht-connect-row";
      btn.setAttribute("data-wallet", t.kind || "injected");
      btn.textContent = "Connect " + (t.name || "wallet");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const hint = popupHint(t.name);
        setConnectUiStatus(hint);
        if (typeof onPick === "function") onPick(t);
      });
      body.appendChild(btn);
    });
  }
}

let captureBound = false;

export function bindConnectCapture(connectFromNav) {
  if (captureBound || typeof document === "undefined" || typeof connectFromNav !== "function") return;
  captureBound = true;
  document.addEventListener(
    "click",
    (ev) => {
      const t = ev.target && ev.target.closest && ev.target.closest("#btn-nav-connect, #ticket-submit");
      if (!t) return;
      if (t.id === "ticket-submit" && !ticketWantsConnect(t)) return;
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
      connectFromNav();
    },
    true
  );
}

export function resetConnectCaptureForTests() {
  captureBound = false;
}
