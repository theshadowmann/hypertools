import { DUST } from "./api.js";
import {
  escapeHtml,
  fmtHype,
  fmtPx,
  fmtQty,
  fmtRoe,
  fmtUsd,
  formatLocalTime,
  num,
  pnlClass,
} from "./format.js";

function cardMini(label, value, hint) {
  return (
    '<article class="rounded-xl border border-white/8 bg-ink-850 p-4 shadow-card">' +
    '<p class="text-xs font-medium uppercase tracking-wider text-mist-400">' +
    escapeHtml(label) +
    "</p>" +
    '<p class="mt-2 font-mono text-xl font-medium tracking-tight text-white tabular">' +
    escapeHtml(value) +
    "</p>" +
    (hint ? '<p class="mt-1 text-[10px] tracking-wide text-mist-400/70">' + escapeHtml(hint) + "</p>" : "") +
    "</article>"
  );
}

export function spotUsdcParts(balances) {
  let total = 0;
  let hold = 0;
  (balances || []).forEach((b) => {
    if (!b || String(b.coin).toUpperCase() !== "USDC") return;
    const t = num(b.total);
    const h = num(b.hold);
    if (Number.isFinite(t)) total += t;
    if (Number.isFinite(h)) hold += h;
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
      }) + "% of account value";
  }

  const cards = [
    {
      label: "Account value",
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

  el.overview.innerHTML = cards
    .map((c) => {
      const color = c.pnl == null ? "text-white" : pnlClass(c.pnl);
      return (
        '<article class="rounded-xl border border-white/8 bg-ink-850 p-4 shadow-card">' +
        '<p class="text-xs font-medium uppercase tracking-wider text-mist-400">' +
        escapeHtml(c.label) +
        "</p>" +
        '<p class="mt-2 font-mono text-2xl font-medium tracking-tight tabular ' +
        color +
        '">' +
        escapeHtml(c.value) +
        "</p>" +
        (c.extra ? '<p class="mt-1 text-xs text-mist-400">' + escapeHtml(c.extra) + "</p>" : "") +
        '<p class="mt-1 text-[10px] uppercase tracking-wider text-mist-400/70">' +
        escapeHtml(c.hint) +
        "</p>" +
        "</article>"
      );
    })
    .join("");
}

function renderPerps(el, assetPositions, mids) {
  const rows = positionRows(assetPositions);
  el.perpsCount.textContent = rows.length ? rows.length + " open" : "";

  if (!rows.length) {
    el.perpsRoot.innerHTML =
      '<div class="rounded-xl border border-dashed border-white/10 bg-ink-850/50 px-5 py-10 text-center text-sm text-mist-400">No open perps.</div>';
    return;
  }

  const head =
    '<thead class="text-xs font-medium uppercase tracking-wider text-mist-400">' +
    "<tr>" +
    ["Market", "Side", "Size", "Entry", "Mark", "Liq. price", "Leverage", "uPnL", "ROE"]
      .map((h) => '<th class="px-3 py-2 text-left font-medium">' + h + "</th>")
      .join("") +
    "</tr></thead>";

  const body = rows
    .map((p) => {
      const szi = num(p.szi);
      const side = szi >= 0 ? "Long" : "Short";
      const sideCls =
        szi >= 0 ? "text-accent bg-accent-muted ring-accent/30" : "text-danger bg-danger/muted ring-danger/30";
      const mark = mids && p.coin != null ? mids[p.coin] : null;
      const liq = p.liquidationPx == null || p.liquidationPx === "" ? "—" : fmtPx(p.liquidationPx);
      return (
        "<tr class='border-t border-white/5'>" +
        '<td class="px-3 py-2.5 font-medium text-white">' +
        escapeHtml(p.coin || "—") +
        "</td>" +
        '<td class="px-3 py-2.5"><span class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ' +
        sideCls +
        '">' +
        side +
        "</span></td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(fmtQty(Math.abs(szi))) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(fmtPx(p.entryPx)) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(mark == null ? "—" : fmtPx(mark)) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(liq) +
        "</td>" +
        '<td class="px-3 py-2.5 text-sm text-mist-300">' +
        escapeHtml(levLabel(p.leverage)) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular ' +
        pnlClass(p.unrealizedPnl) +
        '">' +
        escapeHtml(fmtUsd(p.unrealizedPnl, { signed: true })) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular ' +
        pnlClass(p.returnOnEquity) +
        '">' +
        escapeHtml(fmtRoe(p.returnOnEquity)) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  const table =
    '<div class="hidden overflow-x-auto rounded-xl border border-white/8 bg-ink-850 shadow-card md:block">' +
    '<table class="min-w-full text-sm">' +
    head +
    "<tbody>" +
    body +
    "</tbody></table></div>";

  const cards = rows
    .map((p) => {
      const szi = num(p.szi);
      const side = szi >= 0 ? "Long" : "Short";
      const sideCls = szi >= 0 ? "text-accent" : "text-danger";
      const mark = mids && p.coin != null ? mids[p.coin] : null;
      const liq = p.liquidationPx == null || p.liquidationPx === "" ? "—" : fmtPx(p.liquidationPx);
      function row(k, v, cls) {
        return (
          '<div class="flex items-baseline justify-between gap-3 py-1"><span class="text-xs uppercase tracking-wider text-mist-400">' +
          k +
          '</span><span class="font-mono text-sm tabular ' +
          (cls || "text-white") +
          '">' +
          v +
          "</span></div>"
        );
      }
      return (
        '<article class="rounded-xl border border-white/8 bg-ink-850 p-4 shadow-card">' +
        '<div class="mb-3 flex items-center justify-between">' +
        '<p class="text-base font-semibold text-white">' +
        escapeHtml(p.coin || "—") +
        "</p>" +
        '<span class="text-xs font-semibold uppercase tracking-wider ' +
        sideCls +
        '">' +
        side +
        " · " +
        escapeHtml(levLabel(p.leverage)) +
        "</span>" +
        "</div>" +
        row("Size", escapeHtml(fmtQty(Math.abs(szi)))) +
        row("Entry", escapeHtml(fmtPx(p.entryPx))) +
        row("Mark", escapeHtml(mark == null ? "—" : fmtPx(mark))) +
        row("Liq. price", escapeHtml(liq)) +
        row("uPnL", escapeHtml(fmtUsd(p.unrealizedPnl, { signed: true })), pnlClass(p.unrealizedPnl)) +
        row("ROE", escapeHtml(fmtRoe(p.returnOnEquity)), pnlClass(p.returnOnEquity)) +
        "</article>"
      );
    })
    .join("");

  el.perpsRoot.innerHTML = table + '<div class="grid gap-3 md:hidden">' + cards + "</div>";
}

function renderSpot(el, balances) {
  const rows = (balances || []).filter((b) => {
    const t = num(b && b.total);
    return Number.isFinite(t) && Math.abs(t) >= DUST;
  });
  rows.sort((a, b) => Math.abs(num(b.total)) - Math.abs(num(a.total)));
  el.spotCount.textContent = rows.length ? rows.length + " tokens" : "";

  if (!rows.length) {
    el.spotRoot.innerHTML =
      '<div class="rounded-xl border border-dashed border-white/10 bg-ink-850/50 px-5 py-10 text-center text-sm text-mist-400">No spot balances.</div>';
    return;
  }

  const head =
    "<thead class='text-xs font-medium uppercase tracking-wider text-mist-400'><tr>" +
    ["Token", "Total", "In orders", "Available"]
      .map((h) => '<th class="px-3 py-2 text-left font-medium">' + h + "</th>")
      .join("") +
    "</tr></thead>";

  const body = rows
    .map((b) => {
      const total = num(b.total);
      const hold = num(b.hold);
      const avail = Number.isFinite(total) && Number.isFinite(hold) ? total - hold : NaN;
      return (
        "<tr class='border-t border-white/5'>" +
        '<td class="px-3 py-2.5 font-medium text-white">' +
        escapeHtml(b.coin || "—") +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(fmtQty(b.total)) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular text-mist-300">' +
        escapeHtml(fmtQty(b.hold)) +
        "</td>" +
        '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
        escapeHtml(Number.isFinite(avail) ? fmtQty(avail) : "—") +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  const table =
    '<div class="hidden overflow-x-auto rounded-xl border border-white/8 bg-ink-850 shadow-card sm:block">' +
    '<table class="min-w-full text-sm">' +
    head +
    "<tbody>" +
    body +
    "</tbody></table></div>";

  const cards = rows
    .map((b) => {
      const total = num(b.total);
      const hold = num(b.hold);
      const avail = Number.isFinite(total) && Number.isFinite(hold) ? total - hold : NaN;
      return (
        '<article class="rounded-xl border border-white/8 bg-ink-850 p-4 shadow-card sm:hidden">' +
        '<p class="font-semibold text-white">' +
        escapeHtml(b.coin || "—") +
        "</p>" +
        '<div class="mt-2 grid grid-cols-3 gap-2 text-xs">' +
        '<div><p class="uppercase tracking-wider text-mist-400">Total</p><p class="mt-0.5 font-mono tabular">' +
        escapeHtml(fmtQty(b.total)) +
        "</p></div>" +
        '<div><p class="uppercase tracking-wider text-mist-400">In orders</p><p class="mt-0.5 font-mono tabular">' +
        escapeHtml(fmtQty(b.hold)) +
        "</p></div>" +
        '<div><p class="uppercase tracking-wider text-mist-400">Available</p><p class="mt-0.5 font-mono tabular">' +
        escapeHtml(Number.isFinite(avail) ? fmtQty(avail) : "—") +
        "</p></div>" +
        "</div>" +
        "</article>"
      );
    })
    .join("");

  el.spotRoot.innerHTML = table + '<div class="grid gap-3 sm:hidden">' + cards + "</div>";
}

function renderStaking(el, summary, delegations, validatorNames) {
  const s = summary || {};
  const dels = Array.isArray(delegations) ? delegations : [];
  const names = validatorNames || {};

  const totals =
    '<div class="grid gap-3 sm:grid-cols-3">' +
    cardMini("Delegated", fmtHype(s.delegated), "HYPE staked with validators") +
    cardMini("Undelegated", fmtHype(s.undelegated), "HYPE not currently staked") +
    cardMini(
      "Pending withdrawal",
      fmtHype(s.totalPendingWithdrawal),
      s.nPendingWithdrawals != null ? s.nPendingWithdrawals + " pending" : "Waiting to unstake"
    ) +
    "</div>";

  let list;
  if (!dels.length) {
    list =
      '<div class="mt-4 rounded-xl border border-dashed border-white/10 bg-ink-850/50 px-5 py-8 text-center text-sm text-mist-400">No active delegations.</div>';
  } else {
    const rows = dels
      .map((d) => {
        const lock = d.lockedUntilTimestamp != null ? formatLocalTime(d.lockedUntilTimestamp) : "—";
        const key = String(d.validator || "").toLowerCase();
        const label = names[key] || d.validator || "—";
        const showAddr = names[key] ? String(d.validator || "") : "";
        return (
          "<tr class='border-t border-white/5'>" +
          '<td class="px-3 py-2.5">' +
          '<p class="text-sm font-medium text-white">' +
          escapeHtml(label) +
          "</p>" +
          (showAddr
            ? '<p class="mt-0.5 font-mono text-[11px] text-mist-400">' + escapeHtml(showAddr) + "</p>"
            : "") +
          "</td>" +
          '<td class="px-3 py-2.5 font-mono text-sm tabular">' +
          escapeHtml(fmtHype(d.amount)) +
          "</td>" +
          '<td class="px-3 py-2.5 text-sm text-mist-300">' +
          escapeHtml(lock) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    list =
      '<div class="mt-4 overflow-x-auto rounded-xl border border-white/8 bg-ink-850 shadow-card">' +
      '<table class="min-w-full text-sm">' +
      '<thead class="text-xs font-medium uppercase tracking-wider text-mist-400"><tr>' +
      '<th class="px-3 py-2 text-left font-medium">Validator</th>' +
      '<th class="px-3 py-2 text-left font-medium">Amount</th>' +
      '<th class="px-3 py-2 text-left font-medium">Locked until</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  el.stakingRoot.innerHTML = totals + list;
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
