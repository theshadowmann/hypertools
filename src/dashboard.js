import { DUST } from "./api.js";
import { clear, dashedEmpty, h, ths } from "./dom.js";
import {
  fmtHype,
  fmtPx,
  fmtQty,
  fmtRoe,
  fmtUsd,
  formatLocalTime,
  num,
  pnlClass,
} from "./format.js";

export function spotUsdcParts(balances) {
  let total = 0;
  let hold = 0;
  (balances || []).forEach((b) => {
    if (!b || String(b.coin).toUpperCase() !== "USDC") return;
    const t = num(b.total);
    const ho = num(b.hold);
    if (Number.isFinite(t)) total += t;
    if (Number.isFinite(ho)) hold += ho;
  });
  return { total, available: Math.max(0, total - hold) };
}

export function positionRows(assetPositions) {
  const rows = [];
  (assetPositions || []).forEach((ap) => {
    const p = ap && ap.position;
    if (!p || p.szi == null) return;
    const szi = num(p.szi);
    if (!Number.isFinite(szi) || szi === 0) return;
    rows.push(p);
  });
  rows.sort((a, b) => Math.abs(num(b.positionValue)) - Math.abs(num(a.positionValue)));
  return rows;
}

export function levLabel(lev) {
  if (!lev) return "—";
  const v = lev.value;
  const t = lev.type || "";
  if (v == null || v === "") return t || "—";
  return String(v) + "× " + t;
}

function cardMini(label, value, hint) {
  return h(
    "article",
    { class: "rounded-xl border border-chrome/50 bg-ink-850 p-4 shadow-card" },
    h("p", { class: "text-xs font-medium uppercase tracking-wider text-mist-400" }, label),
    h("p", { class: "mt-2 font-mono text-xl font-medium tracking-tight text-white tabular" }, value),
    hint ? h("p", { class: "mt-1 text-[10px] tracking-wide text-mist-400/70" }, hint) : null
  );
}

function kvRow(k, v, cls) {
  return h(
    "div",
    { class: "flex items-baseline justify-between gap-3 py-1" },
    h("span", { class: "text-xs uppercase tracking-wider text-mist-400" }, k),
    h("span", { class: "font-mono text-sm tabular " + (cls || "text-white") }, v)
  );
}

function renderOverview(el, perps, spotBalances) {
  const ms = perps.marginSummary || {};
  let perpEquity = num(ms.accountValue);
  if (!Number.isFinite(perpEquity)) perpEquity = 0;
  let perpWithdrawable = num(perps.withdrawable);
  if (!Number.isFinite(perpWithdrawable)) perpWithdrawable = 0;
  const marginUsed = ms.totalMarginUsed;
  const spot = spotUsdcParts(spotBalances);
  const accountValue = perpEquity + spot.total;
  const withdrawable = perpWithdrawable + spot.available;

  const positions = perps.assetPositions || [];
  let upnlSum = 0;
  let hasUpnl = false;
  positions.forEach((ap) => {
    const p = ap && ap.position;
    if (!p) return;
    const n = num(p.unrealizedPnl);
    if (Number.isFinite(n)) {
      upnlSum += n;
      hasUpnl = true;
    }
  });

  let usage = "";
  const mu = num(marginUsed);
  if (Number.isFinite(accountValue) && accountValue > 0 && Number.isFinite(mu) && mu > 0) {
    usage =
      ((mu / accountValue) * 100).toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }) + "% of portfolio value";
  }

  const cards = [
    {
      label: "Portfolio value",
      value: fmtUsd(accountValue),
      hint: "Perps equity + spot USDC",
      extra: "",
    },
    {
      label: "Withdrawable",
      value: fmtUsd(withdrawable),
      hint: "Perps withdrawable + free spot USDC",
      extra: "",
    },
    {
      label: "Margin used",
      value: fmtUsd(marginUsed),
      hint: "Open perp margin",
      extra: usage,
    },
    {
      label: "Unrealized PnL",
      value: hasUpnl ? fmtUsd(upnlSum, { signed: true }) : "—",
      hint: "Open perps",
      extra: "",
      pnl: hasUpnl ? upnlSum : null,
    },
  ];

  clear(el.overview);
  cards.forEach((c) => {
    const color = c.pnl == null ? "text-white" : pnlClass(c.pnl);
    el.overview.appendChild(
      h(
        "article",
        { class: "rounded-xl border border-chrome/50 bg-ink-850 p-4 shadow-card" },
        h("p", { class: "text-xs font-medium uppercase tracking-wider text-mist-400" }, c.label),
        h("p", { class: "mt-2 font-mono text-2xl font-medium tracking-tight tabular " + color }, c.value),
        c.extra ? h("p", { class: "mt-1 text-xs text-mist-400" }, c.extra) : null,
        h("p", { class: "mt-1 text-[10px] uppercase tracking-wider text-mist-400/70" }, c.hint)
      )
    );
  });
}

function renderPerps(el, assetPositions, mids) {
  const rows = positionRows(assetPositions);
  el.perpsCount.textContent = rows.length ? rows.length + " open" : "";
  clear(el.perpsRoot);

  if (!rows.length) {
    el.perpsRoot.appendChild(dashedEmpty("No open perps."));
    return;
  }

  const bodyRows = rows.map((p) => {
    const szi = num(p.szi);
    const side = szi >= 0 ? "Long" : "Short";
    const sideCls =
      szi >= 0 ? "text-buy bg-buy/10 ring-buy/30" : "text-sell bg-sell/10 ring-sell/30";
    const mark = mids && p.coin != null ? mids[p.coin] : null;
    const liq = p.liquidationPx == null || p.liquidationPx === "" ? "—" : fmtPx(p.liquidationPx);
    return h(
      "tr",
      { class: "border-t border-chrome/50" },
      h("td", { class: "px-3 py-2.5 font-normal text-mist-100" }, p.coin || "—"),
      h(
        "td",
        { class: "px-3 py-2.5" },
        h(
          "span",
          { class: "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ring-1 " + sideCls },
          side
        )
      ),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, fmtQty(Math.abs(szi))),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, fmtPx(p.entryPx)),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, mark == null ? "—" : fmtPx(mark)),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, liq),
      h("td", { class: "px-3 py-2.5 text-sm text-mist-300" }, levLabel(p.leverage)),
      h(
        "td",
        { class: "px-3 py-2.5 font-mono text-sm tabular " + pnlClass(p.unrealizedPnl) },
        fmtUsd(p.unrealizedPnl, { signed: true })
      ),
      h(
        "td",
        { class: "px-3 py-2.5 font-mono text-sm tabular " + pnlClass(p.returnOnEquity) },
        fmtRoe(p.returnOnEquity)
      )
    );
  });

  el.perpsRoot.appendChild(
    h(
      "div",
      { class: "hidden overflow-x-auto rounded-xl border border-chrome/50 bg-ink-850 shadow-card md:block" },
      h(
        "table",
        { class: "min-w-full text-sm" },
        h(
          "thead",
          { class: "text-xs font-medium uppercase tracking-wider text-mist-400" },
          h("tr", null, ...ths(["Market", "Side", "Size", "Entry", "Mark", "Liq. price", "Leverage", "uPnL", "ROE"]))
        ),
        h("tbody", null, ...bodyRows)
      )
    )
  );

  const cards = h("div", { class: "grid gap-3 md:hidden" });
  rows.forEach((p) => {
    const szi = num(p.szi);
    const side = szi >= 0 ? "Long" : "Short";
    const sideCls = szi >= 0 ? "text-buy" : "text-sell";
    const mark = mids && p.coin != null ? mids[p.coin] : null;
    const liq = p.liquidationPx == null || p.liquidationPx === "" ? "—" : fmtPx(p.liquidationPx);
    cards.appendChild(
      h(
        "article",
        { class: "rounded-xl border border-chrome/50 bg-ink-850 p-4 shadow-card" },
        h(
          "div",
          { class: "mb-3 flex items-center justify-between" },
          h("p", { class: "text-base font-medium text-mist-100" }, p.coin || "—"),
          h("span", { class: "text-xs font-medium uppercase tracking-wider " + sideCls }, side + " · " + levLabel(p.leverage))
        ),
        kvRow("Size", fmtQty(Math.abs(szi))),
        kvRow("Entry", fmtPx(p.entryPx)),
        kvRow("Mark", mark == null ? "—" : fmtPx(mark)),
        kvRow("Liq. price", liq),
        kvRow("uPnL", fmtUsd(p.unrealizedPnl, { signed: true }), pnlClass(p.unrealizedPnl)),
        kvRow("ROE", fmtRoe(p.returnOnEquity), pnlClass(p.returnOnEquity))
      )
    );
  });
  el.perpsRoot.appendChild(cards);
}

function renderSpot(el, balances) {
  const rows = (balances || []).filter((b) => {
    const t = num(b && b.total);
    return Number.isFinite(t) && Math.abs(t) >= DUST;
  });
  rows.sort((a, b) => Math.abs(num(b.total)) - Math.abs(num(a.total)));
  el.spotCount.textContent = rows.length ? rows.length + " tokens" : "";
  clear(el.spotRoot);

  if (!rows.length) {
    el.spotRoot.appendChild(dashedEmpty("No spot balances."));
    return;
  }

  const bodyRows = rows.map((b) => {
    const total = num(b.total);
    const hold = num(b.hold);
    const avail = Number.isFinite(total) && Number.isFinite(hold) ? total - hold : NaN;
    return h(
      "tr",
      { class: "border-t border-chrome/50" },
      h("td", { class: "px-3 py-2.5 font-normal text-mist-100" }, b.coin || "—"),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, fmtQty(b.total)),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular text-mist-300" }, fmtQty(b.hold)),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, Number.isFinite(avail) ? fmtQty(avail) : "—")
    );
  });

  el.spotRoot.appendChild(
    h(
      "div",
      { class: "hidden overflow-x-auto rounded-xl border border-chrome/50 bg-ink-850 shadow-card sm:block" },
      h(
        "table",
        { class: "min-w-full text-sm" },
        h(
          "thead",
          { class: "text-xs font-medium uppercase tracking-wider text-mist-400" },
          h("tr", null, ...ths(["Token", "Total", "In orders", "Available"]))
        ),
        h("tbody", null, ...bodyRows)
      )
    )
  );

  const cards = h("div", { class: "grid gap-3 sm:hidden" });
  rows.forEach((b) => {
    const total = num(b.total);
    const hold = num(b.hold);
    const avail = Number.isFinite(total) && Number.isFinite(hold) ? total - hold : NaN;
    cards.appendChild(
      h(
        "article",
        { class: "rounded-xl border border-chrome/50 bg-ink-850 p-4 shadow-card sm:hidden" },
        h("p", { class: "font-medium text-mist-100" }, b.coin || "—"),
        h(
          "div",
          { class: "mt-2 grid grid-cols-3 gap-2 text-xs" },
          h(
            "div",
            null,
            h("p", { class: "uppercase tracking-wider text-mist-400" }, "Total"),
            h("p", { class: "mt-0.5 font-mono tabular" }, fmtQty(b.total))
          ),
          h(
            "div",
            null,
            h("p", { class: "uppercase tracking-wider text-mist-400" }, "In orders"),
            h("p", { class: "mt-0.5 font-mono tabular" }, fmtQty(b.hold))
          ),
          h(
            "div",
            null,
            h("p", { class: "uppercase tracking-wider text-mist-400" }, "Available"),
            h("p", { class: "mt-0.5 font-mono tabular" }, Number.isFinite(avail) ? fmtQty(avail) : "—")
          )
        )
      )
    );
  });
  el.spotRoot.appendChild(cards);
}

function renderStaking(el, summary, delegations, validatorNames) {
  const s = summary || {};
  const dels = Array.isArray(delegations) ? delegations : [];
  const names = validatorNames || {};
  clear(el.stakingRoot);

  el.stakingRoot.appendChild(
    h(
      "div",
      { class: "grid gap-3 sm:grid-cols-3" },
      cardMini("Delegated", fmtHype(s.delegated), "HYPE staked with validators"),
      cardMini("Undelegated", fmtHype(s.undelegated), "HYPE not currently staked"),
      cardMini(
        "Pending withdrawal",
        fmtHype(s.totalPendingWithdrawal),
        s.nPendingWithdrawals != null ? s.nPendingWithdrawals + " pending" : "Waiting to unstake"
      )
    )
  );

  if (!dels.length) {
    const empty = dashedEmpty("No active delegations.");
    empty.classList.add("mt-4");
    el.stakingRoot.appendChild(empty);
    return;
  }

  const bodyRows = dels.map((d) => {
    const lock = d.lockedUntilTimestamp != null ? formatLocalTime(d.lockedUntilTimestamp) : "—";
    const key = String(d.validator || "").toLowerCase();
    const label = names[key] || d.validator || "—";
    const showAddr = names[key] ? String(d.validator || "") : "";
    return h(
      "tr",
      { class: "border-t border-chrome/50" },
      h(
        "td",
        { class: "px-3 py-2.5" },
        h("p", { class: "text-sm font-medium text-white" }, label),
        showAddr ? h("p", { class: "mt-0.5 font-mono text-[11px] text-mist-400" }, showAddr) : null
      ),
      h("td", { class: "px-3 py-2.5 font-mono text-sm tabular" }, fmtHype(d.amount)),
      h("td", { class: "px-3 py-2.5 text-sm text-mist-300" }, lock)
    );
  });

  el.stakingRoot.appendChild(
    h(
      "div",
      { class: "mt-4 overflow-x-auto rounded-xl border border-chrome/50 bg-ink-850 shadow-card" },
      h(
        "table",
        { class: "min-w-full text-sm" },
        h(
          "thead",
          { class: "text-xs font-medium uppercase tracking-wider text-mist-400" },
          h("tr", null, ...ths(["Validator", "Amount", "Locked until"]))
        ),
        h("tbody", null, ...bodyRows)
      )
    )
  );
}

export function renderDashboard(el, state) {
  el.loading.classList.add("hidden");

  if (state.error) {
    el.errorBanner.textContent = state.error;
    el.errorBanner.classList.remove("hidden");
  } else {
    el.errorBanner.classList.add("hidden");
  }

  if (!state.data) {
    el.dashContent.classList.add("hidden");
    return;
  }

  el.dashContent.classList.remove("hidden");

  const perps = state.data.perps || {};
  const time = perps.time;
  el.dashUpdated.textContent = time ? "Venue snapshot · " + formatLocalTime(time) : "";

  const spotBalances = (state.data.spot && state.data.spot.balances) || [];
  renderOverview(el, perps, spotBalances);
  renderPerps(el, perps.assetPositions || [], state.data.mids || {});
  renderSpot(el, spotBalances);
  renderStaking(el, state.data.staking, state.data.delegations, state.data.validatorNames);
}
