/* SimQ app UI. Talks to the Python engine (Pyodide) through api(name, args). */
"use strict";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = (v, sign) => (v < 0 ? "−" : (sign && v > 0 ? "+" : "")) + "$" + Math.abs(v || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pct = (v, d = 1, sign) => v == null || isNaN(v) ? "—" : (sign && v > 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const f2 = v => v == null || isNaN(v) ? "—" : Number(v).toFixed(2);
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";
const kTxt = k => "$" + (Number.isInteger(+k) ? (+k) : (+k).toFixed(2));
const SAVE_KEY = "simq.save.v1", THEME_KEY = "simq.theme";
const ICON = {
  leaf: '<path d="M5 19c8 0 14-6 14-14C11 5 5 10 5 17v2zM5 19l7-7"/>',
  next: '<path d="M6 5l7 7-7 7M14 5v14"/>', fwd: '<path d="M4 5l7 7-7 7M12 5l7 7-7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', warn: '<path d="M12 3.6L2.9 19.4h18.2z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="16.7" r=".9" fill="currentColor"/>',
  dia: '<path d="M12 4l7 8-7 8-7-8z" fill="currentColor" stroke="none"/>'
};
const I = n => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

let st = null;
const ui = {tab: "Portfolio", exp: null, view: "both", hFilter: "All", range: "3M", perfRange: "All"};
const TABS = ["Portfolio", "Chain", "Indicators", "History", "Performance", "Run"];

/* ---------- plumbing ---------- */
async function api(name, args = {}) {
  const r = await fetch("/api/" + name, {method: "POST", body: JSON.stringify(args)});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}
function toast(msg, ms = 3200) { const t = $("#toast"); t.innerHTML = msg; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", ms); }
async function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(await api("save"))); } catch (e) { /* storage may be unavailable */ }
}
async function act(action) {
  try {
    st = await api("act", {action});
    await persist();
    render();
    const ev = st.new_events || [];
    const big = ev.filter(e => ["assigned", "called", "expired", "split", "close"].includes(e.kind) && action.a === "advance");
    const small = ev.filter(e => ["interest", "rate"].includes(e.kind));
    if (big.length) recap(big, small);
    else if (small.length) toast(small.map(e => esc(e.title)).join(" · "));
    return true;
  } catch (e) { toast(esc(e.message), 4500); return false; }
}

/* ---------- theme ---------- */
function applyTheme() {
  let t = "system"; try { t = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/* ---------- header ---------- */
function renderHeader() {
  $("#logo").innerHTML = `<span class="mark">${I("leaf")}</span>SimQ <small>practice on real TQQQ history</small>`;
  if (!st) { $("#clock").innerHTML = ""; $("#hstat").innerHTML = ""; $("#adv").innerHTML = ""; $("nav").innerHTML = ""; return; }
  const ch = st.spot / st.prev_close - 1;
  $("#clock").innerHTML = `<b>${esc(st.label)}</b><small>Market open · SimQ ${f2(st.spot)} <span class="${cls(ch)}">${pct(ch, 2, true)}</span> from last close</small>`;
  $("#hstat").innerHTML = `
    <div><small>Account value</small><b>${money(st.value)}</b></div>
    <div class="hide-m"><small>Collateral</small><b>${money(st.collateral)}</b></div>
    <div class="hide-m"><small>Shares</small><b>${st.shares ? `${st.shares} × ${f2(st.spot)}` : "0"}</b></div>
    <div><small>Return</small><b class="${cls(st.ret)}">${pct(st.ret, 1, true)}</b></div>`;
  $("#adv").innerHTML = st.ended ? `<span class="pill">Run ended</span>` : `
    <button class="btn primary" id="aDay" title="N">${I("next")} Next day</button>
    <button class="btn" id="aFri" title="F">${st.wday === 4 ? "Next Friday" : "To Friday"}</button>
    <button class="btn hide-m" id="aWeek" title="W">${I("fwd")} Next week</button>`;
  if (!st.ended) {
    $("#aDay").onclick = () => requestAdvance("day");
    $("#aFri").onclick = () => requestAdvance("friday");
    $("#aWeek").onclick = () => requestAdvance("week");
  }
  $("nav").innerHTML = TABS.map((t, i) => `<button class="${ui.tab === t ? "on" : ""}" data-tab="${t}" title="${i + 1}">${t}</button>`).join("");
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(); });
}

/* ---------- portfolio ---------- */
function renderPortfolio() {
  const s = st;
  const kp = (lbl, val, sub, c = "") => `<div class="card kpi"><small>${lbl}</small><b class="${c}">${val}</b>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const pos = s.positions.map(p => `<tr class="row" data-pid="${p.id}">
      <td class="l"><b>${esc(p.label)}</b><div class="hint">${p.type === "put" ? "Short put" : "Covered call"} · opened ${esc(p.opened)}</div></td>
      <td>${p.qty}</td><td>${p.days}d</td>
      <td class="${p.itm ? "down" : ""}">${p.itm ? "ITM " : ""}${pct(Math.abs(p.dist))}</td>
      <td>${f2(p.open_px)}</td><td>${f2(p.mark)}</td><td class="${cls(p.pl)}">${money(p.pl, true)}</td>
      <td>${p.type === "put" ? money(p.collateral) : `${p.qty * 100} sh`}</td>
      <td><button class="btn" data-close="${p.id}">Close…</button></td></tr>`).join("");
  const lots = s.lots.map(l => `<tr><td class="l">${l.qty} shares</td><td>${f2(l.cost)}</td><td class="${cls(s.spot - l.cost)}">${money((s.spot - l.cost) * l.qty, true)}</td><td class="l dim">${esc(l.how)} ${esc(l.since)}</td></tr>`).join("");
  $("#main").innerHTML = `
    <div class="grid cards">
      ${kp("Account value", money(s.value), `started ${money(s.cash0)}`)}
      ${kp("Available", money(s.avail), "spendable cash")}
      ${kp("Collateral", money(s.collateral), s.value ? pct(s.collateral / s.value, 0) + " of account" : "")}
      <div class="card kpi"><small>Shares</small><b>${s.shares}</b><div class="sub">${s.shares ? `${s.free_shares} free · ${s.shares - s.free_shares} covering` : "none held"}</div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" data-sh="buy_shares">Buy</button>${s.free_shares ? `<button class="btn" data-sh="sell_shares">Sell</button>` : ""}</div></div>
      ${kp("Your return", pct(s.ret, 1, true), `buy & hold ${pct(s.bh / s.cash0 - 1, 1, true)} · cash ${pct(s.cash_bench / s.cash0 - 1, 1, true)}`, cls(s.ret))}
      ${kp("Premium kept", money(s.premium), `interest ${money(s.interest)} + ${money(s.accrued)} accruing`)}
    </div>
    ${s.alerts.length ? `<section><h2>Alerts</h2><div class="alerts">${s.alerts.map(a => `<div class="alert">${I("warn")} ${esc(a)}</div>`).join("")}</div></section>` : ""}
    <section><div class="bar"><h2 style="margin:0">Open positions</h2><span style="flex:1"></span>
      <button class="btn" id="bShares">Buy / sell shares</button><button class="btn primary" id="bChain">Open the chain</button></div>
      ${s.positions.length ? `<table><tr><th class="l">Contract</th><th>Contracts</th><th>Left</th><th>From strike</th><th>Sold at</th><th>Mark</th><th>P&L</th><th>Securing</th><th></th></tr>${pos}</table>`
        : `<div class="empty">No open options. Open the Chain to sell a put${s.free_shares >= 100 ? " or a covered call" : ""}.</div>`}
    </section>
    ${s.lots.length ? `<section><h2>Share lots</h2><table><tr><th class="l">Lot</th><th>Cost</th><th>P&L at the open</th><th class="l">How</th></tr>${lots}</table></section>` : ""}
    <section class="grid cards">
      <div class="card"><h3>Market at the open</h3><div class="kv"><span>SimQ</span><b>${f2(s.spot)}</b><span>VIX (last close)</span><b>${f2(s.vix)}</b>
        <span>Fear &amp; Greed</span><b>${s.fg ?? "—"} ${s.fg != null ? `<span class="pill">${fgLabel(s.fg)}</span>` : ""}</b>
        <span>Sim-tastic %K</span><b>${s.stoch_k ?? "—"}</b><span>Rate</span><b>${(s.rate * 100).toFixed(2)}%</b></div></div>
    </section>`;
  $("#bChain").onclick = () => { ui.tab = "Chain"; render(); };
  $("#bShares").onclick = () => sharesTicket();
  document.querySelectorAll("[data-sh]").forEach(b => b.onclick = () => sharesTicket(b.dataset.sh));
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = e => { e.stopPropagation(); closeTicket(+b.dataset.close); });
  document.querySelectorAll("tr[data-pid]").forEach(r => r.ondblclick = () => {
    const p = st.positions.find(x => x.id === +r.dataset.pid); ui.exp = p.expiry; ui.tab = "Chain"; render();
  });
}
const fgLabel = x => x < 25 ? "extreme fear" : x < 45 ? "fear" : x <= 55 ? "neutral" : x <= 75 ? "greed" : "extreme greed";

/* ---------- chain ---------- */
async function renderChain() {
  if (!ui.exp || !st.exps.some(e => e.d === ui.exp)) ui.exp = (st.exps.find(e => e.days >= 5) || st.exps[0]).d;
  const opts = st.exps.map(e => `<option value="${e.d}" ${e.d === ui.exp ? "selected" : ""}>${esc(e.label)} · ${e.days}d</option>`).join("");
  $("#main").innerHTML = `<div class="bar"><select id="exp">${opts}</select>
    <span class="seg">${["calls", "both", "puts"].map(v => `<button data-v="${v}" class="${ui.view === v ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</span>
    <span class="hint">Click a bid (the column next to the strike) to sell · shaded = in the money</span>
    <span style="flex:1"></span><button class="btn" id="cShares">Buy / sell shares</button></div><div id="chainT" class="empty">Pricing…</div>`;
  $("#cShares").onclick = () => sharesTicket();
  $("#exp").onchange = e => { ui.exp = +e.target.value; renderChain(); };
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { ui.view = b.dataset.v; renderChain(); });
  let ch;
  try { ch = await api("chain", {expiry: ui.exp}); } catch (e) { $("#chainT").textContent = e.message; return; }
  const C = ui.view !== "puts", P = ui.view !== "calls";
  let html = `<table class="chain"><tr>${C ? "<th>Δ</th><th>IV</th><th>Call ask</th><th>Call bid</th>" : ""}<th>Strike</th>${P ? "<th>Put bid</th><th>Put ask</th><th>IV</th><th>Δ</th>" : ""}</tr>`;
  let placed = false;
  for (const r of ch.rows) {
    if (!placed && r.k > ch.spot) { placed = true; html += `<tr class="spot"><td colspan="9"><div>SimQ ${f2(ch.spot)}</div></td></tr>`; }
    const citm = r.k < ch.spot, pitm = r.k > ch.spot;
    html += `<tr>${C ? `<td class="${citm ? "itm" : ""} dim">${r.cd.toFixed(2)}</td><td class="${citm ? "itm" : ""} dim">${(r.civ * 100).toFixed(0)}%</td>
      <td class="${citm ? "itm" : ""}">${f2(r.ca)}</td><td class="q ${citm ? "itm" : ""}" data-t="call" data-k="${r.k}" title="Sell this call">${r.cb > 0 ? f2(r.cb) : "—"}</td>` : ""}
      <td class="k">${kTxt(r.k)}${r.held_c || r.held_p ? '<span class="dot" title="You hold this strike"></span>' : ""}</td>
      ${P ? `<td class="q ${pitm ? "itm" : ""}" data-t="put" data-k="${r.k}" title="Sell this put">${r.pb > 0 ? f2(r.pb) : "—"}</td><td class="${pitm ? "itm" : ""}">${f2(r.pa)}</td>
      <td class="${pitm ? "itm" : ""} dim">${(r.piv * 100).toFixed(0)}%</td><td class="${pitm ? "itm" : ""} dim">${r.pd.toFixed(2)}</td>` : ""}</tr>`;
  }
  $("#chainT").outerHTML = html + "</table>" + `<p class="hint">${esc(ch.label)} · ${ch.days} trading days incl. today · at-the-money IV ${(ch.atm_iv * 100).toFixed(0)}%</p>`;
  document.querySelectorAll("td.q").forEach(td => td.onclick = () => openTicket(td.dataset.t, +td.dataset.k, ui.exp));
}

/* ---------- tickets ---------- */
function drawer(html) { $("#drawer").innerHTML = html; $("#drawer").classList.add("open"); }
function closeDrawer() { $("#drawer").classList.remove("open"); }
async function openTicket(type, strike, expiry, qty = 1) {
  const exps = st.exps.map(e => `<option value="${e.d}" ${e.d === expiry ? "selected" : ""}>${esc(e.label)}</option>`).join("");
  drawer(`<div class="dh"><h3>Sell to open</h3><button class="x" id="dx">Close · Esc</button></div>
    <div class="form"><label>Type</label><span class="seg"><button data-ty="put" class="${type === "put" ? "on" : ""}">Put</button><button data-ty="call" class="${type === "call" ? "on" : ""}">Call</button></span>
    <label>Expiration</label><select id="tExp">${exps}</select>
    <label>Strike</label><input id="tK" type="number" step="0.5" value="${strike}">
    <label>Contracts</label><input id="tQ" type="number" min="1" step="1" value="${qty}">
    <label>Note</label><input id="tN" placeholder="Why this trade (optional)"></div>
    <div id="tOut" class="hint">Checking…</div>`);
  $("#dx").onclick = closeDrawer;
  const re = () => openTicketUpdate();
  document.querySelectorAll("#drawer .seg button").forEach(b => b.onclick = () => { document.querySelectorAll("#drawer .seg button").forEach(x => x.classList.toggle("on", x === b)); re(); });
  ["tExp", "tK", "tQ"].forEach(id => $("#" + id).oninput = re);
  re();
}
function ticketOrder() {
  return {action: "sell_to_open", type: document.querySelector("#drawer .seg button.on").dataset.ty,
    expiry: +$("#tExp").value, strike: +$("#tK").value, qty: Math.max(1, Math.floor(+$("#tQ").value || 1)), note: $("#tN").value};
}
async function openTicketUpdate() {
  const o = ticketOrder();
  let c; try { c = await api("check", {order: o}); } catch (e) { $("#tOut").innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; }
  const q = c.quote, e = c.effects;
  let h = "";
  if (q) h += `<div class="kv"><span>Bid / ask</span><b>${f2(q.bid)} / ${f2(q.ask)}</b><span>You sell at</span><b>${f2(c.fill ?? q.bid)}</b>
      <span>IV · delta</span><b>${(q.iv * 100).toFixed(0)}% · ${q.delta.toFixed(2)}</b><span>Days left</span><b>${q.days}</b></div>`;
  if (c.ok) {
    h += `<div class="kv"><span>Premium in</span><b class="up">${money(e.premium, true)}</b>
      ${o.type === "put" ? `<span>Collateral set aside</span><b>${money(e.collateral)}</b>` : `<span>Shares locked</span><b>${e.locks}</b>`}
      <span>Available after</span><b>${money(e.avail_after)}</b>
      <span>Return if it expires worthless</span><b>${pct(c.ret, 2)} <span class="dim">(${pct(c.ann, 0)}/yr)</span></b></div>`;
    if (c.chances) h += `<div class="card" style="margin:10px 0"><h3>Chances (from IV, not predictions)</h3><div class="kv">
      <span>Expires worthless</span><b>${pct(c.chances.worthless, 0)}</b>
      <span>${o.type === "put" ? "Assigned" : "Called away"}</span><b>${pct(c.chances.assigned, 0)}</b>
      <span>Profit at expiration</span><b>${pct(c.chances.profit, 0)}</b><span>Breakeven</span><b>${f2(c.chances.breakeven)}</b></div></div>`;
    if (c.warn) h += `<div class="msg warn">${esc(c.warn)}</div>`;
    h += `<div class="row-btns"><button class="btn" id="tC">Cancel</button><button class="btn primary" id="tR">Review trade</button></div>`;
  } else h += `<div class="msg bad">${esc(c.msg)}</div>`;
  $("#tOut").innerHTML = h;
  if (c.ok) { $("#tC").onclick = closeDrawer; $("#tR").onclick = () => confirmTrade(o, c); }
}
function closeTicket(pid) {
  const p = st.positions.find(x => x.id === pid);
  drawer(`<div class="dh"><h3>Buy to close</h3><button class="x" id="dx">Close · Esc</button></div>
    <p><b>${esc(p.label)}</b><br><span class="hint">sold ${p.qty} at ${f2(p.open_px)} · mark ${f2(p.mark)}</span></p>
    <div class="form"><label>Contracts</label><input id="cQ" type="number" min="1" max="${p.qty}" value="${p.qty}">
    <label>Why close</label><input id="cN" placeholder="optional"></div><div id="cOut"></div>`);
  $("#dx").onclick = closeDrawer;
  const up = async () => {
    const o = {action: "buy_to_close", position_id: pid, qty: Math.max(1, Math.floor(+$("#cQ").value || 1)), note: $("#cN").value};
    let c; try { c = await api("check", {order: o}); } catch (e) { $("#cOut").innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; }
    $("#cOut").innerHTML = c.ok ? `<div class="kv"><span>You buy at the ask</span><b>${f2(c.fill)}</b><span>Cost</span><b>${money(-c.effects.cost)}</b>
      ${c.effects.released ? `<span>Collateral released</span><b>${money(c.effects.released)}</b>` : ""}
      <span>Result on these contracts</span><b class="${cls(c.effects.result)}">${money(c.effects.result, true)}</b><span>Available after</span><b>${money(c.effects.avail_after)}</b></div>
      <div class="row-btns"><button class="btn" id="cC">Cancel</button><button class="btn primary" id="cR">Review trade</button></div>` : `<div class="msg bad">${esc(c.msg)}</div>`;
    if (c.ok) { $("#cC").onclick = closeDrawer; $("#cR").onclick = () => confirmTrade(o, c, p.label); }
  };
  $("#cQ").oninput = up; up();
}
function sharesTicket(side = "buy_shares") {
  const maxBuy = Math.floor(st.avail / st.spot), maxSell = st.free_shares;
  drawer(`<div class="dh"><h3>Buy / sell SimQ shares</h3><button class="x" id="dx">Close · Esc</button></div>
    <p class="hint">Shares trade at today's open price, ${f2(st.spot)}. Available cash ${money(st.avail)} · ${st.free_shares} free shares.</p>
    <div class="form"><label>Side</label><span class="seg"><button data-s="buy_shares" class="${side === "buy_shares" ? "on" : ""}">Buy</button><button data-s="sell_shares" class="${side === "sell_shares" ? "on" : ""}">Sell</button></span>
    <label>Shares</label><input id="sQ" type="number" min="1" value="${side === "sell_shares" ? Math.max(1, maxSell) : Math.min(100, Math.max(1, maxBuy))}">
    <label></label><span id="sQuick" style="display:flex;gap:6px;flex-wrap:wrap"></span></div><div id="sOut"></div>`);
  $("#dx").onclick = closeDrawer;
  const curSide = () => document.querySelector("#drawer .seg button.on").dataset.s;
  const quick = () => {
    const sd = curSide(), mx = sd === "buy_shares" ? maxBuy : maxSell;
    const opts = [100, 200, 500].filter(n => n <= mx).map(n => [n, String(n)]).concat(mx > 0 ? [[mx, `Max (${mx})`]] : []);
    $("#sQuick").innerHTML = opts.map(([n, l]) => `<button class="btn" data-n="${n}" style="padding:4px 10px">${l}</button>`).join("") || `<span class="hint">${sd === "buy_shares" ? "Not enough cash for a share." : "No free shares to sell."}</span>`;
    document.querySelectorAll("#sQuick [data-n]").forEach(b => b.onclick = () => { $("#sQ").value = b.dataset.n; up(); });
  };
  const up = async () => {
    const o = {action: curSide(), qty: Math.max(1, Math.floor(+$("#sQ").value || 1))};
    const c = await api("check", {order: o});
    $("#sOut").innerHTML = c.ok ? `<div class="kv"><span>Price (today's open)</span><b>${f2(c.fill)}</b><span>${o.action === "buy_shares" ? "Cost" : "Proceeds"}</span><b>${money(c.fill * o.qty)}</b>
      <span>Available after</span><b>${money(st.avail + (o.action === "buy_shares" ? -1 : 1) * c.fill * o.qty)}</b>
      ${o.action === "buy_shares" ? `<span>Covered calls this allows</span><b>${Math.floor((st.free_shares + o.qty) / 100)}</b>` : ""}</div>
      <div class="row-btns"><button class="btn" id="sC">Cancel</button><button class="btn primary" id="sR">Review trade</button></div>` : `<div class="msg bad">${esc(c.msg)}</div>`;
    if (c.ok) { $("#sC").onclick = closeDrawer; $("#sR").onclick = () => confirmTrade(o, c); }
  };
  document.querySelectorAll("#drawer .seg button").forEach(b => b.onclick = () => { document.querySelectorAll("#drawer .seg button").forEach(x => x.classList.toggle("on", x === b)); quick(); up(); });
  $("#sQ").oninput = up; quick(); up();
}
function confirmTrade(o, c, label) {
  const e = c.effects;
  const words = o.action === "sell_to_open" ? `SELL TO OPEN ${o.qty} × ${o.type.toUpperCase()} $${o.strike} · ${esc(st.exps.find(x => x.d === o.expiry).label)}`
    : o.action === "buy_to_close" ? `BUY TO CLOSE ${o.qty} × ${esc(label)}` : `${o.action === "buy_shares" ? "BUY" : "SELL"} ${o.qty} SIMQ SHARES`;
  const after = e.avail_after ?? (st.avail + (e.cash || 0));
  const flags = (c.flags || []).concat(c.warn ? [c.warn] : []);
  confirmBox({title: "Confirm trade", html: `<div class="act">${words}</div>
    <div class="kv"><span>Fill price</span><b>${f2(c.fill)}</b>
    ${e.premium ? `<span>Premium in</span><b class="up">${money(e.premium, true)}</b>` : ""}
    ${e.collateral ? `<span>Collateral set aside</span><b>${money(e.collateral)}</b>` : ""}
    ${e.locks ? `<span>Shares locked</span><b>${e.locks}</b>` : ""}
    ${e.cost ? `<span>Cost</span><b>${money(-e.cost)}</b>` : ""}${e.released ? `<span>Collateral released</span><b>${money(e.released)}</b>` : ""}
    ${e.cash ? `<span>Cash</span><b>${money(e.cash, true)}</b>` : ""}
    <span>Available</span><b>${money(st.avail)} → ${money(after)}</b></div>
    ${flags.map(f => `<div class="msg warn">${I("warn")} ${esc(f)}</div>`).join("")}
    <p class="hint">No undo. A mistake is fixed by trading the other way; History keeps both.</p>`,
    delay: flags.length ? 2000 : 0,
    onOK: async () => { if (await act({a: "order", ...o})) { closeDrawer(); toast("Done: " + words); } }});
}
function closeModal() { $("#overlay").classList.remove("open"); modal = null; }

/* ---------- confirmations ---------- */
let modal = null;   // {ok, okKeys, ready}
function confirmBox({title, html, ok = "Confirm", cancel = "Cancel", delay = 0, okKeys = [], onOK, danger = false, noCancel = false}) {
  $("#overlay").innerHTML = `<div class="modal"><h3>${title}</h3>${html}
    <div class="row-btns">${noCancel ? "" : `<button class="btn" id="mC">${cancel} · Esc</button>`}
    <button class="btn ${danger ? "danger" : "primary"}" id="mOK">${ok}</button></div></div>`;
  $("#overlay").classList.add("open");
  const btn = $("#mOK");
  modal = {okKeys, ready: delay <= 0, onOK};
  const label = ok + (okKeys.length ? " · Enter" : " · Enter");
  if (delay > 0) {
    let left = Math.ceil(delay / 1000);
    btn.disabled = true; btn.textContent = `Look it over… ${left}`;
    const tick = setInterval(() => {
      left -= 1;
      if (!modal || $("#mOK") !== btn) return clearInterval(tick);
      if (left <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = label; modal.ready = true; }
      else btn.textContent = `Look it over… ${left}`;
    }, 1000);
  } else btn.textContent = label;
  btn.onclick = () => { if (!modal.ready) return; const f = modal.onOK; closeModal(); f && f(); };
  if (!noCancel) $("#mC").onclick = closeModal;
}
const ADV_KEY = {day: "n", friday: "f", week: "w"};
async function requestAdvance(to) {
  if (!st || st.ended) return;
  let pv; try { pv = await api("preview", {to}); } catch (e) { toast(esc(e.message)); return; }
  const go = () => act({a: "advance", to});
  const rows = pv.settling.map(x => `<div class="alert" style="${x.itm ? "" : "background:var(--accent3);border-color:var(--line)"}">
      <b>${esc(x.label)}</b> settles ${esc(x.when)} close${x.itm ? ` · <span class="down">in the money now</span>` : ` · ${pct(x.dist)} out of the money now`}
      <div class="hint">${esc(x.then)}; ${esc(x.else)}.</div></div>`).join("");
  const facts = [`${pv.days} trading day${pv.days > 1 ? "s" : ""}`];
  if (pv.interest_days) facts.push(`interest paid ${pv.interest_days > 1 ? pv.interest_days + " times" : "Friday"} (${money(pv.accrued)} accrued so far)`);
  if (pv.meeting) facts.push("a central bank meeting");
  if (!pv.settling.length) return confirmBox({
    title: "Are you sure?",
    html: `<p style="margin:6px 0">Move to <b>${esc(pv.label)}</b>.</p><p class="hint">${facts.join(" · ")}${pv.open_positions ? " · nothing of yours settles" : " · no open options"}. No going back.</p>`,
    ok: pv.days > 1 ? `Yes, advance ${pv.days} days` : "Yes, next day", okKeys: [ADV_KEY[to]], onOK: go});
  confirmBox({
    title: `Move to ${esc(pv.label)}?`,
    html: `<p class="hint" style="margin:4px 0 10px">${facts.join(" · ")}${pv.open_positions && !pv.settling.length ? " · nothing of yours settles" : ""}${!pv.open_positions ? " · no open options" : ""}</p>
      ${pv.settling.length ? `<div class="alerts" style="margin-bottom:6px">${rows}</div>` : ""}
      <p class="hint">Trades you didn't place today are gone once the day moves on; there is no going back.</p>`,
    ok: pv.days > 1 ? `Advance ${pv.days} days` : "Next day",
    delay: pv.itm_count ? 2000 : 0, okKeys: [ADV_KEY[to]], onOK: go});
}
function recap(big, small) {
  const line = e => `<div class="ev" style="grid-template-columns:110px 1fr"><div class="when">${esc(e.when)}</div><div><b>${esc(e.title)}</b>${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ""}</div></div>`;
  const shares = st.shares ? `You now hold <b>${st.shares}</b> shares (${st.free_shares} free).` : "You hold no shares.";
  confirmBox({title: "What settled", html: `<div class="evs" style="margin:8px 0">${big.concat(small).map(line).join("")}</div>
      <p class="hint">${shares} Available ${money(st.avail)} · account ${money(st.value)}.</p>`,
    ok: "Got it", noCancel: true, delay: big.some(e => ["assigned", "called", "split"].includes(e.kind)) ? 1500 : 0});
}

/* ---------- charts ---------- */
function lineChart({labels, series, h = 160, refs = [], yfmt = v => v.toFixed(0), markers = [], logY = false, min, max}) {
  const W = 900, pad = {l: 44, r: 10, t: 8, b: 18}, n = labels.length;
  const vals = series.flatMap(s => s.data.filter(v => v != null));
  let lo = min ?? Math.min(...vals, ...refs), hi = max ?? Math.max(...vals, ...refs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const tf = v => logY ? Math.log(v) : v;
  const X = i => pad.l + (n <= 1 ? 0 : i * (W - pad.l - pad.r) / (n - 1));
  const Y = v => pad.t + (1 - (tf(v) - tf(lo)) / (tf(hi) - tf(lo))) * (h - pad.t - pad.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  let s = `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" data-n="${n}">`;
  for (const t of ticks) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l - 6}" y="${Y(t) + 4}" font-size="11" fill="var(--dim)" text-anchor="end">${yfmt(t)}</text>`;
  for (const r of refs) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(r)}" y2="${Y(r)}" stroke="var(--dim)" stroke-dasharray="4 4" stroke-width="1"/>`;
  for (const se of series) {
    let d = "", pen = false;
    se.data.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 1.8}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} vector-effect="non-scaling-stroke"/>`;
  }
  for (const m of markers) if (m.i >= 0 && m.i < n) s += `<path transform="translate(${X(m.i)} ${Y(m.v)})" d="M0 -6 L6 0 L0 6 L-6 0Z" fill="var(--warn)"><title>${esc(m.title)}</title></path>`;
  s += `<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--accent)" stroke-width="1" style="display:none"/>`;
  const lbls = [0, Math.floor(n / 2), n - 1].filter(i => i >= 0 && labels[i]);
  for (const i of lbls) s += `<text x="${X(i)}" y="${h - 3}" font-size="11" fill="var(--dim)" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(labels[i])}</text>`;
  return s + `</svg>`;
}
function hookHover(container, labels, rows) {
  const tip = $("#tip");
  container.querySelectorAll("svg").forEach(svg => {
    svg.onmousemove = ev => {
      const b = svg.getBoundingClientRect(), n = labels.length;
      const x = (ev.clientX - b.left) / b.width * 900;
      const i = Math.max(0, Math.min(n - 1, Math.round((x - 44) / (900 - 54) * (n - 1))));
      container.querySelectorAll("svg .xh").forEach(l => { const xx = 44 + i * (900 - 54) / Math.max(n - 1, 1); l.setAttribute("x1", xx); l.setAttribute("x2", xx); l.style.display = ""; });
      tip.innerHTML = `<b>${esc(labels[i])}</b>` + rows(i);
      tip.style.display = "block"; tip.style.left = Math.min(ev.clientX + 14, innerWidth - 200) + "px"; tip.style.top = ev.clientY + 14 + "px";
    };
    svg.onmouseleave = () => { tip.style.display = "none"; container.querySelectorAll("svg .xh").forEach(l => l.style.display = "none"); };
  });
}
const RANGES = {"1M": 21, "3M": 63, "6M": 126, "1Y": 252, "2Y": 504};

/* ---------- indicators ---------- */
async function renderIndicators() {
  const d = await api("indicators", {days: 600});
  const n = Math.min(RANGES[ui.range], d.close.length);
  if (!n) { $("#main").innerHTML = `<div class="empty">Indicators start once the first day has closed. Press Next day.</div>`; return; }
  const cut = a => a.slice(-n), L = cut(d.labels);
  const last = a => a[a.length - 1], prev = a => a[a.length - 2];
  const fg = last(d.fg), k = last(d.k), dd = last(d.d), vix = last(d.vix);
  const vix1y = d.vix.slice(-252).filter(v => v != null);
  const zone = k == null ? "—" : k < 20 ? "oversold" : k > 80 ? "overbought" : "neutral";
  const comps = Object.entries(d.components).map(([name, a]) => `<span>${name.replace("_", " ")}</span><b>${last(a)}</b>`).join("");
  const t0 = d.t0 + d.close.length - n;
  const mk = d.markers.filter(m => m.t >= t0).map(m => ({i: m.t - t0, v: d.close[m.t - d.t0] ?? d.close[d.close.length - 1], title: m.title}));
  $("#main").innerHTML = `
    <div class="grid cards">
      <div class="card kpi"><small>SimQ at today's open</small><b>${f2(d.today_open)}</b><div class="sub">last close ${f2(last(d.close))}</div></div>
      <div class="card kpi"><small>VIX</small><b>${f2(vix)}</b><div class="sub"><span class="${cls(-(vix - prev(d.vix)))}">${vix - prev(d.vix) >= 0 ? "▲" : "▼"} ${f2(Math.abs(vix - prev(d.vix)))}</span> · 1-yr range ${f2(Math.min(...vix1y))}–${f2(Math.max(...vix1y))}</div></div>
      <div class="card"><h3>Fear &amp; Greed</h3><b style="font-size:22px">${fg?.toFixed(0)}</b> <span class="pill">${fgLabel(fg)}</span>
        <div class="gauge"><i style="left:${fg}%"></i></div><div class="comp">${comps}</div></div>
      <div class="card"><h3>Sim-tastic Oscillator (14,3,3)</h3><b style="font-size:22px">%K ${k?.toFixed(0) ?? "—"}</b> <span class="pill ${zone === "oversold" ? "down" : zone === "overbought" ? "warn" : ""}">${zone}</span>
        <div class="sub dim">%D ${dd?.toFixed(0) ?? "—"} · below 20 oversold, above 80 overbought</div></div>
    </div>
    <section><div class="bar"><span class="seg">${Object.keys(RANGES).map(r => `<button data-r="${r}" class="${ui.range === r ? "on" : ""}">${r}</button>`).join("")}</span>
      <span class="hint">Everything up to yesterday's close · ◆ = your trades and share events</span></div>
    <div class="grid" id="charts">
      <div class="chart"><h4>SimQ close</h4>${lineChart({labels: L, series: [{data: cut(d.close), color: "var(--accent)"}], h: 180, yfmt: v => v.toFixed(2), markers: mk})}</div>
      <div class="chart"><h4>Sim-tastic Oscillator %K / %D</h4>${lineChart({labels: L, series: [{data: cut(d.k), color: "var(--accent)"}, {data: cut(d.d), color: "var(--warn)", w: 1.4}], refs: [20, 80], min: 0, max: 100, h: 120})}</div>
      <div class="chart"><h4>VIX</h4>${lineChart({labels: L, series: [{data: cut(d.vix), color: "var(--down)"}], h: 120, yfmt: v => v.toFixed(1)})}</div>
      <div class="chart"><h4>Fear &amp; Greed</h4>${lineChart({labels: L, series: [{data: cut(d.fg), color: "var(--up)"}], refs: [25, 75], min: 0, max: 100, h: 120})}</div>
    </div></section>`;
  document.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { ui.range = b.dataset.r; renderIndicators(); });
  const C = cut(d.close), K = cut(d.k), D = cut(d.d), V = cut(d.vix), F = cut(d.fg), IV = cut(d.iv);
  hookHover($("#charts"), L, i => `<div class="kv" style="margin:4px 0 0"><span>Close</span><b>${f2(C[i])}</b><span>%K / %D</span><b>${K[i]?.toFixed(0) ?? "—"} / ${D[i]?.toFixed(0) ?? "—"}</b><span>VIX</span><b>${f2(V[i])}</b><span>Fear &amp; Greed</span><b>${F[i]?.toFixed(0)}</b><span>SimQ ATM IV</span><b>${IV[i]?.toFixed(0)}%</b></div>`);
}

/* ---------- history ---------- */
async function renderHistory() {
  const h = await api("history");
  const groups = {All: null, Trades: ["open", "close", "shares"], Settlements: ["expired", "assigned", "called", "split"], Interest: ["interest", "rate"], Notes: ["note", "run", "end"]};
  const ev = h.events.filter(e => !groups[ui.hFilter] || groups[ui.hFilter].includes(e.kind));
  $("#main").innerHTML = `<div class="bar"><span class="seg">${Object.keys(groups).map(g => `<button data-g="${g}" class="${ui.hFilter === g ? "on" : ""}">${g}</button>`).join("")}</span>
    <span style="flex:1"></span><input id="note" placeholder="Add a note to your log…" style="min-width:240px"><button class="btn" id="addN">Add note</button></div>
    ${ev.length ? `<div class="evs">${ev.map(e => `<div class="ev"><div class="when">${esc(e.when)}</div><div><b>${esc(e.title)}</b>${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ""}${e.note ? `<div class="d">“${esc(e.note)}”</div>` : ""}</div></div>`).join("")}</div>` : `<div class="empty">Nothing here yet.</div>`}`;
  document.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { ui.hFilter = b.dataset.g; renderHistory(); });
  $("#addN").onclick = async () => { const t = $("#note").value.trim(); if (t && await act({a: "note", text: t})) { ui.tab = "History"; render(); } };
}

/* ---------- performance ---------- */
async function renderPerformance() {
  const p = await api("performance");
  if (!p.stats) { $("#main").innerHTML = `<div class="empty">Performance starts after the first close. Press Next day.</div>`; return; }
  const s = p.stats, pts = p.points;
  const kp = (l, v, sub, c = "") => `<div class="card kpi"><small>${l}</small><b class="${c}">${v}</b>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const L = pts.map(x => x.label);
  $("#main").innerHTML = `<div class="grid cards">
      ${kp("Your return", pct(s.ret, 1, true), `${pct(s.ann, 1, true)} a year · ${s.weeks} weeks`, cls(s.ret))}
      ${kp("Buy & hold SimQ", pct(s.bh_ret, 1, true), "same start, all in shares", cls(s.bh_ret))}
      ${kp("Cash only", pct(s.cash_ret, 1, true), "at the sim rate")}
      ${kp("Max drawdown", pct(s.max_dd, 1), "worst drop from a high (daily closes)", s.max_dd < 0 ? "down" : "")}
      ${kp("Premium kept", money(s.premium), `interest ${money(s.interest)}`)}
      ${kp("Trades", s.trades, `${s.wins}/${s.settled} settled as wins · ${s.assigned} assigned · ${s.called} called away`)}
    </div>
    <section class="grid" id="pc"><div class="chart"><h4>Account vs. buy &amp; hold vs. cash</h4>${lineChart({labels: L, series: [
      {data: pts.map(x => x.v), color: "var(--accent)", w: 2.2}, {data: pts.map(x => x.bh), color: "var(--warn)"}, {data: pts.map(x => x.cash), color: "var(--dim)", dash: "5 4"}],
      h: 220, yfmt: v => "$" + Math.round(v).toLocaleString()})}
      <div class="hint">— account · <span class="warn">— buy &amp; hold</span> · - - cash</div></div>
    <div class="chart"><h4>Weekly change in account value</h4>${weeklyBars(p.weekly)}</div></section>`;
  hookHover($("#pc"), L, i => `<div class="kv" style="margin:4px 0 0"><span>Account</span><b>${money(pts[i].v)}</b><span>Buy &amp; hold</span><b>${money(pts[i].bh)}</b><span>Cash</span><b>${money(pts[i].cash)}</b></div>`);
}
function weeklyBars(w) {
  if (!w.length) return `<div class="hint">After the first full week.</div>`;
  const W = 900, H = 140, mx = Math.max(0.01, ...w.map(Math.abs)), bw = (W - 50) / w.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="44" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/>
    <text x="38" y="14" font-size="11" fill="var(--dim)" text-anchor="end">+${(mx * 100).toFixed(0)}%</text><text x="38" y="${H - 4}" font-size="11" fill="var(--dim)" text-anchor="end">−${(mx * 100).toFixed(0)}%</text>`;
  w.forEach((v, i) => { const h = Math.abs(v) / mx * (H / 2 - 4); s += `<rect x="${46 + i * bw}" y="${v >= 0 ? H / 2 - h : H / 2}" width="${Math.max(bw - 1, 1)}" height="${h}" fill="${v >= 0 ? "var(--up)" : "var(--down)"}"><title>Week ${i + 1}: ${pct(v, 2, true)}</title></rect>`; });
  return s + "</svg>";
}

/* ---------- run ---------- */
function renderRun() {
  let theme = "system"; try { theme = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
  $("#main").innerHTML = `
    ${st.ended ? `<div class="card"><h3>Run summary</h3><p>Final value <b>${money(st.value)}</b> (${pct(st.ret, 1, true)}) after ${st.weeks} weeks. Seed <b>${st.seed}</b>.</p>
      <p>This run's market was built from these real TQQQ years:</p><div class="kv">${st.eras.slice(0, 8).map(([y, f]) => `<span>${y}</span><b>${pct(f, 0)}</b>`).join("")}</div></div>` : ""}
    <div class="grid cards" style="margin-top:12px">
      <div class="card"><h3>Save</h3><p class="hint">Your run saves itself in this browser after every action. Export a copy to move it to another device or keep it safe.</p>
        <div class="row-btns" style="justify-content:flex-start"><button class="btn" id="exp">Export run file</button><label class="btn">Import run file<input id="imp" type="file" accept=".json" hidden></label></div></div>
      <div class="card"><h3>New run</h3><p class="hint">Starts a fresh market from a new hidden seed. Export first if you want to keep this one.</p>
        <div class="form"><label>Starting cash</label><input id="nc" type="number" value="25000" step="1000"></div>
        <div class="row-btns" style="justify-content:flex-start"><button class="btn" id="nr">Start a new run</button></div></div>
      <div class="card"><h3>Theme</h3><span class="seg">${["light", "dark", "system"].map(t => `<button data-th="${t}" class="${theme === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</span>
        <p class="hint" style="margin-top:12px">Keys: N next day · F to Friday · W next week (press the same key again, or Enter, to confirm) · S shares · 1–6 tabs · Esc closes panels and boxes.</p></div>
      ${st.ended ? "" : `<div class="card"><h3>End this run</h3><p class="hint">Ending is permanent. It reveals the seed and which real TQQQ years the market came from. Type END to confirm.</p>
        <div class="form"><label>Confirm</label><input id="endc" placeholder="END"></div><div class="row-btns" style="justify-content:flex-start"><button class="btn danger" id="endb" disabled>End run</button></div></div>`}
    </div>
    <section><h2>How SimQ works</h2><div class="card"><p>SimQ's market is <b>real TQQQ history, reshuffled</b>: each run stitches together blocks of 2–12 weeks of actual trading days since 2010 (real daily moves, gaps, VIX), joined where volatility matches. Prices start at a random level and real dates are never shown, so you can't look ahead.</p>
      <p>Option prices come from the real Nasdaq fear gauge (VXN) of the same day: at-the-money IV ≈ 2.9× VXN for weeklies, easing to 2.65× for monthlies, with a steep put skew. Fear &amp; Greed is built from the path the way CNN builds its index. Only cash-secured puts and covered calls; sells fill at the bid, buy-backs at the ask; no fees. Cash earns the sim rate, paid Fridays: it starts at today's real 3-month T-bill rate, then a sim central bank moves it 0.25 every 6 weeks toward the rate of the era the market is drawn from.</p></div></section>`;
  $("#exp").onclick = async () => {
    const sv = await api("save");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(sv)], {type: "application/json"}));
    a.download = `simq-run-week${st.weeks + 1}.json`; a.click();
  };
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let save; try { save = JSON.parse(await f.text()); } catch (err) { toast("That file isn't a SimQ run."); return; }
    const go = async () => { try { st = await api("load", {save}); await persist(); toast("Run imported."); render(); } catch (err) { toast("That file isn't a SimQ run: " + esc(err.message)); } };
    if (st && !st.ended && st.t > 0) confirmBox({title: "Replace your current run?", danger: true, ok: "Replace it", delay: 2000,
      html: `<p>Importing replaces the run you're playing (week ${st.weeks + 1}, ${money(st.value)}). Export it first if you want to keep it.</p>`, onOK: go});
    else go();
  };
  $("#nr").onclick = () => guardedNewRun(+$("#nc").value);

  document.querySelectorAll("[data-th]").forEach(b => b.onclick = () => { try { localStorage.setItem(THEME_KEY, b.dataset.th); } catch (e) {} applyTheme(); renderRun(); });
  if (!st.ended) { $("#endc").oninput = e => $("#endb").disabled = e.target.value.trim().toUpperCase() !== "END"; $("#endb").onclick = () => confirmBox({title: "End this run?", danger: true, ok: "End run", delay: 2000,
    html: `<p>Final value ${money(st.value)} (${pct(st.ret, 1, true)}) after ${st.weeks} weeks. Ending is permanent: no more trades, and the seed is revealed.</p>`, onOK: () => act({a: "end"})}); }
}
function guardedNewRun(cash) {
  if (!st || st.ended || st.t === 0) return newRun(cash);
  confirmBox({title: "Start a new run?", danger: true, ok: "Discard and start over", delay: 2000,
    html: `<p>This throws away the run you're playing (week ${st.weeks + 1}, ${money(st.value)}, ${pct(st.ret, 1, true)}). It can't be brought back unless you exported it.</p>
      <div class="form"><label>Type NEW</label><input id="newc" placeholder="NEW"></div>`,
    onOK: () => { if (($("#newc")?.value || "").trim().toUpperCase() === "NEW") newRun(cash); else toast("Type NEW to start over."); }});
  // the typed word is checked on confirm; keep the field usable while the modal is open
  setTimeout(() => $("#newc")?.focus(), 50);
}
async function newRun(cash) {
  if (!(cash >= 1000)) { toast("Starting cash must be at least $1,000."); return; }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  st = await api("new", {cash, seed}); await persist(); ui.tab = "Portfolio"; ui.exp = null; render();
  toast("New run started. Good luck.");
}
function welcome() {
  $("#main").innerHTML = `<div class="card" style="max-width:560px;margin:40px auto"><h3>Welcome to SimQ</h3>
    <p>Practice selling cash-secured puts and covered calls on a market built from <b>real TQQQ history</b>, reshuffled so you can't know what comes next. Every trading day you can act at the open, then move the clock forward.</p>
    <div class="form"><label>Starting cash</label><input id="nc" type="number" value="25000" step="1000"></div>
    <div class="row-btns" style="justify-content:flex-start"><button class="btn primary" id="nr">Start my run</button></div></div>`;
  $("#nr").onclick = () => newRun(+$("#nc").value);
}

/* ---------- render ---------- */
async function render() {
  renderHeader();
  if (!st) return welcome();
  try {
    ({Portfolio: renderPortfolio, Chain: renderChain, Indicators: renderIndicators, History: renderHistory, Performance: renderPerformance, Run: renderRun})[ui.tab]();
  } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
document.addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea")) { if (e.key === "Escape") e.target.blur(); return; }
  if (modal) {
    e.preventDefault();
    if (e.key === "Escape" && $("#mC")) closeModal();
    else if ((e.key === "Enter" || modal.okKeys.includes(e.key.toLowerCase())) && modal.ready && !e.repeat) $("#mOK").click();
    return;
  }
  if (e.key === "Escape") return closeDrawer();
  if (!st || st.ended) return;
  const k = e.key.toLowerCase();
  if (k === "n") requestAdvance("day");
  else if (k === "f") requestAdvance("friday");
  else if (k === "w") requestAdvance("week");
  else if (k === "s") sharesTicket();
  else if (/^[1-6]$/.test(e.key)) { ui.tab = TABS[+e.key - 1]; render(); }
});

async function start() {
  applyTheme();
  let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) {}
  if (saved) { try { st = await api("load", {save: saved}); } catch (e) { toast("Couldn't load your saved run: " + esc(e.message)); } }
  render();
}
start();
