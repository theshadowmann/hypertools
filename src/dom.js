/**
 * DOM helpers. Untrusted strings (API, WS, addresses, coins, validators) go through
 * textContent / createTextNode only — never innerHTML.
 */

export function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((key) => {
      const val = attrs[key];
      if (val == null || val === false) return;
      if (key === "class" || key === "className") el.className = val;
      else if (key === "dataset") {
        Object.keys(val).forEach((d) => {
          el.dataset[d] = String(val[d]);
        });
      } else if (key === "style" && val && typeof val === "object") {
        Object.keys(val).forEach((s) => {
          el.style[s] = val[s];
        });
      } else if (key.slice(0, 2) === "on" && typeof val === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === "checked" || key === "selected" || key === "disabled" || key === "hidden") {
        el[key] = !!val;
      } else {
        el.setAttribute(key, val === true ? "" : String(val));
      }
    });
  }
  children.flat().forEach((child) => {
    if (child == null || child === false) return;
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  });
  return el;
}

export function note(message, className) {
  return h(
    "p",
    { class: className || "px-3 py-6 text-center text-sm text-mist-400" },
    message
  );
}

export function dashedEmpty(message) {
  return h(
    "div",
    { class: "rounded-xl border border-dashed border-white/10 bg-ink-850/50 px-5 py-10 text-center text-sm text-mist-400" },
    message
  );
}

export function ths(labels, thClass) {
  return labels.map((label) => h("th", { class: thClass || "px-3 py-2 text-left font-normal text-mist-400" }, label));
}
