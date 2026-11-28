/* ระบบบัญชีร้านอาหาร (หลายสาขา) — หน้าเว็บ (ไม่ใช้ไลบรารีภายนอก) */
(() => {
"use strict";

/* ===================== utils ===================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = n => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
const fmt0 = n => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const baht = n => "฿" + fmt(n);
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const num = (x, d = 0) => { const n = Number(String(x == null ? "" : x).replace(/,/g, "")); return isFinite(n) ? n : d; };
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MF = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
function thDate(iso, short) { if (!iso) return "-"; const [y, m, d] = iso.split("-").map(Number); return d + " " + TH_M[m - 1] + " " + (short ? String(y + 543).slice(2) : (y + 543)); }
function thMonth(p) { if (!p) return ""; const [y, m] = p.split("-").map(Number); return TH_MF[m - 1] + " " + (y + 543); }
function thDateTime(ms) { if (!ms) return "-"; const d = new Date(ms); return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function monthEnd(p) { const [y, m] = p.split("-").map(Number); return p + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); }
function initials(s) { s = String(s || "").replace(/^สาขา\s*/, "").trim(); return (s[0] || "?").toUpperCase() + (/[A-Za-z]/.test(s[0]) && s[1] ? s[1] : ""); }
function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }
function pct(cur, prev) { if (!prev) return null; return Math.round((cur - prev) / Math.abs(prev) * 1000) / 10; }

// อ่านจำนวนเงินเป็นตัวหนังสือภาษาไทย (สำหรับสลิปเงินเดือน)
function bahtText(n) {
  n = r2(Math.abs(n)); const digits = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"], pos = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
  const read = (s, tail) => { let out = ""; s = String(Number(s)); if (s === "0") return "";
    if (s.length > 6) return read(s.slice(0, -6)) + "ล้าน" + read(s.slice(-6), true);
    const L = s.length; for (let i = 0; i < L; i++) { const d = +s[i], p = L - i - 1; if (!d) continue;
      if (p === 1 && d === 1) out += "สิบ"; else if (p === 1 && d === 2) out += "ยี่สิบ"; else if (p === 0 && d === 1 && (L > 1 || tail)) out += "เอ็ด"; else out += digits[d] + pos[p]; }
    return out; };
  const [b, s] = n.toFixed(2).split(".");
  const bt = read(b), st = read(s);
  if (!bt && !st) return "ศูนย์บาทถ้วน";
  return (bt ? bt + "บาท" : "") + (st && st !== "" && s !== "00" ? st + "สตางค์" : "ถ้วน");
}

/* ===================== icons ===================== */
const IC = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  income: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  expense: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  invest: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  ledger: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M8 7h7M8 11h7"/>',
  stock: '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  payroll: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
  back: '<path d="m15 18-6-6 6-6"/>', menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  clip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/><path d="M17 14h.01"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M12 9.5v5M10 10.5h3a1 1 0 0 1 0 2h-2a1 1 0 0 0 0 2h3"/>',
  report: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  approve: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
  userKey: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 10.5-5.1"/><circle cx="17.5" cy="16.5" r="2.5"/><path d="m19.3 18.3 2.2 2.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
};
const icon = (n, cls) => `<svg class="${cls || ""}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ""}</svg>`;

/* ===================== state & api ===================== */
const S = {
  info: null, adminToken: null, admin: null, adminBranch: null, adminLastAct: Date.now(), adminSettings: null,
  branchTokens: (() => { try { return JSON.parse(sessionStorage.getItem("bt") || "{}"); } catch (e) { return {}; } })(),
  bid: null, binfo: null, lists: null, stockItems: null, emps: null,
  range: { preset: "month", from: today().slice(0, 8) + "01", to: today() }, navOpen: false
};
function saveBT() { try { sessionStorage.setItem("bt", JSON.stringify(S.branchTokens)); } catch (e) {} }
function tokenFor(bid) { return (S.adminToken && S.adminBranch === bid) ? S.adminToken : S.branchTokens[bid]; }

async function api(method, path, body, opts = {}) {
  let token = opts.token;
  if (token === undefined) {
    if (path.startsWith("/api/admin")) token = S.adminToken;
    else { const m = path.match(/^\/api\/b\/([^/]+)/); if (m) token = tokenFor(m[1]); }
  }
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && !opts.noRedirect) {
    if (token && token === S.adminToken) { S.adminToken = null; S.admin = null; S.adminBranch = null; toast("หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบผู้ดูแลอีกครั้ง", "bad"); go("#/admin"); }
    else { const m = path.match(/^\/api\/b\/([^/]+)/); if (m) { delete S.branchTokens[m[1]]; saveBT(); toast("หมดเวลาการใช้งาน กรุณาใส่รหัสสาขาอีกครั้ง", "bad"); go("#/"); } }
  }
  if (!r.ok) { const e = new Error(j.error || ("เกิดข้อผิดพลาด (" + r.status + ")")); e.status = r.status; throw e; }
  if (token && token === S.adminToken) S.adminLastAct = Date.now();
  return j;
}
const bapi = (m, p, b, o) => api(m, "/api/b/" + S.bid + p, b, o);
function go(h) { if (location.hash === h) render(); else location.hash = h; }

/* ===================== ui primitives ===================== */
function toast(msg, kind) {
  const el = document.createElement("div"); el.className = "toast " + (kind || "good"); el.textContent = msg;
  $("#toast-root").appendChild(el); setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2800); setTimeout(() => el.remove(), 3200);
}
function openModal({ title, body, foot, size, onMount, sticky }) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${size || ""}" role="dialog" aria-modal="true"><div class="modal-h"><h3>${title}</h3><button class="x-btn" data-x aria-label="ปิด">${icon("x")}</button></div>
    <div class="modal-b">${body || ""}</div>${foot ? `<div class="modal-f">${foot}</div>` : ""}</div>`;
  $("#modal-root").appendChild(bg);
  const m = { el: bg.firstElementChild, close() { bg.remove(); document.removeEventListener("keydown", onKey); } };
  const onKey = e => { if (e.key === "Escape" && $("#modal-root").lastElementChild === bg) m.close(); };
  document.addEventListener("keydown", onKey);
  $("[data-x]", bg).onclick = () => m.close();
  if (!sticky) bg.addEventListener("mousedown", e => { if (e.target === bg) m.close(); });
  $$("[data-close]", bg).forEach(b => { b.onclick = () => m.close(); });
  if (onMount) onMount(m.el, m);
  const f = $("input:not([type=hidden]):not([readonly]), select, textarea", m.el); if (f && !f.dataset.nofocus) setTimeout(() => f.focus(), 30);
  return m;
}
function confirmBox(msg, { okText = "ยืนยัน", danger = false, title = "ยืนยัน" } = {}) {
  return new Promise(res => {
    const m = openModal({ title, body: `<div style="white-space:pre-line">${msg}</div>`, size: "",
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn ${danger ? "danger solid" : "primary"}" data-ok>${okText}</button>` });
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    $("[data-ok]", m.el).onclick = () => { fin(true); m.close(); };
    const oc = m.close; m.close = () => { fin(false); oc(); };
    $$("[data-close],[data-x]", m.el).forEach(b => { b.onclick = () => m.close(); });
  });
}
async function withBtn(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'; }
  try { return await fn(); } catch (e) { toast(e.message, "bad"); throw e; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.t; } }
}
const pwInput = (name, ph, auto) => `<div class="pw-wrap"><input class="input" type="password" name="${name}" placeholder="${ph || ""}" autocomplete="${auto || "current-password"}"><button type="button" class="pw-eye" tabindex="-1" aria-label="แสดงรหัส">${icon("eye")}</button></div>`;
function bindPwEyes(root) { $$(".pw-eye", root).forEach(b => { b.onclick = () => { const i = b.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; b.innerHTML = icon(i.type === "password" ? "eye" : "eyeOff"); }; }); }
const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(label == null ? v : label)}</option>`;
const emptyBox = (msg, ic) => `<div class="empty">${icon(ic || "inbox")}<div>${msg}</div></div>`;
function formData(root) { const o = {}; $$("[name]", root).forEach(i => { o[i.name] = i.type === "checkbox" ? i.checked : i.value; }); return o; }

function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(c => { const s = String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const PRINT_CSS = `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"IBM Plex Sans Thai","Sarabun",system-ui,sans-serif;color:#18212f;font-size:12.5px;margin:0}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #e5e8ef;text-align:left;vertical-align:top}
th{background:#f4f6fa;font-weight:600;font-size:11.5px;color:#4a5567}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.muted{color:#7b8597}
.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #1f6feb;padding-bottom:10px;margin-bottom:14px}.logo{width:46px;height:46px;object-fit:contain}
tfoot td{font-weight:600;background:#f8fafc}.sig{display:flex;justify-content:space-around;margin-top:46px;text-align:center}.sig div{width:40%;border-top:1px solid #4a5567;padding-top:6px}`;
function printHTML(title, html, extraCss) {
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"; document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open(); d.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet"><style>${PRINT_CSS}${extraCss || ""}</style></head><body>${html}</body></html>`); d.close();
  const go2 = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(() => f.remove(), 60000); };
  const fonts = f.contentWindow.document.fonts;
  setTimeout(() => { if (fonts && fonts.ready) fonts.ready.then(() => setTimeout(go2, 150)); else go2(); }, 400);
}
function fileToB64(file, maxDim) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onerror = () => rej(new Error("อ่านไฟล์ไม่สำเร็จ"));
    rd.onload = () => {
      const url = rd.result;
      if (!/^image\/(png|jpeg|webp)/.test(file.type) || file.size < 900 * 1024) return res({ mime: file.type, data: url.split(",")[1], filename: file.name, url });
      const img = new Image(); img.onload = () => { // ย่อรูปใหญ่ก่อนอัปโหลด (ประหยัดพื้นที่ฐานข้อมูล)
        const sc = Math.min(1, (maxDim || 1800) / Math.max(img.width, img.height)); const c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL("image/jpeg", .85); res({ mime: "image/jpeg", data: out.split(",")[1], filename: file.name.replace(/\.\w+$/, "") + ".jpg", url: out });
      }; img.onerror = () => res({ mime: file.type, data: url.split(",")[1], filename: file.name, url }); img.src = url;
    };
    rd.readAsDataURL(file);
  });
}

/* ===================== รูปภาพ: ลิงก์, ย่อรูป, กล่องรูปโปรไฟล์, หน้าต่างดูรูป (v2.6) ===================== */
const authUrl = (p, bid) => { bid = bid || S.bid; return "/api/b/" + bid + p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(tokenFor(bid) || ""); };
function resizeToDataUrl(file, max, q) {
  max = max || 512; q = q || .82;
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) return rej(new Error("กรุณาเลือกไฟล์รูปภาพ"));
    const rd = new FileReader(); rd.onerror = () => rej(new Error("อ่านไฟล์ไม่สำเร็จ"));
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        let m = max, out = "";
        for (let k = 0; k < 4; k++) {
          const sc = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q); if (out.length < 380000) break; m = Math.round(m * .7);
        }
        res(out);
      };
      img.onerror = () => rej(new Error("เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น"));
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}
/* กล่องเลือกรูป: cur = url รูปเดิม (หรือ "") · คืนค่า get(): undefined = ไม่เปลี่ยน, "" = ลบรูป, dataURL = รูปใหม่ */
const photoBox = (cur, label, round, max) => `<div class="photo-box ${round ? "round" : ""}" data-photobox data-max="${max || 512}">
  <div class="ph" data-ph style="${cur ? `background-image:url('${cur}')` : ""}">${cur ? "" : icon("image", "")}</div>
  <div class="col" style="gap:6px;min-width:0"><div class="bold" style="font-size:13px">${label || "รูปภาพ"}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><label class="btn sm">${icon("upload", "")} ${cur ? "เปลี่ยนรูป" : "เลือกรูป / ถ่ายรูป"}<input type="file" accept="image/*" data-phfile hidden></label>
    <button type="button" class="btn sm ghost danger-t" data-phdel ${cur ? "" : "hidden"}>ลบรูป</button></div>
    <div class="muted" style="font-size:11.5px">ระบบย่อรูปให้อัตโนมัติ</div></div></div>`;
function bindPhotoBox(root) {
  const box = $("[data-photobox]", root); if (!box) return () => undefined;
  let val; const ph = $("[data-ph]", box), del = $("[data-phdel]", box);
  $("[data-phfile]", box).onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { val = await resizeToDataUrl(f, +box.dataset.max || 512); ph.style.backgroundImage = `url('${val}')`; ph.innerHTML = ""; del.hidden = false; }
    catch (er) { toast(er.message, "bad"); }
  };
  del.onclick = () => { val = ""; ph.style.backgroundImage = ""; ph.innerHTML = icon("image", ""); del.hidden = true; };
  ph.onclick = () => { const m = /url\(["']?(.*?)["']?\)/.exec(ph.style.backgroundImage); if (m) lightbox([{ url: m[1] }], 0); };
  return () => val;
}
/* หน้าต่างดูรูปเต็มจอ — items = [{url, name, pdf}] */
function lightbox(items, idx) {
  items = items.filter(x => x && x.url); if (!items.length) return;
  let i = Math.max(0, Math.min(idx || 0, items.length - 1));
  const bg = document.createElement("div"); bg.className = "lightbox";
  const draw = () => {
    const it = items[i];
    bg.innerHTML = `<div class="lb-top"><div class="lb-name">${esc(it.name || "")}${items.length > 1 ? ` <span class="muted">(${i + 1}/${items.length})</span>` : ""}</div>
      <a class="lb-btn" href="${it.url}" target="_blank" rel="noopener" title="เปิดแท็บใหม่">${icon("external", "")}</a><button class="lb-btn" data-lbx aria-label="ปิด">${icon("x", "")}</button></div>
      <div class="lb-stage">${items.length > 1 ? `<button class="lb-nav l" data-lbp aria-label="ก่อนหน้า">‹</button>` : ""}<img src="${it.url}" alt="">${items.length > 1 ? `<button class="lb-nav r" data-lbn aria-label="ถัดไป">›</button>` : ""}</div>`;
    $("[data-lbx]", bg).onclick = close;
    const p = $("[data-lbp]", bg), n = $("[data-lbn]", bg);
    if (p) p.onclick = e => { e.stopPropagation(); i = (i - 1 + items.length) % items.length; draw(); };
    if (n) n.onclick = e => { e.stopPropagation(); i = (i + 1) % items.length; draw(); };
  };
  const onKey = e => { if (e.key === "Escape") close(); else if (e.key === "ArrowLeft" && items.length > 1) { i = (i - 1 + items.length) % items.length; draw(); } else if (e.key === "ArrowRight" && items.length > 1) { i = (i + 1) % items.length; draw(); } };
  function close() { bg.remove(); document.removeEventListener("keydown", onKey, true); }
  bg.addEventListener("click", e => { if (e.target === bg || e.target.classList.contains("lb-stage")) close(); });
  let sx = null; bg.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
  bg.addEventListener("touchend", e => { if (sx == null || items.length < 2) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) { i = (i + (dx < 0 ? 1 : -1) + items.length) % items.length; draw(); } });
  document.addEventListener("keydown", onKey, true);
  draw(); document.body.appendChild(bg);
}
async function viewRecordImages(rid) {
  try { const r = (await bapi("GET", "/records/" + rid)).record; const imgs = (r.files || []).filter(f => /^image/.test(f.mime));
    if (!imgs.length) return toast("ไม่มีรูปแนบ", "bad"); lightbox(imgs.map(f => ({ url: authUrl("/files/" + f.id), name: f.filename })), 0);
  } catch (e) { toast(e.message, "bad"); }
}
const stockPhoto = i => authUrl("/stock/items/" + i.id + "/photo?v=" + i.photoV);
const empPhoto = e => authUrl("/employees/" + e.id + "/photo?v=" + e.photoV);
const empAvatar = e => e.photoV ? `<span class="avatar" style="background-image:url('${empPhoto(e)}')"></span>` : `<span class="avatar ini">${esc(initials(e.nickname || e.name))}</span>`;
/* จุดสีสาขา / โลโก้สาขา */
const bdotH = (b, style) => b && b.logo ? `<div class="branch-dot logo" style="${style}"><img src="${esc(b.logo)}" alt=""></div>` : `<div class="branch-dot" style="${style}">${esc(b.code || initials(b.name))}</div>`;

/* ===================== date range bar ===================== */
const PRESETS = [["today", "วันนี้"], ["7d", "7 วัน"], ["month", "เดือนนี้"], ["lastmonth", "เดือนก่อน"], ["year", "ปีนี้"], ["custom", "กำหนดเอง"]];
function setPreset(p) {
  const t = today(); let from = S.range.from, to = S.range.to;
  if (p === "today") { from = to = t; } else if (p === "7d") { from = addDays(t, -6); to = t; }
  else if (p === "month") { from = t.slice(0, 8) + "01"; to = t; }
  else if (p === "lastmonth") { const d = addDays(t.slice(0, 8) + "01", -1); from = d.slice(0, 8) + "01"; to = d; }
  else if (p === "year") { from = t.slice(0, 4) + "-01-01"; to = t; }
  S.range = { preset: p, from, to };
}
function rangeBar() {
  return `<div class="row wrap rangebar"><div class="seg">${PRESETS.map(([k, l]) => `<button data-preset="${k}" class="${S.range.preset === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="row ${S.range.preset === "custom" ? "" : "hidden"}" data-custom><input type="date" class="input sm" style="width:150px" data-from value="${S.range.from}"><span class="muted">ถึง</span><input type="date" class="input sm" style="width:150px" data-to value="${S.range.to}"></div>
    <span class="muted small" data-rlabel>${S.range.preset === "custom" ? "" : thDate(S.range.from, true) + " – " + thDate(S.range.to, true)}</span></div>`;
}
function bindRange(root, onChange) {
  $$("[data-preset]", root).forEach(b => { b.onclick = () => { setPreset(b.dataset.preset); onChange(); }; });
  const f = $("[data-from]", root), t = $("[data-to]", root);
  if (f) [f, t].forEach(i => { i.onchange = () => { if (f.value && t.value) { S.range = { preset: "custom", from: f.value <= t.value ? f.value : t.value, to: f.value <= t.value ? t.value : f.value }; onChange(); } }; });
}
const rq = () => `from=${S.range.from}&to=${S.range.to}`;

/* ===================== charts ===================== */
function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function shortMoney(v) { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K" : fmt0(v); }
// กราฟแท่งเปรียบเทียบ (กลุ่มละ 2-3 แท่ง) พร้อม tooltip
function barChart(el, data, series, labelFn, tipLabelFn) {
  const W = Math.max(320, el.clientWidth || 640), H = 250, pl = 46, pr = 8, pt = 12, pb = 28;
  const max = niceMax(Math.max(1, ...data.flatMap(d => series.map(s => d[s.k] || 0))));
  const n = data.length, cw = (W - pl - pr) / Math.max(1, n), gap = Math.max(2, Math.min(10, cw * .22));
  const bw = Math.max(2, Math.min(26, (cw - gap) / series.length - 2));
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = y(v); svg += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="axis-t" x="${pl - 8}" y="${yy + 4}" text-anchor="end">${shortMoney(v)}</text>`; }
  const every = Math.ceil(n / Math.max(1, Math.floor((W - pl) / 46)));
  data.forEach((d, i) => {
    const gx = pl + i * cw + (cw - (bw + 2) * series.length + 2) / 2;
    series.forEach((s, j) => { const v = d[s.k] || 0; if (v <= 0) return; const x = gx + j * (bw + 2), yy = y(v), h = Math.max(1, H - pb - yy), rr = Math.min(4, bw / 2, h);
      svg += `<path d="M${x},${H - pb} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${H - pb} Z" fill="${s.color}"/>`; });
    if (i % every === 0) svg += `<text class="axis-t" x="${pl + i * cw + cw / 2}" y="${H - 9}" text-anchor="middle">${esc(labelFn(d, i))}</text>`;
    svg += `<rect data-i="${i}" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent"/>`;
  });
  svg += `<line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="#d3d8e2"/></svg>`;
  el.innerHTML = `<div class="chart">${svg}<div class="tip hidden"></div></div>`;
  const tip = $(".tip", el), ch = $(".chart", el);
  $$("rect[data-i]", el).forEach(r => {
    r.onmouseenter = r.onmousemove = () => { const i = +r.dataset.i, d = data[i]; r.setAttribute("fill", "rgba(31,111,235,.06)");
      tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${esc(tipLabelFn(d))}</div>` + series.map(s => `<div class="tr"><span><i style="background:${s.color}"></i>${s.label}</span><b>${baht(d[s.k] || 0)}</b></div>`).join("");
      tip.classList.remove("hidden"); const bx = ch.getBoundingClientRect(), rb = r.getBoundingClientRect();
      tip.style.left = Math.min(bx.width - 90, Math.max(90, rb.left - bx.left + rb.width / 2)) + "px"; tip.style.top = Math.max(60, 40) + "px"; };
    r.onmouseleave = () => { r.setAttribute("fill", "transparent"); tip.classList.add("hidden"); };
  });
}
function hbars(list, color, limit) {
  if (!list || !list.length) return emptyBox("ยังไม่มีข้อมูลในช่วงนี้");
  const max = Math.max(...list.map(x => x.total), 1), total = list.reduce((a, x) => a + x.total, 0);
  let arr = list.slice(0, limit || 8);
  if (list.length > arr.length) arr.push({ name: "อื่นๆ (" + (list.length - arr.length) + " หมวด)", total: list.slice(arr.length).reduce((a, x) => a + x.total, 0) });
  return arr.map(x => `<div class="hbar" title="${esc(x.name)}: ${baht(x.total)}"><div class="nm">${esc(x.name)}</div><div class="tr"><div class="fl" style="width:${Math.max(1.5, x.total / max * 100)}%;background:${color}"></div></div>
    <div class="v">${baht(x.total)} <span class="muted small">${total ? Math.round(x.total / total * 100) : 0}%</span></div></div>`).join("");
}

/* ===================== shell ===================== */
function shell({ kind, nav, active, title, crumb, headRight }) {
  const app = $("#app");
  const isBranch = kind === "branch";
  const b = isBranch && S.binfo ? S.binfo.branch : null;
  const company = (S.binfo && S.binfo.company) || (S.info && S.info.company) || {};
  const head = isBranch
    ? `<div class="sb-branch">${bdotH(b, `background:${esc(b.color || "#1f6feb")}`)}<div class="grow"><div class="t">${esc(b.name)}</div><div class="s">ระบบบัญชีสาขา</div></div></div><div class="sb-company">${esc(company.name || "")}</div>`
    : `<div class="sb-branch"><div class="branch-dot" style="background:#18212f">${icon("shield")}</div><div class="grow"><div class="t">ผู้ดูแลระบบ</div><div class="s">${esc(S.admin ? S.admin.username : "")}</div></div></div><div class="sb-company">${esc(company.name || "")}</div>`;
  const navHtml = nav.map(n => n.sec ? `<div class="sb-sec">${n.sec}</div>` : `<a class="nav-item ${n.key === active ? "on" : ""}" href="${n.href}">${icon(n.icon)}<span>${n.label}</span>${n.badge ? `<span class="badge">${n.badge}</span>` : ""}</a>`).join("");
  const flag = isBranch && S.adminToken && S.adminBranch === S.bid ? `<div class="admin-flag">${icon("shield", "")}<span>คุณกำลังเปิดบัญชีสาขานี้ในฐานะผู้ดูแลระบบ</span><a href="#/admin/overview" data-backadmin>กลับหน้าผู้ดูแล →</a></div>` : "";
  app.innerHTML = `<div class="shell ${S.navOpen ? "nav-open" : ""}"><div class="scrim" data-scrim></div>
    <aside class="sidebar"><div class="sb-head">${head}</div><nav class="sb-nav">${navHtml}</nav>
      <div class="sb-foot">${isBranch ? `<a class="nav-item" href="#/" data-leave>${icon("logout")}<span>${S.adminToken && S.adminBranch === S.bid ? "ปิดบัญชีสาขานี้" : "ออกจากระบบ"}</span></a>` : `<a class="nav-item" href="#/" data-adminout>${icon("lock")}<span>ออกจากระบบผู้ดูแล</span></a>`}</div></aside>
    <div class="main">${flag}<header class="topbar"><button class="btn ghost icon menu-btn" data-menu aria-label="เมนู">${icon("menu")}</button><div class="grow"><h1>${title}</h1>${crumb ? `<div class="crumb">${crumb}</div>` : ""}</div>${headRight || ""}</header>
      <section class="content" id="content"></section></div></div>`;
  $("[data-menu]").onclick = () => { S.navOpen = !S.navOpen; $(".shell").classList.toggle("nav-open", S.navOpen); };
  $("[data-scrim]").onclick = () => { S.navOpen = false; $(".shell").classList.remove("nav-open"); };
  $$(".nav-item").forEach(a => a.addEventListener("click", () => { S.navOpen = false; }));
  const leave = $("[data-leave]"); if (leave) leave.onclick = e => { e.preventDefault(); leaveBranch(); };
  const ao = $("[data-adminout]"); if (ao) ao.onclick = e => { e.preventDefault(); adminLogout(true); };
  const am = $("[data-adminme]"); if (am) am.onclick = async () => { if (await confirmBox("ออกจากระบบผู้ดูแล (" + esc(S.admin ? S.admin.username : "") + ")?", { okText: "ออกจากระบบ" })) adminLogout(true); };
  const ba = $("[data-backadmin]"); if (ba) ba.onclick = e => { e.preventDefault(); S.adminBranch = null; go("#/admin/overview"); };
  return $("#content");
}

/* ===================== landing & branch login ===================== */
async function renderLanding() {
  const app = $("#app");
  try { S.info = await api("GET", "/api/public/info"); } catch (e) { app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="err-box">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ${esc(e.message)}</div><button class="btn primary" onclick="location.reload()">ลองใหม่</button></div></div>`; return; }
  const c = S.info.company;
  document.title = c.name + " · ระบบบัญชี";
  const card = b => `<button class="branch-card" data-b="${esc(b.id)}">${bdotH(b, `background:${esc(b.color || "#1f6feb")}`)}
      <div><div class="bname">${esc(b.name)}</div><div class="bmeta">${S.branchTokens[b.id] ? `<span class="chip good">เข้าสู่ระบบอยู่</span>` : icon("lock", "") + " ต้องเข้าสู่ระบบ"}</div></div></button>`;
  const bizs = S.info.businesses || [];
  const cards = bizs.length > 1 ? "" : S.info.branches.map(card).join("");
  const grouped = bizs.length > 1 ? bizs.map(z => `<div class="biz-sec"><div class="biz-head">${bizLogo(z, 40)}<div class="bold">${esc(z.name)}</div></div><div class="branch-grid">${S.info.branches.filter(b => b.businessId === z.id).map(card).join("")}</div></div>`).join("") : "";
  app.innerHTML = `<div class="landing"><div class="landing-inner">
    <div class="landing-head"><div class="brand"><div class="brand-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc(initials(c.name))}</div><div><div class="bold" style="font-size:16px">${esc(c.name)}</div><div class="muted small">ระบบบัญชีร้านอาหาร</div></div></div>
      <a class="btn" href="#/admin">${icon("shield")} ผู้ดูแลระบบ (Admin)</a></div>
    <h1>เลือกสาขาเพื่อเข้าสู่ระบบบัญชี</h1><p class="lead">แต่ละสาขามีบัญชี สต็อก และเงินเดือนแยกกัน — เข้าด้วยชื่อผู้ใช้ของคุณ หรือรหัสผ่านสาขา (ผู้จัดการ)</p>
    ${grouped ? grouped : cards ? `<div class="branch-grid">${cards}</div>` : `<div class="empty-hero">${icon("building")}<h3 style="margin:8px 0 4px">ยังไม่มีสาขา</h3><div>เข้าสู่ระบบผู้ดูแล (Admin) เพื่อสร้างสาขาแรกของร้าน</div><div style="margin-top:16px"><a class="btn primary" href="#/admin">${icon("shield")} ไปหน้าผู้ดูแลระบบ</a></div></div>`}
    <div class="footer-note">ข้อมูลทุกสาขาเข้ารหัสผ่าน · รหัสผ่านถูกเก็บแบบเข้ารหัสทางเดียว (scrypt) · เวอร์ชัน ${esc(S.info.build)}</div></div></div>`;
  $$("[data-b]").forEach(btn => { btn.onclick = () => { const b = S.info.branches.find(x => x.id === btn.dataset.b); if (S.branchTokens[b.id]) go("#/b/" + b.id + "/home"); else branchLogin(b); }; });
}
function branchLogin(b) {
  let lastUser = ""; try { lastUser = localStorage.getItem("lastUser") || ""; } catch (e) {}
  const m = openModal({ title: "เข้าสู่ระบบสาขา", size: "", body: `<div class="login-brand">${bdotH(b, `background:${esc(b.color || "#1f6feb")}`)}<div><div class="bold">${esc(b.name)}</div><div class="muted small">ใส่ชื่อผู้ใช้และรหัสผ่านของคุณ</div></div></div>
    <div data-err></div><form data-f class="stack"><label class="field"><span>ชื่อผู้ใช้ (User)</span><input class="input" name="username" value="${esc(lastUser)}" autocomplete="username" autocapitalize="off" placeholder="เว้นว่าง = ใช้รหัสสาขา (ผู้จัดการ)"></label>
    <label class="field"><span>รหัสผ่าน</span>${pwInput("password", "••••••")}</label>
    <div class="field-hint">ผู้จัดการสาขา: เว้นชื่อผู้ใช้ว่าง แล้วใส่ <b>รหัสผ่านสาขา</b> (สิทธิ์เต็ม)</div>
    <button class="btn primary" style="width:100%;height:42px">${icon("lock")} เข้าสู่ระบบ</button></form>` });
  bindPwEyes(m.el);
  if (lastUser) setTimeout(() => $("[name=password]", m.el).focus(), 40);
  $("[data-f]", m.el).onsubmit = async e => {
    e.preventDefault(); const btn = $("button.primary", m.el); const f = formData(m.el);
    try { await withBtn(btn, async () => {
      const r = await api("POST", "/api/branch/login", { branchId: b.id, username: f.username.trim(), password: f.password }, { noRedirect: true });
      try { localStorage.setItem("lastUser", f.username.trim()); } catch (e2) {}
      S.branchTokens[b.id] = r.token; saveBT(); S._lastPw = r.mustChange ? f.password : null; S.bid = null; S.binfo = null; m.close(); go("#/b/" + b.id + "/home");
    }); } catch (err) { $("[data-err]", m.el).innerHTML = `<div class="err-box">${esc(err.message)}</div>`; $("[name=password]", m.el).select(); }
  };
}
// ผู้ใช้เข้าครั้งแรก / ถูกรีเซ็ตรหัส → ต้องตั้งรหัสใหม่ก่อนใช้งาน
function userForceChange(bid) {
  const app = $("#app");
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:440px"><div class="auth-icon">${icon("key")}</div><h2>ตั้งรหัสผ่านใหม่ก่อนใช้งาน</h2><p>สวัสดี ${esc(S.binfo.me.name)} — เพื่อความปลอดภัย กรุณาตั้งรหัสผ่านของคุณเอง</p><div data-err></div>
    <form data-f class="stack">${S._lastPw ? "" : `<label class="field"><span>รหัสผ่านปัจจุบัน (ที่ได้รับจากผู้ดูแล)</span>${pwInput("oldPassword", "", "current-password")}</label>`}
    <label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</span>${pwInput("newPassword", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่านใหม่</span>${pwInput("confirm", "", "new-password")}</label>
    <button class="btn primary">${icon("check")} บันทึกและเข้าใช้งาน</button></form><div style="text-align:center;margin-top:16px"><a href="#/" class="small" data-out>← ออก</a></div></div></div>`;
  bindPwEyes(app);
  $("[data-out]", app).onclick = e => { e.preventDefault(); leaveBranch(); };
  $("[data-f]", app).onsubmit = async e => { e.preventDefault(); const f = formData(app); const btn = $("button.primary", app);
    if (f.newPassword !== f.confirm) { $("[data-err]", app).innerHTML = `<div class="err-box">ยืนยันรหัสผ่านไม่ตรงกัน</div>`; return; }
    try { await withBtn(btn, async () => { await api("POST", "/api/user/change-password", { oldPassword: S._lastPw || f.oldPassword, newPassword: f.newPassword }, { token: tokenFor(bid) });
      S._lastPw = null; S.binfo = null; S.bid = null; toast("ตั้งรหัสผ่านใหม่แล้ว"); go("#/b/" + bid + "/home"); }); }
    catch (err) { $("[data-err]", app).innerHTML = `<div class="err-box">${esc(err.message)}</div>`; } };
}
/* ===== บัญชีของฉัน: รูปโปรไฟล์ + ออกจากระบบ (v2.8) ===== */
const meAvatar = (me, b, big) => { const src = me.photo || (me.kind !== "user" && b && b.logo) || "";
  return src ? `<div class="av ${big ? "big" : ""} img" style="background-image:url('${esc(src)}')"></div>` : `<div class="av ${big ? "big" : ""}" style="${b && b.color ? "background:" + esc(b.color) : ""}">${esc(initials(me.name))}</div>`; };
function meMenu() {
  const me = S.binfo.me, b = S.binfo.branch, asAdmin = S.adminToken && S.adminBranch === S.bid;
  const role = me.kind === "user" ? "ผู้ใช้: " + esc(me.username) : asAdmin ? "ผู้ดูแลระบบ" : "ผู้จัดการ (รหัสสาขา)";
  const m = openModal({ title: "บัญชีของฉัน", body: `<div class="me-card"><div data-meav>${meAvatar(me, b, true)}</div><div class="me-name">${esc(me.name)}</div><div class="muted">${role}</div><div class="muted small">${esc(b.name)}</div></div>
    ${me.canPhoto ? `<div style="margin-top:14px">${photoBox(me.photo || "", "รูปโปรไฟล์ของฉัน", true, 400)}</div><button class="btn" data-mesave style="width:100%;margin-top:8px" hidden>${icon("check")} บันทึกรูปโปรไฟล์</button>`
      : `<div class="muted small" style="text-align:center;margin-top:10px">${asAdmin ? "" : "รูปที่แสดงคือโลโก้สาขา — เปลี่ยนได้ที่ Admin → จัดการสาขา"}</div>`}
    <button class="btn danger me-out" data-meout>${icon("logout")} ${asAdmin ? "ปิดบัญชีสาขานี้ (กลับหน้าผู้ดูแล)" : "ออกจากระบบ"}</button>`, foot: `<button class="btn" data-close>ปิด</button>` });
  if (me.canPhoto) { const get = bindPhotoBox(m.el), sv = $("[data-mesave]", m.el);
    $("[data-phfile]", m.el).addEventListener("change", () => setTimeout(() => { sv.hidden = false; }, 300)); $("[data-phdel]", m.el).addEventListener("click", () => { sv.hidden = false; });
    sv.onclick = () => withBtn(sv, async () => { const v = get(); if (v === undefined) return; await api("POST", "/api/user/photo", { photo: v }, { token: tokenFor(S.bid) }); me.photo = v; toast("บันทึกรูปโปรไฟล์แล้ว"); m.close(); render(); }).catch(() => {}); }
  $("[data-meout]", m.el).onclick = () => { m.close(); leaveBranch(); };
}
async function leaveBranch() {
  const bid = S.bid;
  if (S.adminToken && S.adminBranch === bid) { S.adminBranch = null; go("#/admin/overview"); return; }
  const t = S.branchTokens[bid]; delete S.branchTokens[bid]; saveBT();
  if (t) api("POST", "/api/logout", null, { token: t, noRedirect: true }).catch(() => {});
  S.binfo = null; S.bid = null; go("#/");
}

/* ===================== branch area ===================== */
const TYPE = {
  income: { th: "รายรับ", new: "บันทึกรายรับ", party: "ลูกค้า / ที่มา", cat: "income_category", icon: "income", color: "var(--income)", chip: "t-income", doc: "ใบสำคัญรับ" },
  expense: { th: "รายจ่าย", new: "บันทึกรายจ่าย", party: "ผู้ขาย / ร้านค้า", cat: "expense_category", icon: "expense", color: "var(--expense)", chip: "t-expense", doc: "ใบสำคัญจ่าย" },
  invest: { th: "สินทรัพย์ / งบลงทุน", new: "บันทึกสินทรัพย์", party: "ผู้ขาย / ร้านค้า", cat: "invest_category", icon: "invest", color: "var(--invest)", chip: "t-invest", doc: "ใบสำคัญจ่าย (สินทรัพย์)" }
};
function branchNav() {
  const b = "#/b/" + S.bid + "/";
  const all = [{ key: "dashboard", label: "ภาพรวม", icon: "dashboard" },
    { key: "approvals", label: "รออนุมัติ", icon: "approve", show: anyApprover(), badge: S.pending && S.pending.total },
    { sec: "บัญชี" }, { key: "income", label: "รายรับ", icon: "income" }, { key: "expense", label: "รายจ่าย", icon: "expense" },
    { key: "invest", label: "สินทรัพย์ / งบลงทุน", icon: "invest" }, { key: "ledger", label: "สมุดบัญชี / รายงาน", icon: "ledger" },
    { key: "accounts", label: "เงินในบัญชี / ยอดคงเหลือ", icon: "wallet" }, { key: "statements", label: "งบการเงิน (P&L / BS)", icon: "report" },
    { sec: "POS ขายหน้าร้าน", show: posOn() }, { key: "pos", label: "ขายหน้าร้าน", icon: "cash", show: posOn() && canView("pos") }, { key: "posorders", label: "ออเดอร์ / คิว", icon: "list", show: posOn() && canView("pos") },
    { key: "posmenu", label: "เมนู & ตั้งค่า POS", icon: "settings", show: posOn() && canView("pos_admin") }, { key: "posreport", label: "รายงานขาย POS", icon: "report", show: posOn() && canView("pos_admin") },
    { sec: "สต็อก" }, { key: "stock", label: "สต็อกสินค้า", icon: "stock", badge: approver("stock") && S.pending && S.pending.stock },
    { sec: "บุคลากร" }, { key: "employees", label: "พนักงาน", icon: "users" }, { key: "payroll", label: "เงินเดือน & สลิป", icon: "payroll" },
    { key: "leave", label: "ขาด-ลา", icon: "calendar", badge: approver("leave") && S.pending && S.pending.leave },
    { key: "advance", label: "เบิกเงินล่วงหน้า", icon: "cash", badge: approver("advance") && S.pending && S.pending.advance },
    { key: "attendance", label: "ลงเวลา / เช็คอิน", icon: "clock" },
    { sec: "บัตรเครดิต" }, { key: "cards", label: "บัตรเครดิต & ผ่อนชำระ", icon: "wallet", badge: S.pending && S.pending.cards },
    { sec: "ตั้งค่า" }, { key: "settings", label: "หมวด & ช่องทาง", icon: "settings" }, { key: "log", label: "Log การใช้งาน", icon: "history" },
    { key: "password", label: S.binfo && S.binfo.me.kind === "user" ? "เปลี่ยนรหัสผ่านของฉัน" : "เปลี่ยนรหัสผ่านสาขา", icon: "key", show: true }];
  const vis = all.filter(n => (n.sec && n.show !== false) || (!n.sec && (n.show !== undefined ? n.show : canView(n.key)))).map(n => n.sec ? n : { ...n, href: b + n.key });
  return vis.filter((n, i) => !n.sec || (vis[i + 1] && !vis[i + 1].sec)); // ซ่อนหัวข้อที่ไม่มีเมนู
}
const BRANCH_PAGES = {};
const posOn = () => !!(S.binfo && S.binfo.posEnabled);
const POS_PAGE_PERM = { pos: "pos", posorders: "pos", posmenu: "pos_admin", posreport: "pos_admin" };
const pageAllowed = p => p === "password" || (p === "approvals" ? anyApprover() : POS_PAGE_PERM[p] ? posOn() && canView(POS_PAGE_PERM[p]) : canView(p));
async function refreshPending() { try { S.pending = anyApprover() || canView("cards") ? await bapi("GET", "/approvals/count") : null; } catch (e) { S.pending = null; } }
async function renderBranch(bid, page, rest) {
  if (!tokenFor(bid)) { S.info = S.info || await api("GET", "/api/public/info").catch(() => null); go("#/"); const b = S.info && S.info.branches.find(x => x.id === bid); if (b) setTimeout(() => branchLogin(b), 60); return; }
  if (S.bid !== bid || !S.binfo) {
    S.bid = bid; S.binfo = null; S.lists = null; S.stockItems = null; S.emps = null;
    try { S.binfo = await bapi("GET", "/info"); if (!S.binfo.me.mustChange) S.lists = (await bapi("GET", "/lists")).lists; } catch (e) { if (e.status !== 401) $("#app").innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="err-box">${esc(e.message)}</div><a class="btn" href="#/">กลับหน้าแรก</a></div></div>`; return; }
  }
  if (S.binfo.me.mustChange) return userForceChange(bid);
  if (page === "home" || !BRANCH_PAGES[page] || !pageAllowed(page)) {
    const first = branchNav().find(n => !n.sec && n.key !== "password" && BRANCH_PAGES[n.key]);
    if (page !== "home" && BRANCH_PAGES[page]) toast("คุณไม่มีสิทธิ์เข้าเมนูนี้", "bad");
    location.replace("#/b/" + bid + "/" + (first ? first.key : "password")); return;
  }
  await refreshPending();
  document.title = S.binfo.branch.name + " · ระบบบัญชี";
  const P = BRANCH_PAGES[page];
  const me = S.binfo.me;
  const c = shell({ kind: "branch", nav: branchNav(), active: P.nav || page, title: P.title(rest), crumb: S.binfo.branch.name,
    headRight: `<button class="user-chip" data-me title="บัญชีของฉัน / ออกจากระบบ">${meAvatar(me, S.binfo.branch)}<span>${esc(me.name)}</span>${icon("chevron-down", "")}</button>` });
  const meBtn = $("[data-me]"); if (meBtn) meBtn.onclick = () => meMenu();
  try { await P.render(c, rest); } catch (e) { if (e.status !== 401) c.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}
async function loadStockItems(force) { if (!S.stockItems || force) S.stockItems = (await bapi("GET", "/stock/items")).items; return S.stockItems; }
const listNames = k => (S.lists && S.lists[k] ? S.lists[k].map(x => x.name) : []);
const isCreditChannel = n => !!(S.lists && S.lists.payment_channel.find(x => x.name === n && x.isCredit));
// สิทธิ์ของผู้ใช้ในสาขาปัจจุบัน (เซิร์ฟเวอร์ตรวจซ้ำทุก API)
const LVL = { none: 0, view: 1, edit: 2 };
const permOf = m => (S.binfo && S.binfo.perms && S.binfo.perms[m]) || "none";
const canView = m => (Array.isArray(m) ? m : [m]).some(x => LVL[permOf(x)] >= 1);
const canEdit = m => (Array.isArray(m) ? m : [m]).some(x => LVL[permOf(x)] >= 2);
const approver = k => !!(S.binfo && S.binfo.approve && S.binfo.approve[k]);
const anyApprover = () => approver("stock") || approver("leave") || approver("advance");

/* ---------- dashboard ---------- */
BRANCH_PAGES.dashboard = { title: () => "ภาพรวม", async render(c) {
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ภาพรวมธุรกิจ</h2><div class="muted small">สรุปรายรับ รายจ่าย และกำไรของสาขา</div></div>${rangeBar()}</div><div data-body><div class="boot" style="height:300px"><div class="spinner"></div></div></div>`;
  bindRange(c, () => BRANCH_PAGES.dashboard.render(c));
  const s = await bapi("GET", "/summary?" + rq());
  const t = s.totals, p = s.previous;
  const dl = (cur, prev, goodUp) => { const v = pct(cur, prev); if (v === null) return `<span class="muted">ไม่มีข้อมูลช่วงก่อนหน้า</span>`; const up = v >= 0; return `<span class="delta ${(up === goodUp) ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(v)}%</span><span>จากช่วงก่อนหน้า</span>`; };
  const dueIn = s.due.filter(d => d.type === "income"), dueOut = s.due.filter(d => d.type !== "income");
  const tdy = today();
  const dueRow = d => { const late = d.dueDate < tdy; return `<div class="list-row click" data-open="${d.id}" data-type="${d.type}" style="cursor:pointer"><div class="grow"><div class="bold">${esc(d.party || d.description || d.docNo)}</div><div class="muted small">${esc(d.docNo)} · ${esc(d.paymentChannel)}</div></div>
    <div style="text-align:right"><div class="bold num">${baht(d.total)}</div><span class="chip ${late ? "bad" : "warn"}">${late ? "เลยกำหนด" : "ครบ"} ${thDate(d.dueDate, true)}</span></div></div>`; };
  $("[data-body]", c).innerHTML = `
    <div class="kpis">
      <div class="card kpi"><div class="lbl"><i style="background:var(--income)"></i>รายรับ</div><div class="val">${baht(t.income)}</div><div class="sub">${dl(t.income, p.income, true)}</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--expense)"></i>รายจ่าย</div><div class="val">${baht(t.expense)}</div><div class="sub">${dl(t.expense, p.expense, false)}</div></div>
      <div class="card kpi click" data-netinfo title="ดูวิธีคิด"><div class="lbl"><i style="background:${t.net >= 0 ? "var(--good)" : "var(--bad)"}"></i>กำไร (ขาดทุน) สุทธิ <span class="muted small">รวมสต็อก ⓘ</span></div><div class="val ${t.net < 0 ? "neg" : ""}">${baht(t.net)}</div><div class="sub"><span>รับ−จ่าย ${baht(t.cashNet)}</span><span>· สต็อก ${t.stockAdj >= 0 ? "+" : ""}${baht(t.stockAdj)}</span><span>· อัตรากำไร ${t.margin}%</span>${t.stockPending ? `<span class="warn-t">· สต็อกรออนุมัติ ${t.stockPending} (ยังไม่นับ)</span>` : ""}</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--invest)"></i>สินทรัพย์ / งบลงทุน</div><div class="val">${baht(t.invest)}</div><div class="sub"><span>มูลค่าสต็อกคงเหลือ ${baht(s.stock.value)}</span></div></div>
    </div>
    ${moneyFlowCard(s)}
    ${s.cardBills && s.cardBills.length ? `<div class="card" style="margin-bottom:14px;border-color:#f5c2bd"><div class="card-h"><h3 class="grow">${icon("wallet", "").replace("<svg", '<svg style="width:17px;height:17px;vertical-align:-3px"')} บัตรเครดิต / งวดผ่อน ที่ต้องชำระ (ภายใน 7 วัน / เลยกำหนด)</h3><a class="btn sm primary" href="#/b/${S.bid}/cards">ไปชำระบิล</a></div>
      <div class="card-b flush">${s.cardBills.map(b => `<div class="list-row"><div class="grow"><div class="bold">${esc(b.card)}</div><div class="muted small">${b.count} รายการ</div></div><span class="chip ${b.overdue ? "bad" : "warn"}">${b.overdue ? "เลยกำหนด" : "ครบ"} ${thDate(b.dueDate, true)}</span><b class="num">${baht(b.total)}</b></div>`).join("")}</div></div>` : ""}
    ${avgCard(s)}
    ${channelCard(s)}
    <div class="dash-grid">
      <div class="card"><div class="card-h"><h3 class="grow">รายรับ – รายจ่าย ${s.group === "month" ? "รายเดือน" : "รายวัน"}</h3><div class="legend"><span><i style="background:#257de0"></i>รายรับ</span><span><i style="background:#f47230"></i>รายจ่าย</span></div></div><div class="card-b" data-chart></div></div>
      <div class="card"><div class="card-h"><h3 class="grow">ค้างรับ / ค้างจ่าย</h3><span class="muted small">ทุกช่วงเวลา</span></div>
        <div class="card-b flush" style="max-height:330px;overflow:auto">
          ${!s.due.length ? emptyBox("ไม่มีรายการค้างชำระ", "check") : ""}
          ${dueIn.length ? `<div class="sb-sec" style="padding:10px 18px 4px">ค้างรับ ${baht(dueIn.reduce((a, d) => a + d.total, 0))}</div>${dueIn.map(dueRow).join("")}` : ""}
          ${dueOut.length ? `<div class="sb-sec" style="padding:10px 18px 4px">ค้างจ่าย ${baht(dueOut.reduce((a, d) => a + d.total, 0))}</div>${dueOut.map(dueRow).join("")}` : ""}
        </div></div>
    </div>
    <div class="dash-grid even">
      <div class="card"><div class="card-h"><h3 class="grow">รายจ่ายตามหมวด</h3></div><div class="card-b">${hbars(s.expenseByCategory, "#f47230")}</div></div>
      <div class="card"><div class="card-h"><h3 class="grow">รายรับตามหมวด</h3></div><div class="card-b">${hbars(s.incomeByCategory, "#257de0")}</div></div>
    </div>
    <div class="dash-grid even">
      <div class="card"><div class="card-h"><h3 class="grow">สต็อกใกล้หมด</h3><a class="btn sm" href="#/b/${S.bid}/stock">ดูสต็อก</a></div><div class="card-b flush">
        ${s.stock.lowItems.length ? s.stock.lowItems.map(i => `<div class="list-row"><div class="grow bold">${esc(i.name)}</div><span class="chip ${i.qty <= 0 ? "bad" : "warn"}">เหลือ ${fmtQ(i.qty)} ${esc(i.unit)}</span><span class="muted small">จุดสั่งซื้อ ${fmtQ(i.minQty)}</span></div>`).join("") : emptyBox(s.stock.items ? "สต็อกทุกรายการยังเพียงพอ" : "ยังไม่มีสินค้าในสต็อก", "stock")}</div></div>
      <div class="card"><div class="card-h"><h3 class="grow">เอกสารล่าสุด</h3></div><div class="card-b flush">
        ${s.recent.length ? s.recent.map(r => `<div class="list-row" data-open="${r.id}" data-type="${r.type}" style="cursor:pointer"><span class="chip ${TYPE[r.type].chip} plain">${TYPE[r.type].th.split(" ")[0]}</span><div class="grow"><div class="desc bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.party || r.description)}</div><div class="muted small">${esc(r.docNo)} · ${thDate(r.date, true)}</div></div><div class="bold num">${baht(r.total)}</div></div>`).join("") : emptyBox("ยังไม่มีเอกสาร — เริ่มจากบันทึกรายรับหรือรายจ่าย", "file")}</div></div>
    </div>`;
  const chartEl = $("[data-chart]", c);
  const lab = d => s.group === "month" ? TH_M[+d.key.slice(5, 7) - 1] : String(+d.key.slice(8, 10));
  barChart(chartEl, s.series, [{ k: "income", label: "รายรับ", color: "#257de0" }, { k: "expense", label: "รายจ่าย", color: "#f47230" }], lab, d => s.group === "month" ? thMonth(d.key) : thDate(d.key));
  $$("[data-open]", c).forEach(el => { el.onclick = () => openDoc(el.dataset.type, el.dataset.open, () => BRANCH_PAGES.dashboard.render(c)); });
  const ni = $("[data-netinfo]", c); if (ni) ni.onclick = () => { const t = s.totals; openModal({ title: "กำไรสุทธิ (รวมสต็อก) คิดอย่างไร", body: `<table class="tbl"><tbody>
    <tr><td>รายรับ</td><td class="num">${fmt(t.income)}</td></tr><tr><td>หัก รายจ่าย</td><td class="num">(${fmt(t.expense)})</td></tr>
    <tr class="bold"><td>รับ − จ่าย</td><td class="num">${fmt(t.cashNet)}</td></tr>
    <tr><td>บวก สต็อกปลายงวด (อนุมัติแล้ว)</td><td class="num">${fmt(t.stockEnd)}</td></tr><tr><td>หัก สต็อกต้นงวด</td><td class="num">(${fmt(t.stockBegin)})</td></tr>
    ${t.stockOther ? `<tr><td>หัก ของที่รับเข้าเองไม่ผ่านรายจ่าย <div class="muted small">ยอดยกมา / รับโยกจากสาขาอื่น — ไม่ใช่กำไร</div></td><td class="num">(${fmt(t.stockOther)})</td></tr>` : ""}
    <tr class="bold"><td>ปรับสต็อก</td><td class="num">${t.stockAdj >= 0 ? "+" : ""}${fmt(t.stockAdj)}</td></tr>
    <tr class="bold" style="font-size:16px"><td>กำไร (ขาดทุน) สุทธิ</td><td class="num ${t.net < 0 ? "neg" : "pos"}">${fmt(t.net)}</td></tr></tbody></table>
    <div class="info-box" style="margin-top:12px">ซื้อวัตถุดิบมาแล้วยังไม่ได้ใช้ ยังไม่ใช่ต้นทุน — ระบบจึงบวกของที่เหลือในสต็อกกลับเข้ากำไร · นับเฉพาะรายการสต็อกที่ <b>อนุมัติแล้ว</b>${t.stockPending ? ` · ตอนนี้มีรายการรออนุมัติ <b>${t.stockPending}</b> รายการ (ยังไม่นับ)` : ""}</div>`, foot: `<button class="btn primary" data-close>เข้าใจแล้ว</button>` }); };
} };

// เงินเข้า-ออกแต่ละบัญชี: ยอดต้นงวด + รับเข้า − จ่ายออก = คงเหลือ
function moneyFlowCard(s) {
  const A = (s.accounts || []).filter(a => a.count || a.openingBalance != null || a.endBalance);
  if (!A.length) return "";
  const sum = k => A.reduce((x, a) => x + (a[k] || 0), 0);
  const maxFlow = Math.max(1, ...A.map(a => Math.max(a.periodIn, a.periodOut)));
  const today_ = today(), endLbl = s.to === today_ ? "คงเหลือ ณ วันนี้" : s.to > today_ ? "คงเหลือ ณ " + thDate(s.to, true) + " (รวมรายการล่วงหน้า)" : "คงเหลือ ณ " + thDate(s.to, true);
  const bar = (v, cls) => `<div class="mf-bar"><div class="${cls}" style="width:${Math.max(v ? 3 : 0, v / maxFlow * 100)}%"></div></div>`;
  const tile = a => { const end = a.endBalance, start = r2(a.startBalance + a.periodOpening), net = r2(a.periodIn - a.periodOut);
    return `<a class="mf-card ${/สด/.test(a.name) ? "cash" : "bank"}" href="#/b/${S.bid}/accounts">
      <div class="mf-head"><div class="mf-ic">${icon(/สด/.test(a.name) ? "payroll" : "building")}</div><div class="grow"><div class="bold">${esc(a.name)}</div><div class="small muted">${a.openingBalance == null ? `<span style="color:var(--warn)">ยังไม่ได้ตั้งยอดยกมา</span>` : (a.countIn + a.countOut) + " รายการในช่วงนี้"}</div></div></div>
      <div class="mf-line muted"><span>ยอดต้นงวด</span><b class="num">${fmt(start)}</b></div>
      <div class="mf-line in"><span>${icon("income")} รับเข้า</span><b class="num">+${fmt(a.periodIn)}</b></div>${bar(a.periodIn, "in")}
      ${a.inTransfer ? `<div class="mf-sub">รวมรับโอนจากบัญชีอื่น ${fmt(a.inTransfer)}</div>` : ""}
      <div class="mf-line out"><span>${icon("expense")} จ่ายออก</span><b class="num">−${fmt(a.periodOut)}</b></div>${bar(a.periodOut, "out")}
      ${a.outTransfer ? `<div class="mf-sub">รวมโอนไปบัญชีอื่น ${fmt(a.outTransfer)}</div>` : ""}
      <div class="mf-net ${net < 0 ? "neg" : "pos"}">${net < 0 ? "▼ ใช้มากกว่ารับ" : "▲ รับมากกว่าใช้"} ${fmt(Math.abs(net))}</div>
      <div class="mf-end ${end < 0 ? "negbg" : ""}"><span>${endLbl}</span><b class="num">${baht(end)}</b></div></a>`; };
  return `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">เงินเข้า-ออกแต่ละบัญชี</h3><span class="muted small">${thDate(s.from, true)} – ${thDate(s.to, true)}</span><a class="btn sm" href="#/b/${S.bid}/accounts">รายการเดินบัญชี</a></div>
    <div class="card-b"><div class="mf-total"><div><div class="l">ยอดต้นงวด (ทุกบัญชี)</div><div class="v">${baht(sum("startBalance") + sum("periodOpening"))}</div></div><div class="op">+</div>
      <div class="in"><div class="l">รับเข้า</div><div class="v">${baht(sum("periodIn"))}</div></div><div class="op">−</div>
      <div class="out"><div class="l">จ่ายออก</div><div class="v">${baht(sum("periodOut"))}</div></div><div class="op">=</div>
      <div class="end"><div class="l">${endLbl} (ทุกบัญชี)</div><div class="v">${baht(sum("endBalance"))}</div></div></div>
    <div class="mf-grid">${A.map(tile).join("")}</div>
    <div class="field-hint" style="margin-top:10px">นับตามวันที่เงินเข้า-ออกจริง (รายการที่ค้างจะนับตอนกดชำระ) · รายการบัตรเครดิต/ค้างชำระยังไม่ตัดเงินจนกว่าจะชำระ · โอนระหว่างบัญชีรวมอยู่ในรับเข้า/จ่ายออกของแต่ละบัญชี แต่ไม่กระทบยอดรวมทุกบัญชี</div></div></div>`;
}
// รายได้เฉลี่ย (แบบเดียวกับ POS)
function avgCard(s) {
  const a = s.averages; if (!a) return "";
  const wmax = Math.max(1, ...a.byWeekday.map(w => w.avgPerIncomeDay));
  const kp = (l, v, sub, cls) => `<div class="mini-kpi"><div class="l">${l}</div><div class="v ${cls || ""}">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div>`;
  return `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">รายได้เฉลี่ย</h3><span class="muted small">${a.partial ? "ช่วงนี้ยังไม่จบ — นับถึงวันนี้ " + thDate(a.countedTo, true) + " · " : ""}${a.calendarDays} วันตามปฏิทิน · มีรายรับ ${a.incomeDays} วัน</span></div>
    <div class="card-b"><div class="avg-grid">
      ${kp("เฉลี่ยต่อวันที่มีรายรับ", baht(a.perIncomeDay), "รายรับ ÷ " + a.incomeDays + " วันที่มีรายรับ")}
      ${kp("เฉลี่ยต่อวัน (ตามปฏิทิน)", baht(a.perCalendarDay), "รายรับ ÷ " + a.calendarDays + " วัน")}
      ${kp("ค่าใช้จ่ายเฉลี่ยต่อวัน", baht(a.expensePerDay), "รายจ่าย ÷ " + a.calendarDays + " วัน")}
      ${kp("กำไรเฉลี่ยต่อวัน", baht(a.profitPerDay), "", a.profitPerDay < 0 ? "neg" : "")}
      ${kp("ยอดเฉลี่ยต่อเอกสารรายรับ", baht(a.perIncomeDoc), a.incomeDocs + " เอกสาร")}
      ${kp("วันที่รายรับสูงสุด", a.best ? baht(a.best.total) : "-", a.best ? thDate(a.best.date) + " (" + wdName(a.best.date) + ")" : "")}
      ${kp("วันที่รายรับต่ำสุด", a.worst ? baht(a.worst.total) : "-", a.worst ? thDate(a.worst.date) + " (" + wdName(a.worst.date) + ")" : "")}
    </div>
    <div class="section-t" style="margin-top:16px">ค่าเฉลี่ยแยกตามวันในสัปดาห์</div>
    <div class="tbl-wrap"><table class="tbl wd-tbl"><thead><tr><th>วัน</th><th style="width:40%"></th><th class="num">เฉลี่ย/วันที่มีรายรับ</th><th class="num">เฉลี่ย/วันตามปฏิทิน</th><th class="num">วันที่มีรายรับ</th><th class="num">รวม</th></tr></thead><tbody>
      ${a.byWeekday.map(w => `<tr><td class="bold">${w.name}</td><td><div class="hbar" style="grid-template-columns:1fr;padding:0"><div class="tr"><div class="fl" style="width:${Math.max(w.avgPerIncomeDay ? 2 : 0, w.avgPerIncomeDay / wmax * 100)}%;background:#257de0"></div></div></div></td>
        <td class="num bold">${fmt(w.avgPerIncomeDay)}</td><td class="num">${fmt(w.avgPerCalDay)}</td><td class="num muted">${w.incomeDays} / ${w.calDays}</td><td class="num">${fmt(w.total)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
}
const wdName = iso => ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"][new Date(iso + "T00:00:00Z").getUTCDay()];
// สรุปแยกตามช่องทางรับ/ชำระเงิน
function channelCard(s) {
  const ch = s.channels || []; if (!ch.length) return "";
  const G = { cash: ["ช่องทางรับ-จ่ายเงินจริง", ""], credit: ["ช่องทางเครดิต (ยังไม่ตัดเงินจริง — รอชำระ)", "warn"], unsettled: ["ยังค้าง / ยังไม่ระบุช่องทาง", "bad"] };
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  let body = "";
  ["cash", "credit", "unsettled"].forEach(g => { const rows = ch.filter(x => x.group === g); if (!rows.length) return;
    body += `<tr class="grp"><td colspan="5"><span class="chip ${G[g][1] || "blue"} plain">${G[g][0]}</span></td></tr>` + rows.map(x => `<tr><td style="padding-left:24px">${esc(x.name)}<div class="muted small">${x.incomeCount ? x.incomeCount + " รับ" : ""}${x.incomeCount && x.outCount ? " · " : ""}${x.outCount ? x.outCount + " จ่าย" : ""}</div></td>
      <td class="num pos">${x.income ? fmt(x.income) : "-"}</td><td class="num neg">${x.out ? fmt(x.out) : "-"}</td><td class="num bold ${x.net < 0 ? "neg" : ""}">${fmt(x.net)}</td><td class="num muted">${x.count}</td></tr>`).join("")
      + (rows.length > 1 ? `<tr class="sub"><td style="padding-left:24px">รวม${G[g][0].split(" (")[0]}</td><td class="num">${fmt(sum(rows, "income"))}</td><td class="num">${fmt(sum(rows, "out"))}</td><td class="num">${fmt(sum(rows, "net"))}</td><td></td></tr>` : ""); });
  return `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">สรุปตามช่องทางรับ / ชำระเงิน</h3><span class="muted small">จากเอกสารในช่วงที่เลือก · จ่าย = รายจ่าย + สินทรัพย์</span></div>
    <div class="tbl-wrap"><table class="tbl ch-tbl"><thead><tr><th>ช่องทาง</th><th class="num">รับเงิน</th><th class="num">จ่ายเงิน</th><th class="num">สุทธิ</th><th class="num">เอกสาร</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td>รวมทั้งหมด</td><td class="num">${fmt(sum(ch, "income"))}</td><td class="num">${fmt(sum(ch, "out"))}</td><td class="num">${fmt(sum(ch, "net"))}</td><td class="num">${sum(ch, "count")}</td></tr></tfoot></table></div>
    <div class="field-hint" style="padding:8px 18px 14px">เอกสารที่ค้างแล้วกด “ชำระแล้ว” จะนับในบัญชีที่ใช้ชำระจริง · ช่องทางเครดิต (เช่น บัตรเครดิต แอปเดลิเวอรี่รอโอน) และรายการค้าง แยกไว้ด้านล่างเพราะเงินยังไม่เข้า/ออกจริง</div></div>`;
}

/* ---------- document list (income / expense / invest) ---------- */
function docListPage(type) {
  return { title: () => TYPE[type].th, nav: type, state: { q: "", status: "all" }, async render(c) {
    const T = TYPE[type], st = this.state, self = this;
    c.innerHTML = `<div class="page-head"><div class="grow"><h2>${T.th}</h2>${canEdit(type) ? "" : `<div class="muted small">ดูอย่างเดียว</div>`}</div>${rangeBar()}${canEdit(type) ? `<button class="btn primary" data-new>${icon("plus")} ${T.new}</button>` : ""}</div>
      <div class="pay-grid" data-kpi style="margin-bottom:14px"></div>
      <div class="card"><div class="toolbar"><div class="search">${icon("search")}<input class="input" placeholder="ค้นหาเลขที่ ชื่อ รายการ…" value="${esc(st.q)}" data-q></div>
        <div class="seg" data-status>${[["all", "ทั้งหมด"], ["unsettled", "ค้างชำระ"], ["settled", "ชำระแล้ว"]].map(([k, l]) => `<button data-s="${k}" class="${st.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="grow"></div><button class="btn sm" data-csv>${icon("download")} Excel (CSV)</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:200px"><div class="spinner"></div></div></div></div>`;
    bindRange(c, () => self.render(c));
    if ($("[data-new]", c)) $("[data-new]", c).onclick = () => openDoc(type, null, () => self.render(c));
    const data = (await bapi("GET", "/records?type=" + type + "&" + rq())).records;
    const draw = () => {
      const q = st.q.toLowerCase();
      const rows = data.filter(r => (!q || (r.docNo + " " + r.party + " " + r.description + " " + r.category + " " + r.items.map(i => i.name).join(" ")).toLowerCase().includes(q))
        && (st.status === "all" || (st.status === "unsettled" ? (r.dueDate && !r.settledAt) : (!r.dueDate || r.settledAt))));
      const total = rows.reduce((a, r) => a + r.total, 0), unsettled = rows.filter(r => r.dueDate && !r.settledAt);
      $("[data-kpi]", c).innerHTML = `<div class="mini-kpi"><div class="l">ยอดรวม${T.th.split(" ")[0]}</div><div class="v" style="color:${T.color}">${baht(total)}</div></div><div class="mini-kpi"><div class="l">จำนวนเอกสาร</div><div class="v">${rows.length}</div></div>
        <div class="mini-kpi"><div class="l">${type === "income" ? "ค้างรับ" : "ค้างจ่าย"}</div><div class="v">${baht(unsettled.reduce((a, r) => a + r.total, 0))}</div></div><div class="mini-kpi"><div class="l">VAT ในช่วงนี้</div><div class="v">${baht(rows.reduce((a, r) => a + (r.vatMode !== "none" ? r.vat : 0), 0))}</div></div>`;
      $("[data-tbl]", c).innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>${T.party}</th><th>รายการ / หมวด</th><th>ช่องทาง</th><th>สถานะ</th><th class="num">ยอดสุทธิ</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="click" data-id="${r.id}"><td>${thDate(r.date, true)}</td><td>${r.thumbId ? `<div class="d-cell"><span class="rthumb" data-thumb="${r.id}" title="ดูรูปแนบ" style="background-image:url('${authUrl("/files/" + r.thumbId)}')">${r.fileCount > 1 ? `<b>${r.fileCount}</b>` : ""}</span><span class="doc">${esc(r.docNo)}</span></div>` : `<span class="doc">${esc(r.docNo)}</span>${r.fileCount ? ` <span class="muted" title="ไฟล์แนบ">${icon("clip", "").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')}</span>` : ""}`}</td>
          <td>${esc(r.party || "-")}</td><td><div class="desc">${esc(r.description)}</div><div class="muted small desc">${esc(r.category)}</div></td><td class="small">${esc(r.paymentChannel || "-")}</td>
          <td>${statusChip(r)}</td><td class="num bold">${baht(r.total)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="6">รวม ${rows.length} เอกสาร</td><td class="num">${baht(total)}</td></tr></tfoot></table>` : emptyBox(data.length ? "ไม่พบรายการที่ค้นหา" : `ยังไม่มี${T.th}ในช่วงนี้ — กด “${T.new}” เพื่อเริ่ม`, "file");
      $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => openDoc(type, tr.dataset.id, () => self.render(c)); });
      $$("[data-thumb]", c).forEach(t => { t.onclick = e => { e.stopPropagation(); viewRecordImages(t.dataset.thumb); }; });
      $("[data-csv]", c).onclick = () => downloadCSV(type + "-" + S.range.from + "_" + S.range.to + ".csv", [["วันที่", "เลขที่", T.party, "รายการ", "หมวด", "ช่องทาง", "ก่อนส่วนลด", "ส่วนลด", "VAT", "ยอดสุทธิ", "ครบกำหนด", "ชำระแล้ว", "หมายเหตุ"],
        ...rows.map(r => [r.date, r.docNo, r.party, r.description, r.category, r.paymentChannel, r.subtotal, r.discount, r.vat, r.total, r.dueDate, r.settledDate, r.note])]);
    };
    $("[data-q]", c).oninput = debounce(e => { st.q = e.target.value; draw(); }, 200);
    $$("[data-s]", c).forEach(b => { b.onclick = () => { st.status = b.dataset.s; $$("[data-s]", c).forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
    draw();
  } };
}
function statusChip(r) {
  if (r.source === "payroll" && !r.dueDate) return `<span class="chip blue">จากระบบเงินเดือน</span>`;
  if (r.source === "pos") return `<span class="chip blue">จาก POS</span>`;
  if (r.source === "advance" && !r.dueDate) return `<span class="chip blue">เบิกเงินล่วงหน้า</span>`;
  if (r.planSeq) { const p = `<span class="chip blue plain">ผ่อน ${r.planSeq}/${r.planCount}</span> `; if (r.settledAt) return p + `<span class="chip good">ชำระแล้ว</span>`; return p + (r.dueDate < today() ? `<span class="chip bad">เลยกำหนด ${thDate(r.dueDate, true)}</span>` : `<span class="chip warn">ครบ ${thDate(r.dueDate, true)}</span>`); }
  if (!r.dueDate) return `<span class="chip good">ชำระแล้ว</span>`;
  if (r.settledAt) return `<span class="chip good">ชำระแล้ว ${thDate(r.settledDate, true)}</span>`;
  return r.dueDate < today() ? `<span class="chip bad">เลยกำหนด ${thDate(r.dueDate, true)}</span>` : `<span class="chip warn">ครบ ${thDate(r.dueDate, true)}</span>`;
}
BRANCH_PAGES.income = docListPage("income");
BRANCH_PAGES.expense = docListPage("expense");
BRANCH_PAGES.invest = docListPage("invest");

/* ---------- document editor ---------- */
function calcDoc(d) {
  d.items.forEach(i => { i.amount = r2(num(i.qty) * num(i.price)); });
  const subtotal = r2(d.items.reduce((a, i) => a + i.amount, 0));
  const dv = Math.max(0, num(d.discountValue));
  const discount = d.discountType === "percent" ? r2(subtotal * Math.min(dv, 100) / 100) : r2(Math.min(dv, subtotal));
  const after = r2(subtotal - discount); let vat = 0, total = after;
  if (d.vatMode === "incl") vat = r2(after * 7 / 107); if (d.vatMode === "excl") { vat = r2(after * .07); total = r2(after + vat); }
  return { subtotal, discount, after, vat, total };
}
// เพิ่มหมวด / ช่องทาง / ผู้ขาย / หน่วยนับ ได้ทันทีจากหน้าที่กำลังกรอก
function quickAddList(kind) {
  return new Promise(res => {
    const isCh = kind === "payment_channel";
    const m = openModal({ title: "เพิ่ม" + LIST_LABEL[kind], body: `<div class="stack"><label class="field"><span>ชื่อ${LIST_LABEL[kind]}</span><input class="input" name="name" placeholder="${isCh ? "เช่น บัญชีกสิกร 123-4-56789, เงินสดลิ้นชัก" : ""}"></label>
      ${isCh ? `<label class="check"><input type="checkbox" name="isCredit"> เป็นบัตรเครดิต / เงินเชื่อ (ยังไม่ตัดเงินทันที มีวันครบกำหนด)</label>
        <div data-ob><div class="grid g2"><label class="field"><span>ยอดเงินคงเหลือตอนนี้ (ยอดยกมา)</span><input class="input num" name="openingBalance" inputmode="decimal" placeholder="0.00"></label><label class="field"><span>ณ วันที่</span><input type="date" class="input" name="openingDate" value="${today()}"></label></div>
        <div class="field-hint">ใส่ยอดในบัญชีจริง ณ วันที่เริ่มใช้ระบบ เพื่อให้ยอดคงเหลือถูกต้อง (แก้ภายหลังได้ที่เมนู “เงินในบัญชี”)</div></div>` : ""}</div>`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("plus")} เพิ่ม</button>` });
    let done = false; const oc = m.close; m.close = () => { if (!done) { done = true; res(null); } oc(); }; $$("[data-close],[data-x]", m.el).forEach(b => { b.onclick = () => m.close(); });
    const cr = $("[name=isCredit]", m.el); if (cr) cr.onchange = () => { $("[data-ob]", m.el).style.display = cr.checked ? "none" : ""; };
    const ok = $("[data-ok]", m.el);
    const submit = () => withBtn(ok, async () => { const f = formData(m.el); if (!f.name.trim()) throw new Error("กรุณาใส่ชื่อ");
      await bapi("POST", "/lists", { kind, name: f.name.trim(), isCredit: !!f.isCredit, openingBalance: f.isCredit ? "" : f.openingBalance, openingDate: f.openingDate });
      S.lists = (await bapi("GET", "/lists")).lists; toast("เพิ่ม “" + f.name.trim() + "” แล้ว"); done = true; res(f.name.trim()); oc(); }).catch(() => {});
    ok.onclick = submit; $("[name=name]", m.el).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  });
}
/* เลือกสินค้าสต็อกที่จะผูกกับบรรทัดรายจ่าย (v2.6) — คืนค่า item หรือ null */
function openStockPicker(line) {
  return new Promise(async res => {
    try { await loadStockItems(); } catch (e) { toast(e.message, "bad"); return res(null); }
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const ph = i => i.photoV ? `<span class="sp-ph" style="background-image:url('${authUrl("/stock/items/" + i.id + "/photo?v=" + i.photoV)}')"></span>` : `<span class="sp-ph empty">${icon("stock", "")}</span>`;
    const m = openModal({ title: "ผูกบรรทัดนี้กับสต็อก", size: "lg", body: `
      <div class="info-box" style="margin-bottom:12px;line-height:1.6"><b>ผูกสต็อกคืออะไร?</b> ใช้ตอนซื้อวัตถุดิบ/ของเข้าร้าน เมื่อกด “บันทึก” รายจ่าย ระบบจะ <b>รับของเข้าสต็อกให้อัตโนมัติ</b>
        ตามจำนวนในบรรทัด (ไม่ต้องไปกดรับเข้าซ้ำ และไม่ต้องรออนุมัติ) · ต้นทุนต่อหน่วย = ราคาในบรรทัดหลังหักส่วนลด · ถ้าแก้หรือลบเอกสาร สต็อกจะปรับตามให้เอง</div>
      <div class="search" style="margin-bottom:10px;max-width:none">${icon("search", "")}<input class="input" data-spq placeholder="ค้นหาสินค้าในสต็อก" value="${esc(line.name || "")}"></div>
      <div class="sp-list" data-splist></div>
      ${canEdit("stock") ? `<div class="sp-new" data-spnew><div class="section-t" style="margin:14px 0 8px">ยังไม่มีในสต็อก? สร้างใหม่เลย</div>
        <div class="grid g2"><label class="field"><span>ชื่อสินค้า <em>*</em></span><input class="input" data-nn value="${esc(line.name || "")}" placeholder="เช่น หมูสับ"></label>
        <label class="field"><span>หน่วยนับ</span><input class="input" data-nu value="${esc(line.unit || "")}" list="unit-dl3" placeholder="เช่น กก."><datalist id="unit-dl3">${listNames("unit").map(n => opt(n)).join("")}</datalist></label></div>
        <div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">หมวดสต็อก</span>${catPicker(listNames("stock_category")[0] || "")}</div>
        <button class="btn primary" data-nsave>${icon("plus")} สร้างสินค้าและผูกกับบรรทัดนี้</button></div>`
        : `<div class="muted small" style="margin-top:12px">ไม่พบสินค้าที่ต้องการ? ให้ผู้ที่มีสิทธิ์จัดการสต็อกเพิ่มสินค้าก่อน</div>`}`,
      foot: `<button class="btn" data-close>ยกเลิก</button>` });
    const oc = m.close; m.close = () => { fin(null); oc(); };
    $$("[data-close],[data-x]", m.el).forEach(b => { b.onclick = () => m.close(); });
    const draw = () => {
      const q = $("[data-spq]", m.el).value.trim().toLowerCase();
      const all = S.stockItems.filter(i => i.active);
      let list = q ? all.filter(i => (i.name + " " + (i.sku || "") + " " + (i.category || "")).toLowerCase().includes(q)) : all;
      if (q && !list.length) list = all; // ไม่เจอ → แสดงทั้งหมดให้เลือก
      $("[data-splist]", m.el).innerHTML = all.length ? list.slice(0, 80).map(i => `<button type="button" class="sp-item ${i.id === line.stockItemId ? "on" : ""}" data-sp="${i.id}">${ph(i)}
        <span class="sp-t"><b>${esc(i.name)}</b><span class="muted small">${esc(i.category || "ไม่มีหมวด")} · เหลือ ${fmtQ(i.qty)} ${esc(i.unit)}${i.avgCost ? " · ทุนเฉลี่ย " + fmt(i.avgCost) : ""}</span></span><span class="sp-go">เลือก</span></button>`).join("")
        + (q && !all.some(i => i.name.toLowerCase().includes(q)) ? `<div class="muted small" style="padding:6px 2px">ไม่พบ “${esc(q)}” — แสดงสินค้าทั้งหมด หรือสร้างใหม่ด้านล่าง</div>` : "")
        : `<div class="muted" style="padding:10px 2px">ยังไม่มีสินค้าในสต็อกเลย</div>`;
      $$("[data-sp]", m.el).forEach(b => { b.onclick = () => { fin(S.stockItems.find(x => x.id === b.dataset.sp)); oc(); }; });
    };
    $("[data-spq]", m.el).oninput = debounce(draw, 120); draw();
    bindCatPicker(m.el);
    const ns = $("[data-nsave]", m.el);
    if (ns) ns.onclick = () => withBtn(ns, async () => {
      const name = $("[data-nn]", m.el).value.trim(), unit = $("[data-nu]", m.el).value.trim(), category = $("[name=category]", m.el).value;
      if (!name) throw new Error("กรุณาใส่ชื่อสินค้า");
      if (category && !listNames("stock_category").includes(category)) { await bapi("POST", "/lists", { kind: "stock_category", name: category }); S.lists = (await bapi("GET", "/lists")).lists; }
      const r = await bapi("POST", "/stock/items", { name, unit, category });
      await loadStockItems(true); toast("สร้าง “" + name + "” ในสต็อกแล้ว");
      fin(S.stockItems.find(x => x.id === r.id) || { id: r.id, name, unit }); oc();
    }).catch(() => {});
  });
}
// prefill = { form, replacePlanId } ใช้ตอน "แก้ไขแผนผ่อน": เปิดฟอร์มเดิม บันทึกแล้วแทนที่แผนเดิม
async function openDoc(type, id, onSaved, prefill) {
  const T = TYPE[type];
  let d;
  if (id) { try { d = (await bapi("GET", "/records/" + id)).record; } catch (e) { return toast(e.message, "bad"); } }
  else d = { type, date: today(), party: "", description: "", paymentChannel: listNames("payment_channel")[0] || "", dueDate: "", items: [{ name: "", category: listNames(T.cat)[0] || "", qty: 1, unit: "", price: "" }], discountType: "baht", discountValue: 0, vatMode: "none", note: "", files: [] };
  const isCopy = !id && prefill && prefill.copy;
  const pf = !id && prefill && !prefill.copy ? prefill.form : null;
  if (isCopy) { const c = prefill.form; Object.assign(d, { party: c.party || "", description: c.description || "", note: c.note || "", paymentChannel: c.paymentChannel || d.paymentChannel, items: (c.items || []).length ? c.items.map(i => ({ name: i.name, category: i.category, qty: i.qty, unit: i.unit || "", price: i.price, stockItemId: i.stockItemId || "" })) : d.items, discountType: c.discountType || "baht", discountValue: c.discountValue || 0, vatMode: c.vatMode || "none" }); }
  if (pf) Object.assign(d, { date: pf.date, party: pf.party || "", description: pf.description || "", note: pf.note || "", paymentChannel: pf.paymentChannel, items: pf.items.length ? pf.items : d.items, discountType: pf.discountType || "baht", discountValue: pf.discountValue || 0, vatMode: pf.vatMode || "none" });
  d.items = d.items.map(i => ({ ...i }));
  const ro = ["payroll", "advance", "installment", "card_fee", "pos"].includes(d.source) || !canEdit(type);
  d.months = pf ? "n" : 1; d.interest = "";
  if (type !== "income") await loadStockItems().catch(() => {});
  const pending = [];
  let cats = listNames(T.cat), chans = listNames("payment_channel");
  d.unpaid = id ? (!!d.dueDate && !isCreditChannel(d.paymentChannel)) : false;
  const W = type === "income" ? { paid: "รับเงินแล้ว", unpaid: "ยังไม่ได้รับเงิน (ค้างรับ)", ch: "รับเงินเข้าบัญชี / ช่องทาง", settle: "รับเงิน" } : { paid: "จ่ายแล้ว", unpaid: "ยังไม่จ่าย (ค้างจ่าย)", ch: "จ่ายจากบัญชี / ช่องทาง", settle: "จ่ายเงิน" };
  const chanOpts = () => (d.unpaid ? opt("", "— ยังไม่ระบุ —", !d.paymentChannel) : (d.paymentChannel ? "" : opt("", "— เลือกช่องทาง —", true))) + (chans.includes(d.paymentChannel) || !d.paymentChannel ? "" : opt(d.paymentChannel, d.paymentChannel, true))
    + chans.filter(n => !(d.unpaid && isCreditChannel(n))).map(n => opt(n, n + (isCreditChannel(n) ? " (เครดิต · มีวันครบกำหนด)" : ""), n === d.paymentChannel)).join("");
  const catOpts = sel => (cats.includes(sel) || !sel ? "" : opt(sel, sel + " (เดิม)", true)) + cats.map(n => opt(n, n, n === sel)).join("");
  const stockOpts = sel => `<option value="">— ไม่ผูกสต็อก —</option>` + (S.stockItems || []).filter(i => i.active || i.id === sel).map(i => opt(i.id, i.name + (i.unit ? " (" + i.unit + ")" : ""), i.id === sel)).join("");
  const slChip = it => { const si = it.stockItemId && (S.stockItems || []).find(x => x.id === it.stockItemId);
    if (it.stockItemId) return `<div class="sl-chip on"><button type="button" class="sl-main" data-slpick>${icon("stock", "")}<span><b>${esc(si ? si.name : "สินค้าในสต็อก")}</b> · รับเข้า ${fmtQ(num(it.qty))} ${esc(it.unit || (si && si.unit) || "")}${si && it.unit && it.unit !== si.unit && (si.units || []).some(u => u.n === it.unit) ? ` (= ${fmtQ(num(it.qty) * ufOf(si, it.unit))} ${esc(si.unit)})` : si && it.unit && it.unit !== si.unit ? ` <span style="color:var(--warn)">(หน่วยไม่ตรงสต็อก “${esc(si.unit)}” — นับเป็น ${esc(si.unit)})</span>` : ""}${num(it.price) ? " @ " + fmt(num(it.price)) : ""}</span></button><button type="button" class="sl-x" data-slx title="เลิกผูกสต็อก">×</button></div>`;
    return `<button type="button" class="sl-chip" data-slpick>${icon("stock", "")} ผูกสต็อก <span class="muted">(ของเข้าคลังอัตโนมัติ)</span></button>`; };
  const lineRow = (it, i) => `<tr data-i="${i}"><td class="ln">${i + 1}</td>
    <td class="c-name"><input class="input sm" data-f="name" value="${esc(it.name)}" placeholder="รายละเอียดสินค้า / บริการ" ${ro ? "readonly" : ""}>
      ${type !== "income" && !ro ? `<div data-slwrap>${slChip(it)}</div>` : (it.stockItemId ? `<div class="stock-link">${icon("stock", "").replace("<svg", '<svg style="width:13px;height:13px"')} เข้าสต็อก${(() => { const si = (S.stockItems || []).find(x => x.id === it.stockItemId); return si ? ": " + esc(si.name) : ""; })()}</div>` : "")}</td>
    <td class="c-cat"><select class="input sm" data-f="category" ${ro ? "disabled" : ""}>${catOpts(it.category)}</select></td>
    <td style="width:86px"><input class="input sm num" data-f="qty" value="${esc(it.qty)}" inputmode="decimal" ${ro ? "readonly" : ""}></td>
    <td style="width:86px"><input class="input sm" data-f="unit" value="${esc(it.unit || "")}" list="units-dl" placeholder="หน่วย" ${ro ? "readonly" : ""}></td>
    <td style="width:120px"><input class="input sm num" data-f="price" value="${esc(it.price)}" inputmode="decimal" placeholder="0.00" ${ro ? "readonly" : ""}></td>
    <td class="num bold" style="width:120px;padding-top:12px" data-amt>${fmt(num(it.qty) * num(it.price))}</td>
    <td style="width:36px">${ro ? "" : `<button class="btn ghost sm icon" data-rm title="ลบบรรทัด">${icon("trash")}</button>`}</td></tr>`;
  const body = `
    ${d.source === "payroll" ? `<div class="info-box" style="margin-bottom:14px">เอกสารนี้สร้างอัตโนมัติจากระบบเงินเดือน — แก้ไขหรือยกเลิกได้ที่เมนู “เงินเดือน & สลิป”</div>` : d.source === "advance" ? `<div class="info-box" style="margin-bottom:14px">เอกสารนี้สร้างอัตโนมัติจากการอนุมัติเบิกเงินล่วงหน้า — ยกเลิกได้ที่เมนู “เบิกเงินล่วงหน้า”</div>` : d.source === "installment" ? `<div class="info-box" style="margin-bottom:14px">งวดผ่อนบัตรเครดิต งวดที่ ${d.planSeq}/${d.planCount} — ชำระบิลหรือยกเลิกแผนผ่อนได้ที่เมนู “บัตรเครดิต & ผ่อนชำระ”</div>` : d.source === "card_fee" ? `<div class="info-box" style="margin-bottom:14px">ดอกเบี้ย/ค่าธรรมเนียมที่บันทึกพร้อมการชำระบิลบัตร — ยกเลิกได้ที่เมนู “บัตรเครดิต & ผ่อนชำระ”</div>` : ro ? `<div class="info-box" style="margin-bottom:14px">คุณมีสิทธิ์ดูอย่างเดียว</div>` : ""}
    <div class="grid g2">
      <label class="field"><span>วันที่เอกสาร <em>*</em></span><input type="date" class="input" name="date" value="${esc(d.date)}" ${ro ? "readonly" : ""}></label>
      <label class="field"><span>${T.party}</span><input class="input" name="party" value="${esc(d.party)}" list="vendor-dl" placeholder="${type === "income" ? "เช่น ลูกค้าหน้าร้าน, Grab" : "เช่น แม็คโคร"}" ${ro ? "readonly" : ""}></label>
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="field"><span class="small" style="display:block;margin-bottom:5px;color:var(--text-2);font-weight:500">สถานะการ${W.settle}</span><div class="seg" data-paid style="width:100%"><button type="button" data-v="paid" style="flex:1">${icon("check", "").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} ${W.paid}</button><button type="button" data-v="unpaid" style="flex:1">${W.unpaid}</button></div><div class="cred-stat hidden" data-credstat></div></div>
      <label class="field"><span data-chlbl></span><div class="row" style="gap:6px"><select class="input" name="paymentChannel" ${ro ? "disabled" : ""}></select>${ro ? "" : `<button type="button" class="btn icon" data-addch title="เพิ่มช่องทาง / บัญชีใหม่">${icon("plus")}</button>`}</div></label>
      <label class="field" data-duewrap><span>วันครบกำหนด${W.settle} <em>*</em></span><input type="date" class="input" name="dueDate" value="${esc(d.dueDate)}" ${ro ? "readonly" : ""}></label>
    </div>
    ${!id && type !== "income" ? `<div class="card card-b inst-box hidden" data-inst style="margin-top:14px">
      <div class="row wrap" style="gap:10px;margin-bottom:4px"><b>${icon("wallet", "").replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} ชำระบัตรเครดิตแบบไหน?</b></div>
      <div class="inst-choice" data-instmode><button type="button" data-v="1" class="on"><b>ชำระเต็มจำนวน</b><span>ลงค่าใช้จ่ายเต็มยอดในวันที่เอกสาร · จ่ายบัตรครั้งเดียว</span></button>
        <button type="button" data-v="n"><b>ผ่อนชำระ</b><span>แบ่งเป็นงวดรายเดือน · ลงค่าใช้จ่ายเดือนละงวด</span></button></div>
      <div class="hidden" data-instf style="margin-top:12px"><div class="grid g4">
        <label class="field"><span>ผ่อนกี่งวด (เดือน) <em>*</em></span><input class="input num" name="months" inputmode="numeric" placeholder="เช่น 10"></label>
        <label class="field"><span>จ่ายทุกวันที่ของเดือน <em>*</em></span><input class="input num" name="payDay" inputmode="numeric" placeholder="1-31"></label>
        <label class="field"><span>เริ่มงวดแรกเดือน</span><input type="month" class="input" name="firstMonth"></label>
        <label class="field"><span>ดอกเบี้ย/ค่าธรรมเนียมรวม</span><input class="input num" name="interest" inputmode="decimal" placeholder="0 = ผ่อน 0%"></label></div>
        <div data-sched style="margin-top:12px"></div></div>
      <div class="small muted" data-instinfo style="margin-top:8px"></div></div>` : ""}
    <label class="field" style="margin-top:14px"><span>คำอธิบาย (ไม่ใส่ก็ได้ ระบบใช้ชื่อรายการแทน)</span><input class="input" name="description" value="${esc(d.description)}" ${ro ? "readonly" : ""}></label>
    <div class="row" style="margin-top:18px"><div class="section-t grow" style="margin:0">รายการ</div>${ro ? "" : `<button type="button" class="btn sm ghost" data-addcat>${icon("plus")} เพิ่มหมวดใหม่</button>`}</div>
    <div class="tbl-wrap"><table class="doc-lines"><thead><tr><th>#</th><th>รายละเอียด</th><th style="width:190px">หมวด</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคา/หน่วย</th><th class="num">จำนวนเงิน</th><th></th></tr></thead><tbody data-lines>${d.items.map(lineRow).join("")}</tbody></table></div>
    ${ro ? "" : `<button class="btn sm" style="margin-top:10px" data-addline>${icon("plus")} เพิ่มรายการ</button>`}
    <datalist id="units-dl">${listNames("unit").map(n => opt(n)).join("")}</datalist><datalist id="vendor-dl">${listNames("vendor").map(n => opt(n)).join("")}</datalist>
    <div class="doc-sum"><div class="stack">
      <label class="field"><span>หมายเหตุ</span><textarea class="input" name="note" rows="2" ${ro ? "readonly" : ""}>${esc(d.note)}</textarea></label>
      <div><div class="section-t">ไฟล์แนบ (ใบเสร็จ / สลิป / รูปภาพ / PDF)</div><div class="files" data-files></div><input type="file" accept="image/*,application/pdf" multiple hidden data-fileinput></div>
      ${id && d.dueDate && canEdit(type) ? `<div class="row wrap" data-settle>${d.settledAt ? `<span class="chip good">${W.paid}เมื่อ ${thDate(d.settledDate)}${d.settledChannel ? " · " + esc(d.settledChannel) : ""}</span><button class="btn sm" data-unsettle>ยกเลิกสถานะชำระแล้ว</button>` : `${statusChip(d)}<input type="date" class="input sm" style="width:150px" value="${today()}" data-settledate><select class="input sm" style="width:190px" data-settlech>${opt("", "— " + (type === "income" ? "เข้าบัญชีไหน" : "จ่ายจากบัญชีไหน") + " —")}${chans.filter(n => !isCreditChannel(n)).map(n => opt(n)).join("")}</select><button class="btn sm primary" data-dosettle>${icon("check")} บันทึกว่า${W.settle}แล้ว</button>`}</div>` : ""}
    </div>
    <div class="sum-box">
      <div class="sum-row"><span>รวมเป็นเงิน</span><b class="num" data-sub></b></div>
      <div class="sum-row"><span>ส่วนลด</span><span class="row" style="gap:6px"><input class="input sm num" style="width:90px" name="discountValue" value="${esc(d.discountValue || "")}" placeholder="0" ${ro ? "readonly" : ""}>
        <div class="seg" data-dtype><button type="button" data-v="baht" class="${d.discountType !== "percent" ? "on" : ""}">฿</button><button type="button" data-v="percent" class="${d.discountType === "percent" ? "on" : ""}">%</button></div></span></div>
      <div class="sum-row muted small"><span>ส่วนลดคิดเป็น</span><span class="num" data-disc></span></div>
      <div class="sum-row"><span>ภาษีมูลค่าเพิ่ม 7%</span><select class="input sm" style="width:140px" name="vatMode" ${ro ? "disabled" : ""}>${opt("none", "ไม่มี VAT", d.vatMode === "none")}${opt("incl", "รวม VAT ในราคา", d.vatMode === "incl")}${opt("excl", "บวก VAT เพิ่ม", d.vatMode === "excl")}</select></div>
      <div class="sum-row muted small"><span>VAT</span><span class="num" data-vat></span></div>
      <div class="sum-row total"><span>ยอดสุทธิ</span><span class="num" data-total style="color:${T.color}"></span></div>
    </div></div>`;
  const canCopy = id && canEdit(type) && !["payroll", "advance", "installment", "card_fee", "pos"].includes(d.source);
  const foot = `<div class="left">${id && !ro ? `<button class="btn danger" data-del>${icon("trash")} ลบ</button>` : ""}${canCopy ? `<button class="btn" data-copydoc title="สร้างเอกสารใหม่จากรายการนี้">${icon("copy")} คัดลอก</button>` : ""}${id ? `<button class="btn" data-print>${icon("print")} พิมพ์</button>` : ""}</div>
    <button class="btn" data-close>${ro ? "ปิด" : "ยกเลิก"}</button>${ro ? "" : `<button class="btn primary" data-save>${icon("check")} บันทึก</button>`}`;
  const planBtns = id && d.source === "installment" && d.planId && canEdit("cards") ? `<button class="btn" data-planedit>${icon("edit")} แก้ไขแผนผ่อน</button><button class="btn danger" data-plancancel>${icon("trash")} ยกเลิกแผนผ่อน</button>` : "";
  const m = openModal({ title: pf ? "แก้ไขแผนผ่อน · " + esc(pf.party || pf.description || "") : isCopy ? T.new + ` <span class="chip" style="font-size:11.5px;vertical-align:2px">คัดลอกจาก ${esc(prefill.fromNo || "")}</span>` : (id ? esc(d.docNo) + " · " : "") + (id ? T.doc : T.new), body, foot: planBtns ? foot.replace('<div class="left">', '<div class="left">' + planBtns) : foot, size: "xl", sticky: true });
  const el = m.el;
  const pe = $("[data-planedit]", el); if (pe) pe.onclick = () => editPlan(d.planId, () => { m.close(); onSaved && onSaved(); }, () => m.close());
  const pc = $("[data-plancancel]", el); if (pc) pc.onclick = () => cancelPlan(d.planId, () => { m.close(); onSaved && onSaved(); });
  const recalc = () => { if ($("[data-instinfo]", el)) setTimeout(() => { try { instInfo(); } catch (e) {} }); const t = calcDoc(d); $("[data-sub]", el).textContent = fmt(t.subtotal); $("[data-disc]", el).textContent = "-" + fmt(t.discount); $("[data-vat]", el).textContent = fmt(t.vat); $("[data-total]", el).textContent = baht(t.total);
    $$("tr[data-i]", el).forEach(tr => { const it = d.items[+tr.dataset.i]; $("[data-amt]", tr).textContent = fmt(num(it.qty) * num(it.price)); }); };
  let fmTouched = !!pf;
  if (pf) { const set = (n, v) => { const i = $(`[name=${n}]`, el); if (i && v != null && v !== "") i.value = v; };
    set("months", pf.months); set("payDay", pf.payDay); set("firstMonth", pf.firstMonth); set("interest", pf.interest || ""); }
  const firstMonthFor = (date, pd) => { const [y, mo, dd] = date.split("-").map(Number); const ld = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (dd < Math.min(pd, ld)) return date.slice(0, 7); const nm = mo === 12 ? (y + 1) + "-01" : y + "-" + String(mo + 1).padStart(2, "0"); return nm; };
  const payDateOf = (ym, k, pd) => { let [y, mo] = ym.split("-").map(Number); mo += k; while (mo > 12) { mo -= 12; y++; } const ld = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return y + "-" + String(mo).padStart(2, "0") + "-" + String(Math.min(pd, ld)).padStart(2, "0"); };
  const instInfo = () => {
    const box = $("[data-inst]", el); if (!box) return;
    const credit = !d.unpaid && isCreditChannel(d.paymentChannel); box.classList.toggle("hidden", !credit);
    if (!credit) { d.months = 1; return; }
    const cd = cardOf(d.paymentChannel);
    const multi = d.months > 1 || d.months === "n";
    $$("[data-instmode] button", el).forEach(b => b.classList.toggle("on", (b.dataset.v === "n") === multi));
    $("[data-instf]", el).classList.toggle("hidden", !multi);
    $("[data-duewrap]", el).style.visibility = multi ? "hidden" : "visible";
    if (!multi) { $("[data-instinfo]", el).innerHTML = `ลงค่าใช้จ่ายเต็มยอดวันที่ ${thDate(d.date || today())} · ครบกำหนดจ่ายบัตร ${d.dueDate ? thDate(d.dueDate) : "-"}${cd ? " (ตามรอบบัตร)" : ""}`; $("[data-sched]", el).innerHTML = ""; return; }
    const pdIn = $("[name=payDay]", el), fmIn = $("[name=firstMonth]", el);
    if (!pdIn.value) pdIn.value = cd ? cd.dueDay : Number((d.date || today()).slice(8, 10));
    const pd = Math.round(num(pdIn.value)), n = Math.round(num($("[name=months]", el).value)), it = num($("[name=interest]", el).value);
    if (!fmTouched && pd >= 1 && pd <= 31) fmIn.value = firstMonthFor(d.date || today(), pd);
    const t = calcDoc(d).total;
    if (!(n >= 2 && n <= 60) || !(pd >= 1 && pd <= 31) || !fmIn.value) { $("[data-sched]", el).innerHTML = `<div class="warn-box">ใส่จำนวนงวด (2-60) และวันที่จ่าย (1-31)</div>`; $("[data-instinfo]", el).innerHTML = ""; return; }
    const per = Math.floor((t + it) / n * 100) / 100, last = Math.round((t + it - per * (n - 1)) * 100) / 100;
    const rows = []; for (let k = 0; k < n; k++) rows.push({ k, date: payDateOf(fmIn.value, k, pd), amt: k === n - 1 ? last : per });
    const show = n <= 6 ? rows : [...rows.slice(0, 3), null, ...rows.slice(-2)];
    $("[data-sched]", el).innerHTML = `<div class="sched"><div class="sched-h"><span>ตารางผ่อน ${n} งวด · จ่ายทุกวันที่ ${pd}</span><b>เดือนละ ${baht(per)}</b></div>
      ${show.map(r => r ? `<div class="sched-r"><span>งวดที่ ${r.k + 1}</span><span>${thDate(r.date)}</span><b class="num">${fmt(r.amt)}</b></div>` : `<div class="sched-r muted"><span>⋮</span><span>อีก ${n - 5} งวด</span><span></span></div>`).join("")}
      <div class="sched-r total"><span>รวม</span><span></span><b class="num">${fmt(t + it)}</b></div></div>`;
    $("[data-instinfo]", el).innerHTML = `${icon("info", "").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} ค่าใช้จ่ายจะลงเดือนละงวดตามวันที่จ่ายในตารางนี้ — <b>ไม่</b>ลงเต็มจำนวนในวันที่คีย์ (${thDate(d.date || today())}) · แต่ละงวดจะขึ้นในบิลบัตรและแจ้งเตือนก่อนครบกำหนด 7 วัน`;
  };
  const dueToggle = () => {
    const show = d.unpaid || isCreditChannel(d.paymentChannel);
    if (!d.unpaid && cardOf(d.paymentChannel) && !id && !ro) { d.dueDate = cardDueFor(d.date || today(), cardOf(d.paymentChannel).cutDay, cardOf(d.paymentChannel).dueDay); $("[name=dueDate]", el).value = d.dueDate; }
    $("[data-duewrap]", el).style.visibility = show ? "visible" : "hidden";
    if (show && !d.dueDate && !ro) { d.dueDate = addDays(d.date || today(), 30); $("[name=dueDate]", el).value = d.dueDate; }
    $$("[data-paid] button", el).forEach(b => b.classList.toggle("on", (b.dataset.v === "unpaid") === d.unpaid));
    // จ่ายด้วยบัตร/ช่องทางเครดิต: ไม่ใช่ "จ่ายแล้ว" — เงินจริงยังไม่ออกจนกว่าจะชำระบิล แสดงสถานะจริงแทนปุ่ม
    const credit = !d.unpaid && type !== "income" && isCreditChannel(d.paymentChannel);
    $("[data-paid]", el).classList.toggle("hidden", credit);
    const cs = $("[data-credstat]", el); cs.classList.toggle("hidden", !credit);
    if (credit) cs.innerHTML = id && d.settledAt ? `<span class="chip good">ชำระบิลแล้ว ${thDate(d.settledDate, true)}${d.settledChannel ? " · " + esc(d.settledChannel) : ""}</span>`
      : id ? `<span class="chip ${d.dueDate && d.dueDate < today() ? "bad" : "warn"}">ยังไม่ชำระ · รอชำระบิล ครบ ${d.dueDate ? thDate(d.dueDate, true) : "-"}</span>`
      : `<span class="chip warn">จ่ายด้วยบัตร · ยังไม่ตัดเงินจริง</span><div class="small muted" style="margin-top:4px">เงินสด/ธนาคารจะถูกตัดตอนกด “ชำระบิล” ในเมนูบัตรเครดิต</div>`;
    $("[data-chlbl]", el).innerHTML = d.unpaid ? (type === "income" ? "จะรับเงินผ่าน (ไม่บังคับ)" : "จะจ่ายผ่าน (ไม่บังคับ)") : W.ch + " <em>*</em>";
    instInfo();
  };
  $$("[data-instmode] button", el).forEach(b => { b.onclick = () => { d.months = b.dataset.v === "n" ? "n" : 1; dueToggle(); }; });
  ["months", "interest", "payDay"].forEach(n => { const i = $(`[name=${n}]`, el); if (i) i.oninput = instInfo; });
  if ($("[name=firstMonth]", el)) $("[name=firstMonth]", el).onchange = () => { fmTouched = true; instInfo(); };
  const drawChans = () => { chans = listNames("payment_channel"); $("[name=paymentChannel]", el).innerHTML = chanOpts(); };
  const bindSL = (tr, i) => {
    const w = $("[data-slwrap]", tr); if (!w) return;
    const redraw = () => { w.innerHTML = slChip(d.items[i]); bindSL(tr, i); };
    const pk = $("[data-slpick]", w); if (pk) pk.onclick = async () => {
      const r = await openStockPicker(d.items[i]); if (!r) return;
      const it = d.items[i]; it.stockItemId = r.id;
      if (!it.name) { it.name = r.name; $("[data-f=name]", tr).value = r.name; }
      if (r.unit) { it.unit = r.unit; $("[data-f=unit]", tr).value = r.unit; }
      if (!num(it.price) && r.avgCost) { it.price = r.avgCost; $("[data-f=price]", tr).value = r.avgCost; }
      redraw(); recalc();
    };
    const x = $("[data-slx]", w); if (x) x.onclick = () => { d.items[i].stockItemId = ""; redraw(); };
    tr._slRedraw = redraw;
  };
  const bindLines = () => {
    $$("tr[data-i]", el).forEach(tr => {
      const i = +tr.dataset.i;
      $$("[data-f]", tr).forEach(inp => { const ev = inp.tagName === "SELECT" ? "onchange" : "oninput"; inp[ev] = () => {
        const f = inp.dataset.f; d.items[i][f] = inp.value;
        if (["qty", "unit", "price"].includes(f) && d.items[i].stockItemId && tr._slRedraw) tr._slRedraw();
        if (f === "stockItemId" && inp.value) { const si = S.stockItems.find(x => x.id === inp.value); if (si) { if (!d.items[i].name) { d.items[i].name = si.name; $("[data-f=name]", tr).value = si.name; } if (si.unit) { d.items[i].unit = si.unit; $("[data-f=unit]", tr).value = si.unit; } if (!d.items[i].price && si.avgCost) { d.items[i].price = si.avgCost; $("[data-f=price]", tr).value = si.avgCost; } } }
        recalc(); }; });
      bindSL(tr, i);
      const rm = $("[data-rm]", tr); if (rm) rm.onclick = () => { if (d.items.length === 1) { d.items[0] = { name: "", category: d.items[0].category, qty: 1, unit: "", price: "" }; } else d.items.splice(i, 1); redrawLines(); };
    });
  };
  const redrawLines = () => { $("[data-lines]", el).innerHTML = d.items.map(lineRow).join(""); bindLines(); recalc(); };
  const drawFiles = () => {
    const tiles = (d.files || []).map(f => `<div class="file-tile"><div class="th" data-view="${f.id}" style="${/^image/.test(f.mime) ? `background-image:url('/api/b/${S.bid}/files/${f.id}?t=${tokenFor(S.bid)}')` : ""}">${/^image/.test(f.mime) ? "" : icon("file")}</div><div class="fn" title="${esc(f.filename)}">${esc(f.filename)}</div>${ro ? "" : `<button class="rm" data-rmf="${f.id}" title="ลบไฟล์">×</button>`}</div>`)
      .concat(pending.map((f, i) => `<div class="file-tile"><div class="th" style="${/^image/.test(f.mime) ? `background-image:url('${f.url}')` : ""}">${/^image/.test(f.mime) ? "" : icon("file")}</div><div class="fn">${esc(f.filename)}</div><button class="rm" data-rmp="${i}">×</button></div>`));
    $("[data-files]", el).innerHTML = tiles.join("") + (ro ? "" : `<div class="file-add" data-addfile>${icon("plus")}<div>แนบไฟล์</div></div>`) + (!tiles.length && ro ? `<span class="muted small">ไม่มีไฟล์แนบ</span>` : "");
    const af = $("[data-addfile]", el); if (af) af.onclick = () => $("[data-fileinput]", el).click();
    $$("[data-view]", el).forEach(t => { t.onclick = () => {
      const imgs = (d.files || []).filter(f => /^image/.test(f.mime)), f = (d.files || []).find(x => x.id === t.dataset.view);
      if (f && /^image/.test(f.mime)) lightbox(imgs.map(x => ({ url: authUrl("/files/" + x.id), name: x.filename })), imgs.indexOf(f));
      else window.open(authUrl("/files/" + t.dataset.view), "_blank"); }; });
    $$("[data-rmp]", el).forEach(b => { b.onclick = () => { pending.splice(+b.dataset.rmp, 1); drawFiles(); }; });
    $$("[data-rmf]", el).forEach(b => { b.onclick = async () => { if (!await confirmBox("ลบไฟล์แนบนี้?", { danger: true, okText: "ลบไฟล์" })) return; await bapi("DELETE", "/files/" + b.dataset.rmf); d.files = d.files.filter(f => f.id !== b.dataset.rmf); drawFiles(); }; });
  };
  $("[data-fileinput]", el).onchange = async e => {
    for (const f of Array.from(e.target.files)) { if (f.size > 20 * 1024 * 1024) { toast("ไฟล์ " + f.name + " ใหญ่เกินไป", "bad"); continue; } try { const x = await fileToB64(f); if (x.data.length * .75 > 8 * 1024 * 1024) { toast("ไฟล์ " + f.name + " ใหญ่เกิน 8MB", "bad"); continue; } pending.push(x); } catch (err) { toast(err.message, "bad"); } }
    e.target.value = ""; drawFiles();
  };
  ["date", "party", "description", "dueDate", "note", "discountValue"].forEach(n => { const i = $(`[name=${n}]`, el); if (i) i.oninput = () => { d[n] = i.value; if (n === "discountValue") recalc(); if (n === "dueDate") dueToggle(); if (n === "date" && isCreditChannel(d.paymentChannel)) { fmTouched = false; dueToggle(); } }; });
  $("[name=paymentChannel]", el).onchange = e => { d.paymentChannel = e.target.value; dueToggle(); };
  $$("[data-paid] button", el).forEach(b => { b.onclick = () => { if (ro) return; d.unpaid = b.dataset.v === "unpaid"; if (d.unpaid && isCreditChannel(d.paymentChannel)) d.paymentChannel = ""; if (!d.unpaid && !isCreditChannel(d.paymentChannel)) d.dueDate = ""; drawChans(); dueToggle(); }; });
  const ach = $("[data-addch]", el); if (ach) ach.onclick = async () => { const n = await quickAddList("payment_channel"); if (n) { d.paymentChannel = n; drawChans(); dueToggle(); } };
  const acat = $("[data-addcat]", el); if (acat) acat.onclick = async () => { const n = await quickAddList(T.cat); if (n) { cats = listNames(T.cat); d.items[d.items.length - 1].category = n; redrawLines(); } };
  $("[name=vatMode]", el).onchange = e => { d.vatMode = e.target.value; recalc(); };
  $$("[data-dtype] button", el).forEach(b => { b.onclick = () => { if (ro) return; d.discountType = b.dataset.v; $$("[data-dtype] button", el).forEach(x => x.classList.toggle("on", x === b)); recalc(); }; });
  const al = $("[data-addline]", el); if (al) al.onclick = () => { const last = d.items[d.items.length - 1]; d.items.push({ name: "", category: last ? last.category : cats[0], qty: 1, unit: "", price: "" }); redrawLines(); $$("tr[data-i]", el).pop().querySelector("[data-f=name]").focus(); };
  drawChans(); bindLines(); recalc(); dueToggle(); drawFiles();
  const save = $("[data-save]", el);
  if (save) save.onclick = () => withBtn(save, async () => {
    const needDue = d.unpaid || isCreditChannel(d.paymentChannel);
    const payload = { type, date: d.date, party: d.party, description: d.description, paymentChannel: d.paymentChannel, unpaid: d.unpaid, dueDate: needDue ? d.dueDate : "",
      items: d.items.map(i => ({ name: i.name, category: i.category, qty: num(i.qty, 0), unit: i.unit, price: num(i.price, 0), stockItemId: i.stockItemId || "" })), discountType: d.discountType, discountValue: num(d.discountValue), vatMode: d.vatMode, note: d.note };
    if (!id && !d.unpaid && (d.months === "n" || d.months > 1) && isCreditChannel(d.paymentChannel)) {
      const months = Math.round(num($("[name=months]", el).value)), payDay = Math.round(num($("[name=payDay]", el).value));
      if (months < 2 || months > 60) throw new Error("จำนวนงวดผ่อนต้องอยู่ระหว่าง 2 - 60");
      if (payDay < 1 || payDay > 31) throw new Error("วันที่จ่ายต้องอยู่ระหว่าง 1 - 31");
      const r = await bapi("POST", "/card-plans", { ...payload, months, payDay, firstMonth: $("[name=firstMonth]", el).value, interest: num($("[name=interest]", el).value) });
      if (prefill && prefill.replacePlanId) { try { await bapi("DELETE", "/card-plans/" + prefill.replacePlanId); } catch (e) { toast("บันทึกแผนใหม่แล้ว แต่ลบแผนเดิมไม่สำเร็จ: " + e.message + " — ยกเลิกแผนเดิมที่เมนูบัตรเครดิต", "bad"); } }
      toast(`${prefill ? "แก้ไขแผนผ่อนแล้ว" : "บันทึกผ่อน " + months + " งวดแล้ว"} · เดือนละ ${baht(r.perMonth)} · งวดแรก ${thDate(r.firstDue)}`); m.close(); onSaved && onSaved(); return;
    }
    if (needDue && !d.dueDate) throw new Error("กรุณาระบุวันครบกำหนด" + W.settle);
    if (!needDue && !d.paymentChannel) throw new Error("กรุณาเลือก" + W.ch + " หรือกด “" + W.unpaid + "”");
    const r = id ? await bapi("PUT", "/records/" + id, payload) : await bapi("POST", "/records", payload);
    for (const f of pending) await bapi("POST", "/records/" + r.record.id + "/files", { filename: f.filename, mime: f.mime, data: f.data });
    if (payload.items.some(i => i.stockItemId) || id) S.stockItems = null;
    toast((id ? "บันทึกการแก้ไข " : "บันทึกเอกสาร ") + r.record.docNo + " แล้ว"); m.close(); onSaved && onSaved();
  }).catch(() => {});
  const del = $("[data-del]", el);
  if (del) del.onclick = async () => { if (!await confirmBox(`ลบเอกสาร ${d.docNo} ยอด ${baht(d.total)}?\nไฟล์แนบและรายการสต็อกที่ผูกไว้จะถูกลบด้วย`, { danger: true, okText: "ลบเอกสาร" })) return;
    try { await withBtn(del, () => bapi("DELETE", "/records/" + id)); } catch (e) { return; } S.stockItems = null; toast("ลบเอกสารแล้ว"); m.close(); onSaved && onSaved(); };
  const pr = $("[data-print]", el); if (pr) pr.onclick = () => printDoc(d);
  const cp = $("[data-copydoc]", el); if (cp) cp.onclick = () => { m.close(); openDoc(type, null, onSaved, { copy: true, fromNo: d.docNo, form: d }); };
  const ds = $("[data-dosettle]", el); if (ds) ds.onclick = () => withBtn(ds, async () => { await bapi("POST", "/records/" + id + "/settle", { date: $("[data-settledate]", el).value, channel: $("[data-settlech]", el).value }); toast("บันทึกการชำระแล้ว"); m.close(); onSaved && onSaved(); }).catch(() => {});
  const us = $("[data-unsettle]", el); if (us) us.onclick = () => withBtn(us, async () => { await bapi("POST", "/records/" + id + "/settle", { undo: true }); toast("ยกเลิกสถานะชำระแล้ว"); m.close(); onSaved && onSaved(); }).catch(() => {});
}
function companyHead(title, sub) {
  const c = S.binfo.company, b = S.binfo.branch;
  return `<div class="head"><div style="display:flex;gap:12px">${c.logo ? `<img class="logo" src="${esc(c.logo)}">` : ""}<div><h1>${esc(c.name)}</h1><div>${esc(b.name)}${b.code ? " (" + esc(b.code) + ")" : ""}</div>
    <div class="muted">${esc(b.address || c.address || "")}</div><div class="muted">${(b.taxId || c.taxId) ? "เลขประจำตัวผู้เสียภาษี " + esc(b.taxId || c.taxId) : ""} ${(b.phone || c.phone) ? " โทร " + esc(b.phone || c.phone) : ""}</div></div></div>
    <div style="text-align:right"><h2>${title}</h2><div class="muted">${sub || ""}</div></div></div>`;
}
function printDoc(d) {
  const T = TYPE[d.type], t = calcDoc({ ...d, items: d.items.map(i => ({ ...i })) });
  const html = companyHead(T.doc, `เลขที่ <b>${esc(d.docNo)}</b><br>วันที่ ${thDate(d.date)}`) +
    `<table style="margin-bottom:12px"><tr><td style="border:0;padding:0 0 4px"><b>${T.party}:</b> ${esc(d.party || "-")}</td><td style="border:0;text-align:right"><b>ช่องทาง:</b> ${esc(d.paymentChannel || "-")}${d.dueDate ? ` · ครบกำหนด ${thDate(d.dueDate)}` : ""}</td></tr></table>
    <table><thead><tr><th>#</th><th>รายละเอียด</th><th>หมวด</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">จำนวนเงิน</th></tr></thead><tbody>
    ${d.items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td class="num">${fmtQ(i.qty)} ${esc(i.unit || "")}</td><td class="num">${fmt(i.price)}</td><td class="num">${fmt(i.amount)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="5" class="num">รวมเป็นเงิน</td><td class="num">${fmt(t.subtotal)}</td></tr>${t.discount ? `<tr><td colspan="5" class="num">ส่วนลด</td><td class="num">-${fmt(t.discount)}</td></tr>` : ""}
    ${d.vatMode !== "none" ? `<tr><td colspan="5" class="num">ภาษีมูลค่าเพิ่ม 7% ${d.vatMode === "incl" ? "(รวมในราคา)" : ""}</td><td class="num">${fmt(t.vat)}</td></tr>` : ""}
    <tr><td colspan="5" class="num">ยอดสุทธิ (${bahtText(t.total)})</td><td class="num" style="font-size:14px">${fmt(t.total)}</td></tr></tfoot></table>
    ${d.note ? `<p><b>หมายเหตุ:</b> ${esc(d.note)}</p>` : ""}<div class="sig"><div>ผู้จัดทำ</div><div>ผู้อนุมัติ</div></div>`;
  printHTML(d.docNo, html);
}

/* ---------- ledger ---------- */
BRANCH_PAGES.ledger = { title: () => "สมุดบัญชี / รายงาน", async render(c) {
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>สมุดบัญชี</h2><div class="muted small">รายการรับ-จ่ายทั้งหมดเรียงตามวันที่ พร้อมยอดคงเหลือสะสม</div></div>${rangeBar()}</div>
    <div class="card"><div class="toolbar"><div class="seg" data-tf>${[["all", "ทั้งหมด"], ["income", "รายรับ"], ["expense", "รายจ่าย"], ["invest", "สินทรัพย์"]].map(([k, l], i) => `<button data-t="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div><div class="grow"></div>
      <button class="btn sm" data-print>${icon("print")} พิมพ์ / PDF</button><button class="btn sm" data-csv>${icon("download")} Excel (CSV)</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:200px"><div class="spinner"></div></div></div></div>
    <div class="dash-grid even" style="margin-top:14px" data-pl></div>`;
  bindRange(c, () => BRANCH_PAGES.ledger.render(c));
  const recs = (await bapi("GET", "/records?" + rq())).records.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let tf = "all";
  const rowsOf = () => recs.filter(r => tf === "all" || r.type === tf);
  const draw = () => {
    const rows = rowsOf(); let bal = 0, ti = 0, to = 0;
    const body = rows.map(r => { const inc = r.type === "income" ? r.total : 0, out = r.type !== "income" ? r.total : 0; bal += inc - out; ti += inc; to += out;
      return `<tr class="click" data-id="${r.id}" data-type="${r.type}"><td>${thDate(r.date, true)}</td><td class="doc">${esc(r.docNo)}</td><td><span class="chip ${TYPE[r.type].chip} plain">${TYPE[r.type].th.split(" ")[0]}</span></td><td><div class="desc">${esc(r.party ? r.party + " · " : "")}${esc(r.description)}</div><div class="muted small desc">${esc(r.category)}</div></td><td class="small">${esc(r.paymentChannel)}</td>
        <td class="num">${inc ? fmt(inc) : ""}</td><td class="num">${out ? fmt(out) : ""}</td><td class="num bold ${bal < 0 ? "neg" : ""}">${fmt(bal)}</td></tr>`; }).join("");
    $("[data-tbl]", c).innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>วันที่</th><th>เลขที่</th><th>ประเภท</th><th>รายละเอียด</th><th>ช่องทาง</th><th class="num">รับ</th><th class="num">จ่าย</th><th class="num">คงเหลือสะสม</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td colspan="5">รวม ${rows.length} รายการ</td><td class="num">${fmt(ti)}</td><td class="num">${fmt(to)}</td><td class="num ${ti - to < 0 ? "neg" : ""}">${fmt(ti - to)}</td></tr></tfoot></table>` : emptyBox("ไม่มีรายการในช่วงนี้", "ledger");
    $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => openDoc(tr.dataset.type, tr.dataset.id, () => BRANCH_PAGES.ledger.render(c)); });
  };
  // งบกำไรขาดทุนอย่างย่อ
  const sumCat = type => { const m = {}; recs.filter(r => r.type === type).forEach(r => { const sub = r.subtotal || 0; r.items.forEach(it => { const share = sub > 0 ? r.total * (it.amount / sub) : r.total / r.items.length; m[it.category] = (m[it.category] || 0) + share; }); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const inc = sumCat("income"), exp = sumCat("expense"), inv = sumCat("invest");
  const TI = inc.reduce((a, x) => a + x[1], 0), TE = exp.reduce((a, x) => a + x[1], 0), TV = inv.reduce((a, x) => a + x[1], 0);
  const plRows = (arr) => arr.map(([n, v]) => `<tr><td style="padding-left:28px">${esc(n)}</td><td class="num">${fmt(v)}</td></tr>`).join("");
  const plHtml = `<table class="tbl"><tbody><tr><td class="bold">รายได้</td><td></td></tr>${plRows(inc)}<tr><td class="bold">รวมรายได้</td><td class="num bold">${fmt(TI)}</td></tr>
    <tr><td class="bold">ค่าใช้จ่าย</td><td></td></tr>${plRows(exp)}<tr><td class="bold">รวมค่าใช้จ่าย</td><td class="num bold">${fmt(TE)}</td></tr></tbody>
    <tfoot><tr><td>กำไร (ขาดทุน) สุทธิ</td><td class="num ${TI - TE < 0 ? "neg" : "pos"}">${fmt(TI - TE)}</td></tr></tfoot></table>`;
  $("[data-pl]", c).innerHTML = `<div class="card"><div class="card-h"><h3 class="grow">งบกำไรขาดทุน (อย่างย่อ)</h3><button class="btn sm" data-plprint>${icon("print")} พิมพ์</button></div><div class="card-b flush">${plHtml}</div></div>
    <div class="card"><div class="card-h"><h3 class="grow">สินทรัพย์ / งบลงทุนที่ซื้อในช่วงนี้</h3></div><div class="card-b flush">${inv.length ? `<table class="tbl"><tbody>${inv.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${fmt(v)}</td></tr>`).join("")}</tbody><tfoot><tr><td>รวม</td><td class="num">${fmt(TV)}</td></tr></tfoot></table>` : emptyBox("ไม่มีรายการสินทรัพย์ในช่วงนี้", "invest")}</div></div>`;
  $$("[data-t]", c).forEach(b => { b.onclick = () => { tf = b.dataset.t; $$("[data-t]", c).forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
  const per = `ช่วงวันที่ ${thDate(S.range.from)} – ${thDate(S.range.to)}`;
  $("[data-print]", c).onclick = () => { const t = $("[data-tbl] table", c); if (!t) return toast("ไม่มีข้อมูล", "bad"); printHTML("สมุดบัญชี", companyHead("สมุดบัญชีรับ-จ่าย", per) + t.outerHTML, "@page{size:A4 landscape}.chip{padding:0}.doc{color:#1f6feb}"); };
  $("[data-plprint]", c).onclick = () => printHTML("งบกำไรขาดทุน", companyHead("งบกำไรขาดทุน (อย่างย่อ)", per) + plHtml);
  $("[data-csv]", c).onclick = () => { let bal = 0; downloadCSV("ledger-" + S.range.from + "_" + S.range.to + ".csv", [["วันที่", "เลขที่", "ประเภท", "คู่ค้า", "รายละเอียด", "หมวด", "ช่องทาง", "รับ", "จ่าย", "คงเหลือสะสม"],
    ...rowsOf().map(r => { const i = r.type === "income" ? r.total : 0, o = r.type !== "income" ? r.total : 0; bal += i - o; return [r.date, r.docNo, TYPE[r.type].th, r.party, r.description, r.category, r.paymentChannel, i || "", o || "", r2(bal)]; })]); };
  draw();
} };

/* ---------- money accounts (เงินในบัญชี) ---------- */
BRANCH_PAGES.accounts = { title: () => "เงินในบัญชี / ยอดคงเหลือ", async render(c) {
  const self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>เงินในบัญชี</h2><div class="muted small">ยอดคงเหลือของเงินสดและบัญชีธนาคารแต่ละบัญชี คำนวณจากยอดยกมา + รับ − จ่าย + โอนระหว่างบัญชี</div></div>
    ${rangeBar()}${canEdit("accounts") ? `<button class="btn" data-transfer>${icon("link")} โอนระหว่างบัญชี</button><button class="btn primary" data-add>${icon("plus")} เพิ่มบัญชี</button>` : ""}</div><div data-body><div class="boot" style="height:240px"><div class="spinner"></div></div></div>`;
  bindRange(c, () => self.render(c));
  if ($("[data-add]", c)) $("[data-add]", c).onclick = async () => { if (await quickAddList("payment_channel")) self.render(c); };
  const a = await bapi("GET", "/accounts?" + rq());
  if ($("[data-transfer]", c)) $("[data-transfer]", c).onclick = () => transferModal(a.accounts.filter(x => !x.orphan), () => self.render(c));
  const card = x => `<div class="card acc-card"><div class="card-b">
      <div class="row"><div class="acc-ic">${icon(/สด/.test(x.name) ? "payroll" : "building")}</div><div class="grow"><div class="bold">${esc(x.name)}</div>
        <div class="muted small">${x.orphan ? "ชื่อนี้ไม่อยู่ในรายการช่องทางแล้ว" : x.openingBalance == null ? `<span style="color:var(--warn)">ยังไม่ได้ตั้งยอดยกมา</span>` : "ยอดยกมา " + baht(x.openingBalance) + " ณ " + thDate(x.openingDate, true)}</div></div></div>
      <div class="acc-bal ${x.balance < 0 ? "neg" : ""}">${baht(x.balance)}</div>
      <div class="row small" style="justify-content:space-between"><span class="pos">รับเข้า ${baht(x.periodIn)}</span><span class="neg">จ่ายออก ${baht(x.periodOut)}</span></div>
      <div class="muted small" style="margin-top:2px">ช่วง ${thDate(S.range.from, true)} – ${thDate(S.range.to, true)}</div>
      <div class="row" style="margin-top:12px"><button class="btn sm grow" data-st="${esc(x.name)}">${icon("ledger")} รายการเดินบัญชี</button>${x.orphan || !canEdit("accounts") ? "" : `<button class="btn sm" data-ob="${x.id}">ตั้งยอดยกมา</button>`}</div></div></div>`;
  $("[data-body]", c).innerHTML = `
    <div class="pay-grid" style="margin-bottom:14px"><div class="mini-kpi"><div class="l">เงินรวมทุกบัญชี (ณ วันนี้)</div><div class="v ${a.total < 0 ? "neg" : ""}" style="color:${a.total < 0 ? "" : "var(--primary)"}">${baht(a.total)}</div></div>
      <div class="mini-kpi"><div class="l">ค้างรับ (ลูกค้า/แอปยังไม่โอน)</div><div class="v">${baht(a.receivable)}</div></div><div class="mini-kpi"><div class="l">ค้างจ่าย (รวมบัตรเครดิต)</div><div class="v">${baht(a.payable)}</div></div>
      <div class="mini-kpi"><div class="l">เงินคงเหลือหลังเคลียร์ค้างรับ-ค้างจ่าย</div><div class="v">${baht(a.total + a.receivable - a.payable)}</div></div></div>
    ${a.accounts.length ? `<div class="acc-grid">${a.accounts.map(card).join("")}</div>` : emptyBox("ยังไม่มีบัญชีเงิน — กด “เพิ่มบัญชี” เช่น เงินสด, บัญชีกสิกร", "wallet")}
    ${a.credits.length ? `<div class="card" style="margin-top:14px"><div class="card-h"><h3 class="grow">ช่องทางแบบเครดิต (ยังไม่ตัดเงินจริง)</h3></div><div class="card-b flush">${a.credits.map(x => `<div class="list-row"><div class="grow"><div class="bold">${esc(x.name)}</div><div class="muted small">${x.count} รายการค้างชำระ</div></div>
      ${x.payable ? `<div style="text-align:right"><div class="muted small">ค้างจ่าย</div><div class="bold num">${baht(x.payable)}</div></div>` : ""}${x.receivable ? `<div style="text-align:right"><div class="muted small">ค้างรับ</div><div class="bold num">${baht(x.receivable)}</div></div>` : ""}${!x.payable && !x.receivable ? `<span class="chip good">ไม่มียอดค้าง</span>` : ""}</div>`).join("")}</div></div>` : ""}
    <div class="info-box" style="margin-top:14px">วิธีใช้: ① กด “ตั้งยอดยกมา” ใส่ยอดเงินจริงในแต่ละบัญชี ณ วันที่เริ่มใช้ระบบ ② บันทึกรายรับ/รายจ่ายโดยเลือกบัญชีที่เงินเข้า-ออก ③ รายการที่ “ยังไม่จ่าย” จะยังไม่ตัดเงิน จนกว่าจะกด “บันทึกว่าจ่ายเงินแล้ว” และเลือกบัญชีที่จ่าย ④ ฝากเงินสดเข้าธนาคาร / ถอนเงิน ใช้ปุ่ม “โอนระหว่างบัญชี”</div>`;
  $$("[data-st]", c).forEach(b => { b.onclick = () => statementModal(b.dataset.st, () => self.render(c)); });
  $$("[data-ob]", c).forEach(b => { b.onclick = () => { const x = a.accounts.find(y => y.id === b.dataset.ob);
    const m = openModal({ title: "ตั้งยอดยกมา · " + esc(x.name), body: `<div class="grid g2"><label class="field"><span>ยอดเงินในบัญชีจริง (บาท)</span><input class="input num" name="amount" inputmode="decimal" value="${x.openingBalance == null ? "" : x.openingBalance}"></label><label class="field"><span>ณ วันที่ (ต้นวัน)</span><input type="date" class="input" name="date" value="${esc(x.openingDate || today())}"></label></div>
      <div class="field-hint" style="margin-top:10px">ระบบจะนับเฉพาะรายการตั้งแต่วันที่นี้เป็นต้นไป รายการก่อนหน้าถือว่ารวมอยู่ในยอดยกมาแล้ว — ดูยอดจริงจากสมุดบัญชีหรือแอปธนาคาร ณ เช้าวันนั้น</div>`,
      foot: `${x.openingBalance != null ? `<div class="left"><button class="btn danger" data-clear>ล้างยอดยกมา</button></div>` : ""}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึก</button>` });
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); if (f.amount === "") throw new Error("กรุณาใส่ยอดเงิน"); await bapi("POST", "/accounts/opening", { id: x.id, amount: num(f.amount), date: f.date }); m.close(); toast("ตั้งยอดยกมาแล้ว"); self.render(c); }).catch(() => {});
    const cl = $("[data-clear]", m.el); if (cl) cl.onclick = async () => { await bapi("POST", "/accounts/opening", { id: x.id, amount: null }); m.close(); toast("ล้างยอดยกมาแล้ว"); self.render(c); }; }; });
} };
function transferModal(accts, after) {
  if (accts.length < 2) return toast("ต้องมีบัญชีอย่างน้อย 2 บัญชี — กด “เพิ่มบัญชี” ก่อน", "bad");
  const o = sel => accts.map(x => opt(x.name, x.name + " (คงเหลือ " + baht(x.balance) + ")", x.name === sel)).join("");
  const cash = (accts.find(x => /สด/.test(x.name)) || accts[0]).name, bank = (accts.find(x => x.name !== cash) || accts[1]).name;
  const m = openModal({ title: "โอนเงินระหว่างบัญชี", body: `<div class="grid g2"><label class="field"><span>จากบัญชี</span><select class="input" name="from">${o(cash)}</select></label><label class="field"><span>ไปบัญชี</span><select class="input" name="to">${o(bank)}</select></label>
    <label class="field"><span>จำนวนเงิน</span><input class="input num" name="amount" inputmode="decimal" placeholder="0.00"></label><label class="field"><span>วันที่</span><input type="date" class="input" name="date" value="${today()}"></label></div>
    <label class="field" style="margin-top:14px"><span>หมายเหตุ</span><input class="input" name="note" placeholder="เช่น ฝากเงินสดเข้าธนาคาร, ถอนเงินมาทอน"></label><div class="field-hint" style="margin-top:8px">การโอนระหว่างบัญชีไม่ใช่รายรับหรือรายจ่าย จึงไม่กระทบกำไร</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} บันทึกการโอน</button>` });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); await bapi("POST", "/transfers", { ...f, amount: num(f.amount, NaN) }); m.close(); toast("บันทึกการโอนแล้ว"); after(); }).catch(() => {});
}
async function statementModal(name, after) {
  const st = await bapi("GET", "/accounts/statement?ch=" + encodeURIComponent(name) + "&" + rq());
  const label = { income: "รายรับ", expense: "รายจ่าย", invest: "สินทรัพย์", transfer: "โอน" };
  const rowsHtml = st.rows.map(r => `<tr class="${r.recordId ? "click" : ""}" ${r.recordId ? `data-rec="${r.recordId}" data-type="${r.kind}"` : ""}><td>${thDate(r.date, true)}</td><td>${r.docNo ? `<span class="doc">${esc(r.docNo)}</span>` : `<span class="chip blue plain">${label[r.kind]}</span>`}</td>
    <td><div class="desc">${esc(r.text)}</div>${r.settle ? `<div class="muted small">ชำระรายการค้าง</div>` : ""}</td><td class="num pos">${r.amount > 0 ? fmt(r.amount) : ""}</td><td class="num neg">${r.amount < 0 ? fmt(-r.amount) : ""}</td><td class="num bold">${fmt(r.balance)}</td>
    <td>${r.transferId && canEdit("accounts") ? `<button class="btn ghost sm icon" data-deltr="${r.transferId}" title="ลบรายการโอน">${icon("trash")}</button>` : ""}</td></tr>`).join("");
  const tbl = `<table class="tbl"><thead><tr><th>วันที่</th><th>เอกสาร</th><th>รายละเอียด</th><th class="num">เงินเข้า</th><th class="num">เงินออก</th><th class="num">คงเหลือ</th><th></th></tr></thead><tbody>
    <tr><td>${thDate(S.range.from, true)}</td><td colspan="4" class="muted">ยอดยกมาต้นงวด${st.openingDate && st.openingDate > S.range.from ? " (ตั้งยอดยกมาเมื่อ " + thDate(st.openingDate, true) + ")" : ""}</td><td class="num bold">${fmt(st.startBalance)}</td><td></td></tr>${rowsHtml}</tbody>
    <tfoot><tr><td colspan="3">ยอดคงเหลือปลายงวด · ${st.rows.length} รายการ</td><td class="num">${fmt(st.rows.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0))}</td><td class="num">${fmt(-st.rows.filter(r => r.amount < 0).reduce((a, r) => a + r.amount, 0))}</td><td class="num">${fmt(st.endBalance)}</td><td></td></tr></tfoot></table>`;
  const m = openModal({ title: "รายการเดินบัญชี · " + esc(name), size: "xl", body: `<div class="muted small" style="margin-bottom:10px">ช่วง ${thDate(S.range.from)} – ${thDate(S.range.to)} (เปลี่ยนช่วงได้ที่ตัวเลือกวันที่ด้านบนของหน้า)</div><div class="card tbl-wrap">${tbl}</div>`,
    foot: `<div class="left"><button class="btn" data-print>${icon("print")} พิมพ์</button><button class="btn" data-csv>${icon("download")} CSV</button></div><button class="btn" data-close>ปิด</button>` });
  $$("[data-rec]", m.el).forEach(tr => { tr.onclick = () => { m.close(); openDoc(tr.dataset.type, tr.dataset.rec, after); }; });
  $$("[data-deltr]", m.el).forEach(b => { b.onclick = async e => { e.stopPropagation(); if (!await confirmBox("ลบรายการโอนนี้? ยอดทั้งสองบัญชีจะถูกคำนวณใหม่", { danger: true, okText: "ลบ" })) return; await bapi("DELETE", "/transfers/" + b.dataset.deltr); toast("ลบแล้ว"); m.close(); after(); }; });
  $("[data-print]", m.el).onclick = () => printHTML("รายการเดินบัญชี " + name, companyHead("รายการเดินบัญชี: " + esc(name), "ช่วง " + thDate(S.range.from) + " – " + thDate(S.range.to)) + tbl.replace(/<button[\s\S]*?<\/button>/g, ""), ".chip{padding:0}.pos{color:#0f8a4a}.neg{color:#d92d20}");
  $("[data-csv]", m.el).onclick = () => downloadCSV("statement-" + name + ".csv", [["วันที่", "เอกสาร", "รายละเอียด", "เงินเข้า", "เงินออก", "คงเหลือ"], ["", "", "ยอดยกมาต้นงวด", "", "", st.startBalance], ...st.rows.map(r => [r.date, r.docNo || label[r.kind], r.text, r.amount > 0 ? r.amount : "", r.amount < 0 ? -r.amount : "", r.balance])]);
}

/* ---------- stock ---------- */
const MOVE = { in: { th: "รับเข้า", chip: "good", sign: "+" }, out: { th: "เบิกใช้", chip: "blue", sign: "−" }, waste: { th: "ของเสีย / ทิ้ง", chip: "bad", sign: "−" }, count: { th: "ตรวจนับ", chip: "warn", sign: "±" } };
/* ---------- สต็อก: หน้าเบิกของ (ใช้ง่ายบนมือถือ) ---------- */
const NOCAT = "ไม่ระบุหมวด";
/* ===== หน่วยนับหลายหน่วย (v2.7) ===== */
const unitsOf = i => [{ n: i.unit || "", f: 1 }].concat(i.units || []);
const ufOf = (i, u) => (unitsOf(i).find(x => x.n === u) || { f: 1 }).f;
const unitSel = (i, cur, attr) => (i.units || []).length ? `<select class="input sm u-sel" ${attr}>${unitsOf(i).map(x => opt(x.n, x.f === 1 ? (x.n || "หน่วยหลัก") : `${x.n} (${fmtQ(x.f)} ${i.unit})`, x.n === (cur || i.unit))).join("")}</select>` : `<span class="u-txt">${esc(i.unit || "")}</span>`;
const uNote = m => m.inUnit ? `<div class="muted small">${fmtQ(m.inQty)} ${esc(m.inUnit)}${m.inPrice != null ? " @ " + fmt(m.inPrice) : ""}</div>` : "";
const unitsHint = i => (i.units || []).length ? (i.units || []).map(u => `1 ${u.n} = ${fmtQ(u.f)} ${i.unit}`).join(" · ") : "";

// ปุ่มรับเข้า/ของเสีย/ตรวจนับ/เพิ่มสินค้า แบบแถวเดียว (เลื่อนแนวนอนได้บนมือถือ)
function stockActions() {
  if (!canEdit("stock")) return "";
  const boss = approver("stock");
  return `${boss ? `<div class="stock-actions"><button class="btn sm" data-mv="count">${icon("check")} ตรวจนับ</button>${S.adminToken ? `<button class="btn sm" data-copystock>${icon("copy")} คัดลอกไปสาขาอื่น</button>` : ""}<button class="btn sm primary" data-newitem>${icon("plus")} เพิ่มสินค้า</button></div>` : ""}
    ${boss && S.pending && S.pending.stock ? `<div class="info-box row" style="margin-bottom:12px"><span class="grow">มีรายการสต็อกรออนุมัติ <b>${S.pending.stock}</b> รายการ</span><a class="btn sm primary" href="#/b/${S.bid}/approvals">ไปอนุมัติ</a></div>` : ""}`;
}
function bindStockActions(root, after) {
  const n = $("[data-newitem]", root); if (n) n.onclick = () => stockItemModal(null, after);
  const cs = $("[data-copystock]", root); if (cs) cs.onclick = () => copyStockModal(S.bid, after);
  $$("[data-mv]", root).forEach(b => { b.onclick = () => stockBatchModal(b.dataset.mv, null, after); });
}
const stockCats = items => { const order = listNames("stock_category"); const used = new Set(items.map(i => i.category || NOCAT));
  return [...order.filter(n => used.has(n)), ...[...used].filter(n => !order.includes(n) && n !== NOCAT), ...(used.has(NOCAT) ? [NOCAT] : [])]; };
const canManageCats = () => canEdit("settings") || (canEdit("stock") && approver("stock"));
const hm = ms => new Date(ms).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
const QMODE = { out: { th: "เบิกของ", tap: "แตะเพื่อเบิก", btn: "เบิก", ic: "expense", sel: "เลือกเบิก" }, in: { th: "รับเข้า / เติม", tap: "แตะเพื่อรับเข้า", btn: "รับเข้า", ic: "income", sel: "รับเข้า" }, waste: { th: "ของเสีย", tap: "แตะเพื่อแจ้งของเสีย", btn: "บันทึกของเสีย", ic: "trash", sel: "ของเสีย" },
  xfer: { th: "โยกไปสาขาอื่น", tap: "แตะเพื่อโยก", btn: "โยกของ", ic: "building", sel: "โยก" } };
async function stockQuick(c, st, self) {
  const ed = canEdit("stock"), boss = approver("stock");
  const modes = ed ? (boss ? ["out", "in", "waste", "xfer"] : ["out", "waste"]) : [];
  if (!modes.includes(st.mode)) st.mode = "out";
  const mode = st.mode, M = QMODE[mode];
  st.cm = st.cm || {}; st.cu = st.cu || {}; ["out", "in", "waste", "xfer"].forEach(k => { st.cm[k] = st.cm[k] || {}; st.cu[k] = st.cu[k] || {}; }); st.cp = st.cp || {};
  const cart = st.cm[mode], cu = st.cu[mode];
  const [items, rec] = await Promise.all([loadStockItems(true), bapi("GET", "/stock/recent")]);
  const act = items.filter(i => i.active);
  Object.keys(st.cm).forEach(k => Object.keys(st.cm[k]).forEach(id => { if (!act.find(i => i.id === id)) delete st.cm[k][id]; }));
  const body = $("[data-body]", c);
  const todayMv = rec.moves.filter(m => m.date === rec.today), yMv = rec.moves.filter(m => m.date !== rec.today);
  const recRow = m => `<div class="rc-row"><div class="grow"><div class="bold">${esc(m.itemName)}</div><div class="small muted">${esc(m.createdBy)} · ${m.date === rec.today ? "" : "เมื่อวาน "}${hm(m.createdAt)}${m.note ? " · " + esc(m.note) : ""}</div></div>
    <div class="rc-qty">${m.inUnit ? `−${fmtQ(m.inQty)} <span>${esc(m.inUnit)}</span><div class="small muted" style="font-weight:400">= ${fmtQ(Math.abs(m.qty))} ${esc(m.unit)}</div>` : `−${fmtQ(Math.abs(m.qty))} <span>${esc(m.unit)}</span>`}</div>${m.canEdit ? `<button class="btn sm" data-editmv="${m.id}">${icon("edit")} แก้ไข</button>` : ""}</div>`;
  const cats = stockCats(act);
  const count = n => act.filter(i => (i.category || NOCAT) === n).length;
  const lowN = act.filter(i => i.low || i.qty <= 0).length;
  const fu = (it, u) => ufOf(it, u || it.unit);
  const priceOf = it => st.cp[it.id] !== undefined && st.cp[it.id] !== "" ? num(st.cp[it.id]) : r2(it.avgCost * fu(it, cu[it.id]));
  const hint = mode === "in" ? `แตะสินค้า → ใส่จำนวน · หน่วย · ราคาต่อหน่วย ได้ในการ์ดเลย เลือกได้หลายอย่าง แล้วกด “รับเข้า” ด้านล่าง`
    : mode === "waste" ? `แตะสินค้าที่เสีย/ทิ้ง → ใส่จำนวน → กด “บันทึกของเสีย”${boss ? "" : " · <b>รอผู้จัดการอนุมัติก่อนตัดสต็อก</b>"}`
    : mode === "xfer" ? `แตะสินค้าที่จะส่งไปสาขาอื่น → ใส่จำนวน → กด “โยกของ” แล้วเลือกสาขาปลายทาง · สาขานี้ตัดสต็อกทันที สาขาปลายทางกดอนุมัติเพื่อรับของ (ถ้าไม่อนุมัติ ของจะคืนกลับมาเอง)` : "";
  body.innerHTML = `${mode === "out" ? `<div class="recent-card"><div class="rc-head"><div class="rc-ic">${icon("expense")}</div><div class="grow"><b>เบิกล่าสุด</b><div class="small">วันนี้ ${todayMv.length} รายการ</div></div>${yMv.length ? `<button class="btn sm ghost" data-showy>เมื่อวาน (${yMv.length})</button>` : ""}</div>
      <div class="rc-list">${todayMv.length ? todayMv.slice(0, st.allRecent ? 40 : 5).map(recRow).join("") : `<div class="small muted" style="padding:8px 2px">วันนี้ยังไม่มีการเบิก</div>`}
      ${todayMv.length > 5 && !st.allRecent ? `<button class="btn sm ghost" data-allrec style="width:100%">ดูทั้งหมดวันนี้ (${todayMv.length})</button>` : ""}
      <div class="hidden" data-yest>${yMv.length ? `<div class="small muted" style="padding:8px 2px 2px">เมื่อวาน</div>` + yMv.map(recRow).join("") : ""}</div></div></div>` : ""}
    ${modes.length > 1 ? `<div class="q-modes">${modes.map(k => `<button data-qm="${k}" class="${k === mode ? "on " + k : ""}">${icon(QMODE[k].ic)} ${QMODE[k].th}${Object.keys(st.cm[k]).length ? ` <span class="qm-n">${Object.keys(st.cm[k]).length}</span>` : ""}</button>`).join("")}</div>` : ""}
    ${hint ? `<div class="info-box q-hint ${mode}">${hint}</div>` : ""}
    ${stockActions()}
    <div class="q-tools"><div class="search grow" style="max-width:none">${icon("search")}<input class="input" placeholder="ค้นหาสินค้า" value="${esc(st.qq || "")}" data-qq></div>${canManageCats() ? `<button class="btn" data-mancat>${icon("settings")} จัดการหมวด</button>` : ""}</div>
    <div class="cat-chips"><button data-qc="" class="${!st.qcat ? "on" : ""}">ทั้งหมด <span>${act.length}</span></button>${cats.map(n => `<button data-qc="${esc(n)}" class="${st.qcat === n ? "on" : ""}">${esc(n)} <span>${count(n)}</span></button>`).join("")}
      ${lowN ? `<button data-qc="__low" class="low ${st.qcat === "__low" ? "on" : ""}">⚠ ใกล้หมด <span>${lowN}</span></button>` : ""}</div>
    <div data-groups></div>
    ${ed ? `<div class="cart-bar ${mode} hidden" data-cartbar><div class="grow"><b data-cartn></b><div class="small muted" data-cartlist></div></div><button class="btn" data-cartclear>ล้าง</button><button class="btn primary" data-cartgo>${icon(M.ic)} ${M.btn}</button></div>` : ""}`;
  const overOf = (it) => mode !== "in" && cart[it.id] * fu(it, cu[it.id]) > it.qty + 1e-9;
  const lineSum = it => { const f = fu(it, cu[it.id]), q = num(cart[it.id]);
    if (mode === "in") return `${f !== 1 ? `= ${fmtQ(q * f)} ${esc(it.unit)} · ` : ""}รวม <b>${fmt(q * priceOf(it))}</b>`;
    return f !== 1 ? `= ${fmtQ(q * f)} ${esc(it.unit)}` : ""; };
  const drawGroups = () => {
    const q = (st.qq || "").toLowerCase();
    const show = act.filter(i => (!q || (i.name + " " + i.sku).toLowerCase().includes(q)) && (!st.qcat || (st.qcat === "__low" ? (i.low || i.qty <= 0) : (i.category || NOCAT) === st.qcat)));
    const groups = stockCats(show).map(n => ({ n, list: show.filter(i => (i.category || NOCAT) === n) }));
    $("[data-groups]", body).innerHTML = show.length ? groups.map(g => `<div class="q-group"><div class="q-gh">${esc(g.n)} <span>${g.list.length}</span></div><div class="q-grid">${g.list.map(i => { const inC = cart[i.id] != null;
      const cls = i.qty <= 0 ? "out" : i.low ? "low" : "";
      return `<div class="q-item ${cls} ${inC ? "sel " + mode : ""} ${inC && mode === "in" ? "wide" : ""}" data-qi="${i.id}">${i.photoV ? `<div class="q-head"><span class="q-ph" style="background-image:url('${stockPhoto(i)}')"></span><div class="q-name">${esc(i.name)}</div></div>` : `<div class="q-name">${esc(i.name)}</div>`}<div class="q-left">เหลือ <b>${fmtQ(i.qty)}</b> ${esc(i.unit)}${i.qty <= 0 ? " · หมด" : i.low ? " · ใกล้หมด" : ""}</div>${i.pending ? `<div class="q-pend">รออนุมัติ ${i.pending} รายการ</div>` : ""}
        ${inC ? `<div class="q-edit" data-step><div class="q-step"><button type="button" data-dec>−</button><input inputmode="decimal" value="${cart[i.id]}" data-qin><button type="button" data-inc>+</button></div>
          ${(i.units || []).length ? `<div class="q-unit">${unitSel(i, cu[i.id], "data-qu")}</div>` : ""}
          ${mode === "in" ? `<label class="q-price"><span>ราคา / <i data-pu>${esc(cu[i.id] || i.unit)}</i></span><input inputmode="decimal" data-qp value="${st.cp[i.id] !== undefined ? esc(st.cp[i.id]) : ""}" placeholder="${fmt(r2(i.avgCost * fu(i, cu[i.id])))}"></label>` : ""}
          <div class="q-sum small" data-qsum>${lineSum(i)}</div><button type="button" class="q-rm" data-qrm>เอาออก</button></div>` : ed ? `<div class="q-tap">${M.tap}</div>` : ""}</div>`; }).join("")}</div></div>`).join("")
      : emptyBox(act.length ? "ไม่พบสินค้า" : "ยังไม่มีสินค้า — " + (boss ? "กด “เพิ่มสินค้า” ด้านบน" : "ให้ผู้จัดการเพิ่มสินค้า"), "stock");
    if (!ed) return;
    $$("[data-qi]", body).forEach(card => {
      const id = card.dataset.qi, it = act.find(i => i.id === id);
      card.onclick = e => { if (e.target.closest("[data-step]")) return; if (cart[id] != null) return; cart[id] = 1; drawGroups(); const inp = $(`[data-qi="${id}"] [data-qin]`, body); if (inp && mode === "in") { inp.focus(); inp.select(); } };
      const inp = $("[data-qin]", card); if (!inp) return;
      const refresh = () => { card.classList.toggle("over", overOf(it)); const s = $("[data-qsum]", card); if (s) s.innerHTML = lineSum(it); drawCart(); };
      const set = v => { v = Math.max(0, Math.round(v * 1000) / 1000); if (!v) { delete cart[id]; drawGroups(); return; } cart[id] = v; inp.value = v; refresh(); };
      const qu = $("[data-qu]", card); if (qu) qu.onchange = () => { cu[id] = qu.value; const pu = $("[data-pu]", card); if (pu) pu.textContent = qu.value; const qp = $("[data-qp]", card); if (qp) qp.placeholder = fmt(r2(it.avgCost * fu(it, qu.value))); refresh(); };
      const qp = $("[data-qp]", card); if (qp) qp.oninput = () => { st.cp[id] = qp.value; refresh(); };
      $("[data-dec]", card).onclick = () => set(num(inp.value) - 1);
      $("[data-inc]", card).onclick = () => set(num(inp.value) + 1);
      $("[data-qrm]", card).onclick = () => { delete cart[id]; delete st.cp[id]; drawGroups(); };
      inp.onclick = () => inp.select();
      inp.oninput = () => { const v = num(inp.value); if (v > 0) { cart[id] = v; refresh(); } };
      inp.onblur = () => { if (!(num(inp.value) > 0)) set(0); };
      card.classList.toggle("over", overOf(it));
    });
    drawCart();
  };
  const totalIn = () => Object.keys(cart).reduce((a, id) => { const i = act.find(x => x.id === id); return a + num(cart[id]) * priceOf(i); }, 0);
  const drawCart = () => { const bar = $("[data-cartbar]", body); if (!bar) return; const ids = Object.keys(cart);
    bar.classList.toggle("hidden", !ids.length); $("[data-cartn]", bar).textContent = M.sel + " " + ids.length + " รายการ" + (mode === "in" ? " · รวม " + baht(totalIn()) : "");
    $("[data-cartlist]", bar).textContent = ids.map(id => { const i = act.find(x => x.id === id); return i.name + " " + fmtQ(cart[id]) + " " + (cu[id] || i.unit); }).join(" · ");
    $$("[data-qm]", body).forEach(b => { const n = Object.keys(st.cm[b.dataset.qm]).length; let x = $(".qm-n", b); if (n && !x) { b.insertAdjacentHTML("beforeend", ` <span class="qm-n"></span>`); x = $(".qm-n", b); } if (x) { x.textContent = n; x.hidden = !n; } }); };
  drawGroups();
  $("[data-qq]", body).oninput = debounce(e => { st.qq = e.target.value; drawGroups(); }, 150);
  $$("[data-qc]", body).forEach(b => { b.onclick = () => { st.qcat = b.dataset.qc; $$("[data-qc]", body).forEach(x => x.classList.toggle("on", x === b)); drawGroups(); }; });
  $$("[data-qm]", body).forEach(b => { b.onclick = () => { st.mode = b.dataset.qm; self.render(c); }; });
  const sy = $("[data-showy]", body); if (sy) sy.onclick = () => $("[data-yest]", body).classList.toggle("hidden");
  const ar = $("[data-allrec]", body); if (ar) ar.onclick = () => { st.allRecent = true; self.render(c); };
  $$("[data-editmv]", body).forEach(b => { b.onclick = () => editMoveModal(rec.moves.find(m => m.id === b.dataset.editmv), () => self.render(c)); });
  const mc = $("[data-mancat]", body); if (mc) mc.onclick = () => stockCatManager(items, () => self.render(c));
  bindStockActions(body, () => self.render(c));
  if (!ed) return;
  $("[data-cartclear]", body).onclick = () => { st.cm[mode] = {}; st.cu[mode] = {}; if (mode === "in") st.cp = {}; self.render(c); };
  $("[data-cartgo]", body).onclick = () => {
    const ids = Object.keys(cart);
    const rows = ids.map(id => { const i = act.find(x => x.id === id), f = fu(i, cu[id]), u = cu[id] || i.unit, q = num(cart[id]);
      return `<div class="cf-row"><div class="grow"><div class="bold">${esc(i.name)}</div><div class="small muted">คงเหลือ ${fmtQ(i.qty)} ${esc(i.unit)}${f !== 1 ? ` · ${fmtQ(q)} ${esc(u)} = ${fmtQ(q * f)} ${esc(i.unit)}` : ""}</div></div>
        <div class="cf-q"><b>${fmtQ(q)}</b> ${esc(u)}${mode === "in" ? `<div class="small muted">@ ${fmt(priceOf(i))} = <b>${fmt(q * priceOf(i))}</b></div>` : ""}</div></div>`; }).join("");
    const m = openModal({ title: (mode === "out" ? "ยืนยันเบิกของ " : mode === "in" ? "ยืนยันรับเข้า " : mode === "xfer" ? "โยกของไปสาขาอื่น " : "ยืนยันของเสีย ") + ids.length + " รายการ", body: `${mode === "xfer" ? `<label class="field" style="margin-bottom:12px"><span>ไปสาขา <em>*</em></span><select class="input" name="to"><option value="">กำลังโหลด…</option></select></label>` : ""}<div class="q-confirm">${rows}</div>
      ${mode === "in" ? `<div class="cf-total">รวมมูลค่า <b>${baht(totalIn())}</b></div>` : ""}
      <div class="grid g2" style="margin-top:12px"><label class="field"><span>วันที่</span><input type="date" class="input" name="date" value="${today()}"></label><label class="field"><span>หมายเหตุ (ไม่บังคับ)</span><input class="input" name="note" placeholder="${mode === "out" ? "เช่น ใช้ทำอาหารกะเช้า" : mode === "in" ? "เช่น ซื้อจากแม็คโคร" : "เช่น เน่าเสีย หมดอายุ"}"></label></div>
      <div class="info-box" style="margin-top:12px">${mode === "out" ? "การเบิกจะตัดสต็อกทันที ไม่ต้องรออนุมัติ · แก้ไข/ลบการเบิกของตัวเองได้ภายในวันนี้" : mode === "in" ? "รับเข้าสต็อกทันที ต้นทุนเฉลี่ยจะคำนวณใหม่ให้" : mode === "xfer" ? "สาขานี้ตัดสต็อกทันที (ต้นทุนเฉลี่ยตามสาขานี้) · สาขาปลายทางต้องกดอนุมัติจึงจะเข้าสต็อก · ถ้าไม่อนุมัติ ของคืนให้สาขานี้อัตโนมัติ · ถ้าปลายทางยังไม่มีสินค้านี้ ระบบสร้างให้" : boss ? "ตัดสต็อกทันที" : "ส่งให้ผู้จัดการอนุมัติก่อน จึงจะตัดสต็อก"}</div>`,
      foot: `<button class="btn" data-close>กลับไปแก้</button><button class="btn primary" data-ok>${icon("check")} ยืนยัน${M.btn}</button>` });
    if (mode === "xfer") bapi("GET", "/stock/transfer/targets").then(t => { const sel = $("[name=to]", m.el); if (!sel) return;
      sel.innerHTML = `<option value="">— เลือกสาขา —</option>` + t.branches.map(b => opt(b.id, b.name, st.xferTo === b.id)).join(""); sel.onchange = () => { st.xferTo = sel.value; }; }).catch(e => toast(e.message, "bad"));
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => {
      const lines = ids.map(id => { const i = act.find(x => x.id === id); return { itemId: id, qty: num(cart[id]), unit: cu[id] || i.unit, unitCost: mode === "in" ? priceOf(i) : undefined }; }).filter(l => l.qty > 0);
      if (!lines.length) throw new Error("ใส่จำนวน");
      let r;
      if (mode === "xfer") { const to = $("[name=to]", m.el).value; if (!to) throw new Error("กรุณาเลือกสาขาปลายทาง");
        r = await bapi("POST", "/stock/transfer", { to, date: $("[name=date]", m.el).value, note: $("[name=note]", m.el).value, lines }); r.pending = false; }
      else r = await bapi("POST", "/stock/moves", { kind: mode, date: $("[name=date]", m.el).value, note: $("[name=note]", m.el).value, lines });
      st.cm[mode] = {}; st.cu[mode] = {}; if (mode === "in") st.cp = {}; S.stockItems = null; m.close();
      toast(r.pending ? "ส่งรออนุมัติแล้ว " + lines.length + " รายการ" : (mode === "out" ? "เบิกแล้ว " : mode === "in" ? "รับเข้าแล้ว " : mode === "xfer" ? "โยกไป " + r.to + " แล้ว " : "บันทึกของเสียแล้ว ") + lines.length + " รายการ"); self.render(c);
    }).catch(() => {});
  };
}
/* ===== รายการที่จะซื้อ + ใบขอซื้อ (PO) — v2.8 ===== */
const PO_ST = { pending: ["รออนุมัติ", "warn"], approved: ["อนุมัติแล้ว · รอซื้อ", "blue"], done: ["ซื้อครบแล้ว", "good"], rejected: ["ไม่อนุมัติ", "bad"], cancelled: ["ยกเลิก", ""] };
async function stockShop(c, st, self) {
  const ed = canEdit("stock"), body = $("[data-body]", c);
  const [d, items] = await Promise.all([bapi("GET", "/shopping"), loadStockItems(true)]);
  const boss = d.boss, rerender = () => { S.stockItems = null; self.render(c); };
  st.sel = st.sel || {}; st.selU = st.selU || {};
  const itemOf = x => x.itemId && items.find(i => i.id === x.itemId);
  const open = d.items.filter(x => x.status === "open" && !x.poId).map(x => ({ ...x, kind: "row" }))
    .concat(d.suggest.map(x => ({ ...x, kind: "auto", id: "auto-" + x.itemId, left: x.qty, qty: null })));
  Object.keys(st.sel).forEach(k => { if (!open.some(x => x.id === k)) delete st.sel[k]; });
  const bought = d.items.filter(x => x.status === "bought");
  const pos = d.pos, pend = pos.filter(p => p.status === "pending"), appr = pos.filter(p => p.status === "approved"), closed = pos.filter(p => !["pending", "approved"].includes(p.status));
  const catOf = x => x.category || NOCAT, order = listNames("stock_category");
  const sortCats = arr => [...new Set(arr.map(catOf))].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, "th"); });
  const defQty = x => { if (x.qty) return x.qty; if (x.kind === "auto") return Math.max(1, Math.ceil(x.minQty * 2 - x.left)); return 1; };
  const unitOfSel = x => st.selU[x.id] || x.unit || (itemOf(x) || {}).unit || "";
  const estOf = x => { const it = itemOf(x); return it ? r2(it.avgCost * ufOf(it, unitOfSel(x))) : 0; };
  const info = x => { const it = itemOf(x);
    if (x.kind === "auto") return `<span class="chip warn plain">ใกล้หมด</span> เหลือ ${fmtQ(x.left)} ${esc(x.unit)} · จุดสั่งซื้อ ${fmtQ(x.minQty)}`;
    return (it ? `เหลือ ${fmtQ(it.qty)} ${esc(it.unit)}` : `<span class="muted">ของนอกสต็อก</span>`) + (x.note ? " · " + esc(x.note) : "") + ` · เพิ่มโดย ${esc(x.createdBy)}`; };
  const rowH = x => { const on = st.sel[x.id] != null, it = itemOf(x);
    return `<div class="sh-row ${on ? "on" : ""}" data-sr="${x.id}"><button type="button" class="sh-box ${on ? "sel" : ""}" data-pick="${x.id}" ${ed ? "" : "disabled"}>${on ? "✓" : ""}</button>
      <div class="grow" data-pick2="${x.id}"><div class="sh-name">${esc(x.name)}</div><div class="small muted">${info(x)}</div>
        ${on ? `<div class="sh-edit" data-noprop><div class="q-step"><button type="button" data-sdec>−</button><input inputmode="decimal" data-sq value="${st.sel[x.id]}"><button type="button" data-sinc>+</button></div>
          ${it && (it.units || []).length ? unitSel(it, unitOfSel(x), "data-su") : `<span class="u-txt">${esc(unitOfSel(x) || "หน่วย")}</span>`}${estOf(x) ? `<span class="small muted" data-sest>≈ ${fmt(st.sel[x.id] * estOf(x))}</span>` : ""}</div>` : ""}</div>
      ${ed && x.kind === "row" && !on ? `<button type="button" class="btn ghost sm icon" data-shdel="${x.id}" title="ลบออกจากลิสต์">${icon("trash")}</button>` : ""}
      ${boss && !on ? `<button type="button" class="btn sm" data-buynow="${x.id}" title="ซื้อมาแล้ว → รับเข้าสต็อก">ซื้อแล้ว</button>` : ""}</div>`; };
  const poCard = p => { const done = p.lines.filter(l => (d.items.find(x => x.id === l.shopId) || {}).status === "bought").length;
    return `<div class="po-card" data-po="${p.id}"><div class="po-top"><div class="grow"><b class="doc">${esc(p.poNo)}</b> <span class="chip ${PO_ST[p.status][1]}">${PO_ST[p.status][0]}</span>
      <div class="small muted">${thDate(p.date, true)} · ${esc(p.createdBy)} · ${p.lines.length} รายการ${p.total ? " · ≈ " + baht(p.total) : ""}${p.status === "approved" && done ? ` · ซื้อแล้ว ${done}/${p.lines.length}` : ""}${p.reason ? ` · <span class="neg">${esc(p.reason)}</span>` : ""}</div>
      <div class="small po-names">${esc(p.lines.map(l => l.name + " " + fmtQ(l.qty) + " " + l.unit).join(" · "))}</div></div></div>
      <div class="po-acts"><button class="btn sm" data-poview="${p.id}">${icon("print")} ดู / พิมพ์ PO</button>${p.status === "pending" && boss ? `<button class="btn sm primary" data-poap="${p.id}">${icon("check")} อนุมัติ</button><button class="btn sm" data-porj="${p.id}">ไม่อนุมัติ</button>` : ""}
        ${p.status === "pending" && !boss && p.createdBy === S.binfo.me.name ? `<button class="btn sm ghost" data-pocancel="${p.id}">ยกเลิกคำขอ</button>` : ""}${p.status === "approved" && boss ? `<button class="btn sm primary" data-poview="${p.id}">ติ๊กของที่ซื้อแล้ว</button>` : ""}</div></div>`; };
  const cats = sortCats(open);
  body.innerHTML = `
    <div class="sh-steps"><div class="${open.length ? "on" : ""}"><b>${open.length}</b><span>ต้องซื้อ</span></div><div class="${pend.length ? "on warn" : ""}"><b>${pend.length}</b><span>รออนุมัติ</span></div><div class="${appr.length ? "on blue" : ""}"><b>${appr.length}</b><span>อนุมัติแล้ว รอซื้อ</span></div></div>
    ${pend.length || appr.length ? `<div class="section-t">ใบขอซื้อ (PO) ที่ยังเปิดอยู่</div>${pend.concat(appr).map(poCard).join("")}` : ""}
    <div class="sh-head"><div class="grow"><div class="section-t" style="margin:6px 0 2px">${boss ? "ของที่ต้องซื้อ" : "1. ติ๊กของที่ต้องซื้อ · 2. ใส่จำนวน · 3. ส่งขออนุมัติ"}</div><div class="small muted">ของใกล้หมด (ต่ำกว่าจุดสั่งซื้อ) ขึ้นมาให้เอง${ed ? " · เพิ่มของอื่นได้ที่ปุ่มขวา" : ""}</div></div>
      ${ed ? `<button class="btn" data-shadd>${icon("plus")} เพิ่มรายการ</button>` : ""}</div>
    ${open.length ? `${ed ? `<div class="row" style="margin-bottom:8px"><button class="btn sm ghost" data-selall>เลือกทั้งหมด (${open.length})</button>${Object.keys(st.sel).length ? `<button class="btn sm ghost" data-selnone>ล้างที่เลือก</button>` : ""}</div>` : ""}
      ${cats.map(cn => `<div class="sh-group"><div class="q-gh">${esc(cn)} <span>${open.filter(x => catOf(x) === cn).length}</span></div><div class="card sh-card">${open.filter(x => catOf(x) === cn).map(rowH).join("")}</div></div>`).join("")}`
      : emptyBox("ไม่มีของที่ต้องซื้อตอนนี้ 👍 — ตั้ง “จุดสั่งซื้อ” ให้สินค้า แล้วของใกล้หมดจะขึ้นที่นี่เอง", "stock")}
    ${bought.length ? `<details class="sh-done"><summary>ซื้อแล้ว 3 วันล่าสุด (${bought.length})</summary><div class="card sh-card">${bought.map(x => `<div class="sh-row done"><span class="sh-box on">✓</span><div class="grow"><div class="sh-name">${esc(x.name)}</div>
      <div class="small muted">${x.boughtQty ? fmtQ(x.boughtQty) + " " + esc(x.boughtUnit) : ""}${x.boughtPrice != null ? " @ " + fmt(x.boughtPrice) : ""} · ${esc(x.boughtBy)} ${hm(x.boughtAt)}${x.moveId ? (x.moveStatus === "pending" ? " · รออนุมัติรับเข้า" : " · เข้าสต็อกแล้ว") : ""}</div></div>${x.canUndo ? `<button class="btn sm" data-undo="${x.id}">ยกเลิก</button>` : ""}</div>`).join("")}</div>
      ${boss ? `<button class="btn sm" data-shclear style="margin-top:8px">ล้างรายการที่ซื้อแล้ว</button>` : ""}</details>` : ""}
    ${closed.length ? `<details class="sh-done"><summary>ใบขอซื้อที่ปิดแล้ว (${closed.length})</summary>${closed.map(poCard).join("")}</details>` : ""}
    ${ed ? `<div class="cart-bar po hidden" data-pobar><div class="grow"><b data-pon></b><div class="small muted" data-pol></div></div><button class="btn" data-poclr>ล้าง</button><button class="btn primary" data-pogo>${icon("check")} ${boss ? "สร้างใบสั่งซื้อ" : "ส่งขออนุมัติ"}</button></div>` : ""}`;
  const findO = id => open.find(x => x.id === id);
  const drawBar = () => { const bar = $("[data-pobar]", body); if (!bar) return; const ids = Object.keys(st.sel);
    bar.classList.toggle("hidden", !ids.length); const tot = ids.reduce((a, id) => a + num(st.sel[id]) * estOf(findO(id)), 0);
    $("[data-pon]", bar).textContent = "เลือก " + ids.length + " รายการ" + (tot ? " · ≈ " + baht(tot) : "");
    $("[data-pol]", bar).textContent = ids.map(id => { const x = findO(id); return x.name + " " + fmtQ(st.sel[id]) + " " + unitOfSel(x); }).join(" · "); };
  drawBar();
  $$("[data-poview]", body).forEach(b => { b.onclick = () => poModal(pos.find(p => p.id === b.dataset.poview), d, items, boss, rerender); });
  $$("[data-poap]", body).forEach(b => { b.onclick = () => withBtn(b, async () => { await bapi("POST", "/shopping/po/" + b.dataset.poap + "/approve"); toast("อนุมัติใบขอซื้อแล้ว"); rerender(); }).catch(() => {}); });
  $$("[data-porj]", body).forEach(b => { b.onclick = () => { const x = openModal({ title: "ไม่อนุมัติใบขอซื้อ", body: `<label class="field"><span>เหตุผล (ไม่บังคับ)</span><input class="input" name="reason" placeholder="เช่น ของยังพอใช้"></label><div class="field-hint" style="margin-top:6px">รายการจะกลับไปอยู่ในลิสต์ “ต้องซื้อ”</div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn danger" data-ok>ไม่อนุมัติ</button>` });
    const ok = $("[data-ok]", x.el); ok.onclick = () => withBtn(ok, async () => { await bapi("POST", "/shopping/po/" + b.dataset.porj + "/reject", { reason: $("[name=reason]", x.el).value }); x.close(); toast("ไม่อนุมัติแล้ว"); rerender(); }).catch(() => {}); }; });
  $$("[data-pocancel]", body).forEach(b => { b.onclick = async () => { if (!await confirmBox("ยกเลิกคำขอซื้อนี้? รายการจะกลับไปอยู่ในลิสต์", { okText: "ยกเลิกคำขอ", danger: true })) return; try { await bapi("POST", "/shopping/po/" + b.dataset.pocancel + "/reject"); toast("ยกเลิกแล้ว"); rerender(); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-undo]", body).forEach(b => { b.onclick = async () => { if (!await confirmBox("ยกเลิก “ซื้อแล้ว”? รายการรับเข้าสต็อกที่สร้างไว้จะถูกลบด้วย", { okText: "ยกเลิกซื้อแล้ว", danger: true })) return;
    try { await bapi("POST", "/shopping/" + b.dataset.undo + "/undo"); toast("ยกเลิกแล้ว"); rerender(); } catch (e) { toast(e.message, "bad"); } }; });
  const clr = $("[data-shclear]", body); if (clr) clr.onclick = async () => { await bapi("POST", "/shopping/clear"); toast("ล้างแล้ว"); rerender(); };
  if (!ed) return;
  const redraw = () => stockShop(c, st, self);
  const toggle = id => { if (st.sel[id] != null) delete st.sel[id]; else st.sel[id] = defQty(findO(id)); redraw(); };
  $$("[data-pick]", body).forEach(b => { b.onclick = () => toggle(b.dataset.pick); });
  $$("[data-pick2]", body).forEach(b => { b.onclick = e => { if (e.target.closest("[data-noprop]")) return; toggle(b.dataset.pick2); }; });
  $$(".sh-row.on", body).forEach(r => { const id = r.dataset.sr, x = findO(id), inp = $("[data-sq]", r);
    const upd = () => { const e = $("[data-sest]", r); if (e) e.textContent = "≈ " + fmt(num(st.sel[id]) * estOf(x)); drawBar(); };
    const set = v => { v = Math.max(0, Math.round(v * 1000) / 1000); if (!v) { delete st.sel[id]; redraw(); return; } st.sel[id] = v; inp.value = v; upd(); };
    $("[data-sdec]", r).onclick = () => set(num(inp.value) - 1); $("[data-sinc]", r).onclick = () => set(num(inp.value) + 1);
    inp.oninput = () => { const v = num(inp.value); if (v > 0) { st.sel[id] = v; upd(); } }; inp.onblur = () => { if (!(num(inp.value) > 0)) set(0); };
    const su = $("[data-su]", r); if (su) su.onchange = () => { st.selU[id] = su.value; upd(); }; });
  const sa = $("[data-selall]", body); if (sa) sa.onclick = () => { open.forEach(x => { if (st.sel[x.id] == null) st.sel[x.id] = defQty(x); }); redraw(); };
  const sn = $("[data-selnone]", body); if (sn) sn.onclick = () => { st.sel = {}; redraw(); };
  $$("[data-shdel]", body).forEach(b => { b.onclick = async () => { try { await bapi("DELETE", "/shopping/" + b.dataset.shdel); toast("ลบออกจากลิสต์แล้ว"); rerender(); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-buynow]", body).forEach(b => { b.onclick = () => { const x = findO(b.dataset.buynow); shopBuyModal(x, itemOf(x), rerender); }; });
  $("[data-shadd]", body).onclick = () => shopAddModal(items, open, rerender);
  $("[data-poclr]", body).onclick = () => { st.sel = {}; redraw(); };
  $("[data-pogo]", body).onclick = () => {
    const ids = Object.keys(st.sel), tot = ids.reduce((a, id) => a + num(st.sel[id]) * estOf(findO(id)), 0);
    const m = openModal({ title: (boss ? "สร้างใบสั่งซื้อ " : "ยืนยันส่งขออนุมัติซื้อ ") + ids.length + " รายการ", body: `<div class="q-confirm">${ids.map(id => { const x = findO(id), e = estOf(x);
        return `<div class="cf-row"><div class="grow"><div class="bold">${esc(x.name)}</div><div class="small muted">${esc(catOf(x))}</div></div><div class="cf-q"><b>${fmtQ(st.sel[id])}</b> ${esc(unitOfSel(x))}${e ? `<div class="small muted">≈ ${fmt(st.sel[id] * e)}</div>` : ""}</div></div>`; }).join("")}</div>
      ${tot ? `<div class="cf-total">ประมาณการ <b>${baht(tot)}</b> <span class="muted small">(จากต้นทุนเฉลี่ย)</span></div>` : ""}
      <label class="field" style="margin-top:12px"><span>หมายเหตุ (ไม่บังคับ)</span><input class="input" name="note" placeholder="เช่น ด่วน ใช้พรุ่งนี้เช้า"></label>
      <div class="info-box" style="margin-top:12px">${boss ? "ใบสั่งซื้อจะอนุมัติทันที พิมพ์ PO ได้เลย · ซื้อมาแล้วกด “ติ๊กของที่ซื้อแล้ว” เพื่อรับเข้าสต็อก" : "ส่งให้ผู้จัดการอนุมัติ — ระหว่างรอ พิมพ์ใบขอซื้อ (PO) ได้"}</div>`,
      foot: `<button class="btn" data-close>กลับไปแก้</button><button class="btn primary" data-ok>${icon("check")} ${boss ? "สร้างใบสั่งซื้อ" : "ส่งขออนุมัติ"}</button>` });
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => {
      const lines = ids.map(id => { const x = findO(id); return x.kind === "auto" ? { itemId: x.itemId, qty: num(st.sel[id]), unit: unitOfSel(x) } : { id: x.id, qty: num(st.sel[id]), unit: unitOfSel(x) }; });
      const r = await bapi("POST", "/shopping/po", { lines, note: $("[name=note]", m.el).value });
      st.sel = {}; st.selU = {}; m.close(); toast((r.pending ? "ส่งขออนุมัติแล้ว · " : "สร้างใบสั่งซื้อแล้ว · ") + r.poNo);
      const g = await bapi("GET", "/shopping/po/" + r.id); rerender(); printPO(g.po, false);
    }).catch(() => {});
  };
}
// ดูใบ PO + ติ๊กของที่ซื้อแล้ว (ผู้อนุมัติ)
function poModal(p, d, items, boss, after) {
  const rowOf = l => d.items.find(x => x.id === l.shopId) || {};
  const m = openModal({ title: `${esc(p.poNo)} <span class="chip ${PO_ST[p.status][1]}" style="font-size:12px;vertical-align:2px">${PO_ST[p.status][0]}</span>`, size: "lg", body: `
    <div class="small muted" style="margin-bottom:10px">วันที่ ${thDate(p.date)} · ขอโดย ${esc(p.createdBy)}${p.approvedBy && p.status !== "pending" ? ` · ${p.status === "rejected" ? "ไม่อนุมัติ" : "อนุมัติ"}โดย ${esc(p.approvedBy)}` : ""}${p.note ? ` · หมายเหตุ: ${esc(p.note)}` : ""}</div>
    <div class="card sh-card">${p.lines.map(l => { const r = rowOf(l), b = r.status === "bought";
      return `<div class="sh-row ${b ? "done" : ""}" style="cursor:default"><span class="sh-box ${b ? "on" : ""}">${b ? "✓" : ""}</span><div class="grow"><div class="sh-name">${esc(l.name)}</div><div class="small muted">${fmtQ(l.qty)} ${esc(l.unit)}${l.baseQty && l.baseUnit && l.baseUnit !== l.unit ? ` (= ${fmtQ(l.baseQty)} ${esc(l.baseUnit)})` : ""}${l.price ? ` · ≈ ${fmt(l.qty * l.price)}` : ""}${b ? ` · ซื้อแล้ว ${r.boughtQty ? fmtQ(r.boughtQty) + " " + esc(r.boughtUnit) : ""}${r.boughtPrice != null ? " @ " + fmt(r.boughtPrice) : ""}` : ""}</div></div>
        ${boss && p.status === "approved" && !b && r.id ? `<button class="btn sm primary" data-pobuy="${r.id}">ซื้อแล้ว</button>` : ""}</div>`; }).join("")}</div>
    ${p.total ? `<div class="cf-total">ประมาณการรวม <b>${baht(p.total)}</b></div>` : ""}`,
    foot: `<button class="btn" data-close>ปิด</button><button class="btn primary" data-print>${icon("print")} พิมพ์ PO</button>` });
  $("[data-print]", m.el).onclick = () => printPO(p, true);
  $$("[data-pobuy]", m.el).forEach(b => { b.onclick = () => { const r = d.items.find(x => x.id === b.dataset.pobuy), l = p.lines.find(y => y.shopId === r.id);
    m.close(); shopBuyModal({ ...r, kind: "row", qty: l.qty, unit: l.unit }, r.itemId && items.find(i => i.id === r.itemId), after); }; });
}
function printPO(p, direct) {
  const go = () => { const html = companyHead("ใบขอซื้อ / ใบสั่งซื้อ (Purchase Order)", `เลขที่ <b>${esc(p.poNo)}</b><br>วันที่ ${thDate(p.date)}<br>สถานะ: ${PO_ST[p.status][0]}`) +
    `<p style="margin:0 0 10px"><b>สาขา:</b> ${esc(S.binfo.branch.name)} &nbsp; <b>ผู้ขอซื้อ:</b> ${esc(p.createdBy)}${p.note ? ` &nbsp; <b>หมายเหตุ:</b> ${esc(p.note)}` : ""}</p>
    <table><thead><tr><th>#</th><th>รายการ</th><th>หมวด</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคาประมาณ/หน่วย</th><th class="num">รวมประมาณ</th><th style="width:60px">✓</th></tr></thead><tbody>
    ${p.lines.map((l, k) => `<tr><td>${k + 1}</td><td>${esc(l.name)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</td><td>${esc(l.category || "")}</td><td class="num">${fmtQ(l.qty)}</td><td>${esc(l.unit)}${l.baseQty && l.baseUnit && l.baseUnit !== l.unit ? ` <small>(=${fmtQ(l.baseQty)} ${esc(l.baseUnit)})</small>` : ""}</td><td class="num">${l.price ? fmt(l.price) : "-"}</td><td class="num">${l.price ? fmt(l.qty * l.price) : "-"}</td><td></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="6" class="num">รวมประมาณการ</td><td class="num">${fmt(p.total)}</td><td></td></tr></tfoot></table>
    <p class="small" style="color:#666">* ราคาประมาณจากต้นทุนเฉลี่ยในสต็อก ราคาจริงบันทึกตอนรับของ</p>
    <div class="sig"><div>ผู้ขอซื้อ<br><small>${esc(p.createdBy)}</small></div><div>ผู้อนุมัติ<br><small>${p.status !== "pending" && p.status !== "rejected" ? esc(p.approvedBy) : ""}</small></div><div>ผู้รับของ</div></div>`;
    printHTML(p.poNo, html); };
  if (direct) return go();
  const m = openModal({ title: "ส่งแล้ว · " + esc(p.poNo), body: `<div style="text-align:center;padding:8px 0"><div style="font-size:40px">✅</div><div class="bold" style="font-size:16px">${p.status === "pending" ? "ส่งขออนุมัติเรียบร้อย" : "สร้างใบสั่งซื้อเรียบร้อย"}</div><div class="muted small">${p.lines.length} รายการ${p.total ? " · ≈ " + baht(p.total) : ""}</div></div>`,
    foot: `<button class="btn" data-close>ปิด</button><button class="btn primary" data-p>${icon("print")} พิมพ์ PO</button>` });
  $("[data-p]", m.el).onclick = () => { m.close(); go(); };
}
function shopBuyModal(x, it, after) {
  const isStock = !!it;
  const defU = isStock ? (x.unit && unitsOf(it).some(u => u.n === x.unit) ? x.unit : it.unit) : (x.unit || "");
  const m = openModal({ title: "ซื้อแล้ว · " + esc(x.name), body: `
    ${isStock ? `<div class="muted small" style="margin-bottom:10px">คงเหลือในสต็อก ${fmtQ(it.qty)} ${esc(it.unit)}${unitsHint(it) ? " · " + esc(unitsHint(it)) : ""}${it.avgCost ? " · ทุนเฉลี่ย " + fmt(it.avgCost) + " / " + esc(it.unit) : ""}</div>` : `<div class="muted small" style="margin-bottom:10px">ของนี้ไม่ได้อยู่ในสต็อก — จะติ๊กว่าซื้อแล้วอย่างเดียว (จำนวน/ราคาไม่บังคับ)</div>`}
    <div class="grid g2"><div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">จำนวนที่ซื้อ ${isStock ? "<em>*</em>" : ""}</span><div class="row" style="gap:6px"><input class="input num grow" name="qty" inputmode="decimal" value="${x.qty || ""}" placeholder="0">${isStock ? unitSel(it, defU, 'name="unit" style="width:auto"') : `<input class="input" name="unit" style="width:90px" value="${esc(defU)}" placeholder="หน่วย">`}</div></div>
      <label class="field"><span>ราคาต่อ <span data-pu>${esc(defU || "หน่วย")}</span> (บาท)</span><input class="input num" name="price" inputmode="decimal" placeholder="${isStock ? fmt(it.avgCost * ufOf(it, defU)) : "0.00"}"></label></div>
    <div class="info-box" style="margin-top:10px" data-sum></div>
    <div class="grid g2" style="margin-top:10px"><label class="field"><span>วันที่ซื้อ</span><input type="date" class="input" name="date" value="${today()}"></label><label class="field"><span>หมายเหตุ</span><input class="input" name="note" placeholder="เช่น ซื้อที่แม็คโคร"></label></div>
    ${isStock && !approver("stock") ? `<div class="field-hint" style="margin-top:8px">การรับเข้าสต็อกจะรอผู้จัดการอนุมัติ</div>` : ""}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} ซื้อแล้ว${isStock ? " · รับเข้าสต็อก" : ""}</button>` });
  const el = m.el, f = () => isStock ? ufOf(it, $("[name=unit]", el).value) : 1;
  const sum = () => { const q = num($("[name=qty]", el).value), pv = $("[name=price]", el).value, pr = pv === "" ? (isStock ? it.avgCost * f() : 0) : num(pv), u = $("[name=unit]", el).value;
    $("[data-pu]", el).textContent = u || "หน่วย"; if (isStock) $("[name=price]", el).placeholder = fmt(it.avgCost * f());
    $("[data-sum]", el).innerHTML = q > 0 ? `${fmtQ(q)} ${esc(u)}${isStock && f() !== 1 ? ` = <b>${fmtQ(q * f())} ${esc(it.unit)}</b>` : ""}${pr ? ` · รวม <b>${baht(q * pr)}</b>` : ""}${isStock && pr ? ` · ต้นทุน ${fmt(pr / f())} / ${esc(it.unit)}` : ""}` : "ใส่จำนวนที่ซื้อ"; };
  ["qty", "price"].forEach(n => { $(`[name=${n}]`, el).oninput = sum; }); $("[name=unit]", el).onchange = sum; $("[name=unit]", el).oninput = sum; sum();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => {
    const q = $("[name=qty]", el).value, pv = $("[name=price]", el).value;
    if (isStock && !(num(q) > 0)) throw new Error("กรุณาใส่จำนวนที่ซื้อ");
    const body = { qty: q === "" ? "" : num(q), unit: $("[name=unit]", el).value, price: pv === "" ? (isStock ? r2(it.avgCost * f()) : "") : num(pv), date: $("[name=date]", el).value, note: $("[name=note]", el).value };
    if (x.kind === "auto") body.itemId = x.itemId; else body.id = x.id;
    const r = await bapi("POST", "/shopping/buy", body);
    m.close(); toast(r.stocked ? (r.pending ? "ติ๊กซื้อแล้ว · รับเข้าสต็อกรออนุมัติ" : "ติ๊กซื้อแล้ว · รับเข้าสต็อกแล้ว") : "ติ๊กซื้อแล้ว"); after();
  }).catch(() => {});
}
function shopAddModal(items, rows, after) {
  const act = items.filter(i => i.active), inList = new Set(rows.map(r => r.itemId).filter(Boolean));
  let pick = null;
  const m = openModal({ title: "เพิ่มรายการที่จะซื้อ", size: "lg", body: `
    <div class="search" style="max-width:none;margin-bottom:8px">${icon("search", "")}<input class="input" data-aq placeholder="ค้นหาสินค้าในสต็อก หรือพิมพ์ชื่อของที่จะซื้อ"></div>
    <div class="sp-list" data-alist style="max-height:34vh"></div>
    <div class="sh-form" data-aform></div>`,
    foot: `<button class="btn" data-close>ปิด</button><button class="btn primary" data-ok>${icon("plus")} เพิ่มลงลิสต์</button>` });
  const el = m.el;
  const drawForm = () => { const q = $("[data-aq]", el).value.trim();
    $("[data-aform]", el).innerHTML = pick ? `<div class="section-t" style="margin-top:12px">${esc(pick.name)}</div><div class="grid g2"><div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">จำนวนที่ต้องการ (ไม่บังคับ)</span><div class="row" style="gap:6px"><input class="input num grow" name="qty" inputmode="decimal" placeholder="เช่น 2">${unitSel(pick, pick.unit, 'name="unit" style="width:auto"')}</div></div><label class="field"><span>หมายเหตุ</span><input class="input" name="note" placeholder="เช่น ยี่ห้อมิตรผล"></label></div>`
      : `<div class="section-t" style="margin-top:12px">หรือ เพิ่มของที่ไม่ได้อยู่ในสต็อก</div><div class="grid g2"><label class="field"><span>ชื่อ <em>*</em></span><input class="input" name="name" value="${esc(q)}" placeholder="เช่น ถุงขยะ น้ำยาล้างจาน"></label>
        <div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">จำนวน / หน่วย</span><div class="row" style="gap:6px"><input class="input num grow" name="qty" inputmode="decimal" placeholder="จำนวน"><input class="input" name="unit" style="width:90px" placeholder="หน่วย" list="unit-dl4"><datalist id="unit-dl4">${listNames("unit").map(n => opt(n)).join("")}</datalist></div></div></div>
        <div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">หมวด</span>${catPicker("")}</div>`;
    if (!pick) bindCatPicker(el); };
  const drawList = () => { const q = $("[data-aq]", el).value.trim().toLowerCase();
    const list = act.filter(i => !q || (i.name + " " + i.sku + " " + i.category).toLowerCase().includes(q)).slice(0, 60);
    $("[data-alist]", el).innerHTML = list.length ? list.map(i => `<button type="button" class="sp-item ${pick && pick.id === i.id ? "on" : ""}" data-ai="${i.id}" ${inList.has(i.id) ? "disabled" : ""}>${i.photoV ? `<span class="sp-ph" style="background-image:url('${stockPhoto(i)}')"></span>` : `<span class="sp-ph">${icon("stock", "")}</span>`}<span class="sp-t"><b>${esc(i.name)}</b><span class="muted small">${esc(i.category || NOCAT)} · เหลือ ${fmtQ(i.qty)} ${esc(i.unit)}${i.low ? " · ใกล้หมด" : ""}</span></span><span class="sp-go">${inList.has(i.id) ? "อยู่ในลิสต์แล้ว" : pick && pick.id === i.id ? "✓" : "เลือก"}</span></button>`).join("")
      : `<div class="muted small" style="padding:6px 2px">ไม่พบในสต็อก — เพิ่มเป็นของนอกสต็อกด้านล่างได้</div>`;
    $$("[data-ai]", el).forEach(b => { b.onclick = () => { pick = pick && pick.id === b.dataset.ai ? null : act.find(i => i.id === b.dataset.ai); drawList(); drawForm(); }; }); };
  $("[data-aq]", el).oninput = debounce(() => { pick = null; drawList(); drawForm(); }, 150);
  drawList(); drawForm();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => {
    const f = formData($("[data-aform]", el));
    if (pick) await bapi("POST", "/shopping", { itemId: pick.id, qty: f.qty, unit: f.unit, note: f.note });
    else { if (!String(f.name || "").trim()) throw new Error("เลือกสินค้าจากรายการ หรือพิมพ์ชื่อของที่จะซื้อ"); await bapi("POST", "/shopping", { name: f.name.trim(), qty: f.qty, unit: f.unit, category: f.category }); }
    toast("เพิ่มลงลิสต์แล้ว"); if (pick) inList.add(pick.id); pick = null; $("[data-aq]", el).value = ""; drawList(); drawForm(); m._added = true;
  }).catch(() => {});
  const oc = m.close; m.close = () => { oc(); if (m._added) after(); }; $$("[data-close],[data-x]", el).forEach(b => { b.onclick = () => m.close(); });
}
function editMoveModal(mv, after) {
  const isCount = mv.kind === "count";
  const si = (S.stockItems || []).find(x => x.id === mv.itemId) || { unit: mv.unit, units: [] };
  const q0 = mv.inUnit ? mv.inQty : (isCount ? mv.counted : Math.abs(mv.qty));
  const m = openModal({ title: "แก้ไข" + MOVE[mv.kind].th + " · " + esc(mv.itemName), body: `<div class="muted small" style="margin-bottom:10px">บันทึกโดย ${esc(mv.createdBy)} · ${thDate(mv.date)} ${hm(mv.createdAt)}</div>
    <div class="grid g2"><div class="field"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">${isCount ? "ยอดที่นับได้" : "จำนวน"}</span><div class="row" style="gap:6px"><input class="input num grow" name="qty" inputmode="decimal" value="${q0}">${unitSel(si, mv.inUnit || mv.unit, 'data-eu style="width:auto"')}</div></div>
    <label class="field"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(mv.note)}"></label></div>
    <div class="field-hint" style="margin-top:8px">การแก้ไขจะถูกบันทึกไว้ใน Log (จำนวนเดิม → ใหม่)</div>`,
    foot: `<div class="left"><button class="btn danger" data-del>${icon("trash")} ลบรายการนี้</button></div><button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} บันทึก</button>` });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const eu = $("[data-eu]", m.el); await bapi("PUT", "/stock/moves/" + mv.id, { qty: num($("[name=qty]", m.el).value, NaN), unit: eu ? eu.value : undefined, note: $("[name=note]", m.el).value }); S.stockItems = null; m.close(); toast("แก้ไขแล้ว"); after(); }).catch(() => {});
  $("[data-del]", m.el).onclick = async () => { if (!await confirmBox("ลบ" + MOVE[mv.kind].th + " " + mv.itemName + " " + fmtQ(Math.abs(mv.qty)) + " " + mv.unit + "?" + (mv.status === "approved" ? "\nยอดคงเหลือจะถูกคืนกลับ" : ""), { danger: true, okText: "ลบ" })) return;
    try { await bapi("DELETE", "/stock/moves/" + mv.id); S.stockItems = null; m.close(); toast("ลบแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } };
}
// จัดการหมวดสต็อกจากหน้าสต็อก: เพิ่ม / เปลี่ยนชื่อ / เรียงลำดับ / ลบ (ย้ายสินค้าไปหมวดอื่น)
async function stockCatManager(items, after) {
  let changed = false;
  const m = openModal({ title: "จัดการหมวดสต็อก", body: `<div data-cl></div><div class="row" style="margin-top:12px"><input class="input grow" placeholder="ชื่อหมวดใหม่ เช่น ผักสด" data-newcat><button class="btn primary" data-addcat>${icon("plus")} เพิ่มหมวด</button></div>
    <div class="field-hint" style="margin-top:8px">เปลี่ยนชื่อหมวด → สินค้าในหมวดเปลี่ยนตามให้อัตโนมัติ · ลบหมวด → เลือกย้ายสินค้าไปหมวดอื่น</div>`, foot: `<button class="btn primary" data-close>เสร็จ</button>` });
  const oc = m.close; m.close = () => { oc(); if (changed) after(); }; $$("[data-close],[data-x]", m.el).forEach(b => { b.onclick = () => m.close(); });
  const reload = async () => { S.lists = (await bapi("GET", "/lists")).lists; changed = true; draw(); };
  const draw = () => { const L = S.lists.stock_category; const cnt = n => items.filter(i => i.category === n).length;
    $("[data-cl]", m.el).innerHTML = L.length ? L.map((x, idx) => `<div class="cm-row"><div class="cm-ord"><button class="btn ghost sm icon" data-up="${idx}" ${idx ? "" : "disabled"}>${icon("up")}</button><button class="btn ghost sm icon" data-dn="${idx}" ${idx < L.length - 1 ? "" : "disabled"} style="transform:rotate(180deg)">${icon("up")}</button></div>
      <input class="input" value="${esc(x.name)}" data-ren="${x.id}"><span class="chip plain">${cnt(x.name)} รายการ</span><button class="btn ghost sm icon" data-delc="${x.id}" title="ลบหมวด">${icon("trash")}</button></div>`).join("") : emptyBox("ยังไม่มีหมวด", "stock");
    $$("[data-ren]", m.el).forEach(inp => { inp.onchange = async () => { const x = L.find(y => y.id === inp.dataset.ren); const v = inp.value.trim(); if (!v || v === x.name) { inp.value = x.name; return; }
      try { await bapi("PUT", "/lists/" + x.id, { name: v }); toast("เปลี่ยนชื่อหมวดแล้ว"); items.forEach(i => { if (i.category === x.name) i.category = v; }); await reload(); } catch (e) { toast(e.message, "bad"); inp.value = x.name; } }; });
    const move = async (i, d) => { const ids = L.map(x => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await bapi("PUT", "/lists/" + ids[0], { order: ids }); await reload(); };
    $$("[data-up]", m.el).forEach(b => { b.onclick = () => move(+b.dataset.up, -1); }); $$("[data-dn]", m.el).forEach(b => { b.onclick = () => move(+b.dataset.dn, 1); });
    $$("[data-delc]", m.el).forEach(b => { b.onclick = async () => { const x = L.find(y => y.id === b.dataset.delc); const n = cnt(x.name);
      let to = "";
      if (n) { to = await new Promise(res => { const d = openModal({ title: "ลบหมวด " + esc(x.name), body: `<p>หมวดนี้มีสินค้า ${n} รายการ ย้ายไปหมวดไหน?</p><select class="input" data-to>${opt("", NOCAT)}${L.filter(y => y.id !== x.id).map(y => opt(y.name, y.name)).join("")}</select>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn danger solid" data-ok>ลบหมวดและย้ายสินค้า</button>` });
        const dc = d.close; let done = false; d.close = () => { dc(); if (!done) res(null); }; $$("[data-close],[data-x]", d.el).forEach(bb => { bb.onclick = () => d.close(); });
        $("[data-ok]", d.el).onclick = () => { done = true; const v = $("[data-to]", d.el).value; dc(); res(v); }; }); if (to === null) return; }
      else if (!await confirmBox("ลบหมวด " + x.name + "?", { danger: true, okText: "ลบ" })) return;
      try { await bapi("DELETE", "/lists/" + x.id + "?moveTo=" + encodeURIComponent(to)); items.forEach(i => { if (i.category === x.name) i.category = to; }); toast("ลบหมวดแล้ว"); await reload(); } catch (e) { toast(e.message, "bad"); } }; });
  };
  draw();
  const add = async () => { const inp = $("[data-newcat]", m.el); const v = inp.value.trim(); if (!v) return; try { await bapi("POST", "/lists", { kind: "stock_category", name: v }); inp.value = ""; toast("เพิ่มหมวดแล้ว"); await reload(); } catch (e) { toast(e.message, "bad"); } };
  $("[data-addcat]", m.el).onclick = add; $("[data-newcat]", m.el).onkeydown = e => { if (e.key === "Enter") add(); };
}
// ตัวเลือกหมวดแบบแตะ + พิมพ์หมวดใหม่ได้ในช่องเดียว
function catPicker(cur) {
  const cats = listNames("stock_category");
  return `<div class="cat-pick" data-catpick><input type="hidden" name="category" value="${esc(cur || "")}">${cats.map(n => `<button type="button" data-cv="${esc(n)}" class="${n === cur ? "on" : ""}">${esc(n)}</button>`).join("")}
    ${cur && !cats.includes(cur) ? `<button type="button" data-cv="${esc(cur)}" class="on">${esc(cur)}</button>` : ""}<input class="input sm" data-catnew placeholder="+ พิมพ์หมวดใหม่" style="width:150px"></div>`;
}
function bindCatPicker(root) {
  const box = $("[data-catpick]", root); if (!box) return;
  const hid = $("[name=category]", box), nw = $("[data-catnew]", box);
  $$("[data-cv]", box).forEach(b => { b.onclick = () => { const on = !b.classList.contains("on"); $$("[data-cv]", box).forEach(x => x.classList.remove("on")); if (on) b.classList.add("on"); hid.value = on ? b.dataset.cv : ""; nw.value = ""; }; });
  nw.oninput = () => { if (nw.value.trim()) { $$("[data-cv]", box).forEach(x => x.classList.remove("on")); hid.value = nw.value.trim(); } };
}

const MSTATUS = { pending: ["รออนุมัติ", "warn"], approved: ["อนุมัติแล้ว", "good"], rejected: ["ไม่อนุมัติ", "bad"] };
BRANCH_PAGES.stock = { title: () => "สต็อกสินค้า", state: { tab: "quick", q: "", cat: "", low: false, kind: "", mstatus: "", qcat: "", qq: "", cart: {} }, async render(c) {
  const st = this.state, self = this;
  const ed = canEdit("stock"), boss = approver("stock");
  if (!boss && (st.tab === "items" || st.tab === "moves")) st.tab = "quick";
  c.innerHTML = `<div class="page-head stock-head"><div class="grow"><h2>สต็อกสินค้า / วัตถุดิบ</h2><div class="muted small hide-m">ต้นทุนคิดแบบถัวเฉลี่ยถ่วงน้ำหนัก · ซื้อผ่านเอกสารรายจ่ายที่ “ผูกสต็อก” จะรับเข้าสต็อกให้อัตโนมัติ</div></div></div>
    <div class="tabs"><button data-tab="quick" class="${st.tab === "quick" ? "on" : ""}">${ed ? (boss ? "เบิก / รับเข้า" : "เบิกของ") : "สินค้า"}</button><button data-tab="shop" class="${st.tab === "shop" ? "on" : ""}">${icon("check", "").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} รายการที่จะซื้อ</button>${boss ? `<button data-tab="items" class="${st.tab === "items" ? "on" : ""}">ตารางคงเหลือ</button><button data-tab="moves" class="${st.tab === "moves" ? "on" : ""}">ประวัติความเคลื่อนไหว</button>` : ""}</div><div data-body></div>`;
  $$("[data-tab]", c).forEach(b => { b.onclick = () => { st.tab = b.dataset.tab; self.render(c); }; });
  if (st.tab === "quick") return stockQuick(c, st, self);
  if (st.tab === "shop") return stockShop(c, st, self);
  const items = await loadStockItems(true);
  const body = $("[data-body]", c);
  body.insertAdjacentHTML("beforebegin", stockActions()); bindStockActions(c, () => self.render(c));
  if (st.tab === "items") {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
    body.innerHTML = `<div class="pay-grid" style="margin-bottom:14px"><div class="mini-kpi"><div class="l">จำนวนสินค้า</div><div class="v">${items.filter(i => i.active).length} รายการ</div></div><div class="mini-kpi"><div class="l">มูลค่าสต็อกคงเหลือ</div><div class="v">${baht(items.reduce((a, i) => a + (i.active ? i.value : 0), 0))}</div></div>
      <div class="mini-kpi"><div class="l">ใกล้หมด / หมด</div><div class="v" style="color:${items.some(i => i.low && i.active) ? "var(--bad)" : "inherit"}">${items.filter(i => i.low && i.active).length} รายการ</div></div><div class="mini-kpi"><div class="l">ปิดใช้งาน</div><div class="v">${items.filter(i => !i.active).length} รายการ</div></div></div>
      <div class="card"><div class="toolbar"><div class="search">${icon("search")}<input class="input" placeholder="ค้นหาสินค้า / รหัส" value="${esc(st.q)}" data-q></div>
        <select class="input" style="width:200px" data-cat><option value="">ทุกหมวด</option>${cats.map(n => opt(n, n, n === st.cat)).join("")}</select><label class="check"><input type="checkbox" data-low ${st.low ? "checked" : ""}> เฉพาะใกล้หมด</label><div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl></div></div>`;
    const draw = () => {
      const q = st.q.toLowerCase(); const rows = items.filter(i => (!q || (i.name + " " + i.sku).toLowerCase().includes(q)) && (!st.cat || i.category === st.cat) && (!st.low || (i.low && i.active)));
      $("[data-tbl]", c).innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>สินค้า</th><th>หมวด</th><th class="num">คงเหลือ</th><th class="num">จุดสั่งซื้อ</th><th class="num">ต้นทุนเฉลี่ย/หน่วย</th><th class="num">มูลค่า</th><th>สถานะ</th></tr></thead><tbody>
        ${rows.map(i => `<tr class="click" data-id="${i.id}" style="${i.active ? "" : "opacity:.55"}"><td><div class="d-cell">${i.photoV ? `<span class="rthumb" style="background-image:url('${stockPhoto(i)}')"></span>` : ""}<div><div class="bold">${esc(i.name)}</div>${i.sku ? `<div class="muted small">${esc(i.sku)}</div>` : ""}</div></div></td><td class="small">${esc(i.category || "-")}</td>
          <td class="num bold">${fmtQ(i.qty)} <span class="muted small">${esc(i.unit)}</span></td><td class="num muted">${i.minQty ? fmtQ(i.minQty) : "-"}</td><td class="num">${fmt(i.avgCost)}</td><td class="num">${fmt(i.value)}</td>
          <td>${!i.active ? `<span class="chip">ปิดใช้งาน</span>` : i.qty <= 0 ? `<span class="chip bad">หมด</span>` : i.low ? `<span class="chip warn">ใกล้หมด</span>` : `<span class="chip good">ปกติ</span>`}${i.pending ? ` <span class="chip warn plain">รออนุมัติ ${i.pending}</span>` : ""}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="5">รวม ${rows.length} รายการ</td><td class="num">${fmt(rows.reduce((a, i) => a + i.value, 0))}</td><td></td></tr></tfoot></table>` : emptyBox(items.length ? "ไม่พบสินค้า" : "ยังไม่มีสินค้า — กด “เพิ่มสินค้า” เพื่อเริ่มต้น", "stock");
      $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => stockItemDetail(tr.dataset.id, () => self.render(c)); });
    };
    $("[data-q]", c).oninput = debounce(e => { st.q = e.target.value; draw(); }, 200);
    $("[data-cat]", c).onchange = e => { st.cat = e.target.value; draw(); };
    $("[data-low]", c).onchange = e => { st.low = e.target.checked; draw(); };
    $("[data-csv]", c).onclick = () => downloadCSV("stock-" + today() + ".csv", [["รหัส", "สินค้า", "หมวด", "คงเหลือ", "หน่วย", "จุดสั่งซื้อ", "ต้นทุนเฉลี่ย", "มูลค่า", "สถานะ"], ...items.map(i => [i.sku, i.name, i.category, i.qty, i.unit, i.minQty, i.avgCost, i.value, i.active ? (i.low ? "ใกล้หมด" : "ปกติ") : "ปิดใช้งาน"])]);
    draw();
  } else {
    body.innerHTML = `<div class="card"><div class="toolbar">${rangeBar()}<select class="input" style="width:170px" data-kind><option value="">ทุกประเภท</option>${Object.keys(MOVE).map(k => opt(k, MOVE[k].th, k === st.kind)).join("")}</select>
      <select class="input" style="width:150px" data-mstatus>${opt("", "ทุกสถานะ")}${Object.keys(MSTATUS).map(k => opt(k, MSTATUS[k][0], k === st.mstatus)).join("")}</select><div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
    bindRange(body, () => self.render(c));
    $("[data-kind]", c).onchange = e => { st.kind = e.target.value; self.render(c); };
    $("[data-mstatus]", c).onchange = e => { st.mstatus = e.target.value; self.render(c); };
    const mv = (await bapi("GET", "/stock/moves?" + rq() + (st.kind ? "&kind=" + st.kind : "") + (st.mstatus ? "&status=" + st.mstatus : ""))).moves;
    $("[data-tbl]", c).innerHTML = movesTable(mv, true);
    bindMoveDeletes(c, () => self.render(c));
    $("[data-csv]", c).onclick = () => downloadCSV("stock-moves-" + S.range.from + "_" + S.range.to + ".csv", [["วันที่", "สินค้า", "ประเภท", "จำนวน", "หน่วย", "ต้นทุน/หน่วย", "มูลค่า", "คงเหลือ", "อ้างอิง", "หมายเหตุ", "ผู้บันทึก", "สถานะ", "ผู้อนุมัติ", "เหตุผลไม่อนุมัติ"],
      ...mv.map(m => [m.date, m.itemName, MOVE[m.kind].th, m.kind === "count" && m.status !== "approved" ? "นับได้ " + m.counted : m.qty, m.unit, m.unitCost, m.amount, m.balance, m.docNo, m.note, m.createdBy, MSTATUS[m.status][0], m.approvedBy, m.rejectReason])]);
  }
} };
function movesTable(mv, showItem) {
  if (!mv.length) return emptyBox("ไม่มีความเคลื่อนไหวในช่วงนี้", "stock");
  const canDel = m => m.canEdit;
  S._mvCache = mv;
  return `<table class="tbl"><thead><tr><th>วันที่</th>${showItem ? "<th>สินค้า</th>" : ""}<th>ประเภท</th><th class="num">จำนวน</th><th class="num">ต้นทุน/หน่วย</th><th class="num">มูลค่า</th><th class="num">คงเหลือ</th><th>สถานะ</th><th>อ้างอิง / หมายเหตุ</th><th></th></tr></thead><tbody>
    ${mv.map(m => { const ap = m.status === "approved"; return `<tr style="${m.status === "rejected" ? "opacity:.6" : ""}"><td>${thDate(m.date, true)}</td>${showItem ? `<td class="bold">${esc(m.itemName)}</td>` : ""}<td><span class="chip ${m.xferDir ? "violet" : MOVE[m.kind].chip}">${m.xferDir === "out" ? "โยกออก" : m.xferDir === "in" ? "รับโยก" : MOVE[m.kind].th}</span>${m.xferDir ? `<div class="muted small">${m.xferDir === "out" ? "→ " : "← "}${esc(m.xferBranch)}</div>` : ""}</td>
      <td class="num bold ${m.qty < 0 ? "neg" : m.qty > 0 ? "pos" : ""}">${ap || m.kind !== "count" ? (m.qty > 0 ? "+" : "") + fmtQ(m.qty) : "±"} <span class="muted small">${esc(m.unit)}</span>${uNote(m)}${m.kind === "count" ? `<div class="muted small">นับได้ ${fmtQ(m.counted)}</div>` : ""}</td>
      <td class="num">${ap || m.kind === "in" ? fmt(m.unitCost) : "-"}</td><td class="num">${ap ? fmt(m.amount) : "-"}</td><td class="num">${ap ? fmtQ(m.balance) : "-"}</td>
      <td><span class="chip ${MSTATUS[m.status][1]}">${MSTATUS[m.status][0]}</span>${m.status !== "pending" && m.approvedBy && !m.refRecordId ? `<div class="muted small">${esc(m.approvedBy)}</div>` : ""}${m.rejectReason ? `<div class="small neg">${esc(m.rejectReason)}</div>` : ""}</td>
      <td class="small">${m.docNo ? `<span class="doc">${esc(m.docNo)}</span> ` : ""}${esc(m.note)}<div class="muted">${esc(m.createdBy)}</div></td>
      <td style="white-space:nowrap">${m.status === "pending" && approver("stock") ? `<button class="btn sm primary" data-apmove="${m.id}">อนุมัติ</button> <button class="btn sm" data-rjmove="${m.id}">ไม่อนุมัติ</button>` : ""}${m.canEdit ? `<button class="btn ghost sm icon" data-editmv2="${m.id}" title="แก้ไข">${icon("edit")}</button>` : ""}${canDel(m) ? `<button class="btn ghost sm icon" data-delmove="${m.id}" title="ลบรายการ">${icon("trash")}</button>` : ""}</td></tr>`; }).join("")}</tbody></table>`;
}
// อนุมัติ / ไม่อนุมัติ รายการสต็อก
async function stockDecide(ids, ok, after) {
  if (ok) { try { await bapi("POST", "/stock/moves/approve", { ids, approve: true }); S.stockItems = null; toast("อนุมัติ " + ids.length + " รายการแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } return; }
  const reason = await askReason("ไม่อนุมัติรายการสต็อก " + ids.length + " รายการ"); if (!reason) return;
  try { await bapi("POST", "/stock/moves/approve", { ids, approve: false, reason }); toast("บันทึกไม่อนุมัติแล้ว"); after(); } catch (e) { toast(e.message, "bad"); }
}
function askReason(title) {
  return new Promise(res => {
    const m = openModal({ title, body: `<label class="field"><span>เหตุผล <em>*</em></span><textarea class="input" name="reason" rows="3" placeholder="เช่น จำนวนไม่ตรง ให้ตรวจนับใหม่"></textarea></label>`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn danger solid" data-ok>ไม่อนุมัติ</button>` });
    let done = false; const oc = m.close; m.close = () => { if (!done) { done = true; res(null); } oc(); }; $$("[data-close],[data-x]", m.el).forEach(b => { b.onclick = () => m.close(); });
    $("[data-ok]", m.el).onclick = () => { const v = $("[name=reason]", m.el).value.trim(); if (!v) return toast("กรุณาใส่เหตุผล", "bad"); done = true; res(v); oc(); };
  });
}
function bindMoveDeletes(root, after) {
  $$("[data-editmv2]", root).forEach(b => { b.onclick = () => editMoveModal((S._mvCache || []).find(m => m.id === b.dataset.editmv2), after); });
  $$("[data-apmove]", root).forEach(b => { b.onclick = () => stockDecide([b.dataset.apmove], true, after); });
  $$("[data-rjmove]", root).forEach(b => { b.onclick = () => stockDecide([b.dataset.rjmove], false, after); });
  $$("[data-delmove]", root).forEach(b => { b.onclick = async () => { if (!await confirmBox("ลบรายการเคลื่อนไหวนี้? ระบบจะคำนวณยอดคงเหลือและต้นทุนใหม่ให้", { danger: true, okText: "ลบ" })) return;
    try { await bapi("DELETE", "/stock/moves/" + b.dataset.delmove); S.stockItems = null; toast("ลบแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } }; });
}
function stockItemModal(item, after) {
  const isNew = !item; item = item || { name: "", sku: "", category: listNames("stock_category")[0] || "", unit: "", minQty: "", note: "" };
  const cats = listNames("stock_category");
  const m = openModal({ title: isNew ? "เพิ่มสินค้าในสต็อก" : "แก้ไขสินค้า", size: "lg", body: `<div class="grid g2">
    <label class="field"><span>ชื่อสินค้า / วัตถุดิบ <em>*</em></span><input class="input" name="name" value="${esc(item.name)}" placeholder="เช่น หมูสับ, ข้าวหอมมะลิ"></label>
    <label class="field"><span>รหัสสินค้า (SKU)</span><input class="input" name="sku" value="${esc(item.sku)}"></label>
    <div class="field" style="grid-column:1/-1"><span style="display:block;font-size:13px;color:var(--text-2);margin-bottom:5px;font-weight:500">หมวดสต็อก (แตะเลือก หรือพิมพ์หมวดใหม่)</span>${catPicker(item.category)}</div>
    <label class="field"><span>หน่วยหลัก (หน่วยที่นับสต็อก)</span><input class="input" name="unit" value="${esc(item.unit)}" list="unit-dl2" placeholder="เช่น กก."><datalist id="unit-dl2">${listNames("unit").map(n => opt(n)).join("")}</datalist></label>
    <label class="field"><span>จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือไม่เกิน)</span><input class="input num" name="minQty" value="${esc(item.minQty || "")}" inputmode="decimal" placeholder="0 = ไม่แจ้งเตือน"></label>
    <label class="field"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(item.note)}"></label>
    <div class="units-ed" style="grid-column:1/-1"><div class="bold" style="font-size:13.5px">หน่วยอื่น (ไม่บังคับ) — เช่น ซื้อเป็นถุง / ลัง / แพ็ค</div>
      <div data-urows></div><button type="button" class="btn sm" data-uadd>${icon("plus")} เพิ่มหน่วย</button>
      <div class="field-hint" style="margin-top:6px">สต็อกนับเป็น <b>หน่วยหลัก</b> เสมอ · ตอนรับเข้า / เบิก / ตรวจนับ / ผูกรายจ่าย เลือกหน่วยไหนก็ได้ ระบบแปลงให้ และคิดต้นทุนต่อหน่วยหลักให้ถูกต้อง (เช่น 1 ถุง = 2 กก. ราคาถุงละ 62.50 → ต้นทุน 31.25 / กก.)</div></div>
    <div style="grid-column:1/-1">${photoBox(item.photoV ? stockPhoto(item) : "", "รูปสินค้า (ช่วยให้พนักงานเบิกถูก)")}</div></div>
    ${isNew ? `<div class="section-t" style="margin-top:18px">ยอดยกมา (ไม่บังคับ)</div><div class="grid g3"><label class="field"><span>จำนวนคงเหลือตอนนี้</span><input class="input num" name="openingQty" inputmode="decimal" placeholder="0"></label>
      <label class="field"><span>ต้นทุนต่อหน่วย (บาท)</span><input class="input num" name="openingCost" inputmode="decimal" placeholder="0.00"></label><label class="field"><span>ณ วันที่</span><input type="date" class="input" name="openingDate" value="${today()}"></label></div>` : ""}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} บันทึก</button>` });
  bindCatPicker(m.el); const getPhoto = bindPhotoBox(m.el);
  const urows = (item.units || []).map(u => ({ ...u }));
  const drawU = () => { const base = $("[name=unit]", m.el).value.trim() || "หน่วยหลัก";
    $("[data-urows]", m.el).innerHTML = urows.map((u, k) => `<div class="u-row" data-k="${k}"><span>1</span><input class="input sm" data-un value="${esc(u.n || "")}" placeholder="เช่น ถุง" list="unit-dl2"><span>=</span><input class="input sm num" data-uf value="${u.f || ""}" inputmode="decimal" placeholder="2"><span class="u-base">${esc(base)}</span><button type="button" class="btn ghost sm icon" data-urm>${icon("trash")}</button></div>`).join("");
    $$(".u-row", m.el).forEach(r => { const k = +r.dataset.k; $("[data-un]", r).oninput = e => { urows[k].n = e.target.value; }; $("[data-uf]", r).oninput = e => { urows[k].f = e.target.value; }; $("[data-urm]", r).onclick = () => { urows.splice(k, 1); drawU(); }; }); };
  $("[data-uadd]", m.el).onclick = () => { urows.push({ n: "", f: "" }); drawU(); const ins = $$("[data-un]", m.el); if (ins.length) ins[ins.length - 1].focus(); };
  $("[name=unit]", m.el).addEventListener("input", () => $$(".u-base", m.el).forEach(x => { x.textContent = $("[name=unit]", m.el).value.trim() || "หน่วยหลัก"; }));
  drawU();
  const sv = $("[data-save]", m.el);
  sv.onclick = () => withBtn(sv, async () => { const f = formData(m.el); const pv = getPhoto(); if (pv !== undefined) f.photo = pv;
    f.units = urows.filter(u => String(u.n || "").trim() || String(u.f || "").trim()).map(u => ({ n: String(u.n || "").trim(), f: num(u.f) }));
    f.minQty = num(f.minQty); f.openingQty = num(f.openingQty); f.openingCost = num(f.openingCost);
    if (f.category && !listNames("stock_category").includes(f.category)) { await bapi("POST", "/lists", { kind: "stock_category", name: f.category }); S.lists = (await bapi("GET", "/lists")).lists; }
    const r = isNew ? await bapi("POST", "/stock/items", f) : await bapi("PUT", "/stock/items/" + item.id, f);
    S.stockItems = null; toast(r.pending ? "บันทึกสินค้าแล้ว · ยอดยกมารออนุมัติ" : "บันทึกสินค้าแล้ว"); m.close(); after(); }).catch(() => {});
}
async function stockItemDetail(id, after) {
  const it = (S.stockItems || await loadStockItems()).find(x => x.id === id); if (!it) return;
  const mv = (await bapi("GET", "/stock/moves?from=2000-01-01&to=2100-12-31&itemId=" + id)).moves;
  const m = openModal({ title: esc(it.name), size: "xl", body: `${it.photoV ? `<div class="detail-ph" data-dph style="background-image:url('${stockPhoto(it)}')"></div>` : ""}<div class="pay-grid" style="margin-bottom:16px"><div class="mini-kpi"><div class="l">คงเหลือ</div><div class="v">${fmtQ(it.qty)} ${esc(it.unit)}</div></div><div class="mini-kpi"><div class="l">ต้นทุนเฉลี่ย/หน่วย</div><div class="v">${baht(it.avgCost)}</div></div>
      <div class="mini-kpi"><div class="l">มูลค่าคงเหลือ</div><div class="v">${baht(it.value)}</div></div><div class="mini-kpi"><div class="l">จุดสั่งซื้อ</div><div class="v">${it.minQty ? fmtQ(it.minQty) + " " + esc(it.unit) : "-"}</div></div></div>
    ${unitsHint(it) ? `<div class="info-box" style="margin-bottom:12px">หน่วยอื่น: ${esc(unitsHint(it))} — รับเข้า/เบิกเป็นหน่วยเหล่านี้ได้ ระบบแปลงเป็น ${esc(it.unit)} ให้</div>` : ""}
    <div class="section-t">บัตรสต็อก (Stock Card)</div><div class="card tbl-wrap" data-mv>${movesTable(mv, false)}</div>`,
    foot: canEdit("stock") ? `<div class="left"><button class="btn danger" data-del>${icon("trash")} ลบสินค้า</button><button class="btn" data-act>${it.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>${S.adminToken ? `<button class="btn" data-cpy>${icon("copy")} คัดลอกไปสาขาอื่น</button>` : ""}</div><button class="btn" data-in>${icon("income")} รับเข้า</button><button class="btn" data-out>${icon("expense")} เบิกใช้</button><button class="btn primary" data-edit>${icon("edit")} แก้ไข</button>` : `<button class="btn" data-close>ปิด</button>` });
  const done = () => { m.close(); after(); };
  const dph = $("[data-dph]", m.el); if (dph) dph.onclick = () => lightbox([{ url: stockPhoto(it), name: it.name }], 0);
  bindMoveDeletes(m.el, done);
  if (!canEdit("stock")) return;
  $("[data-edit]", m.el).onclick = () => { m.close(); stockItemModal(it, after); };
  const cpy = $("[data-cpy]", m.el); if (cpy) cpy.onclick = () => { m.close(); copyStockModal(S.bid, after, [id]); };
  $("[data-in]", m.el).onclick = () => { m.close(); stockBatchModal("in", id, after); };
  $("[data-out]", m.el).onclick = () => { m.close(); stockBatchModal("out", id, after); };
  $("[data-act]", m.el).onclick = async () => { await bapi("PUT", "/stock/items/" + id, { active: !it.active }); S.stockItems = null; toast(it.active ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว"); done(); };
  $("[data-del]", m.el).onclick = async () => { if (!await confirmBox(`ลบสินค้า “${it.name}” และประวัติความเคลื่อนไหวทั้งหมด?`, { danger: true, okText: "ลบสินค้า" })) return; try { await bapi("DELETE", "/stock/items/" + id); S.stockItems = null; toast("ลบสินค้าแล้ว"); done(); } catch (e) { toast(e.message, "bad"); } };
}
/* รับเข้า / ของเสีย / ตรวจนับ / เบิก — เลือกสินค้าแบบแตะการ์ดแยกหมวด (v2.7) */
const BATCH = { in: { t: "รับเข้า / เติมสินค้า", btn: "บันทึกรับเข้า", q: "จำนวน" }, waste: { t: "บันทึกของเสีย / ทิ้ง", btn: "บันทึกของเสีย", q: "จำนวน" },
  count: { t: "ตรวจนับสต็อก", btn: "บันทึกยอดนับ", q: "นับได้จริง" }, out: { t: "เบิกใช้", btn: "บันทึกเบิก", q: "จำนวน" } };
async function stockBatchModal(kind, preId, after) {
  let items; try { items = (await loadStockItems(true)).filter(i => i.active); } catch (e) { return toast(e.message, "bad"); }
  if (!items.length) return toast("ยังไม่มีสินค้า — เพิ่มสินค้าก่อน", "bad");
  const K = BATCH[kind], sel = [], st = { cat: "", q: "" };
  const add = id => { if (!sel.some(l => l.id === id)) { const it = items.find(i => i.id === id); sel.push({ id, qty: "", unit: it.unit, price: "" }); } };
  if (preId && items.some(i => i.id === preId)) add(preId);
  const needAppr = kind !== "out" && !approver("stock");
  const m = openModal({ title: K.t, size: "xl", sticky: true, body: `
    ${kind === "in" ? `<div class="info-box" style="margin-bottom:12px">แตะสินค้าด้านล่างเพื่อเพิ่ม แล้วใส่จำนวน · เลือกหน่วย (เช่น ถุง / ลัง) · ราคาต่อหน่วยที่เลือก — ระบบแปลงเป็นหน่วยหลักและคิดต้นทุนให้เอง${needAppr ? " · <b>รายการนี้จะรอผู้จัดการอนุมัติ</b>" : ""}<br><span class="small">ถ้าเป็นการซื้อของ แนะนำบันทึกที่ “รายจ่าย” แล้วผูกสต็อก หรือใช้แท็บ “รายการที่จะซื้อ” จะได้ทั้งบัญชีและสต็อก</span></div>` : ""}
    ${kind === "count" ? `<div class="info-box" style="margin-bottom:12px">ใส่จำนวนที่นับได้จริง (เลือกหน่วยได้) ระบบจะปรับยอดคงเหลือให้ตรง และบันทึกส่วนต่างไว้${needAppr ? " · <b>รออนุมัติ</b>" : ""}</div>` : ""}
    ${kind === "waste" && needAppr ? `<div class="info-box" style="margin-bottom:12px">รายการของเสียจะรอผู้จัดการอนุมัติก่อนตัดยอด</div>` : ""}
    <div class="grid g2"><label class="field"><span>วันที่</span><input type="date" class="input" name="date" value="${today()}"></label><label class="field"><span>หมายเหตุ</span><input class="input" name="note" placeholder="${kind === "in" ? "เช่น ซื้อจากแม็คโคร" : kind === "waste" ? "เช่น เน่าเสีย หมดอายุ" : kind === "count" ? "เช่น นับสิ้นเดือน" : "เช่น เบิกเข้าครัว"}"></label></div>
    <div class="section-t" style="margin-top:14px">รายการที่เลือก <span class="muted" data-seln></span></div><div data-sel></div>
    <div class="section-t" style="margin-top:14px">แตะสินค้าเพื่อเพิ่ม</div>
    <div class="search" style="max-width:none;margin-bottom:8px">${icon("search", "")}<input class="input" data-bq placeholder="ค้นหาสินค้า"></div>
    <div class="cat-chips" data-bcats></div><div class="bt-grid" data-bgrid></div>`,
    foot: `${kind === "in" ? `<div class="left bold" data-btotal></div>` : ""}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} ${K.btn}</button>` });
  const el = m.el;
  const totalOf = () => sel.reduce((a, l) => { const it = items.find(i => i.id === l.id); const pr = l.price === "" ? it.avgCost * ufOf(it, l.unit) : num(l.price); return a + num(l.qty) * pr; }, 0);
  const drawTotal = () => { const t = $("[data-btotal]", el); if (t) t.textContent = sel.length ? "รวม " + baht(totalOf()) : ""; };
  const lineInfo = l => { const it = items.find(i => i.id === l.id), f = ufOf(it, l.unit), bq = num(l.qty) * f;
    if (kind === "count") return l.qty === "" ? `ในระบบ ${fmtQ(it.qty)} ${esc(it.unit)}` : `ในระบบ ${fmtQ(it.qty)} → ต่าง <b class="${bq - it.qty < 0 ? "neg" : "pos"}">${bq - it.qty > 0 ? "+" : ""}${fmtQ(bq - it.qty)}</b> ${esc(it.unit)}`;
    if (kind === "in") { const pr = l.price === "" ? it.avgCost * f : num(l.price); return `${f !== 1 && l.qty !== "" ? `= ${fmtQ(bq)} ${esc(it.unit)} · ` : ""}${pr ? `ทุน ${fmt(pr / f)} / ${esc(it.unit)} · ` : ""}รวม <b>${fmt(num(l.qty) * pr)}</b>`; }
    const over = bq > it.qty + 1e-9; return `${f !== 1 && l.qty !== "" ? `= ${fmtQ(bq)} ${esc(it.unit)} · ` : ""}<span class="${over ? "neg" : ""}">เหลือ ${fmtQ(it.qty)} ${esc(it.unit)}${over ? " — ไม่พอ" : ""}</span>`; };
  const drawSel = () => {
    $("[data-seln]", el).textContent = sel.length ? `(${sel.length})` : "";
    $("[data-sel]", el).innerHTML = sel.length ? sel.map((l, k) => { const it = items.find(i => i.id === l.id); const f = ufOf(it, l.unit);
      return `<div class="bt-row" data-k="${k}"><div class="bt-top">${it.photoV ? `<span class="q-ph" style="background-image:url('${stockPhoto(it)}')"></span>` : ""}<div class="grow"><b>${esc(it.name)}</b><div class="muted small">${esc(it.category || NOCAT)} · เหลือ ${fmtQ(it.qty)} ${esc(it.unit)}${unitsHint(it) ? " · " + esc(unitsHint(it)) : ""}</div></div><button type="button" class="btn ghost sm icon" data-brm title="เอาออก">${icon("x")}</button></div>
        <div class="bt-in"><input class="input num" data-bqty inputmode="decimal" value="${esc(l.qty)}" placeholder="${K.q}">${unitSel(it, l.unit, "data-bu")}
          ${kind === "in" ? `<span class="muted">×</span><input class="input num" data-bpr inputmode="decimal" value="${esc(l.price)}" placeholder="${fmt(it.avgCost * f)}" title="ราคาต่อ ${esc(l.unit)}"><span class="muted small" data-bpu>/ ${esc(l.unit || it.unit)}</span>` : ""}</div>
        <div class="small muted" data-binfo>${lineInfo(l)}</div></div>`; }).join("") : `<div class="muted small" style="padding:6px 2px">ยังไม่ได้เลือก — แตะการ์ดสินค้าด้านล่าง</div>`;
    $$(".bt-row", el).forEach(r => { const k = +r.dataset.k, l = sel[k], it = items.find(i => i.id === l.id);
      const upd = () => { $("[data-binfo]", r).innerHTML = lineInfo(l); drawTotal(); };
      $("[data-bqty]", r).oninput = e => { l.qty = e.target.value; upd(); };
      const bu = $("[data-bu]", r); if (bu) bu.onchange = () => { l.unit = bu.value; const pr = $("[data-bpr]", r); if (pr) pr.placeholder = fmt(it.avgCost * ufOf(it, l.unit)); const pu = $("[data-bpu]", r); if (pu) pu.textContent = "/ " + l.unit; upd(); };
      const pr = $("[data-bpr]", r); if (pr) pr.oninput = e => { l.price = e.target.value; upd(); };
      $("[data-brm]", r).onclick = () => { sel.splice(k, 1); drawSel(); drawGrid(); }; });
    drawTotal();
  };
  const drawGrid = () => {
    const q = st.q.toLowerCase();
    const cats = stockCats(items), cnt = n => items.filter(i => (i.category || NOCAT) === n).length, lowN = items.filter(i => i.low || i.qty <= 0).length;
    $("[data-bcats]", el).innerHTML = `<button data-bc="" class="${!st.cat ? "on" : ""}">ทั้งหมด <span>${items.length}</span></button>${cats.map(n => `<button data-bc="${esc(n)}" class="${st.cat === n ? "on" : ""}">${esc(n)} <span>${cnt(n)}</span></button>`).join("")}${lowN ? `<button data-bc="__low" class="low ${st.cat === "__low" ? "on" : ""}">⚠ ใกล้หมด <span>${lowN}</span></button>` : ""}`;
    $$("[data-bc]", el).forEach(b => { b.onclick = () => { st.cat = b.dataset.bc; drawGrid(); }; });
    const show = items.filter(i => (!q || (i.name + " " + i.sku).toLowerCase().includes(q)) && (!st.cat || (st.cat === "__low" ? (i.low || i.qty <= 0) : (i.category || NOCAT) === st.cat)));
    const groups = stockCats(show).map(n => ({ n, list: show.filter(i => (i.category || NOCAT) === n) }));
    $("[data-bgrid]", el).innerHTML = show.length ? groups.map(g => `<div class="q-gh">${esc(g.n)} <span>${g.list.length}</span></div><div class="q-grid">${g.list.map(i => { const on = sel.some(l => l.id === i.id);
      return `<button type="button" class="q-item bt-card ${i.qty <= 0 ? "out" : i.low ? "low" : ""} ${on ? "sel" : ""}" data-bi="${i.id}">${i.photoV ? `<div class="q-head"><span class="q-ph" style="background-image:url('${stockPhoto(i)}')"></span><div class="q-name">${esc(i.name)}</div></div>` : `<div class="q-name">${esc(i.name)}</div>`}
        <div class="q-left">เหลือ <b>${fmtQ(i.qty)}</b> ${esc(i.unit)}</div><div class="q-tap">${on ? "✓ เลือกแล้ว" : "+ แตะเพื่อเพิ่ม"}</div></button>`; }).join("")}</div>`).join("") : emptyBox("ไม่พบสินค้า", "stock");
    $$("[data-bi]", el).forEach(b => { b.onclick = () => { const id = b.dataset.bi; const k = sel.findIndex(l => l.id === id);
      if (k < 0) { add(id); drawSel(); drawGrid(); const rows = $$(".bt-row", el); const r = rows[rows.length - 1]; if (r) { r.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => $("[data-bqty]", r).focus({ preventScroll: true }), 250); } }
      else { const r = $$(".bt-row", el)[k]; if (r) { r.scrollIntoView({ block: "center", behavior: "smooth" }); r.classList.add("flash"); setTimeout(() => r.classList.remove("flash"), 800); } } }; });
  };
  $("[data-bq]", el).oninput = debounce(e => { st.q = e.target.value; drawGrid(); }, 150);
  drawSel(); drawGrid();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => {
    const lines = sel.filter(l => kind === "count" ? l.qty !== "" : num(l.qty) > 0).map(l => { const it = items.find(i => i.id === l.id);
      return { itemId: l.id, qty: num(l.qty), unit: l.unit, unitCost: kind === "in" ? (l.price === "" ? r2(it.avgCost * ufOf(it, l.unit)) : num(l.price)) : undefined }; });
    if (!lines.length) throw new Error("กรุณาเลือกสินค้าและใส่จำนวน");
    const r = await bapi("POST", "/stock/moves", { kind, date: $("[name=date]", el).value, note: $("[name=note]", el).value, lines });
    S.stockItems = null; m.close(); toast(r.pending ? "ส่งรออนุมัติแล้ว " + lines.length + " รายการ" : "บันทึกแล้ว " + lines.length + " รายการ"); after();
  }).catch(() => {});
}
async function stockMoveModal(kind, itemId, after) {
  const items = (await loadStockItems()).filter(i => i.active);
  if (!items.length) return toast("ยังไม่มีสินค้า — เพิ่มสินค้าก่อน", "bad");
  const lines = [{ itemId: itemId || "", qty: "", unitCost: "" }];
  const itemOpts = sel => `<option value="">— เลือกสินค้า —</option>` + items.map(i => opt(i.id, i.name + " · เหลือ " + fmtQ(i.qty) + " " + i.unit, i.id === sel)).join("");
  const lineRow = (l, i) => { const it = items.find(x => x.id === l.itemId); return `<tr data-i="${i}"><td class="c-name"><select class="input sm" data-f="itemId">${itemOpts(l.itemId)}</select></td>
    <td style="width:130px"><input class="input sm num" data-f="qty" value="${esc(l.qty)}" inputmode="decimal" placeholder="${kind === "count" ? "ยอดนับจริง" : "จำนวน"}"></td>
    ${kind === "in" ? `<td style="width:130px"><input class="input sm num" data-f="unitCost" value="${esc(l.unitCost)}" inputmode="decimal" placeholder="${it ? fmt(it.avgCost) : "0.00"}"></td>` : ""}
    <td class="small muted" style="width:150px;padding-top:12px" data-info>${it ? (kind === "count" ? "ในระบบ " + fmtQ(it.qty) + (l.qty !== "" ? ` → ต่าง <b>${fmtQ(num(l.qty) - it.qty)}</b>` : "") : "คงเหลือ " + fmtQ(it.qty) + " " + esc(it.unit)) : ""}</td>
    <td style="width:36px"><button class="btn ghost sm icon" data-rm>${icon("trash")}</button></td></tr>`; };
  const m = openModal({ title: MOVE[kind].th + "สินค้า", size: "lg", sticky: true, body: `
    ${kind === "in" ? `<div class="info-box" style="margin-bottom:14px">ใช้สำหรับรับของเข้าที่ไม่ได้บันทึกเป็นรายจ่าย (เช่น ยอดยกมา โอนจากที่อื่น) — ถ้าซื้อของ แนะนำให้บันทึกที่ “รายจ่าย” แล้วผูกสต็อก จะได้ทั้งบัญชีและสต็อกในครั้งเดียว</div>` : ""}
    ${kind === "count" ? `<div class="info-box" style="margin-bottom:14px">ใส่จำนวนที่นับได้จริง ระบบจะปรับยอดคงเหลือให้ตรง และบันทึกส่วนต่างไว้เป็นประวัติ</div>` : ""}
    <div class="grid g2"><label class="field"><span>วันที่</span><input type="date" class="input" name="date" value="${today()}"></label><label class="field"><span>หมายเหตุ</span><input class="input" name="note" placeholder="${kind === "out" ? "เช่น เบิกเข้าครัวรอบเช้า" : kind === "waste" ? "เช่น เน่าเสีย หมดอายุ" : ""}"></label></div>
    <table class="doc-lines" style="margin-top:14px"><thead><tr><th>สินค้า</th><th class="num">${kind === "count" ? "นับได้จริง" : "จำนวน"}</th>${kind === "in" ? '<th class="num">ต้นทุน/หน่วย</th>' : ""}<th></th><th></th></tr></thead><tbody data-lines></tbody></table>
    <button class="btn sm" style="margin-top:10px" data-add>${icon("plus")} เพิ่มรายการ</button>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} บันทึก${MOVE[kind].th}</button>` });
  const el = m.el;
  const draw = () => { $("[data-lines]", el).innerHTML = lines.map(lineRow).join("");
    $$("tr[data-i]", el).forEach(tr => { const i = +tr.dataset.i;
      $$("[data-f]", tr).forEach(inp => { inp[inp.tagName === "SELECT" ? "onchange" : "oninput"] = () => { lines[i][inp.dataset.f] = inp.value; if (inp.tagName === "SELECT" || kind === "count") { const pos = inp.selectionStart; draw(); const n = $(`tr[data-i="${i}"] [data-f=${inp.dataset.f}]`, el); if (n) { n.focus(); if (pos != null && n.setSelectionRange) try { n.setSelectionRange(pos, pos); } catch (e) {} } } }; });
      $("[data-rm]", tr).onclick = () => { lines.splice(i, 1); if (!lines.length) lines.push({ itemId: "", qty: "", unitCost: "" }); draw(); }; }); };
  $("[data-add]", el).onclick = () => { lines.push({ itemId: "", qty: "", unitCost: "" }); draw(); };
  draw();
  const sv = $("[data-save]", el);
  sv.onclick = () => withBtn(sv, async () => {
    const ls = lines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, qty: num(l.qty, NaN), unitCost: l.unitCost === "" ? (items.find(x => x.id === l.itemId) || {}).avgCost : num(l.unitCost) }));
    if (!ls.length) throw new Error("กรุณาเลือกสินค้า");
    const r = await bapi("POST", "/stock/moves", { kind, date: $("[name=date]", el).value, note: $("[name=note]", el).value, lines: ls });
    S.stockItems = null; toast(r.pending ? "บันทึก" + MOVE[kind].th + "แล้ว · รอผู้อนุมัติ (ยอดยังไม่เปลี่ยน)" : "บันทึก" + MOVE[kind].th + "แล้ว"); m.close(); after();
  }).catch(() => {});
}

/* ---------- employees ---------- */
BRANCH_PAGES.employees = { title: () => "พนักงาน", async render(c) {
  const self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>พนักงาน</h2><div class="muted small">ข้อมูลพนักงานและอัตราค่าจ้างของสาขา ใช้คำนวณเงินเดือนอัตโนมัติ · ตั้ง PIN ให้พนักงานเพื่อใช้เช็คอินเข้างาน</div></div>${canEdit("employees") ? `<button class="btn primary" data-new>${icon("plus")} เพิ่มพนักงาน</button>` : ""}</div><div class="card"><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  if ($("[data-new]", c)) $("[data-new]", c).onclick = () => empModal(null, () => self.render(c));
  const emps = S.emps = (await bapi("GET", "/employees")).employees;
  $("[data-tbl]", c).innerHTML = emps.length ? `<table class="tbl"><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>รูปแบบค่าจ้าง</th><th class="num">อัตรา</th><th>ประกันสังคม</th><th>บัญชีรับเงิน</th><th>PIN เช็คอิน</th><th>สถานะ</th></tr></thead><tbody>
    ${emps.map(e => `<tr class="click" data-id="${e.id}" style="${e.active ? "" : "opacity:.55"}"><td class="muted">${esc(e.code)}</td><td><div class="d-cell">${empAvatar(e)}<div><div class="bold">${esc(e.name)}${e.nickname ? ` <span class="muted">(${esc(e.nickname)})</span>` : ""}</div><div class="muted small">${e.startDate ? "เริ่มงาน " + thDate(e.startDate, true) : ""}${e.fileCount ? ` · ${icon("clip", "").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} เอกสาร ${e.fileCount}` : ""}</div></div></div></td>
      <td>${esc(e.position || "-")}</td><td>${e.payType === "daily" ? "รายวัน" : "รายเดือน"}</td><td class="num bold">${baht(e.rate)}<span class="muted small">/${e.payType === "daily" ? "วัน" : "เดือน"}</span></td>
      <td>${e.sso ? `<span class="chip blue">หักประกันสังคม</span>` : `<span class="chip">ไม่หัก</span>`}</td><td class="small">${esc(e.bankName)} ${esc(e.bankAccount)}</td><td>${e.hasPin ? `<span class="chip good plain">ตั้งแล้ว</span>` : `<span class="chip plain">ยังไม่ตั้ง</span>`}</td><td>${e.active ? `<span class="chip good">ทำงานอยู่</span>` : `<span class="chip">ลาออก / ปิด</span>`}</td></tr>`).join("")}</tbody></table>`
    : emptyBox("ยังไม่มีพนักงาน — กด “เพิ่มพนักงาน”", "users");
  $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => empModal(emps.find(e => e.id === tr.dataset.id), () => self.render(c)); });
} };
const EMP_DOC_TYPES = ["บัตรประชาชน", "ทะเบียนบ้าน", "สัญญาจ้าง", "ใบรับรองแพทย์", "สมุดบัญชีธนาคาร", "ใบอนุญาตทำงาน", "วุฒิการศึกษา", "อื่นๆ"];
async function bindEmpDocs(root, e, ced) {
  const box = $("[data-edocs]", root); if (!box) return;
  let files = [];
  const draw = () => {
    if (!files.length) { box.innerHTML = `<div class="muted small">ยังไม่มีเอกสาร</div>`; return; }
    box.innerHTML = `<div class="file-grid">${files.map(f => { const img = /^image/.test(f.mime);
      return `<div class="file-tile"><div class="th" data-edv="${f.id}" style="${img ? `background-image:url('${authUrl("/emp-files/" + f.id)}')` : ""}">${img ? "" : icon("file")}</div><div class="fn"><b>${esc(f.docType)}</b><br><span class="muted">${thDate(new Date(f.createdAt).toISOString().slice(0, 10), true)}</span></div>${ced ? `<button class="rm" data-edrm="${f.id}" title="ลบเอกสาร">×</button>` : ""}</div>`; }).join("")}</div>`;
    const imgs = files.filter(f => /^image/.test(f.mime));
    $$("[data-edv]", box).forEach(t => { t.onclick = () => { const f = files.find(x => x.id === t.dataset.edv);
      if (/^image/.test(f.mime)) lightbox(imgs.map(x => ({ url: authUrl("/emp-files/" + x.id), name: x.docType + " · " + x.filename })), imgs.indexOf(f)); else window.open(authUrl("/emp-files/" + f.id), "_blank"); }; });
    $$("[data-edrm]", box).forEach(b => { b.onclick = async () => { const f = files.find(x => x.id === b.dataset.edrm);
      if (!await confirmBox(`ลบเอกสาร “${f.docType}” ของ ${e.name}?`, { danger: true, okText: "ลบเอกสาร" })) return;
      try { await bapi("DELETE", "/emp-files/" + f.id); toast("ลบเอกสารแล้ว"); await load(); } catch (er) { toast(er.message, "bad"); } }; });
  };
  const load = async () => { try { files = (await bapi("GET", "/employees/" + e.id + "/files")).files; draw(); } catch (er) { box.innerHTML = `<div class="muted small">${esc(er.message)}</div>`; } };
  const inp = $("[data-edfile]", root);
  if (inp) inp.onchange = async ev => {
    const list = [...ev.target.files]; ev.target.value = ""; if (!list.length) return;
    const docType = $("[data-edtype]", root).value; const lbl = inp.parentElement; lbl.classList.add("disabled");
    try { for (const file of list) { if (file.size > 12 * 1024 * 1024) { toast(file.name + " ใหญ่เกินไป", "bad"); continue; }
        const r = await fileToB64(file, 2000); await bapi("POST", "/employees/" + e.id + "/files", { docType, filename: r.filename, mime: r.mime || "image/jpeg", data: r.data }); }
      toast("แนบเอกสารแล้ว"); await load(); } catch (er) { toast(er.message, "bad"); } finally { lbl.classList.remove("disabled"); }
  };
  load();
}
function empModal(e, after) {
  const isNew = !e; e = e || { code: "", name: "", nickname: "", position: "", phone: "", idCard: "", bankName: "", bankAccount: "", startDate: "", payType: "monthly", rate: "", sso: true, note: "", active: true };
  const ced = canEdit("employees");
  const m = openModal({ title: isNew ? "เพิ่มพนักงาน" : "ข้อมูลพนักงาน", size: "lg", body: `${ced ? `<div style="margin-bottom:14px">${photoBox(e.photoV ? empPhoto(e) : "", "รูปโปรไฟล์พนักงาน", true)}</div>` : (e.photoV ? `<div class="emp-ph-big" style="background-image:url('${empPhoto(e)}')"></div>` : "")}<div class="grid g3">
    <label class="field"><span>รหัสพนักงาน</span><input class="input" name="code" value="${esc(e.code)}" placeholder="ว่าง = สร้างให้อัตโนมัติ"></label>
    <label class="field"><span>ชื่อ-นามสกุล <em>*</em></span><input class="input" name="name" value="${esc(e.name)}"></label>
    <label class="field"><span>ชื่อเล่น</span><input class="input" name="nickname" value="${esc(e.nickname)}"></label>
    <label class="field"><span>ตำแหน่ง</span><input class="input" name="position" value="${esc(e.position)}" placeholder="เช่น พ่อครัว, พนักงานเสิร์ฟ"></label>
    <label class="field"><span>เบอร์โทร</span><input class="input" name="phone" value="${esc(e.phone)}"></label>
    <label class="field"><span>วันที่เริ่มงาน</span><input type="date" class="input" name="startDate" value="${esc(e.startDate)}"></label></div>
    <div class="section-t" style="margin-top:18px">ค่าจ้าง</div><div class="grid g3">
    <label class="field"><span>รูปแบบค่าจ้าง</span><select class="input" name="payType">${opt("monthly", "รายเดือน", e.payType === "monthly")}${opt("daily", "รายวัน", e.payType === "daily")}</select></label>
    <label class="field"><span data-ratelbl>อัตรา (บาท/${e.payType === "daily" ? "วัน" : "เดือน"}) <em>*</em></span><input class="input num" name="rate" value="${esc(e.rate)}" inputmode="decimal"></label>
    <label class="field"><span>ประกันสังคม</span><label class="check" style="height:38px"><input type="checkbox" name="sso" ${e.sso ? "checked" : ""}> หักเงินสมทบ ${S.binfo.sso.rate}%</label></label></div>
    <div class="section-t" style="margin-top:18px">ข้อมูลสำหรับสลิป / โอนเงิน</div><div class="grid g3">
    <label class="field"><span>เลขบัตรประชาชน</span><input class="input" name="idCard" value="${esc(e.idCard)}" inputmode="numeric" maxlength="17"></label>
    <label class="field"><span>ธนาคาร</span><input class="input" name="bankName" value="${esc(e.bankName)}" list="bank-dl"><datalist id="bank-dl">${["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทหารไทยธนชาต (ttb)", "ออมสิน", "ธ.ก.ส.", "พร้อมเพย์"].map(n => opt(n)).join("")}</datalist></label>
    <label class="field"><span>เลขที่บัญชี</span><input class="input" name="bankAccount" value="${esc(e.bankAccount)}"></label></div>
    <div class="section-t" style="margin-top:18px">PIN สำหรับเช็คอินเข้า-ออกงาน</div><div class="grid g3">
    <label class="field"><span>${e.hasPin ? "ตั้ง PIN ใหม่ (เว้นว่าง = ใช้ PIN เดิม)" : "PIN 4-6 หลัก"}</span><input class="input" name="pin" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="${e.hasPin ? "••••" : "เช่น 1234"}"></label>
    <div class="field" style="align-self:end">${e.hasPin ? `<label class="check" style="height:38px"><input type="checkbox" name="clearPin"> ลบ PIN (ปิดการเช็คอินของคนนี้)</label>` : `<div class="field-hint">พนักงานใช้ PIN นี้ยืนยันตัวตนตอนเช็คอินบนมือถือ</div>`}</div></div>
    <label class="field" style="margin-top:14px"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(e.note)}"></label>
    <div class="section-t" style="margin-top:18px">เอกสารพนักงาน</div>
    ${isNew ? `<div class="muted small">บันทึกข้อมูลพนักงานก่อน แล้วเปิดอีกครั้งเพื่อแนบเอกสาร (บัตรประชาชน สัญญาจ้าง ฯลฯ)</div>` : `<div data-edocs><div class="muted small">กำลังโหลด…</div></div>
      ${ced ? `<div class="row wrap" style="gap:8px;margin-top:10px"><select class="input sm" style="width:auto" data-edtype>${EMP_DOC_TYPES.map(n => opt(n)).join("")}</select>
        <label class="btn sm">${icon("upload", "")} แนบเอกสาร / ถ่ายรูป<input type="file" accept="image/*,application/pdf" multiple data-edfile hidden></label><span class="muted small">รูปภาพหรือ PDF ไม่เกิน 8MB</span></div>` : ""}`}`,
    foot: !canEdit("employees") ? `<button class="btn" data-close>ปิด</button>` : `${isNew ? "" : `<div class="left"><button class="btn danger" data-del>${icon("trash")} ลบ</button><button class="btn" data-act>${e.active ? "ปิดใช้งาน (ลาออก)" : "เปิดใช้งานอีกครั้ง"}</button></div>`}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} บันทึก</button>` });
  const getPhoto = ced ? bindPhotoBox(m.el) : () => undefined;
  if (!isNew) bindEmpDocs(m.el, e, ced);
  const bigPh = $(".emp-ph-big", m.el); if (bigPh) bigPh.onclick = () => lightbox([{ url: empPhoto(e), name: e.name }], 0);
  $("[name=payType]", m.el).onchange = ev => { $("[data-ratelbl]", m.el).innerHTML = `อัตรา (บาท/${ev.target.value === "daily" ? "วัน" : "เดือน"}) <em>*</em>`; };
  const sv = $("[data-save]", m.el);
  if (!sv) return;
  sv.onclick = () => withBtn(sv, async () => { const f = formData(m.el); f.rate = num(f.rate, NaN); if (!isFinite(f.rate)) throw new Error("กรุณาใส่อัตราค่าจ้าง");
    f.pin = String(f.pin || "").trim(); if (f.pin && !/^\d{4,6}$/.test(f.pin)) throw new Error("PIN ต้องเป็นตัวเลข 4-6 หลัก");
    const pv = getPhoto(); if (pv !== undefined) f.photo = pv;
    if (isNew) await bapi("POST", "/employees", f); else await bapi("PUT", "/employees/" + e.id, f); toast("บันทึกข้อมูลพนักงานแล้ว"); m.close(); after(); }).catch(() => {});
  const act = $("[data-act]", m.el); if (act) act.onclick = async () => { await bapi("PUT", "/employees/" + e.id, { active: !e.active }); toast("อัปเดตสถานะแล้ว"); m.close(); after(); };
  const del = $("[data-del]", m.el); if (del) del.onclick = async () => { if (!await confirmBox("ลบพนักงาน " + e.name + "?", { danger: true, okText: "ลบ" })) return; try { await bapi("DELETE", "/employees/" + e.id); toast("ลบแล้ว"); m.close(); after(); } catch (err) { toast(err.message, "bad"); } };
}

/* ---------- payroll ---------- */
function ssoCalc(wage, enabled) { const s = S.binfo.sso; if (!enabled || wage <= 0) return 0; return Math.round(Math.min(Math.max(wage, s.min), s.max) * s.rate / 100); }
function daysIn(p) { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function calcPay(it) { // ต้องตรงกับ calcPayItem ฝั่งเซิร์ฟเวอร์
  const rate = r2(num(it.rate)), wd = r2(num(it.workDays)), base = it.payType === "daily" ? r2(rate * wd) : rate;
  const otRate = it.otRate === "" || it.otRate == null ? (it.payType === "daily" ? rate / 8 * 1.5 : rate / 30 / 8 * 1.5) : num(it.otRate);
  const otAmount = r2(r2(num(it.otHours)) * r2(otRate));
  const gross = r2(base + otAmount + num(it.allowance) + num(it.bonus) + num(it.otherIncome));
  const ssoAuto = ssoCalc(r2(base + otAmount + num(it.allowance) - num(it.absentDeduct)), it.emp.sso !== false);
  const sso = it.ssoOverride !== "" && it.ssoOverride != null ? r2(num(it.ssoOverride)) : ssoAuto;
  const totalDeduct = r2(sso + num(it.tax) + num(it.advance) + num(it.absentDeduct) + num(it.otherDeduct));
  return { base, otRate: r2(otRate), otAmount, gross, sso, ssoAuto, totalDeduct, net: r2(gross - totalDeduct) };
}
BRANCH_PAGES.payroll = { title: rest => rest && rest[0] ? "งวดเงินเดือน" : "เงินเดือน & สลิป", nav: "payroll", async render(c, rest) {
  if (rest && rest[0]) return payrollRun(c, rest[0]);
  const self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>เงินเดือน & สลิปเงินเดือน</h2><div class="muted small">สร้างงวด → กด “ดึงข้อมูลอัตโนมัติ” (วันทำงาน/ขาด-ลา/เบิกล่วงหน้า) → ปรับ OT/เบี้ยเลี้ยง → กด “จ่ายเงินเดือน” ระบบลงรายจ่ายให้อัตโนมัติ</div></div>${canEdit("payroll") ? `<button class="btn primary" data-new>${icon("plus")} สร้างงวดเงินเดือน</button>` : ""}</div><div class="card"><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  if ($("[data-new]", c)) $("[data-new]", c).onclick = () => {
    const p = today().slice(0, 7);
    const m = openModal({ title: "สร้างงวดเงินเดือน", body: `<div class="grid g2"><label class="field"><span>งวดเดือน</span><input type="month" class="input" name="period" value="${p}"></label><label class="field"><span>วันที่จ่าย</span><input type="date" class="input" name="payDate" value="${monthEnd(p)}"></label></div>
      <label class="field" style="margin-top:14px"><span>ชื่องวด (ไม่บังคับ)</span><input class="input" name="title" placeholder="เช่น เงินเดือน, ค่าแรงครึ่งเดือนแรก"></label><div class="field-hint" style="margin-top:10px">ระบบจะดึงพนักงานที่ทำงานอยู่ทั้งหมดพร้อมอัตราค่าจ้าง และคำนวณประกันสังคมให้อัตโนมัติ</div>`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>สร้างงวด</button>` });
    $("[name=period]", m.el).onchange = e => { if (e.target.value) $("[name=payDate]", m.el).value = monthEnd(e.target.value); };
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const r = await bapi("POST", "/payroll/runs", formData(m.el)); m.close(); go("#/b/" + S.bid + "/payroll/" + r.id); }).catch(() => {});
  };
  const runs = (await bapi("GET", "/payroll/runs")).runs;
  $("[data-tbl]", c).innerHTML = runs.length ? `<table class="tbl"><thead><tr><th>งวด</th><th>ชื่องวด</th><th>วันที่จ่าย</th><th class="num">พนักงาน</th><th class="num">รายได้รวม</th><th class="num">รายการหัก</th><th class="num">จ่ายสุทธิ</th><th>สถานะ</th></tr></thead><tbody>
    ${runs.map(r => `<tr class="click" data-id="${r.id}"><td class="bold">${thMonth(r.period)}</td><td>${esc(r.title || "-")}</td><td>${thDate(r.payDate, true)}</td><td class="num">${r.count}</td><td class="num">${fmt(r.gross)}</td><td class="num">${fmt(r.totalDeduct)}</td><td class="num bold">${fmt(r.net)}</td>
      <td>${r.status === "paid" ? `<span class="chip good">จ่ายแล้ว · ${esc(r.recordDocNo)}</span>` : `<span class="chip warn">ฉบับร่าง</span>`}</td></tr>`).join("")}</tbody></table>`
    : emptyBox("ยังไม่มีงวดเงินเดือน — เพิ่มพนักงานก่อน แล้วกด “สร้างงวดเงินเดือน”", "payroll");
  $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => go("#/b/" + S.bid + "/payroll/" + tr.dataset.id); });
} };
async function payrollRun(c, runId) {
  const run = (await bapi("GET", "/payroll/runs/" + runId)).run;
  const draft = run.status === "draft" && canEdit("payroll");
  const items = run.items.map(it => { const x = { ...it, ssoOverride: "" }; if (Math.abs(calcPay({ ...x, otRate: "" }).otRate - x.otRate) < .01) x.otRate = ""; return x; });
  items.forEach(it => { const auto = calcPay({ ...it, ssoOverride: "" }).ssoAuto; if (Math.abs(auto - it.sso) > .001) it.ssoOverride = it.sso; });
  let dirty = false;
  const cell = (it, i, f, w) => draft ? `<input class="input sm num" style="width:${w || 82}px" data-i="${i}" data-f="${f}" value="${it[f] === 0 ? "" : esc(it[f])}" placeholder="0" inputmode="decimal">` : `<span>${fmt(it[f])}</span>`;
  c.innerHTML = `<div class="page-head"><a class="btn ghost icon" href="#/b/${S.bid}/payroll" title="กลับ">${icon("back")}</a><div class="grow"><h2>${esc(run.title || "เงินเดือน")} · ${thMonth(run.period)}</h2>
      <div class="row small muted" style="margin-top:2px">${draft ? `<span class="chip warn">ฉบับร่าง</span>` : `<span class="chip good">จ่ายแล้ว ${thDate(run.payDate)} · ${esc(run.paymentChannel)} · เอกสาร ${esc(run.recordDocNo)}</span>`}<span>สร้างโดย ${esc(run.createdBy)}</span></div></div>
      <button class="btn" data-slips>${icon("print")} พิมพ์สลิปทั้งหมด</button>${draft ? `<button class="btn danger" data-del>${icon("trash")}</button><button class="btn" data-auto>${icon("clock")} ดึงข้อมูลอัตโนมัติ</button><button class="btn" data-save>${icon("check")} บันทึก</button><button class="btn primary" data-pay>${icon("payroll")} จ่ายเงินเดือน</button>` : run.status === "paid" && canEdit("payroll") ? `<button class="btn danger" data-unpay>ยกเลิกการจ่าย</button>` : ""}</div>
    ${draft ? `<div class="card card-b" style="margin-bottom:14px"><div class="grid g3"><label class="field"><span>ชื่องวด</span><input class="input" data-meta="title" value="${esc(run.title)}"></label><label class="field"><span>วันที่จ่าย</span><input type="date" class="input" data-meta="payDate" value="${esc(run.payDate)}"></label><label class="field"><span>หมายเหตุ</span><input class="input" data-meta="note" value="${esc(run.note)}"></label></div></div>` : ""}
    <div class="pay-grid" data-kpi style="margin-bottom:14px"></div>
    <div class="card"><div class="toolbar"><b class="grow">รายละเอียดรายคน</b>${draft ? `<button class="btn sm" data-addemp>${icon("plus")} เพิ่มพนักงานในงวด</button>` : ""}</div><div class="tbl-wrap"><table class="tbl" data-tbl><thead><tr><th>พนักงาน</th><th class="num">วันทำงาน</th><th class="num">ฐาน</th><th class="num">OT (ชม.)</th><th class="num">ค่า OT</th><th class="num">เบี้ยเลี้ยง</th><th class="num">โบนัส</th><th class="num">ขาด/ลา/สาย</th><th class="num">ประกันสังคม</th><th class="num">ภาษี</th><th class="num">เบิกล่วงหน้า</th><th class="num">สุทธิ</th></tr></thead><tbody>
    ${items.map((it, i) => `<tr data-row="${i}"><td style="min-width:190px"><div class="row" style="gap:6px"><div class="grow"><div class="bold" style="white-space:nowrap">${esc(it.emp.name)}</div><div class="muted small" style="white-space:nowrap">${esc(it.emp.position || "")}${it.emp.position ? " · " : ""}${it.payType === "daily" ? "รายวัน " + fmt(it.rate) : "รายเดือน"}</div>${linkNote(it)}</div><button class="btn ghost sm icon" data-more="${i}" title="${draft ? "แก้ไขรายละเอียด" : "ดูรายละเอียด"}">${icon(draft ? "edit" : "more")}</button><button class="btn ghost sm icon" data-slip="${i}" title="พิมพ์สลิป">${icon("print")}</button></div></td>
      <td class="num">${it.payType === "daily" ? cell(it, i, "workDays", 64) : `<span class="muted">-</span>`}</td><td class="num" data-c="base"></td><td class="num">${cell(it, i, "otHours", 64)}</td><td class="num" data-c="ot"></td>
      <td class="num">${cell(it, i, "allowance")}</td><td class="num">${cell(it, i, "bonus")}</td><td class="num">${cell(it, i, "absentDeduct")}</td>
      <td class="num">${draft ? `<input class="input sm num" style="width:76px" data-i="${i}" data-f="ssoOverride" value="${esc(it.ssoOverride)}" placeholder="">` : fmt(it.sso)}</td>
      <td class="num">${cell(it, i, "tax", 74)}</td><td class="num">${cell(it, i, "advance")}</td><td class="num bold" data-c="net"></td></tr>`).join("")}</tbody><tfoot data-foot></tfoot></table></div></div>
    <div class="field-hint" style="margin-top:10px">ประกันสังคมคำนวณอัตโนมัติ ${S.binfo.sso.rate}% ของค่าจ้าง (ฐานต่ำสุด ${fmt0(S.binfo.sso.min)} สูงสุด ${fmt0(S.binfo.sso.max)} บาท) — ช่องประกันสังคมเว้นว่างไว้ = ใช้ค่าอัตโนมัติ · OT คิด 1.5 เท่าของค่าจ้างต่อชั่วโมง (แก้อัตราได้ที่ปุ่มแก้ไขรายคน)</div>`;
  const refresh = () => {
    let G = 0, D = 0, N = 0, SS = 0;
    items.forEach((it, i) => { const k = calcPay(it); Object.assign(it, { base: k.base, otAmount: k.otAmount, gross: k.gross, sso: k.sso, totalDeduct: k.totalDeduct, net: k.net, _ssoAuto: k.ssoAuto });
      const tr = $(`tr[data-row="${i}"]`, c); $("[data-c=base]", tr).textContent = fmt(k.base); $("[data-c=ot]", tr).textContent = fmt(k.otAmount); $("[data-c=net]", tr).textContent = fmt(k.net);
      const so = $("[data-f=ssoOverride]", tr); if (so) so.placeholder = fmt(k.ssoAuto);
      G += k.gross; D += k.totalDeduct; N += k.net; SS += k.sso; });
    $("[data-kpi]", c).innerHTML = `<div class="mini-kpi"><div class="l">พนักงานในงวด</div><div class="v">${items.length} คน</div></div><div class="mini-kpi"><div class="l">รายได้รวม</div><div class="v">${baht(G)}</div></div><div class="mini-kpi"><div class="l">รายการหักรวม</div><div class="v">${baht(D)}</div></div><div class="mini-kpi"><div class="l">จ่ายสุทธิ</div><div class="v" style="color:var(--primary)">${baht(N)}</div></div>`;
    $("[data-foot]", c).innerHTML = `<tr><td colspan="2">รวม</td><td class="num">${fmt(items.reduce((a, x) => a + x.base, 0))}</td><td></td><td class="num">${fmt(items.reduce((a, x) => a + x.otAmount, 0))}</td><td class="num">${fmt(items.reduce((a, x) => a + num(x.allowance), 0))}</td><td class="num">${fmt(items.reduce((a, x) => a + num(x.bonus), 0))}</td><td class="num">${fmt(items.reduce((a, x) => a + num(x.absentDeduct), 0))}</td><td class="num">${fmt(SS)}</td><td class="num">${fmt(items.reduce((a, x) => a + num(x.tax), 0))}</td><td class="num">${fmt(items.reduce((a, x) => a + num(x.advance), 0))}</td><td class="num">${fmt(N)}</td></tr>`;
  };
  $$("[data-f]", c).forEach(inp => { inp.oninput = () => { items[+inp.dataset.i][inp.dataset.f] = inp.value; dirty = true; refresh(); }; });
  $$("[data-meta]", c).forEach(inp => { inp.oninput = () => { run[inp.dataset.meta] = inp.value; dirty = true; }; });
  refresh();
  const payload = () => ({ title: run.title, payDate: run.payDate, note: run.note, items: items.map(it => ({ id: it.id, rate: it.rate, workDays: it.payType === "daily" ? num(it.workDays) : it.workDays, otHours: num(it.otHours), otRate: it.otRate, allowance: num(it.allowance), bonus: num(it.bonus), otherIncome: num(it.otherIncome), absentDeduct: num(it.absentDeduct), ssoOverride: it.ssoOverride === "" ? "" : num(it.ssoOverride), tax: num(it.tax), advance: num(it.advance), otherDeduct: num(it.otherDeduct), note: it.note })) });
  const save = async (silent) => { await bapi("PUT", "/payroll/runs/" + runId, payload()); dirty = false; if (!silent) toast("บันทึกงวดเงินเดือนแล้ว"); };
  const sv = $("[data-save]", c); if (sv) sv.onclick = () => withBtn(sv, () => save()).catch(() => {});
  const del = $("[data-del]", c); if (del) del.onclick = async () => { if (!await confirmBox("ลบงวดเงินเดือนฉบับร่างนี้?", { danger: true, okText: "ลบงวด" })) return; await bapi("DELETE", "/payroll/runs/" + runId); toast("ลบงวดแล้ว"); go("#/b/" + S.bid + "/payroll"); };
  const un = $("[data-unpay]", c); if (un) un.onclick = async () => { if (!await confirmBox(`ยกเลิกการจ่ายงวดนี้?\nเอกสารรายจ่าย ${run.recordDocNo} ที่สร้างอัตโนมัติจะถูกลบ และงวดกลับเป็นฉบับร่างให้แก้ไขได้`, { danger: true, okText: "ยกเลิกการจ่าย" })) return; await bapi("POST", "/payroll/runs/" + runId + "/unpay"); toast("ยกเลิกการจ่ายแล้ว"); payrollRun(c, runId); };
  const au = $("[data-auto]", c); if (au) au.onclick = async () => {
    if (!await confirmBox("ดึงข้อมูลอัตโนมัติเข้างวดนี้?\n• พนักงานรายวัน: วันทำงาน = จำนวนวันที่เช็คอิน\n• ขาด/ลา/สาย: ยอดหักจากรายการลาที่อนุมัติแล้วในเดือนนี้\n• เบิกล่วงหน้า: ยอดเบิกที่อนุมัติแล้วและยังไม่ได้หักคืน\n\nช่องวันทำงาน (รายวัน), ขาด/ลา/สาย และเบิกล่วงหน้า จะถูกเขียนทับ", { okText: "ดึงข้อมูล" })) return;
    try { if (dirty) await save(true); const r = await withBtn(au, () => bapi("POST", "/payroll/runs/" + runId + "/autofill"));
      toast(`ดึงข้อมูลแล้ว · วันทำงานจากเช็คอิน ${r.summary.attendance} คน · ลา ${r.summary.leaves} รายการ · เบิก ${r.summary.advances} รายการ`); payrollRun(c, runId); } catch (e) {}
  };
  const pay = $("[data-pay]", c); if (pay) pay.onclick = async () => {
    try { await save(true); } catch (e) { return toast(e.message, "bad"); }
    const r = (await bapi("GET", "/payroll/runs/" + runId)).run; const chans = listNames("payment_channel").filter(n => !isCreditChannel(n));
    const m = openModal({ title: "ยืนยันการจ่ายเงินเดือน", body: `<div class="pay-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px"><div class="mini-kpi"><div class="l">จ่ายสุทธิให้พนักงาน ${r.count} คน</div><div class="v">${baht(r.net)}</div></div><div class="mini-kpi"><div class="l">ประกันสังคม (ลูกจ้าง+นายจ้าง) + ภาษี</div><div class="v">${baht(r.sso * 2 + r.tax)}</div></div></div>
      <div class="grid g2"><label class="field"><span>วันที่จ่าย</span><input type="date" class="input" name="date" value="${esc(r.payDate || today())}"></label><label class="field"><span>จ่ายผ่านช่องทาง</span><select class="input" name="paymentChannel">${(() => { const pick = chans.find(n => /โอน/.test(n) && !isCreditChannel(n)) || chans.find(n => !isCreditChannel(n)) || chans[0]; return chans.map(n => opt(n, n, n === pick)).join(""); })()}</select></label></div>
      <div class="info-box" style="margin-top:14px">ระบบจะสร้าง <b>เอกสารรายจ่าย</b> ให้อัตโนมัติ ยอดรวม <b>${baht(r.net + r.sso * 2 + r.tax)}</b> ประกอบด้วย เงินเดือนสุทธิที่จ่ายพนักงาน + ประกันสังคมส่วนลูกจ้างและนายจ้างที่ต้องนำส่ง + ภาษีหัก ณ ที่จ่าย (เงินเบิกล่วงหน้าที่หักคืนไม่นับซ้ำ)</div>`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} ยืนยันจ่ายเงินเดือน</button>` });
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const x = await bapi("POST", "/payroll/runs/" + runId + "/pay", formData(m.el)); m.close(); toast("จ่ายเงินเดือนแล้ว · สร้างเอกสาร " + x.docNo); payrollRun(c, runId); }).catch(() => {});
  };
  const ae = $("[data-addemp]", c); if (ae) ae.onclick = async () => {
    const emps = (await bapi("GET", "/employees")).employees.filter(e => e.active && !items.some(it => it.employeeId === e.id));
    if (!emps.length) return toast("พนักงานทุกคนอยู่ในงวดนี้แล้ว", "bad");
    const m = openModal({ title: "เพิ่มพนักงานในงวด", body: emps.map(e => `<label class="check" style="display:flex;padding:6px 0"><input type="checkbox" value="${e.id}"> ${esc(e.name)} <span class="muted small">${esc(e.position)}</span></label>`).join(""), foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>เพิ่ม</button>` });
    $("[data-ok]", m.el).onclick = async () => { const ids = $$("input:checked", m.el).map(i => i.value); if (dirty) await save(true); await bapi("PUT", "/payroll/runs/" + runId, { ...payload(), addEmployeeIds: ids }); m.close(); payrollRun(c, runId); };
  };
  $$("[data-more]", c).forEach(b => { b.onclick = () => {
    const i = +b.dataset.more, it = items[i];
    const f = (k, l, h) => `<label class="field"><span>${l}</span><input class="input num" name="${k}" value="${it[k] === 0 ? "" : esc(it[k])}" inputmode="decimal" placeholder="${h || "0"}" ${draft ? "" : "readonly"}></label>`;
    const m = openModal({ title: esc(it.emp.name) + " · " + thMonth(run.period), size: "lg", body: `<div class="section-t">รายได้</div><div class="grid g3">${f("rate", it.payType === "daily" ? "ค่าแรงต่อวัน" : "เงินเดือน")}${it.payType === "daily" ? f("workDays", "วันทำงาน") : ""}${f("otHours", "OT (ชั่วโมง)")}${f("otRate", "อัตรา OT ต่อชั่วโมง", fmt(calcPay({ ...it, otRate: "" }).otRate))}${f("allowance", "เบี้ยเลี้ยง / ค่าตำแหน่ง")}${f("bonus", "โบนัส / ค่าคอม")}${f("otherIncome", "รายได้อื่นๆ")}</div>
      <div class="section-t" style="margin-top:16px">รายการหัก</div><div class="grid g3">${f("ssoOverride", "ประกันสังคม", "อัตโนมัติ " + fmt(it._ssoAuto))}${f("tax", "ภาษีหัก ณ ที่จ่าย")}${f("advance", "เบิกล่วงหน้า")}${f("absentDeduct", "ขาด / ลา / มาสาย")}${f("otherDeduct", "หักอื่นๆ")}</div>
      <label class="field" style="margin-top:14px"><span>หมายเหตุในสลิป</span><input class="input" name="note" value="${esc(it.note)}" ${draft ? "" : "readonly"}></label>`,
      foot: `<button class="btn" data-slip1>${icon("print")} สลิป</button><button class="btn" data-close>ปิด</button>${draft ? `<button class="btn primary" data-ok>ตกลง</button>` : ""}` });
    $("[data-slip1]", m.el).onclick = () => printSlips(run, [it]);
    const ok = $("[data-ok]", m.el); if (ok) ok.onclick = () => { $$("[name]", m.el).forEach(inp => { it[inp.name] = inp.name === "note" ? inp.value : (inp.value === "" && (inp.name === "otRate" || inp.name === "ssoOverride") ? "" : inp.value); }); dirty = true; m.close(); payrollRun.redraw = true;
      // วาดตารางใหม่ด้วยค่าที่แก้
      $$("tr[data-row='" + i + "'] [data-f]", c).forEach(x => { x.value = it[x.dataset.f] === 0 ? "" : it[x.dataset.f]; }); refresh(); };
  }; });
  $$("[data-slip]", c).forEach(b => { b.onclick = () => { refresh(); printSlips(run, [items[+b.dataset.slip]]); }; });
  $("[data-slips]", c).onclick = () => { refresh(); printSlips(run, items); };
  window.onbeforeunload = () => dirty && draft ? "ยังไม่ได้บันทึก" : undefined;
}
function linkNote(it) {
  const l = it.links || {}; const parts = [];
  if (l.attendanceDays != null) parts.push("เช็คอิน " + l.attendanceDays + " วัน");
  if (l.leaveIds && l.leaveIds.length) parts.push("ลา " + l.leaveIds.length + " รายการ");
  if (l.advanceIds && l.advanceIds.length) parts.push("เบิก " + l.advanceIds.length + " รายการ");
  return parts.length ? `<div class="small" style="color:var(--primary);white-space:nowrap">${icon("link", "").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${parts.join(" · ")}</div>` : "";
}
function printSlips(run, items) {
  const c = S.binfo.company, b = S.binfo.branch;
  const slip = it => {
    const inc = [[it.payType === "daily" ? `ค่าแรง (${fmtQ(it.workDays)} วัน × ${fmt(it.rate)})` : "เงินเดือน", it.base], ["ค่าล่วงเวลา (OT " + fmtQ(it.otHours) + " ชม.)", it.otAmount], ["เบี้ยเลี้ยง / ค่าตำแหน่ง", it.allowance], ["โบนัส / ค่าคอมมิชชั่น", it.bonus], ["รายได้อื่นๆ", it.otherIncome]].filter((x, k) => k === 0 || num(x[1]) > 0);
    const ded = [["ประกันสังคม", it.sso], ["ภาษีหัก ณ ที่จ่าย", it.tax], ["เบิกล่วงหน้า", it.advance], ["ขาด / ลา / มาสาย", it.absentDeduct], ["หักอื่นๆ", it.otherDeduct]].filter(x => num(x[1]) > 0);
    const n = Math.max(inc.length, ded.length, 3);
    let rows = ""; for (let k = 0; k < n; k++) { const a = inc[k], d = ded[k]; rows += `<tr><td>${a ? esc(a[0]) : ""}</td><td class="num">${a ? fmt(a[1]) : ""}</td><td>${d ? esc(d[0]) : ""}</td><td class="num">${d ? fmt(d[1]) : ""}</td></tr>`; }
    return `<div class="slip"><div class="sh"><div style="display:flex;gap:10px;align-items:center">${c.logo ? `<img src="${esc(c.logo)}" style="width:40px;height:40px;object-fit:contain">` : ""}<div><div style="font-weight:700;font-size:15px">${esc(c.name)}</div><div class="muted">${esc(b.name)}${(b.address || c.address) ? " · " + esc(b.address || c.address) : ""}</div></div></div>
      <div style="text-align:right"><div style="font-weight:700;font-size:15px;color:#1f6feb">สลิปเงินเดือน</div><div class="muted">PAY SLIP · งวด ${thMonth(run.period)}</div><div class="muted">วันที่จ่าย ${thDate(run.payDate)}</div></div></div>
      <table class="info"><tr><td><span class="muted">รหัส</span> ${esc(it.emp.code)}</td><td><span class="muted">ชื่อ-สกุล</span> <b>${esc(it.emp.name)}</b></td><td><span class="muted">ตำแหน่ง</span> ${esc(it.emp.position || "-")}</td></tr>
        <tr><td colspan="2"><span class="muted">บัญชีรับเงิน</span> ${esc(it.emp.bankName || "-")} ${esc(it.emp.bankAccount || "")}</td><td><span class="muted">เลขบัตรประชาชน</span> ${it.emp.idCard ? esc(it.emp.idCard.replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, "$1-$2-xxxxx-$4-$5")) : "-"}</td></tr></table>
      <table class="lines"><thead><tr><th>รายได้</th><th class="num">จำนวนเงิน</th><th>รายการหัก</th><th class="num">จำนวนเงิน</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td>รวมรายได้</td><td class="num">${fmt(it.gross)}</td><td>รวมรายการหัก</td><td class="num">${fmt(it.totalDeduct)}</td></tr></tfoot></table>
      <div class="netbox"><div><div class="muted">เงินได้สุทธิ (Net Pay)</div><div class="muted small">(${bahtText(it.net)})</div>${it.note ? `<div class="small">หมายเหตุ: ${esc(it.note)}</div>` : ""}</div><div class="net">฿${fmt(it.net)}</div></div>
      <div class="sig2"><div>ผู้จ่ายเงิน</div><div>ผู้รับเงิน</div></div></div>`;
  };
  printHTML("สลิปเงินเดือน " + run.period, items.map(slip).join(""), `.slip{height:136mm;padding:4mm 2mm;border-bottom:1px dashed #b8c0cc;page-break-inside:avoid;display:flex;flex-direction:column}.slip:nth-child(2n){border-bottom:0;page-break-after:always}
    .sh{display:flex;justify-content:space-between;border-bottom:2px solid #1f6feb;padding-bottom:6px;margin-bottom:8px}.info td{border:0;padding:2px 4px;font-size:12px}.lines{margin-top:8px}.lines th,.lines td{font-size:12px;padding:5px 8px}
    .lines td:nth-child(2){border-right:1px solid #e5e8ef}.netbox{display:flex;justify-content:space-between;align-items:center;background:#eef4ff;border-radius:8px;padding:8px 12px;margin-top:8px}.net{font-size:22px;font-weight:700;color:#1f6feb}
    .sig2{display:flex;justify-content:space-around;margin-top:auto;padding-top:22px;text-align:center;font-size:12px}.sig2 div{width:38%;border-top:1px solid #4a5567;padding-top:4px}.small{font-size:11px}`);
}

/* ---------- shared: employees / status ---------- */
async function loadEmps(force) { if (!S.emps || force) S.emps = (await bapi("GET", "/employees")).employees; return S.emps; }
const RSTATUS = { pending: ["รออนุมัติ", "warn"], approved: ["อนุมัติแล้ว", "good"], rejected: ["ไม่อนุมัติ", "bad"], cancelled: ["ยกเลิกแล้ว", ""] };
const statusCell = x => `<span class="chip ${RSTATUS[x.status][1]}">${RSTATUS[x.status][0]}</span>${x.status !== "pending" && x.approvedBy ? `<div class="muted small">${esc(x.approvedBy)}${x.approvedAt ? " · " + thDateTime(x.approvedAt) : ""}</div>` : ""}${x.rejectReason ? `<div class="small neg">${esc(x.rejectReason)}</div>` : ""}`;
const empOpts = (emps, sel, first) => (first ? opt("", first) : "") + emps.filter(e => e.active || e.id === sel).map(e => opt(e.id, e.name + (e.nickname ? " (" + e.nickname + ")" : ""), e.id === sel)).join("");
const statusSeg = (st, keys) => `<div class="seg" data-stf>${[["", "ทั้งหมด"], ...keys.map(k => [k, RSTATUS[k][0]])].map(([k, l]) => `<button data-sv="${k}" class="${st.status === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
const LEAVE_TH = { sick: "ลาป่วย", personal: "ลากิจ", vacation: "ลาพักร้อน", unpaid: "ลาไม่รับค่าจ้าง", absent: "ขาดงาน", late: "มาสาย" };
const LEAVE_CHIP = { sick: "blue", personal: "blue", vacation: "good", unpaid: "warn", absent: "bad", late: "warn" };

/* ---------- ขาด-ลา ---------- */
BRANCH_PAGES.leave = { title: () => "ขาด-ลา", state: { status: "", emp: "" }, async render(c) {
  const st = this.state, self = this, ed = canEdit("leave");
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ขาด-ลา / มาสาย</h2><div class="muted small">บันทึกการลา → ผู้อนุมัติกดอนุมัติ → ยอดหักเข้าไปหักในงวดเงินเดือนอัตโนมัติ (กด “ดึงข้อมูลอัตโนมัติ” ในงวด)</div></div>${rangeBar()}${ed ? `<button class="btn primary" data-new>${icon("plus")} บันทึกขาด/ลา</button>` : ""}</div>
    <div class="pay-grid" data-kpi style="margin-bottom:14px"></div>
    <div class="card"><div class="toolbar">${statusSeg(st, ["pending", "approved", "rejected"])}<select class="input" style="width:220px" data-emp></select><div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  bindRange(c, () => self.render(c));
  const emps = await loadEmps(true);
  $("[data-emp]", c).innerHTML = empOpts(emps, st.emp, "พนักงานทุกคน");
  $("[data-emp]", c).onchange = e => { st.emp = e.target.value; self.render(c); };
  $$("[data-sv]", c).forEach(b => { b.onclick = () => { st.status = b.dataset.sv; self.render(c); }; });
  if (ed) $("[data-new]", c).onclick = () => leaveModal(emps, () => self.render(c));
  const r = await bapi("GET", "/leaves?" + rq() + (st.status ? "&status=" + st.status : "") + (st.emp ? "&employeeId=" + st.emp : ""));
  const L = r.leaves, appr = L.filter(x => x.status === "approved");
  $("[data-kpi]", c).innerHTML = `<div class="mini-kpi"><div class="l">รออนุมัติ</div><div class="v" style="color:${L.some(x => x.status === "pending") ? "var(--warn)" : ""}">${L.filter(x => x.status === "pending").length} รายการ</div></div>
    <div class="mini-kpi"><div class="l">อนุมัติแล้ว</div><div class="v">${appr.length} รายการ</div></div><div class="mini-kpi"><div class="l">วันลารวม (อนุมัติ)</div><div class="v">${fmtQ(appr.reduce((a, x) => a + x.days, 0))} วัน</div></div>
    <div class="mini-kpi"><div class="l">ยอดหักรวม (อนุมัติ)</div><div class="v">${baht(appr.reduce((a, x) => a + x.deduct, 0))}</div></div>`;
  $("[data-tbl]", c).innerHTML = L.length ? `<table class="tbl"><thead><tr><th>วันที่</th><th>พนักงาน</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">ยอดหัก</th><th>เหตุผล</th><th>สถานะ</th><th>งวดเงินเดือน</th><th></th></tr></thead><tbody>
    ${L.map(x => `<tr><td style="white-space:nowrap">${thDate(x.dateFrom, true)}${x.dateTo !== x.dateFrom ? " – " + thDate(x.dateTo, true) : ""}</td><td class="bold">${esc(x.empName)}</td><td><span class="chip ${LEAVE_CHIP[x.kind]} plain">${esc(x.kindTh)}</span></td>
      <td class="num">${x.kind === "late" ? x.minutes + " นาที" : fmtQ(x.days) + " วัน"}</td><td class="num bold">${fmt(x.deduct)}</td><td class="small"><div class="desc">${esc(x.reason || "-")}</div><div class="muted">โดย ${esc(x.requestedBy)}</div></td><td>${statusCell(x)}</td>
      <td class="small">${x.payrollRunId ? `<span class="chip good plain">หักแล้ว ${thMonth(x.payrollPeriod)}</span>` : x.status === "approved" ? `<span class="muted">รอหักในงวด</span>` : ""}</td>
      <td style="white-space:nowrap">${x.status === "pending" && r.canApprove ? `<button class="btn sm primary" data-ap="${x.id}">อนุมัติ</button> <button class="btn sm" data-rj="${x.id}">ไม่อนุมัติ</button>` : ""}
        ${ed && !x.payrollRunId && (x.status === "pending" || r.canApprove) ? `<button class="btn ghost sm icon" data-del="${x.id}" title="ลบ">${icon("trash")}</button>` : ""}</td></tr>`).join("")}</tbody></table>` : emptyBox("ไม่มีรายการขาด-ลาในช่วงนี้", "calendar");
  const find = id => L.find(x => x.id === id);
  $$("[data-ap]", c).forEach(b => { b.onclick = () => leaveApprove(find(b.dataset.ap), () => self.render(c)); });
  $$("[data-rj]", c).forEach(b => { b.onclick = async () => { const reason = await askReason("ไม่อนุมัติ" + find(b.dataset.rj).kindTh); if (!reason) return; try { await bapi("POST", "/leaves/" + b.dataset.rj + "/approve", { approve: false, reason }); toast("บันทึกแล้ว"); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-del]", c).forEach(b => { b.onclick = async () => { const x = find(b.dataset.del); if (!await confirmBox(`ลบรายการ${x.kindTh} ของ ${x.empName}?`, { danger: true, okText: "ลบ" })) return; try { await bapi("DELETE", "/leaves/" + x.id); toast("ลบแล้ว"); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $("[data-csv]", c).onclick = () => downloadCSV("leaves-" + S.range.from + "_" + S.range.to + ".csv", [["วันที่เริ่ม", "ถึง", "พนักงาน", "ประเภท", "วัน", "นาที", "ยอดหัก", "เหตุผล", "สถานะ", "ผู้ขอ", "ผู้อนุมัติ", "งวดที่หัก"],
    ...L.map(x => [x.dateFrom, x.dateTo, x.empName, x.kindTh, x.days, x.minutes, x.deduct, x.reason, RSTATUS[x.status][0], x.requestedBy, x.approvedBy, x.payrollPeriod])]);
} };
function leaveModal(emps, after) {
  const d = { employeeId: "", kind: "sick", dateFrom: today(), dateTo: today(), days: "", minutes: "", reason: "", deduct: "" };
  const m = openModal({ title: "บันทึกขาด / ลา / มาสาย", size: "lg", body: `<div class="grid g2">
      <label class="field"><span>พนักงาน <em>*</em></span><select class="input" name="employeeId">${empOpts(emps, "", "— เลือกพนักงาน —")}</select></label>
      <label class="field"><span>ประเภท <em>*</em></span><select class="input" name="kind">${Object.keys(LEAVE_TH).map(k => opt(k, LEAVE_TH[k], k === d.kind)).join("")}</select></label>
      <label class="field"><span>ตั้งแต่วันที่</span><input type="date" class="input" name="dateFrom" value="${d.dateFrom}"></label>
      <label class="field" data-towrap><span>ถึงวันที่</span><input type="date" class="input" name="dateTo" value="${d.dateTo}"></label>
      <label class="field" data-dayswrap><span>จำนวนวัน (ครึ่งวัน = 0.5)</span><input class="input num" name="days" inputmode="decimal" placeholder="1"></label>
      <label class="field hidden" data-minwrap><span>มาสายกี่นาที <em>*</em></span><input class="input num" name="minutes" inputmode="numeric" placeholder="เช่น 30"></label>
      <label class="field"><span>ยอดหักจากเงินเดือน (บาท)</span><input class="input num" name="deduct" inputmode="decimal" placeholder="อัตโนมัติ"><div class="field-hint" data-hint></div></label></div>
    <label class="field" style="margin-top:14px"><span>เหตุผล / หมายเหตุ</span><input class="input" name="reason" placeholder="เช่น ไม่สบาย มีใบรับรองแพทย์"></label>
    ${approver("leave") ? `<label class="check" style="margin-top:14px"><input type="checkbox" name="approveNow" checked> อนุมัติทันที (คุณเป็นผู้อนุมัติการลา)</label>` : `<div class="info-box" style="margin-top:14px">รายการนี้จะรอผู้อนุมัติก่อน จึงจะนำไปหักในงวดเงินเดือน</div>`}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} บันทึก</button>` });
  const el = m.el;
  const preview = debounce(async () => { const f = formData(el); const h = $("[data-hint]", el);
    if (!f.employeeId) { h.textContent = "เลือกพนักงานเพื่อคำนวณยอดหักอัตโนมัติ"; return; }
    try { const p = await bapi("GET", `/leaves/preview?employeeId=${f.employeeId}&kind=${f.kind}&dateFrom=${f.dateFrom}&dateTo=${f.dateTo || f.dateFrom}&days=${encodeURIComponent(f.days)}&minutes=${encodeURIComponent(f.minutes || 0)}`);
      $("[name=deduct]", el).placeholder = "อัตโนมัติ " + fmt(p.deduct);
      if (!f.days && f.kind !== "late") $("[name=days]", el).placeholder = p.days;
      h.innerHTML = `อัตโนมัติ = <b>${fmt(p.deduct)}</b> บาท (ค่าจ้างต่อวัน ${fmt(p.dayRate)}${p.payType === "monthly" ? " = เงินเดือน÷30" : ""}${["sick", "personal", "vacation"].includes(f.kind) ? " · ลาประเภทนี้ได้รับค่าจ้าง ไม่หัก" : f.kind === "late" ? " · ÷8 ชม. ÷60 × นาที" : ""}) · แก้เองได้`;
    } catch (e) { h.textContent = e.message; } }, 250);
  const kindToggle = () => { const late = $("[name=kind]", el).value === "late"; $("[data-minwrap]", el).classList.toggle("hidden", !late); $("[data-dayswrap]", el).classList.toggle("hidden", late); $("[data-towrap]", el).classList.toggle("hidden", late); preview(); };
  $$("[name]", el).forEach(i => { i.addEventListener(i.tagName === "SELECT" || i.type === "date" ? "change" : "input", () => { if (i.name === "dateFrom" && $("[name=dateTo]", el).value < i.value) $("[name=dateTo]", el).value = i.value; if (i.name === "kind") kindToggle(); else if (i.name !== "deduct" && i.name !== "reason") preview(); }); });
  kindToggle();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => { const f = formData(el); if (!f.employeeId) throw new Error("กรุณาเลือกพนักงาน");
    if (f.kind === "late") f.dateTo = f.dateFrom;
    const r = await bapi("POST", "/leaves", { ...f, approveNow: f.approveNow !== false });
    toast(r.status === "approved" ? "บันทึกและอนุมัติแล้ว" : "บันทึกแล้ว · รอผู้อนุมัติ"); m.close(); after(); }).catch(() => {});
}
function leaveApprove(x, after) {
  const m = openModal({ title: "อนุมัติ" + esc(x.kindTh) + " · " + esc(x.empName), body: `<div class="pay-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px"><div class="mini-kpi"><div class="l">วันที่</div><div class="v" style="font-size:15px">${thDate(x.dateFrom)}${x.dateTo !== x.dateFrom ? " – " + thDate(x.dateTo) : ""}</div></div>
      <div class="mini-kpi"><div class="l">จำนวน</div><div class="v" style="font-size:15px">${x.kind === "late" ? x.minutes + " นาที" : fmtQ(x.days) + " วัน"}</div></div></div>
    ${x.reason ? `<p><b>เหตุผล:</b> ${esc(x.reason)}</p>` : ""}<p class="muted small">ขอโดย ${esc(x.requestedBy)} · ${thDateTime(x.createdAt)}</p>
    <label class="field"><span>ยอดหักจากเงินเดือน (บาท)</span><input class="input num" name="deduct" value="${x.deduct}" inputmode="decimal"></label><div class="field-hint">ยอดนี้จะถูกหักในงวดเงินเดือนของเดือนที่ลา</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} อนุมัติ</button>` });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { await bapi("POST", "/leaves/" + x.id + "/approve", { approve: true, deduct: $("[name=deduct]", m.el).value }); toast("อนุมัติแล้ว"); m.close(); after(); }).catch(() => {});
}

/* ---------- เบิกเงินล่วงหน้า ---------- */
const nextPeriod = p => { const [y, m] = p.split("-").map(Number); return m === 12 ? (y + 1) + "-01" : y + "-" + String(m + 1).padStart(2, "0"); };
const realChannels = () => listNames("payment_channel").filter(n => !isCreditChannel(n));
const chanSelect = (name, sel) => `<select class="input" name="${name}">${opt("", "— เลือกบัญชีที่จ่ายเงิน —")}${realChannels().map(n => opt(n, n, n === sel)).join("")}</select>`;
BRANCH_PAGES.advance = { title: () => "เบิกเงินล่วงหน้า", state: { status: "" }, async render(c) {
  const st = this.state, self = this, ed = canEdit("advance");
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>เบิกเงินล่วงหน้า</h2><div class="muted small">ขอเบิก → ผู้อนุมัติกดอนุมัติพร้อมเลือกบัญชีที่จ่าย → ระบบลงรายจ่ายทันที และหักคืนในงวดเงินเดือนอัตโนมัติ (ไม่บันทึกค่าใช้จ่ายซ้ำ)</div></div>${rangeBar()}${ed ? `<button class="btn primary" data-new>${icon("plus")} ขอเบิกเงิน</button>` : ""}</div>
    <div class="pay-grid" data-kpi style="margin-bottom:14px"></div>
    <div class="card"><div class="toolbar">${statusSeg(st, ["pending", "approved", "rejected", "cancelled"])}<div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  bindRange(c, () => self.render(c));
  $$("[data-sv]", c).forEach(b => { b.onclick = () => { st.status = b.dataset.sv; self.render(c); }; });
  const emps = await loadEmps(true);
  if (ed) $("[data-new]", c).onclick = () => advanceModal(emps, () => self.render(c));
  const r = await bapi("GET", "/advances?" + rq() + (st.status ? "&status=" + st.status : ""));
  const A = r.advances;
  $("[data-kpi]", c).innerHTML = `<div class="mini-kpi"><div class="l">รออนุมัติ</div><div class="v" style="color:${A.some(x => x.status === "pending") ? "var(--warn)" : ""}">${A.filter(x => x.status === "pending").length} รายการ</div></div>
    <div class="mini-kpi"><div class="l">อนุมัติแล้วในช่วงนี้</div><div class="v">${baht(A.filter(x => x.status === "approved").reduce((a, x) => a + x.amount, 0))}</div></div>
    <div class="mini-kpi"><div class="l">ยังไม่ได้หักคืน (ทั้งหมด)</div><div class="v" style="color:var(--primary)">${baht(r.outstanding.amount)}</div><div class="small muted">${r.outstanding.count} รายการ</div></div>
    <div class="mini-kpi"><div class="l">หักคืนแล้วในช่วงนี้</div><div class="v">${baht(A.filter(x => x.payrollRunId).reduce((a, x) => a + x.amount, 0))}</div></div>`;
  $("[data-tbl]", c).innerHTML = A.length ? `<table class="tbl"><thead><tr><th>วันที่ขอ</th><th>พนักงาน</th><th class="num">จำนวนเงิน</th><th>หักคืนงวด</th><th>เหตุผล</th><th>สถานะ</th><th>จ่ายจาก / เอกสาร</th><th></th></tr></thead><tbody>
    ${A.map(x => `<tr><td>${thDate(x.date, true)}</td><td class="bold">${esc(x.empName)}</td><td class="num bold">${fmt(x.amount)}</td>
      <td class="small">${thMonth(x.deductPeriod)}${x.payrollRunId ? `<div><span class="chip good plain">หักคืนแล้ว</span></div>` : ""}</td><td class="small"><div class="desc">${esc(x.reason || "-")}</div><div class="muted">โดย ${esc(x.requestedBy)}</div></td><td>${statusCell(x)}</td>
      <td class="small">${x.payChannel ? esc(x.payChannel) + " · " + thDate(x.payDate, true) : ""}${x.docNo ? `<div><a href="#" class="doc" data-doc="${x.recordId}">${esc(x.docNo)}</a></div>` : ""}</td>
      <td style="white-space:nowrap">${x.status === "pending" && r.canApprove ? `<button class="btn sm primary" data-ap="${x.id}">อนุมัติ</button> <button class="btn sm" data-rj="${x.id}">ไม่อนุมัติ</button> ` : ""}
        ${x.status === "approved" && !x.payrollRunId && r.canApprove ? `<button class="btn sm danger" data-cancel="${x.id}">ยกเลิก</button>` : ""}
        ${ed && (x.status === "pending" || ((x.status === "rejected" || x.status === "cancelled") && r.canApprove)) ? `<button class="btn ghost sm icon" data-del="${x.id}" title="ลบ">${icon("trash")}</button>` : ""}</td></tr>`).join("")}</tbody></table>` : emptyBox("ไม่มีรายการเบิกเงินในช่วงนี้", "cash");
  const find = id => A.find(x => x.id === id);
  $$("[data-doc]", c).forEach(a => { a.onclick = e => { e.preventDefault(); openDoc("expense", a.dataset.doc, () => self.render(c)); }; });
  $$("[data-ap]", c).forEach(b => { b.onclick = () => advanceApprove(find(b.dataset.ap), () => self.render(c)); });
  $$("[data-rj]", c).forEach(b => { b.onclick = async () => { const reason = await askReason("ไม่อนุมัติการเบิกเงิน"); if (!reason) return; try { await bapi("POST", "/advances/" + b.dataset.rj + "/approve", { approve: false, reason }); toast("บันทึกแล้ว"); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-cancel]", c).forEach(b => { b.onclick = async () => { const x = find(b.dataset.cancel); if (!await confirmBox(`ยกเลิกการเบิกเงินของ ${x.empName} ${baht(x.amount)}?\nเอกสารรายจ่าย ${x.docNo} ที่สร้างอัตโนมัติจะถูกลบ (เงินกลับเข้าบัญชี ${x.payChannel})`, { danger: true, okText: "ยกเลิกการเบิก" })) return; try { await bapi("POST", "/advances/" + x.id + "/cancel", {}); toast("ยกเลิกแล้ว"); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-del]", c).forEach(b => { b.onclick = async () => { if (!await confirmBox("ลบคำขอเบิกเงินนี้?", { danger: true, okText: "ลบ" })) return; try { await bapi("DELETE", "/advances/" + b.dataset.del); toast("ลบแล้ว"); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $("[data-csv]", c).onclick = () => downloadCSV("advances-" + S.range.from + "_" + S.range.to + ".csv", [["วันที่", "พนักงาน", "จำนวนเงิน", "หักคืนงวด", "เหตุผล", "สถานะ", "ผู้ขอ", "ผู้อนุมัติ", "จ่ายจาก", "เอกสาร", "หักคืนแล้ว"],
    ...A.map(x => [x.date, x.empName, x.amount, x.deductPeriod, x.reason, RSTATUS[x.status][0], x.requestedBy, x.approvedBy, x.payChannel, x.docNo, x.payrollRunId ? "ใช่" : ""])]);
} };
function advanceModal(emps, after) {
  const t = today();
  const m = openModal({ title: "ขอเบิกเงินล่วงหน้า", body: `<div class="grid g2">
      <label class="field"><span>พนักงาน <em>*</em></span><select class="input" name="employeeId">${empOpts(emps, "", "— เลือกพนักงาน —")}</select></label>
      <label class="field"><span>จำนวนเงิน (บาท) <em>*</em></span><input class="input num" name="amount" inputmode="decimal" placeholder="0.00"></label>
      <label class="field"><span>วันที่ขอเบิก</span><input type="date" class="input" name="date" value="${t}"></label>
      <label class="field"><span>หักคืนในงวดเงินเดือน</span><input type="month" class="input" name="deductPeriod" value="${t.slice(0, 7)}"></label></div>
    <label class="field" style="margin-top:14px"><span>เหตุผล</span><input class="input" name="reason" placeholder="เช่น ค่าเทอมลูก"></label>
    ${approver("advance") ? `<div class="card card-b" style="margin-top:14px;background:var(--surface-2)"><label class="check"><input type="checkbox" name="approveNow"> อนุมัติและจ่ายเงินทันที</label><div class="grid g2 hidden" style="margin-top:10px" data-paywrap>
      <label class="field"><span>จ่ายจากบัญชี</span>${chanSelect("channel", realChannels().find(n => /สด/.test(n)) || "")}</label><label class="field"><span>วันที่จ่าย</span><input type="date" class="input" name="payDate" value="${t}"></label></div></div>` : `<div class="info-box" style="margin-top:14px">คำขอจะรอผู้อนุมัติ เมื่ออนุมัติแล้วระบบจะลงรายจ่ายและหักคืนในงวดเงินเดือนให้อัตโนมัติ</div>`}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} บันทึก</button>` });
  const an = $("[name=approveNow]", m.el); if (an) an.onchange = () => $("[data-paywrap]", m.el).classList.toggle("hidden", !an.checked);
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); if (!f.employeeId) throw new Error("กรุณาเลือกพนักงาน"); f.amount = num(f.amount, NaN);
    if (f.approveNow && !f.channel) throw new Error("กรุณาเลือกบัญชีที่จ่ายเงิน");
    const r = await bapi("POST", "/advances", f); toast(r.docNo ? "อนุมัติและลงรายจ่ายแล้ว · " + r.docNo : "บันทึกคำขอแล้ว · รอผู้อนุมัติ"); m.close(); after(); }).catch(() => {});
}
function advanceApprove(x, after) {
  const m = openModal({ title: "อนุมัติเบิกเงิน · " + esc(x.empName), body: `<div class="mini-kpi" style="margin-bottom:14px"><div class="l">จำนวนเงิน</div><div class="v">${baht(x.amount)}</div><div class="small muted">${esc(x.reason || "")} · ขอโดย ${esc(x.requestedBy)}</div></div>
    <div class="grid g2"><label class="field"><span>จ่ายจากบัญชี <em>*</em></span>${chanSelect("channel", realChannels().find(n => /สด/.test(n)) || "")}</label><label class="field"><span>วันที่จ่าย</span><input type="date" class="input" name="date" value="${today()}"></label>
    <label class="field"><span>หักคืนในงวดเงินเดือน</span><input type="month" class="input" name="deductPeriod" value="${esc(x.deductPeriod)}"></label></div>
    <div class="info-box" style="margin-top:14px">ระบบจะสร้าง <b>เอกสารรายจ่าย</b> ${baht(x.amount)} หักเงินจากบัญชีที่เลือกทันที และหักคืนจากเงินเดือนงวดที่ระบุ (ตอนจ่ายเงินเดือนจะลงรายจ่ายเฉพาะยอดสุทธิ จึงไม่ซ้ำ)</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} อนุมัติและจ่ายเงิน</button>` });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); if (!f.channel) throw new Error("กรุณาเลือกบัญชีที่จ่ายเงิน");
    const r = await bapi("POST", "/advances/" + x.id + "/approve", { approve: true, ...f }); toast("อนุมัติแล้ว · สร้างเอกสาร " + r.docNo); m.close(); after(); }).catch(() => {});
}

/* ---------- ลงเวลา / เช็คอิน ---------- */
const hhmm = ms => ms ? new Date(ms).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : "-";
const fmtHrs = min => min > 0 ? Math.floor(min / 60) + " ชม. " + String(Math.round(min % 60)).padStart(2, "0") + " น." : "-";
// รวมรายการเข้า-ออกของแต่ละคนต่อวัน
function attDays(entries) {
  const g = {};
  entries.forEach(e => { const k = e.employeeId + "|" + e.date; (g[k] = g[k] || { employeeId: e.employeeId, empName: e.empName, date: e.date, list: [] }).list.push(e); });
  return Object.values(g).map(d => {
    d.list.sort((a, b) => a.at - b.at);
    const ins = d.list.filter(x => x.kind === "in"), outs = d.list.filter(x => x.kind === "out");
    let mins = 0, open = null; d.list.forEach(x => { if (x.kind === "in") open = x.at; else if (open) { mins += (x.at - open) / 60000; open = null; } });
    return { ...d, first: ins[0] || null, last: outs[outs.length - 1] || null, minutes: mins, lateMin: ins[0] ? ins[0].lateMin : 0, manual: d.list.some(x => x.manual), working: !!open };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.empName.localeCompare(b.empName));
}
BRANCH_PAGES.attendance = { title: () => "ลงเวลา / เช็คอิน", state: { tab: "day", day: "", month: "" }, async render(c) {
  const st = this.state, self = this, ed = canEdit("attendance");
  st.day = st.day || today(); st.month = st.month || today().slice(0, 7);
  const link = location.origin + location.pathname + "#/checkin/" + S.bid;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ลงเวลาเข้า-ออกงาน</h2><div class="muted small">พนักงานเช็คอินด้วย GPS ผ่านลิงก์ของสาขา · หัวหน้าดูรายวัน สรุปรายเดือน และเพิ่มรายการเองได้</div></div>${ed ? `<button class="btn primary" data-new>${icon("plus")} เพิ่มรายการเอง</button>` : ""}</div>
    <div class="card" style="margin-bottom:14px" data-linkcard></div>
    <div class="tabs"><button data-tab="day" class="${st.tab === "day" ? "on" : ""}">รายวัน</button><button data-tab="month" class="${st.tab === "month" ? "on" : ""}">สรุปรายเดือน</button></div><div data-body><div class="boot" style="height:160px"><div class="spinner"></div></div></div>`;
  $$("[data-tab]", c).forEach(b => { b.onclick = () => { st.tab = b.dataset.tab; self.render(c); }; });
  const emps = await loadEmps(true);
  if (ed) $("[data-new]", c).onclick = () => attManualModal(emps, st.tab === "day" ? st.day : today(), () => self.render(c));
  const from = st.tab === "day" ? st.day : st.month + "-01", to = st.tab === "day" ? st.day : monthEnd(st.month);
  const r = await bapi("GET", `/attendance?from=${from}&to=${to}`);
  const cfg = r.settings;
  $("[data-linkcard]", c).innerHTML = `<div class="card-b row wrap"><div class="acc-ic">${icon("pin")}</div><div class="grow" style="min-width:220px"><div class="bold">ลิงก์เช็คอินของสาขา ${cfg.enabled ? `<span class="chip good">เปิดใช้งาน</span>` : `<span class="chip bad">ปิดอยู่</span>`}</div>
    <div class="muted small">${cfg.enabled ? `เข้างาน ${esc(cfg.workStart)} น. · ผ่อนผัน ${cfg.lateGrace} นาที · ต้องอยู่ห่างร้านไม่เกิน ${fmt0(cfg.radius)} เมตร` : "ผู้ดูแลระบบ (Admin) เปิดใช้และตั้งพิกัดร้านได้ที่ จัดการสาขา → ตั้งค่าเช็คอิน"}</div>
    <div class="small" style="margin-top:4px;word-break:break-all"><a href="${esc(link)}" target="_blank">${esc(link)}</a></div></div><button class="btn sm" data-copy>${icon("copy")} คัดลอกลิงก์</button></div>`;
  $("[data-copy]", c).onclick = () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast("คัดลอกลิงก์แล้ว — ส่งให้พนักงานเปิดบนมือถือ"), () => toast(link)); };
  const days = attDays(r.entries); const body = $("[data-body]", c);
  if (st.tab === "day") {
    const active = emps.filter(e => e.active);
    const rows = active.map(e => ({ e, d: days.find(x => x.employeeId === e.id) }));
    body.innerHTML = `<div class="card"><div class="toolbar"><button class="btn sm icon" data-prev>${icon("back")}</button><input type="date" class="input sm" style="width:160px" value="${st.day}" data-day><button class="btn sm icon" data-next style="transform:scaleX(-1)">${icon("back")}</button><span class="muted small">${wdName(st.day)}</span><div class="grow"></div>
      <span class="small">มาทำงาน <b>${rows.filter(x => x.d).length}</b> / ${active.length} คน · สาย <b>${rows.filter(x => x.d && x.d.lateMin).length}</b> คน</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>พนักงาน</th><th>เข้างาน</th><th>ออกงาน</th><th class="num">ชั่วโมงทำงาน</th><th>มาสาย</th><th>ระยะห่าง / ที่มา</th><th></th></tr></thead><tbody>
      ${rows.map(({ e, d }) => !d ? `<tr><td class="bold">${esc(e.name)}</td><td colspan="6" class="muted">ไม่มีการลงเวลา</td></tr>` : `<tr><td class="bold">${esc(e.name)}</td><td>${d.first ? hhmm(d.first.at) : "-"}</td><td>${d.last ? hhmm(d.last.at) : d.working ? `<span class="chip blue">กำลังทำงาน</span>` : "-"}</td>
        <td class="num">${fmtHrs(d.minutes)}</td><td>${d.lateMin ? `<span class="chip warn">สาย ${d.lateMin} นาที</span>` : `<span class="chip good plain">ตรงเวลา</span>`}</td>
        <td class="small">${d.list.map(x => `<div>${x.kind === "in" ? "เข้า" : "ออก"} ${hhmm(x.at)} · ${x.manual ? `<span class="chip plain">บันทึกเอง</span> ${esc(x.createdBy)}${x.note ? " · " + esc(x.note) : ""}` : `${x.distance} ม.${x.lat != null ? ` <a href="https://www.google.com/maps?q=${x.lat},${x.lng}" target="_blank">แผนที่</a>` : ""} · ${esc(uaShort(x.ua))}`}
          ${ed ? ` <button class="btn ghost sm icon" style="height:22px;width:22px" data-delatt="${x.id}" title="ลบ">${icon("x")}</button>` : ""}</div>`).join("")}</td><td></td></tr>`).join("")}</tbody></table></div></div>`;
    $("[data-day]", body).onchange = e => { st.day = e.target.value || today(); self.render(c); };
    $("[data-prev]", body).onclick = () => { st.day = addDays(st.day, -1); self.render(c); };
    $("[data-next]", body).onclick = () => { st.day = addDays(st.day, 1); self.render(c); };
  } else {
    const sum = {}; days.forEach(d => { const s = sum[d.employeeId] = sum[d.employeeId] || { name: d.empName, days: 0, late: 0, lateMin: 0, minutes: 0, manual: 0 }; s.days++; if (d.lateMin) { s.late++; s.lateMin += d.lateMin; } s.minutes += d.minutes; if (d.manual) s.manual++; });
    const list = emps.filter(e => e.active || sum[e.id]).map(e => ({ e, s: sum[e.id] || { days: 0, late: 0, lateMin: 0, minutes: 0, manual: 0 } }));
    body.innerHTML = `<div class="card"><div class="toolbar"><input type="month" class="input sm" style="width:170px" value="${st.month}" data-month><div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>พนักงาน</th><th class="num">วันมาทำงาน</th><th class="num">มาสาย (ครั้ง)</th><th class="num">สายรวม (นาที)</th><th class="num">ชั่วโมงรวม</th><th class="num">วันที่บันทึกเอง</th></tr></thead><tbody>
      ${list.map(({ e, s }) => `<tr class="click" data-emp="${e.id}"><td class="bold">${esc(e.name)}</td><td class="num bold">${s.days}</td><td class="num ${s.late ? "neg" : ""}">${s.late}</td><td class="num">${s.lateMin}</td><td class="num">${fmtHrs(s.minutes)}</td><td class="num muted">${s.manual}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="field-hint" style="margin-top:10px">กดที่ชื่อเพื่อดูรายวันของคนนั้น · วันมาทำงานของพนักงานรายวันจะถูกดึงเข้างวดเงินเดือนเมื่อกด “ดึงข้อมูลอัตโนมัติ”</div>`;
    $("[data-month]", body).onchange = e => { st.month = e.target.value || today().slice(0, 7); self.render(c); };
    $$("[data-emp]", body).forEach(tr => { tr.onclick = () => { const e = emps.find(x => x.id === tr.dataset.emp); const ds = days.filter(d => d.employeeId === e.id).sort((a, b) => a.date.localeCompare(b.date));
      openModal({ title: esc(e.name) + " · " + thMonth(st.month), size: "lg", body: ds.length ? `<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th class="num">ชั่วโมง</th><th>สาย</th><th></th></tr></thead><tbody>${ds.map(d => `<tr><td>${thDate(d.date, true)} <span class="muted small">${wdName(d.date)}</span></td><td>${d.first ? hhmm(d.first.at) : "-"}</td><td>${d.last ? hhmm(d.last.at) : "-"}</td><td class="num">${fmtHrs(d.minutes)}</td><td>${d.lateMin ? d.lateMin + " นาที" : "-"}</td><td>${d.manual ? `<span class="chip plain">บันทึกเอง</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : emptyBox("ไม่มีการลงเวลาในเดือนนี้", "clock"), foot: `<button class="btn" data-close>ปิด</button>` }); }; });
    $("[data-csv]", body).onclick = () => downloadCSV("attendance-" + st.month + ".csv", [["พนักงาน", "วันที่", "เข้า", "ออก", "นาทีทำงาน", "สาย (นาที)", "บันทึกเอง"], ...days.slice().reverse().map(d => [d.empName, d.date, d.first ? hhmm(d.first.at) : "", d.last ? hhmm(d.last.at) : "", Math.round(d.minutes), d.lateMin, d.manual ? "ใช่" : ""])]);
  }
  $$("[data-delatt]", c).forEach(b => { b.onclick = async () => { if (!await confirmBox("ลบรายการลงเวลานี้?", { danger: true, okText: "ลบ" })) return; await bapi("DELETE", "/attendance/" + b.dataset.delatt); toast("ลบแล้ว"); self.render(c); }; });
} };
function attManualModal(emps, day, after) {
  const m = openModal({ title: "เพิ่มรายการลงเวลาเอง", body: `<div class="grid g2"><label class="field"><span>พนักงาน <em>*</em></span><select class="input" name="employeeId">${empOpts(emps, "", "— เลือกพนักงาน —")}</select></label><label class="field"><span>วันที่</span><input type="date" class="input" name="date" value="${day}"></label>
    <label class="field"><span>เวลาเข้า</span><input type="time" class="input" name="timeIn" value="${esc(S.binfo.branch.checkin.workStart)}"></label><label class="field"><span>เวลาออก (ไม่บังคับ)</span><input type="time" class="input" name="timeOut"></label></div>
    <label class="field" style="margin-top:14px"><span>หมายเหตุ</span><input class="input" name="note" placeholder="เช่น ลืมเช็คอิน, มือถือแบตหมด"></label><div class="field-hint" style="margin-top:8px">รายการนี้จะแสดงว่า “บันทึกเอง” พร้อมชื่อผู้บันทึก และเก็บใน Log</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} บันทึก</button>` });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); if (!f.employeeId) throw new Error("กรุณาเลือกพนักงาน"); await bapi("POST", "/attendance", f); toast("บันทึกแล้ว"); m.close(); after(); }).catch(() => {});
}

/* ---------- รออนุมัติ ---------- */
BRANCH_PAGES.approvals = { title: () => "รออนุมัติ", async render(c) {
  const self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>รายการรออนุมัติ</h2><div class="muted small">สต็อก / การลา / การเบิกเงิน ที่รอคุณพิจารณา</div></div></div><div data-body><div class="boot" style="height:200px"><div class="spinner"></div></div></div>`;
  const r = await bapi("GET", "/approvals"); const after = async () => { await refreshPending(); renderBranch(S.bid, "approvals", []); };
  let html = "";
  if (r.approve.stock) html += `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">${icon("stock", "").replace("<svg", '<svg style="width:17px;height:17px;vertical-align:-3px"')} สต็อก <span class="chip warn plain">${r.stock.length}</span></h3>${r.stock.length > 1 ? `<button class="btn sm primary" data-allst>อนุมัติที่เลือก</button><button class="btn sm" data-rjst>ไม่อนุมัติที่เลือก</button>` : ""}</div>
    ${r.stock.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" data-chkall checked></th><th>วันที่</th><th>สินค้า</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือตอนนี้</th><th>ผู้บันทึก / หมายเหตุ</th><th></th></tr></thead><tbody>
      ${r.stock.map(m => `<tr><td><input type="checkbox" data-chk="${m.id}" checked></td><td>${thDate(m.date, true)}</td><td class="bold">${esc(m.itemName)}</td><td><span class="chip ${m.xferDir ? "violet" : MOVE[m.kind].chip}">${m.xferDir === "out" ? "โยกออก" : m.xferDir === "in" ? "รับโยก" : MOVE[m.kind].th}</span>${m.xferDir ? `<div class="muted small">${m.xferDir === "out" ? "→ " : "← "}${esc(m.xferBranch)}</div>` : ""}</td>
        <td class="num bold">${m.kind === "count" ? "นับได้ " + fmtQ(m.counted) : (m.qty > 0 ? "+" : "") + fmtQ(m.qty)} <span class="muted small">${esc(m.unit)}</span>${uNote(m)}${m.kind === "in" && m.unitCost ? `<div class="muted small">@ ${fmt(m.unitCost)}</div>` : ""}</td>
        <td class="num">${fmtQ(m.itemQty)}${m.kind === "count" ? `<div class="small ${m.counted - m.itemQty < 0 ? "neg" : "pos"}">ต่าง ${fmtQ(m.counted - m.itemQty)}</div>` : ""}</td><td class="small">${esc(m.createdBy)}<div class="muted">${thDateTime(m.createdAt)}${m.note ? " · " + esc(m.note) : ""}</div></td>
        <td style="white-space:nowrap"><button class="btn sm primary" data-apmove="${m.id}">อนุมัติ</button> <button class="btn sm" data-rjmove="${m.id}">ไม่อนุมัติ</button></td></tr>`).join("")}</tbody></table></div>` : emptyBox("ไม่มีรายการสต็อกรออนุมัติ", "check")}</div>`;
  if (r.approve.leave) html += `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">${icon("calendar", "").replace("<svg", '<svg style="width:17px;height:17px;vertical-align:-3px"')} ขาด-ลา <span class="chip warn plain">${r.leaves.length}</span></h3></div>
    ${r.leaves.length ? r.leaves.map(x => `<div class="list-row"><div class="grow"><div class="bold">${esc(x.empName)} · <span class="chip ${LEAVE_CHIP[x.kind]} plain">${esc(x.kindTh)}</span></div><div class="muted small">${thDate(x.dateFrom)}${x.dateTo !== x.dateFrom ? " – " + thDate(x.dateTo) : ""} · ${x.kind === "late" ? x.minutes + " นาที" : fmtQ(x.days) + " วัน"} · หัก ${baht(x.deduct)}${x.reason ? " · " + esc(x.reason) : ""} · โดย ${esc(x.requestedBy)}</div></div>
      <button class="btn sm primary" data-aplv="${x.id}">อนุมัติ</button><button class="btn sm" data-rjlv="${x.id}">ไม่อนุมัติ</button></div>`).join("") : emptyBox("ไม่มีรายการลารออนุมัติ", "check")}</div>`;
  if (r.approve.advance) html += `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">${icon("cash", "").replace("<svg", '<svg style="width:17px;height:17px;vertical-align:-3px"')} เบิกเงินล่วงหน้า <span class="chip warn plain">${r.advances.length}</span></h3></div>
    ${r.advances.length ? r.advances.map(x => `<div class="list-row"><div class="grow"><div class="bold">${esc(x.empName)} · ${baht(x.amount)}</div><div class="muted small">${thDate(x.date)} · หักคืนงวด ${thMonth(x.deductPeriod)}${x.reason ? " · " + esc(x.reason) : ""} · โดย ${esc(x.requestedBy)}</div></div>
      <button class="btn sm primary" data-apadv="${x.id}">อนุมัติ</button><button class="btn sm" data-rjadv="${x.id}">ไม่อนุมัติ</button></div>`).join("") : emptyBox("ไม่มีคำขอเบิกเงินรออนุมัติ", "check")}</div>`;
  $("[data-body]", c).innerHTML = html;
  bindMoveDeletes(c, after);
  const picked = () => $$("[data-chk]", c).filter(x => x.checked).map(x => x.dataset.chk);
  const ca = $("[data-chkall]", c); if (ca) ca.onchange = () => $$("[data-chk]", c).forEach(x => { x.checked = ca.checked; });
  const as = $("[data-allst]", c); if (as) as.onclick = () => { const ids = picked(); if (!ids.length) return toast("ยังไม่ได้เลือกรายการ", "bad"); stockDecide(ids, true, after); };
  const rs = $("[data-rjst]", c); if (rs) rs.onclick = () => { const ids = picked(); if (!ids.length) return toast("ยังไม่ได้เลือกรายการ", "bad"); stockDecide(ids, false, after); };
  $$("[data-aplv]", c).forEach(b => { b.onclick = () => leaveApprove(r.leaves.find(x => x.id === b.dataset.aplv), after); });
  $$("[data-rjlv]", c).forEach(b => { b.onclick = async () => { const reason = await askReason("ไม่อนุมัติการลา"); if (!reason) return; try { await bapi("POST", "/leaves/" + b.dataset.rjlv + "/approve", { approve: false, reason }); toast("บันทึกแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-apadv]", c).forEach(b => { b.onclick = () => advanceApprove(r.advances.find(x => x.id === b.dataset.apadv), after); });
  $$("[data-rjadv]", c).forEach(b => { b.onclick = async () => { const reason = await askReason("ไม่อนุมัติการเบิกเงิน"); if (!reason) return; try { await bapi("POST", "/advances/" + b.dataset.rjadv + "/approve", { approve: false, reason }); toast("บันทึกแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } }; });
} };

/* ---------- งบการเงิน ---------- */
BRANCH_PAGES.statements = { title: () => "งบการเงิน", state: { tab: "pl", date: "", inv: true }, async render(c) {
  const st = this.state, self = this; st.date = st.date || today();
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>งบการเงิน</h2><div class="muted small">ตัวเลขไม่รวม VAT · จัดกลุ่มตามที่ตั้งไว้ในเมนู “หมวด & ช่องทาง” (หมวดที่ยังไม่ตั้ง ระบบเดาจากชื่อ)</div></div>
    ${st.tab === "pl" ? rangeBar() : `<label class="row"><span class="muted small">ณ วันที่</span><input type="date" class="input sm" style="width:160px" value="${st.date}" data-date></label>`}
    <label class="check small" title="ใช้มูลค่าสต็อกจากระบบ ปรับต้นทุนขายด้วยสินค้าคงเหลือต้นงวด/ปลายงวด"><input type="checkbox" data-inv ${st.inv ? "checked" : ""}> ปรับสินค้าคงเหลือ (ตรวจนับ)</label><button class="btn" data-print>${icon("print")} พิมพ์ / PDF</button></div>
    <div class="tabs"><button data-tab="pl" class="${st.tab === "pl" ? "on" : ""}">งบกำไรขาดทุน (P&L)</button><button data-tab="bs" class="${st.tab === "bs" ? "on" : ""}">งบแสดงฐานะการเงิน (BS)</button></div>
    <div data-body><div class="boot" style="height:240px"><div class="spinner"></div></div></div>`;
  $$("[data-tab]", c).forEach(b => { b.onclick = () => { st.tab = b.dataset.tab; self.render(c); }; });
  $("[data-inv]", c).onchange = e => { st.inv = e.target.checked; self.render(c); };
  if (st.tab === "pl") bindRange(c, () => self.render(c)); else $("[data-date]", c).onchange = e => { st.date = e.target.value || today(); self.render(c); };
  const L = (name, v, o = {}) => `<tr class="${o.cls || ""}"><td style="padding-left:${o.indent ? 30 : 14}px">${o.bold ? `<b>${name}</b>` : name}</td><td class="num ${o.bold ? "bold" : ""} ${v < 0 ? "neg" : ""}">${v == null ? "" : (o.paren && v ? "(" + fmt(Math.abs(v)) + ")" : fmt(v))}</td></tr>`;
  const lines = arr => arr.map(x => L(esc(x.name), x.amount, { indent: true })).join("");
  let html, title, sub;
  if (st.tab === "pl") {
    const p = await bapi("GET", `/statements/pl?${rq()}&inv=${st.inv ? 1 : 0}`);
    const sec = (t, o) => o.lines.length ? L(t, null, { bold: true }) + lines(o.lines) + L("รวม" + t, o.total, { cls: "subtot" }) : L(t, 0, { bold: true });
    html = `<table class="tbl fs"><tbody>
      ${L("รายได้จากการขาย", null, { bold: true })}${lines(p.sales.lines)}${L("รวมรายได้จากการขาย", p.sales.total, { cls: "subtot" })}
      ${L("ต้นทุนขาย", null, { bold: true })}${p.useInventory ? L("สินค้าคงเหลือต้นงวด", p.cogs.beginInventory, { indent: true }) : ""}
      ${lines(p.cogs.purchaseLines.map(x => ({ ...x, name: "ซื้อ: " + x.name })))}${p.useInventory && p.cogs.otherIn ? L("สินค้ารับเข้าที่ไม่ผ่านการซื้อ (ยอดยกมา / รับเข้าเอง)", p.cogs.otherIn, { indent: true }) : ""}
      ${p.useInventory ? L("หัก สินค้าคงเหลือปลายงวด", -p.cogs.endInventory, { indent: true, paren: true }) : ""}${L("รวมต้นทุนขาย", p.cogs.total, { cls: "subtot" })}
      ${L("กำไรขั้นต้น", p.grossProfit, { bold: true, cls: "tot" })}<tr><td class="muted small" style="padding-left:30px">อัตรากำไรขั้นต้น</td><td class="num muted small">${p.grossMargin}%</td></tr>
      ${sec("ค่าใช้จ่ายในการขาย", p.selling)}${sec("ค่าใช้จ่ายพนักงาน", p.staff)}${sec("ค่าใช้จ่ายบริหาร", p.admin)}
      ${L("กำไร (ขาดทุน) จากการดำเนินงาน", p.operatingProfit, { bold: true, cls: "tot" })}
      ${p.otherIncome.lines.length ? sec("รายได้อื่น", p.otherIncome) : ""}${p.otherExpense.lines.length ? sec("ค่าใช้จ่ายอื่น", p.otherExpense) : ""}
      ${L("กำไร (ขาดทุน) ก่อนภาษีเงินได้", p.profitBeforeTax, { bold: true, cls: "tot" })}${L("ภาษีเงินได้", p.incomeTax.total, { indent: true })}
      ${L("กำไร (ขาดทุน) สุทธิ", p.netProfit, { bold: true, cls: "grand" })}<tr><td class="muted small" style="padding-left:30px">อัตรากำไรสุทธิ</td><td class="num muted small">${p.netMargin}%</td></tr></tbody></table>`;
    title = "งบกำไรขาดทุน"; sub = "สำหรับงวด " + thDate(p.from) + " – " + thDate(p.to);
  } else {
    const b = await bapi("GET", `/statements/bs?date=${st.date}&inv=${st.inv ? 1 : 0}`);
    html = `<table class="tbl fs"><tbody>${L("สินทรัพย์", null, { bold: true, cls: "head" })}${L("สินทรัพย์หมุนเวียน", null, { bold: true })}
      ${b.assets.current.map(x => L(esc(x.name), x.amount, { indent: true }) + (x.lines && x.lines.length > 1 ? x.lines.map(y => `<tr class="muted small"><td style="padding-left:48px">${esc(y.name)}</td><td class="num">${fmt(y.amount)}</td></tr>`).join("") : "")).join("")}
      ${L("รวมสินทรัพย์หมุนเวียน", b.assets.currentTotal, { cls: "subtot" })}${L("สินทรัพย์ถาวร (ราคาทุน ยังไม่หักค่าเสื่อม)", null, { bold: true })}
      ${b.assets.fixed.length ? b.assets.fixed.map(x => L(esc(x.name), x.amount, { indent: true })).join("") : L("ไม่มี", 0, { indent: true })}
      ${L("รวมสินทรัพย์ถาวร", b.assets.fixedTotal, { cls: "subtot" })}${L("รวมสินทรัพย์", b.assets.total, { bold: true, cls: "grand" })}
      ${L("หนี้สินและส่วนของเจ้าของ", null, { bold: true, cls: "head" })}${L("หนี้สินหมุนเวียน", null, { bold: true })}${b.liabilities.lines.map(x => L(esc(x.name), x.amount, { indent: true })).join("")}
      ${L("รวมหนี้สิน", b.liabilities.total, { cls: "subtot" })}${L("ส่วนของเจ้าของ", null, { bold: true })}
      ${L("ทุน / ยอดยกมา (คำนวณให้งบดุล)", b.equity.capital, { indent: true })}${L("กำไร (ขาดทุน) สะสม", b.equity.retained, { indent: true })}
      <tr class="muted small"><td style="padding-left:48px">ในจำนวนนี้ เป็นกำไรตั้งแต่ต้นปี ${Number(b.date.slice(0, 4)) + 543}</td><td class="num">${fmt(b.equity.retainedYtd)}</td></tr>
      ${L("รวมส่วนของเจ้าของ", b.equity.total, { cls: "subtot" })}${L("รวมหนี้สินและส่วนของเจ้าของ", b.totalLiabEquity, { bold: true, cls: "grand" })}</tbody></table>
      <div class="field-hint" style="padding:10px 14px">“ทุน / ยอดยกมา” คำนวณจาก สินทรัพย์ − หนี้สิน − กำไรสะสม ประกอบด้วยยอดเงินยกมาของแต่ละบัญชี สต็อกยกมา และเงินที่เจ้าของนำเข้า/ถอนออก</div>`;
    title = "งบแสดงฐานะการเงิน"; sub = "ณ วันที่ " + thDate(b.date);
  }
  $("[data-body]", c).innerHTML = `<div class="card fs-card"><div class="card-h"><div class="grow"><h3>${title}</h3><div class="muted small">${sub}${st.inv ? "" : " · ไม่ปรับสินค้าคงเหลือ"}</div></div></div><div class="card-b flush">${html}</div></div>`;
  $("[data-print]", c).onclick = () => printHTML(title, companyHead(title, sub) + html, `.fs td{border-bottom:1px solid #eef0f4}.fs .subtot td{border-top:1px solid #d3d8e2;font-weight:600}.fs .tot td{background:#f4f6fa;font-weight:700}.fs .grand td{border-top:2px solid #18212f;border-bottom:3px double #18212f;font-weight:700}.fs .head td{background:#eef4ff;color:#1f6feb}.neg{color:#d92d20}.muted{color:#7b8597}.small{font-size:11px}.field-hint{font-size:11px;color:#7b8597;margin-top:10px}`);
} };

/* ---------- log การใช้งาน ---------- */
function uaShort(ua) {
  ua = String(ua || ""); if (!ua) return "-";
  const dev = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android" : "แท็บเล็ต Android") : /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : /node|curl/i.test(ua) ? "ระบบ" : "อุปกรณ์อื่น";
  const br = /Edg\//.test(ua) ? "Edge" : /Line\//.test(ua) ? "LINE" : /FBAN|FBAV/.test(ua) ? "Facebook" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return dev + (br ? " · " + br : "");
}
const ACT_TH = { login: "เข้าสู่ระบบ", login_fail: "เข้าระบบไม่สำเร็จ", access_denied: "ไม่มีสิทธิ์", checkin: "เช็คอิน", checkout: "เช็คเอาท์", checkin_fail: "เช็คอินไม่สำเร็จ" };
function activityTable(a, showBranch) {
  if (!a.length) return emptyBox("ไม่มีประวัติในช่วงนี้", "history");
  return `<table class="tbl"><thead><tr><th>เมื่อไร</th><th>ใคร</th>${showBranch ? "<th>สาขา</th>" : ""}<th>ทำอะไร</th><th>อย่างไร (IP · อุปกรณ์ · พิกัด)</th></tr></thead><tbody>${a.map(x => {
    const bad = /fail|denied/.test(x.action);
    return `<tr><td class="small" style="white-space:nowrap">${thDateTime(x.at)}</td><td><span class="chip ${x.kind === "admin" ? "blue" : x.kind === "employee" ? "good" : ""} plain">${esc(x.actor)}</span></td>${showBranch ? `<td class="small">${esc(x.branchName || "-")}</td>` : ""}
      <td>${ACT_TH[x.action] ? `<span class="chip ${bad ? "bad" : "good"} plain">${ACT_TH[x.action]}</span> ` : ""}${esc(x.detail)}</td>
      <td class="small" style="white-space:nowrap">${esc(x.ip || "-")}<div class="muted">${esc(uaShort(x.ua))}</div>${x.lat != null ? `<a href="https://www.google.com/maps?q=${x.lat},${x.lng}" target="_blank">${icon("pin", "").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}</a>` : ""}</td></tr>`; }).join("")}</tbody></table>`;
}
function activityCsv(name, a) { downloadCSV(name, [["เวลา", "ผู้ใช้", "สาขา", "การกระทำ", "รายละเอียด", "IP", "อุปกรณ์", "User-Agent", "ละติจูด", "ลองจิจูด"], ...a.map(x => [new Date(x.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }), x.actor, x.branchName, x.action, x.detail, x.ip, uaShort(x.ua), x.ua, x.lat, x.lng])]); }
BRANCH_PAGES.log = { title: () => "Log การใช้งาน", state: { actor: "", kind: "" }, async render(c) {
  const st = this.state, self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>Log การใช้งานของสาขา</h2><div class="muted small">ใคร ทำอะไร เมื่อไร อย่างไร — รวมการใส่รหัสผิด การพยายามเข้าเมนูที่ไม่มีสิทธิ์ และการเช็คอิน</div></div>${rangeBar()}</div>
    <div class="card"><div class="toolbar"><select class="input" style="width:240px" data-actor></select><select class="input" style="width:200px" data-kind>${opt("", "ทุกการกระทำ")}${opt("sec", "เฉพาะความปลอดภัย (รหัสผิด / ไม่มีสิทธิ์)", st.kind === "sec")}${opt("att", "เฉพาะเช็คอิน", st.kind === "att")}</select><div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  bindRange(c, () => self.render(c));
  const all = (await bapi("GET", "/activity?limit=3000&" + rq())).activity;
  const actors = [...new Set(all.map(x => x.actor))].sort();
  $("[data-actor]", c).innerHTML = opt("", "ผู้ใช้ทุกคน (" + actors.length + ")") + actors.map(a => opt(a, a, a === st.actor)).join("");
  const filt = () => all.filter(x => (!st.actor || x.actor === st.actor) && (!st.kind || (st.kind === "sec" ? /fail|denied/.test(x.action) : /^check/.test(x.action))));
  const draw = () => { $("[data-tbl]", c).innerHTML = activityTable(filt(), false); };
  $("[data-actor]", c).onchange = e => { st.actor = e.target.value; draw(); };
  $("[data-kind]", c).onchange = e => { st.kind = e.target.value; draw(); };
  $("[data-csv]", c).onclick = () => activityCsv("log-" + S.binfo.branch.name + "-" + S.range.from + "_" + S.range.to + ".csv", filt());
  draw();
} };

/* ---------- หน้าเช็คอินพนักงาน (สาธารณะ ใช้บนมือถือ) ---------- */
async function renderCheckin(bid) {
  const app = $("#app");
  let info; try { info = await api("GET", "/api/checkin/" + bid); } catch (e) { app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="err-box">${esc(e.message)}</div></div></div>`; return; }
  document.title = "เช็คอิน · " + info.branch.name;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem("ci_" + bid) || "{}"); } catch (e) {}
  const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  app.innerHTML = `<div class="auth-wrap ci"><div class="auth-card" style="max-width:420px">
    <div class="row">${bdotH(info.branch, `background:${esc(info.branch.color || "#1f6feb")}`)}<div class="grow"><div class="bold">${esc(info.branch.name)}</div><div class="muted small">${esc(info.company.name)} · ลงเวลาเข้า-ออกงาน</div></div></div>
    <div class="ci-clock" data-clock>${clock()}</div><div class="muted small" style="text-align:center;margin-top:-6px">${thDate(today())} · เข้างาน ${esc(info.workStart)} น.</div>
    ${!info.enabled ? `<div class="warn-box" style="margin-top:18px">สาขานี้ยังไม่เปิดระบบเช็คอิน — แจ้งผู้ดูแลระบบ</div>` : `
    <div data-err style="margin-top:14px"></div><div class="stack">
      <label class="field"><span>ชื่อของคุณ</span><select class="input" name="emp" style="height:46px;font-size:16px">${opt("", "— เลือกชื่อ —")}${info.employees.map(e => opt(e.id, e.name + (e.nickname ? " (" + e.nickname + ")" : "") + (e.hasPin ? "" : " · ยังไม่มี PIN"), e.id === saved.emp)).join("")}</select></label>
      <label class="field"><span>PIN</span><input class="input" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" style="height:46px;font-size:20px;letter-spacing:.4em;text-align:center" placeholder="••••"></label>
      <div class="grid g2" style="grid-template-columns:1fr 1fr"><button class="btn primary ci-btn" data-act="in">${icon("income")} เช็คอิน</button><button class="btn ci-btn" data-act="out">${icon("logout")} เช็คเอาท์</button></div>
      <button class="btn ghost sm" data-act="status">ดูเวลาของฉันวันนี้</button></div>
    <div data-result style="margin-top:14px"></div>
    <div class="field-hint" style="margin-top:14px;text-align:center">${icon("pin", "").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} ต้องเปิด GPS / Location และอยู่ในระยะ ${fmt0(info.radius)} เมตรจากร้าน</div>`}
  </div></div>`;
  const tick = setInterval(() => { const el = $("[data-clock]"); if (!el) return clearInterval(tick); el.textContent = clock(); }, 1000);
  if (!info.enabled) return;
  const err = m => { $("[data-err]").innerHTML = m ? `<div class="err-box">${esc(m)}</div>` : ""; };
  const getPos = () => new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error("อุปกรณ์นี้ไม่รองรับ GPS"));
    navigator.geolocation.getCurrentPosition(p => res(p.coords), e => rej(new Error(e.code === 1 ? "กรุณาอนุญาตให้เว็บนี้ใช้ตำแหน่ง (Location) แล้วลองใหม่" : "อ่านตำแหน่งไม่ได้ — ลองออกไปที่โล่ง หรือเปิด GPS")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); });
  const showToday = r => { $("[data-result]").innerHTML = `<div class="card"><div class="card-b"><div class="bold" style="margin-bottom:6px">${esc(r.employee.name)} · วันนี้</div>${r.today.length ? r.today.map(x => `<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${x.kind === "in" ? "🟢 เข้างาน" : "🔴 ออกงาน"}</span><b>${hhmm(x.at)} น.</b><span class="muted">${x.manual ? "บันทึกโดยหัวหน้า" : x.distance + " ม."}${x.lateMin ? ` · <span class="neg">สาย ${x.lateMin} นาที</span>` : ""}</span></div>`).join("") : `<div class="muted small">ยังไม่มีการลงเวลาวันนี้</div>`}</div></div>`; };
  $$("[data-act]").forEach(b => { b.onclick = () => withBtn(b, async () => {
    err(""); const emp = $("[name=emp]").value, pin = $("[name=pin]").value.trim(), action = b.dataset.act;
    if (!emp) throw new Error("กรุณาเลือกชื่อของคุณ"); if (!pin) throw new Error("กรุณาใส่ PIN");
    try { localStorage.setItem("ci_" + bid, JSON.stringify({ emp })); } catch (e) {}
    let pos = {}; if (action !== "status") { const c = await getPos(); pos = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy }; }
    const r = await api("POST", "/api/checkin/" + bid, { employeeId: emp, pin, action, ...pos }, { noRedirect: true });
    if (action !== "status") toast((action === "in" ? "เช็คอินสำเร็จ " : "เช็คเอาท์สำเร็จ ") + hhmm(r.at) + " น." + (r.lateMin ? " · สาย " + r.lateMin + " นาที" : ""));
    $("[name=pin]").value = ""; showToday(r);
  }).catch(e => err(e.message)); });
}

/* ---------- บัตรเครดิต ---------- */
const cardOf = n => { const x = S.lists && S.lists.payment_channel.find(c => c.name === n && c.isCredit && c.card); return x ? x.card : null; };
function cardDueFor(date, cut, due) { // ต้องตรงกับฝั่งเซิร์ฟเวอร์
  const ld = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let [y, m, d] = date.split("-").map(Number);
  if (d > Math.min(cut, ld(y, m))) m++; if (due <= cut) m++;
  while (m > 12) { m -= 12; y++; }
  return y + "-" + String(m).padStart(2, "0") + "-" + String(Math.min(due, ld(y, m))).padStart(2, "0");
}
const BILL_ST = { overdue: ["เลยกำหนด", "bad"], soon: ["ใกล้ครบกำหนด", "warn"], upcoming: ["ยังไม่ถึงกำหนด", ""] };
BRANCH_PAGES.cards = { title: () => "บัตรเครดิต", state: { open: {} }, async render(c) {
  const self = this, ed = canEdit("cards");
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>บัตรเครดิต</h2><div class="muted small">บิลรายเดือนของแต่ละบัตร (รายการที่รูด + งวดผ่อนที่ถึงกำหนด) · กด “ชำระบิล” แล้วเลือกบัญชีที่ใช้จ่าย ระบบจะตัดเงินจากบัญชีนั้นให้</div></div></div><div data-body><div class="boot" style="height:240px"><div class="spinner"></div></div></div>`;
  const r = await bapi("GET", "/cards");
  const after = async () => { await refreshPending(); renderBranch(S.bid, "cards", []); };
  if (!r.cards.length) {
    $("[data-body]", c).innerHTML = `<div class="empty-hero">${icon("wallet")}<h3 style="margin:8px 0 4px">ยังไม่ได้ตั้งค่าบัตรเครดิต</h3><div>ไปที่ <b>หมวด & ช่องทาง → ช่องทางชำระเงิน</b> เพิ่มบัตร (ติ๊ก “มีวันครบกำหนด”) แล้วกด “ตั้งค่าบัตร” ใส่วันตัดรอบและวันครบกำหนดชำระ</div>
      ${r.notSetUp.length ? `<div class="muted small" style="margin-top:10px">ช่องทางเครดิตที่ยังไม่ได้ตั้งค่า: ${r.notSetUp.map(x => esc(x.name)).join(", ")}</div>` : ""}${canEdit("settings") ? `<div style="margin-top:16px"><a class="btn primary" href="#/b/${S.bid}/settings">ไปตั้งค่า</a></div>` : ""}</div>`; return;
  }
  const allOut = r.cards.reduce((a, x) => a + x.outstanding, 0);
  const dueSoon = r.alerts.reduce((a, x) => a + x.total, 0);
  let html = `<div class="pay-grid" style="margin-bottom:14px"><div class="mini-kpi"><div class="l">ยอดค้างทุกบัตร (รวมงวดผ่อนอนาคต)</div><div class="v">${baht(allOut)}</div></div>
    <div class="mini-kpi"><div class="l">ต้องชำระภายใน 7 วัน / เลยกำหนด</div><div class="v" style="color:${dueSoon ? "var(--bad)" : ""}">${baht(dueSoon)}</div><div class="small muted">${r.alerts.length} บิล</div></div>
    <div class="mini-kpi"><div class="l">แผนผ่อนที่ยังผ่อนอยู่</div><div class="v">${r.cards.reduce((a, x) => a + x.plans.filter(p => p.status === "active" && p.remaining > 0).length, 0)} รายการ</div></div>
    <div class="mini-kpi"><div class="l">จำนวนบัตร</div><div class="v">${r.cards.length} ใบ</div></div></div>`;
  r.cards.forEach(cd => {
    const pct = cd.limit ? Math.min(100, cd.outstanding / cd.limit * 100) : 0;
    const billsDue = cd.bills.filter(b => b.status !== "upcoming"), billsLater = cd.bills.filter(b => b.status === "upcoming");
    const billRow = b => `<div class="bill ${b.status}"><div class="row wrap" style="gap:12px"><div class="grow"><div class="bold">บิลครบกำหนด ${thDate(b.dueDate)} <span class="chip ${BILL_ST[b.status][1]}">${BILL_ST[b.status][0]}</span></div><div class="muted small">${b.records.length} รายการ${b.records.some(x => x.installment) ? " · มีงวดผ่อน " + b.records.filter(x => x.installment).length + " งวด" : ""}</div></div>
      <div class="bold num" style="font-size:17px">${baht(b.total)}</div><button class="btn sm" data-tg="${cd.id}|${b.dueDate}">รายการ</button>${ed ? `<button class="btn sm primary" data-pay="${cd.id}|${b.dueDate}">${icon("check")} ชำระบิล</button>` : ""}</div>
      <div class="bill-items ${self.state.open[cd.id + "|" + b.dueDate] ? "" : "hidden"}" data-items="${cd.id}|${b.dueDate}">${b.records.map(x => `<div class="list-row small" data-doc="${x.id}" data-type="${x.type}" style="cursor:pointer"><span class="muted" style="width:70px">${thDate(x.date, true)}</span><span class="doc">${esc(x.docNo)}</span><div class="grow desc">${esc(x.party ? x.party + " · " : "")}${esc(x.description)}</div>${x.installment ? `<span class="chip blue plain">งวด ${x.planSeq}/${x.planCount}</span>` : ""}<b class="num">${fmt(x.total)}</b></div>`).join("")}</div></div>`;
    cd.plans = cd.plans.filter(p => p.count > 0);
    html += `<div class="card" style="margin-bottom:14px"><div class="card-h"><div class="acc-ic">${icon("wallet")}</div><div class="grow"><h3>${esc(cd.name)}</h3><div class="muted small">${cd.dueDay ? `ตัดรอบทุกวันที่ ${cd.cutDay} · ครบกำหนดชำระวันที่ ${cd.dueDay}${cd.dueDay <= cd.cutDay ? " ของเดือนถัดไป" : ""}` : `ยังไม่ได้ตั้งวันตัดรอบ (ไม่บังคับ — ตั้งได้ที่ หมวด & ช่องทาง)`}</div></div>
      <div style="text-align:right"><div class="muted small">ยอดค้างทั้งหมด</div><div class="bold num" style="font-size:18px">${baht(cd.outstanding)}</div>${cd.limit ? `<div class="small muted">วงเงิน ${baht(cd.limit)} · เหลือ ${baht(cd.available)}</div>` : ""}</div></div>
      ${cd.limit ? `<div style="padding:0 18px"><div class="hbar" style="grid-template-columns:1fr;padding:8px 0 0"><div class="tr"><div class="fl" style="width:${pct}%;background:${pct > 80 ? "var(--bad)" : "var(--primary)"}"></div></div></div></div>` : ""}
      <div class="card-b">${billsDue.length ? billsDue.map(billRow).join("") : `<div class="muted small" style="padding:4px 0 10px">${icon("check", "").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} ไม่มีบิลที่ต้องชำระใน 7 วันนี้</div>`}
        ${billsLater.length ? `<div class="section-t" style="margin-top:12px">บิลถัดไป</div>${billsLater.slice(0, 3).map(billRow).join("")}${billsLater.length > 3 ? `<details><summary class="small" style="cursor:pointer;color:var(--primary);padding:6px 0">ดูบิลล่วงหน้าอีก ${billsLater.length - 3} เดือน</summary>${billsLater.slice(3).map(billRow).join("")}</details>` : ""}` : ""}
        ${cd.plans.length ? `<div class="section-t" style="margin-top:14px">แผนผ่อนชำระ</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>วันที่ซื้อ</th><th>รายการ</th><th class="num">ยอดรวม</th><th>ผ่อนแล้ว</th><th class="num">คงเหลือ</th><th>งวดถัดไป</th><th></th></tr></thead><tbody>
          ${cd.plans.map(p => `<tr style="${p.status !== "active" ? "opacity:.6" : ""}"><td>${thDate(p.purchaseDate, true)}</td><td><div class="bold desc">${esc(p.description)}</div><div class="muted small">${esc(p.party)}${p.payDay ? " · จ่ายทุกวันที่ " + p.payDay : ""}${p.interest ? " · ดอกเบี้ย " + fmt(p.interest) : ""}</div></td><td class="num">${fmt(p.total + p.interest)}</td>
            <td><div class="small">${p.paid}/${p.count} งวด${p.status === "cancelled" ? " · ยกเลิก" : p.status === "closed" ? " · ปิดแผน" : ""}</div><div class="hbar" style="grid-template-columns:1fr;padding:2px 0"><div class="tr" style="width:90px"><div class="fl" style="width:${p.count ? p.paid / p.count * 100 : 0}%;background:var(--good)"></div></div></div></td>
            <td class="num bold">${fmt(p.remaining)}</td><td class="small">${p.nextDue ? thDate(p.nextDue, true) : "-"}</td><td style="white-space:nowrap">${ed && p.remaining > 0 && p.status === "active" ? `${p.paid ? "" : `<button class="btn sm" data-editplan="${p.id}">${icon("edit")} แก้ไข</button> `}<button class="btn ghost sm" data-cancelplan="${p.id}">ยกเลิก</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
        ${cd.history.length ? `<details style="margin-top:12px"><summary class="section-t" style="cursor:pointer">ประวัติการชำระบิล (${cd.history.length})</summary>${cd.history.map(h => `<div class="list-row small"><div class="grow">${thDate(h.date)} · จ่ายจาก <b>${esc(h.channel)}</b> · ${h.count} รายการ<div class="muted">${esc(h.by)}${h.fee ? " · ดอกเบี้ย/ค่าธรรมเนียม " + fmt(h.fee) : ""}</div></div><b class="num">${fmt(h.total + h.fee)}</b>${ed ? `<button class="btn ghost sm" data-unpay="${h.batch}">ยกเลิกการชำระ</button>` : ""}</div>`).join("")}</details>` : ""}
      </div></div>`;
  });
  if (r.notSetUp.length) html += `<div class="field-hint">ช่องทางเครดิตที่ไม่ได้ตั้งเป็นบัตร (เช่น แอปเดลิเวอรี่รอโอน) จะไม่แสดงในหน้านี้: ${r.notSetUp.map(x => esc(x.name)).join(", ")}</div>`;
  $("[data-body]", c).innerHTML = html;
  const findBill = k => { const [cid, d] = k.split("|"); const cd = r.cards.find(x => x.id === cid); return { cd, bill: cd.bills.find(b => b.dueDate === d) }; };
  $$("[data-tg]", c).forEach(b => { b.onclick = () => { const k = b.dataset.tg; self.state.open[k] = !self.state.open[k]; $(`[data-items="${k}"]`, c).classList.toggle("hidden"); }; });
  $$("[data-doc]", c).forEach(el => { el.onclick = () => openDoc(el.dataset.type, el.dataset.doc, after); });
  $$("[data-pay]", c).forEach(b => { b.onclick = () => { const { cd, bill } = findBill(b.dataset.pay); payBillModal(cd, bill, after); }; });
  $$("[data-unpay]", c).forEach(b => { b.onclick = async () => { if (!await confirmBox("ยกเลิกการชำระบิลนี้?\nรายการจะกลับเป็นค้างจ่าย และเงินจะคืนเข้าบัญชีที่ใช้จ่าย (ดอกเบี้ย/ค่าธรรมเนียมที่บันทึกพร้อมกันจะถูกลบ)", { danger: true, okText: "ยกเลิกการชำระ" })) return;
    try { await bapi("POST", "/cards/unpay", { batch: b.dataset.unpay }); toast("ยกเลิกการชำระแล้ว"); after(); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-cancelplan]", c).forEach(b => { b.onclick = () => cancelPlan(b.dataset.cancelplan, after); });
  $$("[data-editplan]", c).forEach(b => { b.onclick = () => editPlan(b.dataset.editplan, after); });
} };
// แก้ไขแผนผ่อน = เปิดฟอร์มเดิมให้แก้ แล้วบันทึกเป็นแผนใหม่แทนแผนเดิม (ทำได้ถ้ายังไม่ได้ชำระงวดไหน)
async function editPlan(planId, after, closeCurrent) {
  let p; try { p = (await bapi("GET", "/card-plans/" + planId)).plan; } catch (e) { return toast(e.message, "bad"); }
  if (p.paid) return toast(`แผนนี้ชำระไปแล้ว ${p.paid} งวด แก้ไขไม่ได้ — ใช้ “ยกเลิกแผนผ่อน” (ยกเลิกงวดที่เหลือ) แล้วบันทึกใหม่`, "bad");
  if (closeCurrent) closeCurrent();
  openDoc(p.form.type, null, after, { form: p.form, replacePlanId: planId });
}
async function cancelPlan(planId, after) {
  let p; try { p = (await bapi("GET", "/card-plans/" + planId)).plan; } catch (e) { return toast(e.message, "bad"); }
  if (!await confirmBox(p.paid ? `แผนนี้ชำระไปแล้ว ${p.paid}/${p.count} งวด\nยกเลิกงวดที่เหลือทั้งหมด? (งวดที่ยังไม่ชำระจะถูกลบ)` : `ยกเลิกแผนผ่อนนี้ทั้งหมด ${p.count} งวด?\nเอกสารทุกงวด (รวมดอกเบี้ย) จะถูกลบ`, { danger: true, okText: "ยืนยันยกเลิก" })) return;
  try { const r = await bapi("DELETE", "/card-plans/" + planId + (p.paid ? "?remaining=1" : "")); toast("ยกเลิกแล้ว · ลบ " + r.removed + " เอกสาร"); await refreshPending(); after(); } catch (e) { toast(e.message, "bad"); }
}
function payBillModal(cd, bill, after) {
  const chans = listNames("payment_channel").filter(n => !isCreditChannel(n));
  const m = openModal({ title: "ชำระบิล " + esc(cd.name) + " · ครบกำหนด " + thDate(bill.dueDate), size: "lg", body: `
    <div class="card tbl-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" data-all checked></th><th>วันที่</th><th>เอกสาร</th><th>รายการ</th><th class="num">ยอด</th></tr></thead><tbody>
      ${bill.records.map(x => `<tr><td><input type="checkbox" data-r="${x.id}" data-amt="${x.total}" checked></td><td>${thDate(x.date, true)}</td><td class="doc">${esc(x.docNo)}</td><td class="desc">${esc(x.description)}${x.installment ? ` <span class="chip blue plain">งวด ${x.planSeq}/${x.planCount}</span>` : ""}</td><td class="num">${fmt(x.total)}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid g3" style="margin-top:14px"><label class="field"><span>จ่ายจากบัญชี <em>*</em></span><select class="input" name="channel">${opt("", "— เลือกบัญชี —")}${(() => { const pick = chans.find(n => /โอน|ธนาคาร|บัญชี/.test(n)); return chans.map(n => opt(n, n, n === pick)).join(""); })()}</select></label>
      <label class="field"><span>วันที่ชำระ</span><input type="date" class="input" name="date" value="${today()}"></label>
      <label class="field"><span>ดอกเบี้ย / ค่าธรรมเนียม / ค่าปรับ (ถ้ามี)</span><input class="input num" name="fee" inputmode="decimal" placeholder="0.00"></label></div>
    <div class="sum-box" style="margin-top:14px"><div class="sum-row"><span>ยอดรายการที่เลือก</span><b class="num" data-sel></b></div><div class="sum-row"><span>ดอกเบี้ย / ค่าธรรมเนียม</span><span class="num" data-fee>0.00</span></div><div class="sum-row total"><span>ยอดที่จ่ายจริง</span><span class="num" data-tot></span></div></div>
    <div class="field-hint" style="margin-top:8px">ระบบจะตัดเงินจากบัญชีที่เลือก และเปลี่ยนรายการเป็น “ชำระแล้ว” · ดอกเบี้ย/ค่าธรรมเนียมจะลงเป็นรายจ่ายหมวด “ค่าธรรมเนียม / ดอกเบี้ยบัตรเครดิต” ให้อัตโนมัติ</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("check")} ยืนยันชำระบิล</button>` });
  const el = m.el;
  const calc = () => { const s = $$("[data-r]", el).filter(x => x.checked).reduce((a, x) => a + Number(x.dataset.amt), 0), f = num($("[name=fee]", el).value); $("[data-sel]", el).textContent = fmt(s); $("[data-fee]", el).textContent = fmt(f); $("[data-tot]", el).textContent = baht(s + f); };
  $("[data-all]", el).onchange = e => { $$("[data-r]", el).forEach(x => { x.checked = e.target.checked; }); calc(); };
  $$("[data-r]", el).forEach(x => { x.onchange = calc; }); $("[name=fee]", el).oninput = calc; calc();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => { const f = formData(el); const ids = $$("[data-r]", el).filter(x => x.checked).map(x => x.dataset.r);
    if (!ids.length) throw new Error("กรุณาเลือกรายการ"); if (!f.channel) throw new Error("กรุณาเลือกบัญชีที่ใช้จ่าย");
    const r = await bapi("POST", "/cards/pay", { card: cd.name, recordIds: ids, channel: f.channel, date: f.date, fee: num(f.fee) });
    toast("ชำระบิลแล้ว " + baht(r.total + r.fee) + " จาก " + f.channel); m.close(); after(); }).catch(() => {});
}
function cardSettingModal(x, call, after) {
  const k = x.card || {};
  const m = openModal({ title: "ตั้งค่าบัตร · " + esc(x.name), body: `<div class="grid g3"><label class="field"><span>วันตัดรอบบัญชี (1-31) <em>*</em></span><input class="input num" name="cutDay" value="${k.cutDay || ""}" inputmode="numeric" placeholder="เช่น 25"></label>
    <label class="field"><span>วันครบกำหนดชำระ (1-31) <em>*</em></span><input class="input num" name="dueDay" value="${k.dueDay || ""}" inputmode="numeric" placeholder="เช่น 10"></label>
    <label class="field"><span>วงเงิน (ไม่บังคับ)</span><input class="input num" name="limit" value="${k.limit == null ? "" : k.limit}" inputmode="decimal"></label></div>
    <div class="info-box" style="margin-top:14px" data-ex></div>`,
    foot: `${x.card ? `<div class="left"><button class="btn danger" data-clear>ยกเลิกการตั้งค่าบัตร</button></div>` : ""}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึก</button>` });
  const ex = () => { const f = formData(m.el), c = +f.cutDay, d = +f.dueDay; const t = today();
    $("[data-ex]", m.el).innerHTML = c >= 1 && c <= 31 && d >= 1 && d <= 31 ? `ตัวอย่าง: รูดวันนี้ (${thDate(t)}) → ครบกำหนดชำระ <b>${thDate(cardDueFor(t, c, d))}</b><br>วันครบกำหนดที่น้อยกว่าหรือเท่ากับวันตัดรอบ = ชำระในเดือนถัดจากเดือนที่ตัดรอบ` : "ใส่วันตัดรอบและวันครบกำหนดตามใบแจ้งยอดบัตร"; };
  $$("[name]", m.el).forEach(i => { i.oninput = ex; }); ex();
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); await call("PUT", "/lists/" + x.id, { card: f }); m.close(); toast("บันทึกการตั้งค่าบัตรแล้ว"); after(); }).catch(() => {});
  const cl = $("[data-clear]", m.el); if (cl) cl.onclick = async () => { await call("PUT", "/lists/" + x.id, { card: null }); m.close(); toast("ยกเลิกการตั้งค่าบัตรแล้ว"); after(); };
}

/* ---------- settings: lists ---------- */
const LIST_LABEL = { income_category: "หมวดรายรับ", expense_category: "หมวดรายจ่าย", invest_category: "หมวดสินทรัพย์", vendor: "ผู้ขาย / ร้านค้า", payment_channel: "ช่องทางชำระเงิน", stock_category: "หมวดสต็อก", unit: "หน่วยนับ" };
async function listsEditor(c, bid, token, state) {
  const call = (m, p, b) => api(m, "/api/b/" + bid + p, b, { token });
  const lr = await call("GET", "/lists"); const lists = lr.lists, FSG = lr.fsGroups || {};
  if (bid === S.bid) S.lists = lists;
  const k = state.kind;
  const ro = bid === S.bid && !S.adminToken && !canEdit("settings");
  const fsSel = x => FSG[k] ? `<label class="row small" style="gap:6px"><span class="muted">กลุ่มในงบ</span><select class="input sm" style="width:190px" data-fs="${x.id}" ${ro ? "disabled" : ""}>${opt("", "อัตโนมัติ: " + (FSG[k][x.fsGuess] || "-"), !x.fsGroup)}${Object.keys(FSG[k]).map(g => opt(g, FSG[k][g], g === x.fsGroup)).join("")}</select></label>` : "";
  c.innerHTML = `<div class="tabs">${Object.keys(LIST_LABEL).map(x => `<button data-k="${x}" class="${x === k ? "on" : ""}">${LIST_LABEL[x]} <span class="muted small">${lists[x].length}</span></button>`).join("")}</div>
    <div class="card"><div class="toolbar"><input class="input" style="max-width:360px" placeholder="เพิ่ม${LIST_LABEL[k]}ใหม่…" data-new>${k === "payment_channel" ? `<label class="check"><input type="checkbox" data-credit> มีวันครบกำหนด (เครดิต/ค้างชำระ)</label>` : ""}<button class="btn primary" data-add>${icon("plus")} เพิ่ม</button></div>
    ${k === "payment_channel" ? `<div class="info-box" style="margin:12px 14px 0">ช่องทางที่ติ๊ก “มีวันครบกำหนด” จะให้ใส่วันครบชำระ และแสดงในรายการค้างรับ/ค้างจ่ายจนกว่าจะกดว่าชำระแล้ว · <b>บัตรเครดิต</b>: กด “ตั้งค่าบัตร” ใส่วันตัดรอบ/วันครบกำหนด เพื่อใช้บิลรายเดือน การแบ่งจ่าย และการแจ้งเตือน</div>` : ""}
    <div data-rows>${lists[k].map((x, i) => `<div class="list-row"><div class="row" style="gap:2px"><button class="btn ghost sm icon" data-up="${i}" ${i ? "" : "disabled"}>${icon("up")}</button><button class="btn ghost sm icon" data-dn="${i}" ${i < lists[k].length - 1 ? "" : "disabled"}>${icon("down")}</button></div>
      <div class="grow bold">${esc(x.name)}</div>${fsSel(x)}${k === "payment_channel" ? `<label class="check small"><input type="checkbox" data-cr="${x.id}" ${x.isCredit ? "checked" : ""}> มีวันครบกำหนด</label>${x.isCredit ? `<button class="btn sm ${x.card ? "" : "ghost"}" data-card="${x.id}">${icon("wallet")} ${x.card ? "บัตร: ตัดรอบ " + x.card.cutDay + " / ชำระ " + x.card.dueDay : "ตั้งค่าบัตร"}</button>` : ""}` : ""}
      <button class="btn ghost sm" data-ren="${x.id}">${icon("edit")} เปลี่ยนชื่อ</button><button class="btn ghost sm icon" data-del="${x.id}">${icon("trash")}</button></div>`).join("") || emptyBox("ยังไม่มีรายการ")}</div></div>
    ${lr.synced ? `<div class="info-box" style="margin-top:12px">${icon("link", "").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} <b>ใช้ร่วมกันทุกสาขา (ในธุรกิจเดียวกัน)</b> — เพิ่ม / เปลี่ยนชื่อ / ลบ / เรียงลำดับ / ตั้งกลุ่มในงบ ที่นี่ จะมีผลกับทุกสาขาพร้อมกัน (ยอดยกมาของบัญชีเงินยังแยกตามสาขา)</div>` : ""}
    ${FSG[k] ? `<div class="info-box" style="margin-top:12px">“กลุ่มในงบ” ใช้จัดหมวดนี้ลงในงบกำไรขาดทุน / งบแสดงฐานะการเงิน — ถ้าไม่เลือก ระบบจะเดาจากชื่อหมวด (แสดงในวงเล็บ “อัตโนมัติ”)</div>` : ""}
    <div class="field-hint" style="margin-top:10px">เปลี่ยนชื่อหมวด → เอกสารเก่าที่ใช้ชื่อเดิมจะเปลี่ยนตามให้อัตโนมัติ · ลบหมวด → เอกสารเก่ายังคงชื่อเดิมไว้</div>`;
  if (ro) $$("[data-add],[data-new],[data-credit],[data-up],[data-dn],[data-cr],[data-ren],[data-del]", c).forEach(x => { x.disabled = true; });
  $$("[data-card]", c).forEach(b => { b.onclick = () => cardSettingModal(lists[k].find(y => y.id === b.dataset.card), call, re); });
  if (ro) $$("[data-card]", c).forEach(x => { x.disabled = true; });
  $$("[data-fs]", c).forEach(sel => { sel.onchange = async () => { try { await call("PUT", "/lists/" + sel.dataset.fs, { fsGroup: sel.value }); toast("บันทึกกลุ่มในงบแล้ว"); } catch (e) { toast(e.message, "bad"); } }; });
  const re = () => listsEditor(c, bid, token, state);
  $$("[data-k]", c).forEach(b => { b.onclick = () => { state.kind = b.dataset.k; re(); }; });
  const add = async () => { const v = $("[data-new]", c).value.trim(); if (!v) return; try { await call("POST", "/lists", { kind: k, name: v, isCredit: !!($("[data-credit]", c) || {}).checked }); toast("เพิ่มแล้ว"); re(); } catch (e) { toast(e.message, "bad"); } };
  $("[data-add]", c).onclick = add; $("[data-new]", c).onkeydown = e => { if (e.key === "Enter") add(); };
  const order = async (i, d) => { const ids = lists[k].map(x => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await call("PUT", "/lists/" + ids[0], { order: ids }); re(); };
  $$("[data-up]", c).forEach(b => { b.onclick = () => order(+b.dataset.up, -1); }); $$("[data-dn]", c).forEach(b => { b.onclick = () => order(+b.dataset.dn, 1); });
  $$("[data-cr]", c).forEach(b => { b.onchange = async () => { await call("PUT", "/lists/" + b.dataset.cr, { isCredit: b.checked }); toast("บันทึกแล้ว"); re(); }; });
  $$("[data-del]", c).forEach(b => { b.onclick = async () => { const x = lists[k].find(y => y.id === b.dataset.del); if (!await confirmBox(`ลบ “${x.name}” ออกจาก${LIST_LABEL[k]}?`, { danger: true, okText: "ลบ" })) return; await call("DELETE", "/lists/" + x.id); toast("ลบแล้ว"); re(); }; });
  $$("[data-ren]", c).forEach(b => { b.onclick = () => { const x = lists[k].find(y => y.id === b.dataset.ren);
    const m = openModal({ title: "เปลี่ยนชื่อ", body: `<label class="field"><span>ชื่อใหม่</span><input class="input" name="n" value="${esc(x.name)}"></label>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึก</button>` });
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { await call("PUT", "/lists/" + x.id, { name: $("[name=n]", m.el).value }); m.close(); toast("เปลี่ยนชื่อแล้ว"); re(); }).catch(() => {}); }; });
}
BRANCH_PAGES.settings = { title: () => "หมวด & ช่องทาง", state: { kind: "expense_category" }, async render(c) {
  const inner = document.createElement("div"); c.innerHTML = `<div class="page-head"><div class="grow"><h2>หมวด & ช่องทางของสาขา</h2></div></div>`; c.appendChild(inner);
  await listsEditor(inner, S.bid, tokenFor(S.bid), this.state);
} };
BRANCH_PAGES.password = { title: () => S.binfo.me.kind === "user" ? "เปลี่ยนรหัสผ่านของฉัน" : "เปลี่ยนรหัสผ่านสาขา", async render(c) {
  if (S.binfo.me.kind === "user") {
    c.innerHTML = `<div class="card" style="max-width:480px"><div class="card-h"><h3>บัญชีผู้ใช้: ${esc(S.binfo.me.username)}</h3></div><form class="card-b stack" data-f>
      <label class="field"><span>รหัสผ่านปัจจุบัน</span>${pwInput("oldPassword", "", "current-password")}</label><label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</span>${pwInput("newPassword", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่านใหม่</span>${pwInput("confirm", "", "new-password")}</label>
      <div class="field-hint">อุปกรณ์อื่นที่เข้าด้วยบัญชีนี้อยู่จะถูกออกจากระบบ</div><button class="btn primary">${icon("check")} เปลี่ยนรหัสผ่าน</button></form></div>`;
    bindPwEyes(c);
    $("[data-f]", c).onsubmit = e => { e.preventDefault(); const f = formData(c); if (f.newPassword !== f.confirm) return toast("ยืนยันรหัสผ่านไม่ตรงกัน", "bad");
      withBtn($("button.primary", c), async () => { await api("POST", "/api/user/change-password", f, { token: tokenFor(S.bid) }); toast("เปลี่ยนรหัสผ่านแล้ว"); $("[data-f]", c).reset(); }).catch(() => {}); };
    return;
  }
  const adm = S.binfo.isAdmin;
  c.innerHTML = `<div class="card" style="max-width:480px"><div class="card-h"><h3>${icon("key", "").replace("<svg", '<svg style="width:18px;height:18px;vertical-align:-3px"')} เปลี่ยนรหัสผ่านของ ${esc(S.binfo.branch.name)}</h3></div><form class="card-b stack" data-f>
    ${adm ? `<div class="info-box">คุณเข้าในฐานะผู้ดูแล — ไม่ต้องใส่รหัสเดิม</div>` : `<label class="field"><span>รหัสผ่านเดิม</span>${pwInput("oldPassword", "", "current-password")}</label>`}
    <label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</span>${pwInput("newPassword", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่านใหม่</span>${pwInput("confirm", "", "new-password")}</label>
    <div class="field-hint">หลังเปลี่ยนรหัส อุปกรณ์อื่นที่เข้าสาขานี้อยู่จะถูกออกจากระบบ ต้องใส่รหัสใหม่</div><button class="btn primary">${icon("check")} เปลี่ยนรหัสผ่าน</button></form></div>`;
  bindPwEyes(c);
  $("[data-f]", c).onsubmit = e => { e.preventDefault(); const f = formData(c); const btn = $("button.primary", c);
    if (f.newPassword !== f.confirm) return toast("ยืนยันรหัสผ่านไม่ตรงกัน", "bad");
    withBtn(btn, async () => { await bapi("POST", "/change-password", f); toast("เปลี่ยนรหัสผ่านสาขาแล้ว"); $("[data-f]", c).reset(); }).catch(() => {}); };
} };

/* ===================== admin ===================== */
function adminNav() {
  const a = "#/admin/";
  return [{ key: "overview", label: "ภาพรวมทุกสาขา", icon: "dashboard", href: a + "overview" }, { sec: "จัดการ" }, { key: "businesses", label: "ธุรกิจ", icon: "building", href: a + "businesses" }, { key: "branches", label: "จัดการสาขา", icon: "building", href: a + "branches" },
    { key: "lists", label: "หมวด & ช่องทาง", icon: "settings", href: a + "lists" }, { key: "settings", label: "ตั้งค่าบริษัท & ระบบ", icon: "shield", href: a + "settings" },
    { key: "users", label: "ผู้ใช้งาน & สิทธิ์", icon: "userKey", href: a + "users" }, { key: "admins", label: "ผู้ดูแลระบบ", icon: "users", href: a + "admins" },
    { sec: "ระบบ" }, { key: "activity", label: "Log การใช้งาน", icon: "history", href: a + "activity" },
    { key: "backup", label: "สำรองข้อมูล", icon: "database", href: a + "backup" }, { key: "account", label: "เปลี่ยนรหัสผ่านของฉัน", icon: "key", href: a + "account" }];
}
async function adminLogout(goHome) {
  const t = S.adminToken; S.adminToken = null; S.admin = null; S.adminBranch = null;
  if (t) api("POST", "/api/logout", null, { token: t, noRedirect: true }).catch(() => {});
  if (S.bid && !S.branchTokens[S.bid]) { S.bid = null; S.binfo = null; }
  if (goHome) go("#/");
}
function adminLoginView() {
  const app = $("#app");
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="auth-icon">${icon("shield")}</div><h2>เข้าสู่ระบบผู้ดูแล</h2><p>ใส่ชื่อผู้ใช้และรหัสผ่านทุกครั้งที่เข้าหน้าผู้ดูแลระบบ</p><div data-err></div>
    <form data-f class="stack"><label class="field"><span>ชื่อผู้ใช้ (User)</span><input class="input" name="username" autocomplete="username" autocapitalize="off"></label><label class="field"><span>รหัสผ่าน (Password)</span>${pwInput("password")}</label>
    <button class="btn primary">${icon("lock")} เข้าสู่ระบบ</button></form><div style="text-align:center;margin-top:16px"><a href="#/" class="small">← กลับหน้าเลือกสาขา</a></div></div></div>`;
  bindPwEyes(app);
  $("[data-f]").onsubmit = async e => { e.preventDefault(); const f = formData(app); const btn = $("button.primary", app);
    try { await withBtn(btn, async () => { const r = await api("POST", "/api/admin/login", f, { noRedirect: true }); S.adminToken = r.token; S.admin = r.admin; S.adminIdle = r.idleMin || 30; S.adminLastAct = Date.now(); S._lastPw = f.password;
      if (r.admin.mustChange) forceChangeView(); else { S._lastPw = null; go("#/admin/overview"); } }); }
    catch (err) { $("[data-err]", app).innerHTML = `<div class="err-box">${esc(err.message)}</div>`; } };
}
function forceChangeView() {
  const app = $("#app");
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:440px"><div class="auth-icon">${icon("key")}</div><h2>ตั้งรหัสผ่านใหม่ก่อนใช้งาน</h2><p>เพื่อความปลอดภัย กรุณาเปลี่ยนรหัสผ่านเริ่มต้น (และชื่อผู้ใช้ถ้าต้องการ)</p><div data-err></div>
    <form data-f class="stack"><label class="field"><span>ชื่อผู้ใช้</span><input class="input" name="newUsername" value="${esc(S.admin.username)}" autocapitalize="off"></label><label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</span>${pwInput("newPassword", "", "new-password")}</label>
    <label class="field"><span>ยืนยันรหัสผ่านใหม่</span>${pwInput("confirm", "", "new-password")}</label><button class="btn primary">${icon("check")} บันทึกและเข้าใช้งาน</button></form></div></div>`;
  bindPwEyes(app);
  $("[data-f]").onsubmit = async e => { e.preventDefault(); const f = formData(app); const btn = $("button.primary", app);
    if (f.newPassword !== f.confirm) { $("[data-err]", app).innerHTML = `<div class="err-box">ยืนยันรหัสผ่านไม่ตรงกัน</div>`; return; }
    try { await withBtn(btn, async () => { const r = await api("POST", "/api/admin/change-password", { oldPassword: S._lastPw, newPassword: f.newPassword, newUsername: f.newUsername }); S._lastPw = null; S.admin.username = r.username; S.admin.mustChange = false; toast("ตั้งรหัสผ่านใหม่แล้ว"); go("#/admin/overview"); }); }
    catch (err) { $("[data-err]", app).innerHTML = `<div class="err-box">${esc(err.message)}</div>`; } };
}
const ADMIN_PAGES = {};
async function renderAdmin(page, rest) {
  if (!S.adminToken) return adminLoginView();
  if (S.admin && S.admin.mustChange) return forceChangeView();
  S.adminBranch = null;
  if (!S.info) S.info = await api("GET", "/api/public/info").catch(() => null);
  const P = ADMIN_PAGES[page] || ADMIN_PAGES.overview;
  try { S.bizList = (await api("GET", "/api/admin/businesses")).businesses; } catch (e) { S.bizList = S.bizList || []; }
  if (S.biz === undefined) { try { S.biz = localStorage.getItem("biz") || ""; } catch (e) { S.biz = ""; } }
  if (!S.bizList.some(z => z.id === S.biz)) S.biz = S.bizList[0] ? S.bizList[0].id : "";
  const bz = curBiz();
  document.title = "ผู้ดูแลระบบ · " + (bz ? bz.name : "");
  const c = shell({ kind: "admin", nav: adminNav(), active: ADMIN_PAGES[page] ? page : "overview", title: P.title, crumb: "ผู้ดูแลระบบ" + (bz && S.bizList.length > 1 ? " · " + esc(bz.name) : ""), headRight: `${S.bizList.length > 1 ? `<label class="biz-switch" title="สลับธุรกิจ">${bizLogo(bz, 26)}<select data-bizsw>${S.bizList.map(z => opt(z.id, z.name, z.id === S.biz)).join("")}</select></label>` : ""}<button class="user-chip" data-adminme><div class="av">${esc(initials(S.admin.username))}</div><span>${esc(S.admin.username)}</span>${icon("logout", "")}</button>` });
  const sw = $("[data-bizsw]"); if (sw) sw.onchange = () => { setBiz(sw.value); toast("สลับเป็น " + curBiz().name); render(); };
  try { await P.render(c, rest); } catch (e) { if (e.status !== 401) c.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}
function openBranchAsAdmin(id) { S.adminBranch = id; S.bid = null; S.binfo = null; go("#/b/" + id + "/dashboard"); }

/* =====================================================================
   POS ขายหน้าร้าน (v3.0)
   ===================================================================== */
const POS_L = {
  th: { sell: "ขายหน้าร้าน", search: "ค้นหาเมนู", all: "ทั้งหมด", cart: "ตะกร้า", empty: "ยังไม่มีรายการ — แตะเมนูเพื่อเพิ่ม", total: "รวม", pay: "ชำระเงิน", clear: "ล้าง", soldout: "หมด", left: "เหลือ",
    type: "แบบ / ขนาด", qty: "จำนวน", addons: "เพิ่ม (Add-on)", note: "หมายเหตุ", notePh: "เช่น ไม่เผ็ด ไม่ใส่ผัก", add: "ใส่ตะกร้า", added: "เพิ่มแล้ว", discount: "ส่วนลด (บาท)", method: "วิธีชำระ",
    qr: "QR โอนเงิน", cash: "เงินสด", other: "ช่องทางอื่น", received: "รับเงินมา", change: "เงินทอน", exact: "พอดี", slip: "แนบสลิป (ไม่บังคับ)", confirmPaid: "ยืนยันรับเงินแล้ว", scan: "ให้ลูกค้าสแกนจ่ายตามยอดนี้",
    queue: "คิว", paidOk: "รับเงินเรียบร้อย", newSale: "ขายต่อ", print: "พิมพ์ใบเสร็จ", orders: "ออเดอร์ / คิว", waiting: "รอทำ", ready: "เสร็จแล้ว", allDay: "ทั้งหมดวันนี้", done: "ทำเสร็จ", undo: "ย้อนกลับ",
    cancel: "ยกเลิก / คืนเงิน", noOrders: "ยังไม่มีออเดอร์", channel: "ช่องทาง", notEnough: "รับเงินไม่พอ", noQr: "ยังไม่ได้ตั้งค่า QR รับเงิน — ให้ผู้จัดการตั้งที่ “เมนู & ตั้งค่า POS”", display: "จอลูกค้า", items: "รายการ",
    noMenu: "ยังไม่มีเมนู — ให้ผู้จัดการเพิ่มที่ “เมนู & ตั้งค่า POS”", fast: "แตะ = เพิ่ม 1", refundDone: "คืนเงินแล้ว", cancelled: "ยกเลิกแล้ว", refunded: "คืนเงินบางส่วน" },
  en: { sell: "Sell", search: "Search menu", all: "All", cart: "Cart", empty: "Cart is empty — tap a menu item", total: "Total", pay: "Pay", clear: "Clear", soldout: "Sold out", left: "Left",
    type: "Type / Size", qty: "Quantity", addons: "Add-ons", note: "Note", notePh: "e.g. not spicy, no vegetables", add: "Add to cart", added: "Added", discount: "Discount (THB)", method: "Payment",
    qr: "QR transfer", cash: "Cash", other: "Other", received: "Cash received", change: "Change", exact: "Exact", slip: "Attach slip (optional)", confirmPaid: "Payment received", scan: "Customer scans to pay this amount",
    queue: "Queue", paidOk: "Payment complete", newSale: "Next sale", print: "Print receipt", orders: "Orders / Queue", waiting: "To cook", ready: "Ready", allDay: "All today", done: "Done", undo: "Undo",
    cancel: "Cancel / Refund", noOrders: "No orders yet", channel: "Channel", notEnough: "Not enough cash", noQr: "Payment QR is not set up — ask the manager", display: "Customer screen", items: "items",
    noMenu: "No menu yet — ask the manager to add items", fast: "Tap = add 1", refundDone: "Refunded", cancelled: "Cancelled", refunded: "Partly refunded" },
  my: { sell: "ရောင်းမည်", search: "မီနူးရှာရန်", all: "အားလုံး", cart: "ခြင်းတောင်း", empty: "ဘာမှမရှိသေးပါ — မီနူးကိုနှိပ်ပါ", total: "စုစုပေါင်း", pay: "ငွေရှင်းမည်", clear: "ရှင်းမည်", soldout: "ကုန်ပြီ", left: "ကျန်",
    type: "အမျိုးအစား / အရွယ်", qty: "အရေအတွက်", addons: "အပိုထည့်ရန်", note: "မှတ်ချက်", notePh: "ဥပမာ မစပ်ပါ၊ ဟင်းသီးဟင်းရွက်မထည့်ပါ", add: "ခြင်းထဲထည့်", added: "ထည့်ပြီး", discount: "လျှော့စျေး (ဘတ်)", method: "ငွေပေးချေမှု",
    qr: "QR ငွေလွှဲ", cash: "ငွေသား", other: "အခြား", received: "လက်ခံငွေ", change: "ပြန်အမ်းငွေ", exact: "အတိအကျ", slip: "ငွေလွှဲစာရွက် (မဖြစ်မနေမဟုတ်)", confirmPaid: "ငွေရပြီ", scan: "ဖောက်သည် QR စကင်ဖတ်ပြီး ပေးချေရန်",
    queue: "တန်းစီနံပါတ်", paidOk: "ငွေရှင်းပြီးပါပြီ", newSale: "နောက်တစ်ခု", print: "ပြေစာထုတ်", orders: "အော်ဒါ / တန်းစီ", waiting: "ချက်ရန်", ready: "ပြီးပြီ", allDay: "ယနေ့အားလုံး", done: "ပြီးပြီ", undo: "ပြန်ပြင်",
    cancel: "ပယ်ဖျက် / ငွေပြန်", noOrders: "အော်ဒါမရှိသေးပါ", channel: "နည်းလမ်း", notEnough: "ငွေမလုံလောက်ပါ", noQr: "QR မသတ်မှတ်ရသေးပါ — မန်နေဂျာကိုပြောပါ", display: "ဖောက်သည်မျက်နှာပြင်", items: "ခု",
    noMenu: "မီနူးမရှိသေးပါ", fast: "နှိပ် = ၁ ခုထည့်", refundDone: "ငွေပြန်ပေးပြီး", cancelled: "ပယ်ဖျက်ပြီး", refunded: "တစ်စိတ်တစ်ပိုင်းပြန်ပေး" },
  lo: { sell: "ຂາຍໜ້າຮ້ານ", search: "ຄົ້ນຫາເມນູ", all: "ທັງໝົດ", cart: "ກະຕ່າ", empty: "ຍັງບໍ່ມີລາຍການ — ແຕະເມນູເພື່ອເພີ່ມ", total: "ລວມ", pay: "ຈ່າຍເງິນ", clear: "ລ້າງ", soldout: "ໝົດ", left: "ເຫຼືອ",
    type: "ແບບ / ຂະໜາດ", qty: "ຈຳນວນ", addons: "ເພີ່ມ (Add-on)", note: "ໝາຍເຫດ", notePh: "ເຊັ່ນ ບໍ່ເຜັດ ບໍ່ໃສ່ຜັກ", add: "ໃສ່ກະຕ່າ", added: "ເພີ່ມແລ້ວ", discount: "ສ່ວນຫຼຸດ (ບາດ)", method: "ວິທີຈ່າຍ",
    qr: "QR ໂອນເງິນ", cash: "ເງິນສົດ", other: "ຊ່ອງທາງອື່ນ", received: "ຮັບເງິນມາ", change: "ເງິນທອນ", exact: "ພໍດີ", slip: "ແນບສະລິບ (ບໍ່ບັງຄັບ)", confirmPaid: "ຢືນຢັນຮັບເງິນແລ້ວ", scan: "ໃຫ້ລູກຄ້າສະແກນຈ່າຍຕາມຍອດນີ້",
    queue: "ຄິວ", paidOk: "ຮັບເງິນສຳເລັດ", newSale: "ຂາຍຕໍ່", print: "ພິມໃບບິນ", orders: "ອໍເດີ / ຄິວ", waiting: "ລໍຖ້າເຮັດ", ready: "ເຮັດແລ້ວ", allDay: "ທັງໝົດມື້ນີ້", done: "ເຮັດແລ້ວ", undo: "ຍ້ອນກັບ",
    cancel: "ຍົກເລີກ / ຄືນເງິນ", noOrders: "ຍັງບໍ່ມີອໍເດີ", channel: "ຊ່ອງທາງ", notEnough: "ຮັບເງິນບໍ່ພໍ", noQr: "ຍັງບໍ່ໄດ້ຕັ້ງ QR ຮັບເງິນ — ບອກຜູ້ຈັດການ", display: "ຈໍລູກຄ້າ", items: "ລາຍການ",
    noMenu: "ຍັງບໍ່ມີເມນູ", fast: "ແຕະ = ເພີ່ມ 1", refundDone: "ຄືນເງິນແລ້ວ", cancelled: "ຍົກເລີກແລ້ວ", refunded: "ຄືນເງິນບາງສ່ວນ" } };
const POS_LANGS = [["th", "ไทย"], ["en", "EN"], ["my", "မြန်မာ"], ["lo", "ລາວ"]];
const posLang = () => { if (!S.posLang) { try { S.posLang = localStorage.getItem("posLang") || "th"; } catch (e) { S.posLang = "th"; } } return POS_L[S.posLang] ? S.posLang : "th"; };
const PT = k => (POS_L[posLang()] || POS_L.th)[k] || POS_L.th[k] || k;
const posName = m => (m && m.names && m.names[posLang()]) || (m && m.name) || "";
const posImg = m => m.imageV ? authUrl("/pos/menu/" + m.id + "/image?v=" + m.imageV) : "";
const posLangBar = () => `<div class="pos-lang">${POS_LANGS.map(([k, l]) => `<button data-plang="${k}" class="${posLang() === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
function bindPosLang(root, redraw) { $$("[data-plang]", root).forEach(b => { b.onclick = () => { S.posLang = b.dataset.plang; try { localStorage.setItem("posLang", S.posLang); } catch (e) {} redraw(); }; }); }
async function posBoot(force) { if (force || !S.posBoot || S.posBoot._bid !== S.bid) { S.posBoot = await bapi("GET", "/pos/boot"); S.posBoot._bid = S.bid; } return S.posBoot; }
const posCats = boot => { const used = [...new Set(boot.menu.map(m => m.category || "อื่นๆ"))], order = boot.config.menuCats || []; return used.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, "th"); }); };
const posLineTotal = l => r2(l.price * l.qty + (l.addons || []).reduce((a, x) => a + x.price * x.qty, 0));
function posStopTimers() { if (S.posTimer) { clearInterval(S.posTimer); S.posTimer = null; } }

/* ---------- หน้าขาย ---------- */
BRANCH_PAGES.pos = { title: () => "POS ขายหน้าร้าน", nav: "pos", state: { cat: "", q: "" }, async render(c) {
  const st = this.state, self = this;
  const boot = await posBoot(true);
  S.posCart = S.posCart || [];
  const left = m => m.dailyLimit == null ? null : Math.max(0, m.dailyLimit - m.soldToday - S.posCart.filter(l => l.menuId === m.id).reduce((a, l) => a + l.qty, 0));
  const isOut = m => m.soldout || (m.dailyLimit != null && left(m) <= 0);
  c.innerHTML = `<div class="pos-wrap"><div class="pos-main">
      <div class="pos-top"><div class="search grow" style="max-width:none">${icon("search")}<input class="input" data-pq placeholder="${PT("search")}" value="${esc(st.q)}"></div>${posLangBar()}</div>
      ${!boot.config.qrReady ? `<div class="info-box warn-box" style="margin-bottom:10px">${PT("noQr")}</div>` : ""}
      <div class="cat-chips pos-cats" data-pcats></div><div class="pos-grid" data-pgrid></div></div>
    <aside class="pos-cart" data-pcart></aside></div>
    <div class="pos-cartbar" data-pbar></div>`;
  const drawCats = () => { const cats = posCats(boot);
    $("[data-pcats]", c).innerHTML = `<button data-pc="" class="${!st.cat ? "on" : ""}">${PT("all")}</button>` + cats.map(n => `<button data-pc="${esc(n)}" class="${st.cat === n ? "on" : ""}">${esc(n)}</button>`).join("");
    $$("[data-pc]", c).forEach(b => { b.onclick = () => { st.cat = b.dataset.pc; drawCats(); drawGrid(); }; }); };
  const drawGrid = () => {
    const q = st.q.toLowerCase();
    const list = boot.menu.filter(m => m.active && (!st.cat || (m.category || "อื่นๆ") === st.cat) && (!q || (m.name + " " + Object.values(m.names || {}).join(" ")).toLowerCase().includes(q)));
    $("[data-pgrid]", c).innerHTML = list.length ? list.map(m => { const out = isOut(m), lf = left(m), inCart = S.posCart.filter(l => l.menuId === m.id).reduce((a, l) => a + l.qty, 0);
      const minP = m.types.length ? Math.min(...m.types.map(t => t.price)) : m.price;
      return `<button class="pos-item ${out ? "out" : ""}" data-pm="${m.id}">${posImg(m) ? `<span class="pi-img" style="background-image:url('${posImg(m)}')"></span>` : `<span class="pi-img ph">${esc((posName(m) || "?").slice(0, 2))}</span>`}
        ${inCart ? `<span class="pi-badge">${inCart}</span>` : ""}${out ? `<span class="pi-out">${PT("soldout")}</span>` : ""}
        <span class="pi-name">${esc(posName(m))}</span><span class="pi-price">${m.types.length > 1 ? "฿" + fmt(minP).replace(/\.00$/, "") + "+" : "฿" + fmt(minP).replace(/\.00$/, "")}${lf != null && !out ? ` <small>· ${PT("left")} ${lf}</small>` : ""}</span></button>`; }).join("")
      : emptyBox(boot.menu.length ? "—" : PT("noMenu"), "stock");
    $$("[data-pm]", c).forEach(b => { b.onclick = () => { const m = boot.menu.find(x => x.id === b.dataset.pm); if (isOut(m)) return toast(PT("soldout"), "bad");
      if (m.types.length <= 1 && !m.addons.length) { posAdd({ menuId: m.id, name: m.name, names: m.names, type: m.types[0] ? m.types[0].name : "", price: m.types[0] ? m.types[0].price : m.price, qty: 1, addons: [], note: "" }); return; }
      posItemModal(m, left(m)); }; });
  };
  const posAdd = line => { const same = S.posCart.find(l => l.menuId === line.menuId && l.type === line.type && !l.note && !line.note && !(l.addons || []).length && !line.addons.length);
    if (same) same.qty += line.qty; else S.posCart.push({ ...line, key: Math.random().toString(36).slice(2) });
    drawGrid(); drawCart(); pushDisplay(); };
  const pushDisplay = debounce(() => { const tot = S.posCart.reduce((a, l) => a + posLineTotal(l), 0);
    bapi("POST", "/pos/display", S.posCart.length ? { mode: "cart", amount: tot, items: S.posCart.map(l => ({ name: l.name + (l.type ? " (" + l.type + ")" : ""), qty: l.qty, total: posLineTotal(l) })) } : { mode: "idle" }).catch(() => {}); }, 400);
  const drawCart = () => {
    const tot = r2(S.posCart.reduce((a, l) => a + posLineTotal(l), 0)), n = S.posCart.reduce((a, l) => a + l.qty, 0);
    const html = `<div class="pc-head"><b>${PT("cart")}</b><span class="grow"></span>${S.posCart.length ? `<button class="btn sm ghost" data-pclear>${PT("clear")}</button>` : ""}<button class="btn sm ghost icon pc-x" data-pcx>${icon("x")}</button></div>
      <div class="pc-lines">${S.posCart.length ? S.posCart.map((l, i) => `<div class="pc-line"><div class="grow"><div class="bold">${esc(posName(l))}</div>
          <div class="small muted">${l.type ? esc(l.type) + " · " : ""}฿${fmt(l.price)}${(l.addons || []).map(a => `<br>+ ${esc(a.name)} ×${a.qty}`).join("")}${l.note ? `<br>📝 ${esc(l.note)}` : ""}</div></div>
          <div class="pc-qty"><button data-pdec="${i}">−</button><b>${l.qty}</b><button data-pinc="${i}">+</button></div><div class="pc-amt">${fmt(posLineTotal(l))}</div></div>`).join("") : `<div class="muted small" style="padding:18px 4px;text-align:center">${PT("empty")}</div>`}</div>
      <div class="pc-foot"><div class="pc-total"><span>${PT("total")}</span><b>฿${fmt(tot)}</b></div><button class="btn primary pc-pay" data-ppay ${S.posCart.length && boot.canSell ? "" : "disabled"}>${icon("cash")} ${PT("pay")}</button></div>`;
    $("[data-pcart]", c).innerHTML = html;
    $("[data-pbar]", c).innerHTML = S.posCart.length ? `<button class="pcb-open" data-popen><span class="pcb-n">${n}</span><span class="grow">${PT("cart")} · ฿${fmt(tot)}</span></button><button class="btn primary" data-ppay>${PT("pay")}</button>` : "";
    $("[data-pbar]", c).classList.toggle("show", !!S.posCart.length);
    $$("[data-pdec]", c).forEach(b => { b.onclick = () => { const l = S.posCart[+b.dataset.pdec]; l.qty--; if (l.qty <= 0) S.posCart.splice(+b.dataset.pdec, 1); drawGrid(); drawCart(); pushDisplay(); }; });
    $$("[data-pinc]", c).forEach(b => { b.onclick = () => { const l = S.posCart[+b.dataset.pinc], m = boot.menu.find(x => x.id === l.menuId); if (m && left(m) === 0) return toast(PT("soldout"), "bad"); l.qty++; drawGrid(); drawCart(); pushDisplay(); }; });
    const cl = $("[data-pclear]", c); if (cl) cl.onclick = () => { S.posCart = []; drawGrid(); drawCart(); pushDisplay(); };
    $$("[data-ppay]", c).forEach(b => { b.onclick = () => posCheckout(boot, () => self.render(c)); });
    const op = $("[data-popen]", c); if (op) op.onclick = () => { $(".pos-cart", c).classList.add("open"); };
    $("[data-pcx]", c).onclick = () => $(".pos-cart", c).classList.remove("open");
  };
  $("[data-pcart]", c).addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });
  function posItemModal(m, lf) {
    let ti = 0, qty = 1; const aq = m.addons.map(() => 0);
    const types = m.types.length ? m.types : [{ name: "", price: m.price }];
    const md = openModal({ title: esc(posName(m)), body: `${posImg(m) ? `<div class="pm-img" style="background-image:url('${posImg(m)}')"></div>` : ""}
      ${types.length > 1 ? `<div class="pm-lbl">${PT("type")}</div><div class="pm-opts">${types.map((t, i) => `<button type="button" class="pm-opt ${i ? "" : "on"}" data-ti="${i}">${esc(t.name)}<b>฿${fmt(t.price).replace(/\.00$/, "")}</b></button>`).join("")}</div>` : ""}
      <div class="pm-lbl">${PT("qty")}${lf != null ? ` <span class="muted small">(${PT("left")} ${lf})</span>` : ""}</div><div class="pm-qty"><button type="button" data-qd>−</button><b data-qv>1</b><button type="button" data-qi>+</button></div>
      ${m.addons.length ? `<div class="pm-lbl">${PT("addons")}</div>${m.addons.map((a, i) => `<div class="pm-add"><span class="grow">${esc(a.name)} <span class="muted">+฿${fmt(a.price).replace(/\.00$/, "")}</span></span><div class="pm-qty sm"><button type="button" data-ad="${i}">−</button><b data-av="${i}">0</b><button type="button" data-ai="${i}">+</button></div></div>`).join("")}` : ""}
      <div class="pm-lbl">${PT("note")}</div><input class="input" data-pnote placeholder="${PT("notePh")}">`,
      foot: `<button class="btn primary pm-addbtn" data-padd>${icon("plus")} ${PT("add")} · <span data-plt></span></button>` });
    const el = md.el, upd = () => { $("[data-qv]", el).textContent = qty; aq.forEach((v, i) => { $(`[data-av="${i}"]`, el).textContent = v; }); $("[data-plt]", el).textContent = "฿" + fmt(types[ti].price * qty + m.addons.reduce((a, x, i) => a + x.price * aq[i], 0)); };
    $$("[data-ti]", el).forEach(b => { b.onclick = () => { ti = +b.dataset.ti; $$("[data-ti]", el).forEach(x => x.classList.toggle("on", x === b)); upd(); }; });
    $("[data-qd]", el).onclick = () => { qty = Math.max(1, qty - 1); upd(); }; $("[data-qi]", el).onclick = () => { if (lf != null && qty >= lf) return toast(PT("left") + " " + lf, "bad"); qty++; upd(); };
    $$("[data-ad]", el).forEach(b => { b.onclick = () => { aq[+b.dataset.ad] = Math.max(0, aq[+b.dataset.ad] - 1); upd(); }; }); $$("[data-ai]", el).forEach(b => { b.onclick = () => { aq[+b.dataset.ai]++; upd(); }; });
    $("[data-padd]", el).onclick = () => { posAdd({ menuId: m.id, name: m.name, names: m.names, type: types[ti].name, price: types[ti].price, qty, addons: m.addons.map((a, i) => ({ name: a.name, price: a.price, qty: aq[i] })).filter(a => a.qty), note: $("[data-pnote]", el).value.trim() }); md.close(); toast(PT("added")); };
    upd();
  }
  $("[data-pq]", c).oninput = debounce(e => { st.q = e.target.value; drawGrid(); }, 120);
  bindPosLang(c, () => self.render(c));
  drawCats(); drawGrid(); drawCart();
} };
/* ---------- ชำระเงิน ---------- */
function posCheckout(boot, after) {
  const sub = r2(S.posCart.reduce((a, l) => a + posLineTotal(l), 0));
  let method = boot.config.qrReady ? "qr" : "cash", disc = 0, slip = null, qrFor = null;
  const total = () => r2(Math.max(0, sub - disc));
  const others = boot.channels.filter(n => n !== boot.config.chQr && n !== boot.config.chCash);
  const m = openModal({ title: PT("pay") + " · ฿" + fmt(sub), size: "lg", body: `<div class="pay-modal">
      <div class="pay-total"><span>${PT("total")}</span><b data-ptot>฿${fmt(sub)}</b></div>
      <div class="pay-methods">${[["qr", "qr", PT("qr")], ["cash", "cash", PT("cash")], ["other", "wallet", PT("other")]].map(([k, ic, l]) => `<button type="button" data-pmeth="${k}" class="${k === method ? "on" : ""}">${icon(ic === "qr" ? "image" : ic)} ${l}</button>`).join("")}</div>
      <div data-ppanel></div>
      <details class="pay-more"><summary>${PT("discount")} / ${PT("note")}</summary><div class="grid g2" style="margin-top:8px"><label class="field"><span>${PT("discount")}</span><input class="input num" data-pdisc inputmode="decimal" placeholder="0"></label><label class="field"><span>${PT("note")}</span><input class="input" data-pnote2></label></div></details></div>`,
    foot: `<button class="btn" data-close>${icon("x")}</button><button class="btn primary pay-ok" data-pok>${icon("check")} ${PT("confirmPaid")}</button>` });
  const el = m.el;
  const oc = m.close; m.close = () => { oc(); bapi("POST", "/pos/display", { mode: "cart", amount: sub, items: S.posCart.map(l => ({ name: l.name, qty: l.qty, total: posLineTotal(l) })) }).catch(() => {}); };
  $$("[data-close],[data-x]", el).forEach(b => { b.onclick = () => m.close(); });
  const drawPanel = async () => {
    $("[data-ptot]", el).textContent = "฿" + fmt(total());
    $$("[data-pmeth]", el).forEach(b => b.classList.toggle("on", b.dataset.pmeth === method));
    const p = $("[data-ppanel]", el);
    if (method === "qr") {
      if (!boot.config.qrReady) { p.innerHTML = `<div class="info-box warn-box">${PT("noQr")}</div>`; return; }
      p.innerHTML = `<div class="pay-qr"><div class="pq-card"><div class="pq-head">THAI QR PAYMENT</div><div class="pq-box" data-pqbox><div class="muted">…</div></div><div class="pq-amt">฿${fmt(total())}</div><div class="small" style="opacity:.85">${PT("scan")}</div></div>
        <label class="btn sm" style="margin-top:10px">${icon("upload")} ${PT("slip")}<input type="file" accept="image/*" data-pslip hidden></label><div data-pslipv></div></div>`;
      if (qrFor !== total()) { try { const r = await bapi("POST", "/pos/qr", { amount: total() }); qrFor = total(); S._posQr = r.svg; } catch (e) { p.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; } }
      $("[data-pqbox]", el).innerHTML = S._posQr;
      $("[data-pslip]", el).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { slip = await resizeToDataUrl(f, 1400, .8); $("[data-pslipv]", el).innerHTML = `<img src="${slip}" class="pay-slip">`; } catch (er) { toast(er.message, "bad"); } };
    } else if (method === "cash") {
      const t = total(), quick = [...new Set([t, ...[20, 50, 100, 500, 1000].map(v => Math.ceil(t / v) * v)].filter(v => v >= t))].slice(0, 5);
      p.innerHTML = `<div class="pay-cash"><label class="field"><span>${PT("received")}</span><input class="input num big" data-pcash inputmode="decimal" placeholder="${fmt(t)}"></label>
        <div class="pay-quick">${quick.map(v => `<button type="button" data-pq="${v}">${v === t ? PT("exact") : "฿" + v.toLocaleString()}</button>`).join("")}</div>
        <div class="pay-change"><span>${PT("change")}</span><b data-pchg>฿0.00</b></div></div>`;
      const inp = $("[data-pcash]", el), upd = () => { const v = num(inp.value); const ch = inp.value === "" ? 0 : v - t; $("[data-pchg]", el).textContent = ch < 0 ? PT("notEnough") : "฿" + fmt(ch); $("[data-pchg]", el).classList.toggle("neg", ch < 0); };
      inp.oninput = upd; $$("[data-pq]", el).forEach(b => { b.onclick = () => { inp.value = b.dataset.pq; upd(); }; }); setTimeout(() => inp.focus(), 50);
      bapi("POST", "/pos/display", { mode: "cart", amount: t, items: S.posCart.map(l => ({ name: l.name, qty: l.qty, total: posLineTotal(l) })) }).catch(() => {});
    } else {
      p.innerHTML = `<label class="field"><span>${PT("channel")}</span><select class="input" data-pch>${(others.length ? others : boot.channels).map(n => opt(n)).join("")}</select></label>`;
    }
  };
  $$("[data-pmeth]", el).forEach(b => { b.onclick = () => { method = b.dataset.pmeth; drawPanel(); }; });
  $("[data-pdisc]", el).oninput = debounce(e => { disc = Math.min(sub, Math.max(0, num(e.target.value))); qrFor = null; drawPanel(); }, 350);
  drawPanel();
  const ok = $("[data-pok]", el); ok.onclick = () => withBtn(ok, async () => {
    const body = { items: S.posCart.map(l => ({ menuId: l.menuId, type: l.type, qty: l.qty, addons: l.addons, note: l.note })), discount: disc, payMethod: method, note: $("[data-pnote2]", el).value };
    if (method === "cash") { const v = $("[data-pcash]", el).value; if (v !== "") { if (num(v) < total()) throw new Error(PT("notEnough")); body.cashReceived = num(v); } }
    if (method === "qr") { if (!boot.config.qrReady) throw new Error(PT("noQr")); if (slip) body.slip = slip; }
    if (method === "other") body.payChannel = $("[data-pch]", el).value;
    const r = await bapi("POST", "/pos/orders", body);
    S.posCart = []; oc(); posDone(r.order, boot, after);
  }).catch(() => {});
}
function posDone(o, boot, after) {
  const m = openModal({ title: PT("paidOk"), body: `<div class="pos-done"><div class="pd-ic">✓</div><div class="muted">${PT("queue")}</div><div class="pd-q">${esc(o.queueNo)}</div>
      <div class="pd-amt">฿${fmt(o.total)} · ${esc(o.payChannel)}</div>${o.change != null ? `<div class="pd-chg">${PT("change")} <b>฿${fmt(o.change)}</b></div>` : ""}</div>`,
    foot: `<button class="btn" data-prc>${icon("print")} ${PT("print")}</button><button class="btn primary" data-pnew>${PT("newSale")}</button>` });
  $("[data-prc]", m.el).onclick = () => posReceipt(o, boot);
  $("[data-pnew]", m.el).onclick = () => { m.close(); bapi("POST", "/pos/display", { mode: "idle" }).catch(() => {}); after(); };
  const oc = m.close; m.close = () => { oc(); after(); };
}
function posReceipt(o, boot) {
  const shop = boot.config.shopName || S.binfo.branch.name, co = S.binfo.company || {};
  const d = new Date(o.createdAt);
  const html = `<div class="rc">${co.logo ? `<img src="${esc(co.logo)}" class="rc-logo">` : ""}<div class="rc-shop">${esc(shop)}</div>${S.binfo.branch.address ? `<div class="rc-s">${esc(S.binfo.branch.address)}</div>` : ""}${co.taxId ? `<div class="rc-s">เลขผู้เสียภาษี ${esc(co.taxId)}</div>` : ""}
    <div class="rc-q">คิว ${esc(o.queueNo)}</div><div class="rc-s">${thDate(o.date)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} · ${esc(o.createdBy)}</div><hr>
    ${o.items.map(i => `<div class="rc-row"><span>${i.qty}× ${esc(i.name)}${i.type ? " (" + esc(i.type) + ")" : ""}</span><span>${fmt(i.price * i.qty)}</span></div>${(i.addons || []).map(a => `<div class="rc-row rc-sub"><span>+ ${esc(a.name)} ×${a.qty}</span><span>${fmt(a.price * a.qty)}</span></div>`).join("")}${i.note ? `<div class="rc-sub">📝 ${esc(i.note)}</div>` : ""}`).join("")}<hr>
    ${o.discount ? `<div class="rc-row"><span>รวม</span><span>${fmt(o.subtotal)}</span></div><div class="rc-row"><span>ส่วนลด</span><span>-${fmt(o.discount)}</span></div>` : ""}
    <div class="rc-row rc-tot"><span>ยอดสุทธิ</span><span>${fmt(o.total)}</span></div><div class="rc-row"><span>${esc(o.payChannel)}</span><span>${o.cashReceived != null ? fmt(o.cashReceived) : fmt(o.total)}</span></div>${o.change != null ? `<div class="rc-row"><span>เงินทอน</span><span>${fmt(o.change)}</span></div>` : ""}
    ${o.refund ? `<div class="rc-row"><span>คืนเงิน</span><span>-${fmt(o.refund)}</span></div>` : ""}<hr><div class="rc-s" style="text-align:center">${esc(boot.config.receiptFooter || "")}</div></div>`;
  printHTML("ใบเสร็จ คิว " + o.queueNo, html, `@page{size:80mm auto;margin:3mm}body{font-size:12px}.rc{width:72mm;margin:0 auto}.rc-logo{display:block;margin:0 auto 4px;max-width:28mm;max-height:18mm}.rc-shop{text-align:center;font-weight:700;font-size:15px}.rc-s{text-align:center;color:#444;font-size:11px}.rc-q{text-align:center;font-size:26px;font-weight:800;margin:6px 0 2px}.rc-row{display:flex;justify-content:space-between;gap:8px;padding:1px 0}.rc-sub{font-size:11px;color:#444;padding-left:10px}.rc-tot{font-weight:800;font-size:15px}hr{border:0;border-top:1px dashed #999;margin:6px 0}`);
}

/* ---------- ออเดอร์ / คิว ---------- */
BRANCH_PAGES.posorders = { title: () => "ออเดอร์ / คิว", nav: "posorders", state: { tab: "paid", date: "" }, async render(c) {
  const st = this.state, self = this; posStopTimers();
  const boot = await posBoot();
  st.date = st.date || today();
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>${PT("orders")}</h2></div>${posLangBar()}</div>
    <div class="row wrap" style="margin-bottom:12px"><div class="seg" data-otab>${[["paid", PT("waiting")], ["prepared", PT("ready")], ["", PT("allDay")]].map(([k, l]) => `<button data-ot="${k}" class="${st.tab === k ? "on" : ""}">${l} <span data-on="${k}"></span></button>`).join("")}</div>
      <input type="date" class="input" style="width:auto" data-odate value="${st.date}"><span class="muted small grow" data-oupd></span></div>
    <div class="pos-orders" data-olist></div>`;
  const draw = async () => {
    let o; try { o = (await bapi("GET", "/pos/orders?from=" + st.date + "&to=" + st.date)).orders; } catch (e) { posStopTimers(); return; }
    if (!document.body.contains(c) || location.hash.indexOf("/posorders") < 0) { posStopTimers(); return; }
    const cnt = k => o.filter(x => !k || x.status === k).length;
    ["paid", "prepared", ""].forEach(k => { const e = $(`[data-on="${k}"]`, c); if (e) e.textContent = cnt(k) ? "(" + cnt(k) + ")" : ""; });
    const list = o.filter(x => !st.tab || x.status === st.tab).sort((a, b) => st.tab === "paid" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
    const ST = { paid: [PT("waiting"), "warn"], prepared: [PT("ready"), "good"], cancelled: [PT("cancelled"), "bad"], refunded: [PT("refunded"), "violet"] };
    $("[data-olist]", c).innerHTML = list.length ? list.map(x => { const d = new Date(x.createdAt);
      return `<div class="po-ord ${x.status}"><div class="pod-top"><div class="pod-q">${esc(x.queueNo)}</div><div class="grow"><span class="chip ${ST[x.status][1]}">${ST[x.status][0]}</span><div class="small muted">${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} · ${esc(x.createdBy)}</div></div><div class="pod-amt">฿${fmt(x.total)}<div class="small muted">${esc(x.payChannel)}</div></div></div>
        <div class="pod-items">${x.items.map(i => `<div><b>${i.qty}×</b> ${esc(posName(boot.menu.find(mm => mm.id === i.menuId) || i))}${i.type ? ` <span class="muted">(${esc(i.type)})</span>` : ""}${(i.addons || []).map(a => ` <span class="chip plain">+${esc(a.name)}×${a.qty}</span>`).join("")}${i.note ? `<div class="pod-note">📝 ${esc(i.note)}</div>` : ""}</div>`).join("")}${x.note ? `<div class="pod-note">📝 ${esc(x.note)}</div>` : ""}</div>
        ${x.refund ? `<div class="small neg">คืนเงิน ฿${fmt(x.refund)} — ${esc(x.cancelReason)}</div>` : ""}
        <div class="pod-acts">${x.status === "paid" && boot.canSell ? `<button class="btn primary" data-oprep="${x.id}">${icon("check")} ${PT("done")}</button>` : ""}${x.status === "prepared" && boot.canSell ? `<button class="btn sm ghost" data-ounprep="${x.id}">${PT("undo")}</button>` : ""}
          <button class="btn sm" data-oprint="${x.id}">${icon("print")}</button>${x.hasSlip ? `<button class="btn sm" data-oslip="${x.id}">${icon("image")} สลิป</button>` : ""}${["paid", "prepared", "refunded"].includes(x.status) && boot.canSell ? `<button class="btn sm ghost danger-t" data-ocancel="${x.id}">${PT("cancel")}</button>` : ""}</div></div>`; }).join("")
      : emptyBox(PT("noOrders"), "list");
    $("[data-oupd]", c).textContent = "อัปเดต " + new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const act = (id, path, okMsg) => withBtn($(`[data-${path}="${id}"]`, c) || document.createElement("button"), async () => { await bapi("POST", "/pos/orders/" + id + "/" + (path === "oprep" ? "prepared" : "unprepare")); toast(okMsg); draw(); }).catch(() => {});
    $$("[data-oprep]", c).forEach(b => { b.onclick = () => act(b.dataset.oprep, "oprep", PT("done") + " ✓"); });
    $$("[data-ounprep]", c).forEach(b => { b.onclick = () => act(b.dataset.ounprep, "ounprep", PT("undo")); });
    $$("[data-oprint]", c).forEach(b => { b.onclick = () => posReceipt(o.find(x => x.id === b.dataset.oprint), boot); });
    $$("[data-oslip]", c).forEach(b => { b.onclick = () => lightbox([{ url: authUrl("/pos/orders/" + b.dataset.oslip + "/slip"), name: "สลิป" }], 0); });
    $$("[data-ocancel]", c).forEach(b => { b.onclick = () => posCancelModal(o.find(x => x.id === b.dataset.ocancel), draw); });
  };
  $$("[data-ot]", c).forEach(b => { b.onclick = () => { st.tab = b.dataset.ot; $$("[data-ot]", c).forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
  $("[data-odate]", c).onchange = e => { st.date = e.target.value || today(); draw(); };
  bindPosLang(c, () => self.render(c));
  await draw();
  S.posTimer = setInterval(() => { if (!$(".modal-bg")) draw(); }, 8000);
} };
function posCancelModal(o, after) {
  const left = r2(o.total - (o.refund || 0));
  const m = openModal({ title: PT("cancel") + " · " + PT("queue") + " " + esc(o.queueNo), body: `<div class="seg" data-ck style="margin-bottom:12px"><button data-k="all" class="on">ยกเลิกทั้งบิล (คืน ฿${fmt(left)})</button><button data-k="part">คืนเงินบางส่วน</button></div>
      <label class="field" data-amtw hidden><span>ยอดคืน (ไม่เกิน ฿${fmt(left)})</span><input class="input num" data-camt inputmode="decimal"></label>
      <label class="field" style="margin-top:10px"><span>เหตุผล <em>*</em></span><input class="input" data-creason placeholder="เช่น ลูกค้ายกเลิก / ของหมด / ทำผิด"></label>
      <div class="info-box" style="margin-top:10px">รายรับรายวันในบัญชีจะปรับยอดให้อัตโนมัติ</div>`,
    foot: `<button class="btn" data-close>ปิด</button><button class="btn danger" data-ok>ยืนยัน</button>` });
  let k = "all";
  $$("[data-k]", m.el).forEach(b => { b.onclick = () => { k = b.dataset.k; $$("[data-k]", m.el).forEach(x => x.classList.toggle("on", x === b)); $("[data-amtw]", m.el).hidden = k !== "part"; }; });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => {
    const body = { reason: $("[data-creason]", m.el).value.trim() }; if (k === "part") body.amount = $("[data-camt]", m.el).value;
    await bapi("POST", "/pos/orders/" + o.id + "/cancel", body); m.close(); toast(PT("refundDone")); after();
  }).catch(() => {});
}
/* ---------- เมนู & ตั้งค่า POS (ผู้ดูแล POS) ---------- */
// อ่าน QR จากรูป: ย่อรูปเป็นขาวดำในเครื่อง แล้วให้เซิร์ฟเวอร์ถอดรหัส (ใช้ได้กับ Safari บน iPhone/iPad)
async function posLoadImage(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (e) {} }
  return await new Promise((ok, no) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("เปิดรูปนี้ไม่ได้ ลองแคปหน้าจอเป็นรูป PNG/JPG")); im.src = u; });
}
function posGray(img, max) {
  const W0 = img.width || img.naturalWidth, H0 = img.height || img.naturalHeight, k = Math.min(1, max / Math.max(W0, H0));
  const w = Math.max(1, Math.round(W0 * k)), h = Math.max(1, Math.round(H0 * k)), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  let bin = ""; for (let i = 0; i < g.length; i += 0x8000) bin += String.fromCharCode.apply(null, g.subarray(i, i + 0x8000));
  return { w, h, gray: btoa(bin) };
}
async function posReadQrImage(file) {
  const img = await posLoadImage(file); let lastErr = null;
  if ("BarcodeDetector" in window) { try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(img); if (r.length) return await bapi("POST", "/pos/qr-info", { text: r[0].rawValue }); } catch (e) {} }
  for (const max of [1200, 700, 1800]) {
    try { return await bapi("POST", "/pos/qr-decode", posGray(img, max)); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("อ่าน QR จากรูปนี้ไม่ได้");
}
BRANCH_PAGES.posmenu = { title: () => "เมนู & ตั้งค่า POS", nav: "posmenu", state: { tab: "menu" }, async render(c) {
  const st = this.state, self = this; const boot = await posBoot(true), ed = boot.canAdmin, cfg = boot.config;
  const rr = () => self.render(c);
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>เมนู & ตั้งค่า POS</h2><div class="muted small">ยอดขายจะเข้าเป็น “รายรับ” รายวันแยกตามช่องทางให้อัตโนมัติ</div></div>${ed && st.tab === "menu" ? `${S.adminToken ? `<button class="btn" data-mcopy>${icon("copy")} คัดลอกเมนูระหว่างสาขา</button>` : ""}<button class="btn primary" data-mnew>${icon("plus")} เพิ่มเมนู</button>` : ""}</div>
    <div class="tabs"><button data-mt="menu" class="${st.tab === "menu" ? "on" : ""}">เมนู (${boot.menu.length})</button><button data-mt="pay" class="${st.tab === "pay" ? "on" : ""}">รับเงิน & บัญชี</button><button data-mt="display" class="${st.tab === "display" ? "on" : ""}">จอลูกค้า</button><button data-mt="import" class="${st.tab === "import" ? "on" : ""}">นำเข้าจาก POS เดิม</button></div><div data-mb></div>`;
  $$("[data-mt]", c).forEach(b => { b.onclick = () => { st.tab = b.dataset.mt; rr(); }; });
  const body = $("[data-mb]", c);
  if (st.tab === "menu") {
    const cats = posCats(boot);
    body.innerHTML = boot.menu.length ? cats.map(cn => { const list = boot.menu.filter(m => (m.category || "อื่นๆ") === cn);
      return `<div class="q-gh">${esc(cn)} <span>${list.length}</span></div><div class="card pm-list">${list.map(m => `<div class="pm-row ${m.active ? "" : "off"}">${posImg(m) ? `<span class="pm-th" style="background-image:url('${posImg(m)}')"></span>` : `<span class="pm-th ph">${esc(m.name.slice(0, 2))}</span>`}
        <div class="grow" data-medit="${m.id}" style="cursor:pointer"><div class="bold">${esc(m.name)}${m.active ? "" : ` <span class="chip">ปิดอยู่</span>`}${m.soldout ? ` <span class="chip bad">หมด</span>` : ""}</div>
          <div class="small muted">฿${m.types.length ? m.types.map(t => esc(t.name) + " " + fmt(t.price).replace(/\.00$/, "")).join(" · ") : fmt(m.price)}${m.addons.length ? " · Add-on " + m.addons.length : ""}${m.dailyLimit != null ? ` · ขายวันนี้ ${m.soldToday}/${m.dailyLimit}` : m.soldToday ? ` · ขายวันนี้ ${m.soldToday}` : ""}</div></div>
        ${ed ? `<button class="btn sm ${m.soldout ? "primary" : ""}" data-msold="${m.id}">${m.soldout ? "เปิดขาย" : "หมด"}</button><div class="row" style="gap:0"><button class="btn ghost sm icon" data-mup="${m.id}">${icon("up")}</button><button class="btn ghost sm icon" data-mdn="${m.id}">${icon("down")}</button></div>` : ""}</div>`).join("")}</div>`; }).join("")
      : `<div class="empty-hero">${icon("stock")}<h3 style="margin:8px 0 4px">ยังไม่มีเมนู</h3><div>กด “เพิ่มเมนู”${S.adminToken ? ", “คัดลอกเมนูจากสาขาอื่น”" : ""} หรือแท็บ “นำเข้าจาก POS เดิม” เพื่อดึงเมนูทั้งหมดมาจากระบบเดิม</div>${ed && S.adminToken ? `<button class="btn primary" style="margin-top:12px" data-mcopy2>${icon("copy")} คัดลอกเมนูจากสาขาอื่น</button>` : ""}</div>`;
    if (!ed) return;
    $("[data-mnew]", c).onclick = () => posMenuModal(null, boot, rr);
    const mc = $("[data-mcopy]", c); if (mc) mc.onclick = () => posCopyMenuModal(boot.menu.length ? "from" : "to", rr);
    const mc2 = $("[data-mcopy2]", c); if (mc2) mc2.onclick = () => posCopyMenuModal("to", rr);
    $$("[data-medit]", c).forEach(b => { b.onclick = () => posMenuModal(boot.menu.find(m => m.id === b.dataset.medit), boot, rr); });
    $$("[data-msold]", c).forEach(b => { b.onclick = () => withBtn(b, async () => { const m = boot.menu.find(x => x.id === b.dataset.msold); await bapi("PUT", "/pos/menu/" + m.id, { soldout: !m.soldout }); rr(); }).catch(() => {}); });
    const move = async (id, d) => { const ids = boot.menu.map(m => m.id), i = ids.indexOf(id), j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await bapi("POST", "/pos/menu-order", { ids }); rr(); };
    $$("[data-mup]", c).forEach(b => { b.onclick = () => move(b.dataset.mup, -1); }); $$("[data-mdn]", c).forEach(b => { b.onclick = () => move(b.dataset.mdn, 1); });
  } else if (st.tab === "pay") {
    const incCats = listNames("income_category");
    body.innerHTML = `<div class="card"><div class="card-h"><h3>บัญชีรับเงิน QR</h3></div><div class="card-b">
      <div class="seg" data-qm style="margin-bottom:12px">${[["none", "ไม่ใช้ QR"], ["promptpay", "พร้อมเพย์ (เบอร์/เลขบัตร)"], ["merchant", "QR ร้านค้า (ถุงเงิน ฯลฯ)"]].map(([k, l]) => `<button data-q="${k}" class="${cfg.qrMode === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div data-qp="promptpay" ${cfg.qrMode === "promptpay" ? "" : "hidden"}><label class="field" style="max-width:360px"><span>เลขพร้อมเพย์</span><input class="input" data-ppid value="${esc(cfg.promptpayId)}" inputmode="numeric" placeholder="เบอร์มือถือ หรือ เลขประจำตัว 13 หลัก"></label>
        <label class="btn sm">${icon("upload")} อ่านเลขจากรูป QR พร้อมเพย์<input type="file" accept="image/*" data-mqimg2 hidden></label></div>
      <div data-qp="merchant" ${cfg.qrMode === "merchant" ? "" : "hidden"}>${cfg.merchantCode ? `<div class="info-box" style="margin-bottom:10px">ตั้งค่า QR ร้านค้าแล้ว · รหัสร้านค้า <b>${esc(cfg.merchantCode)}</b></div>` : ""}
        <div class="row wrap"><label class="btn primary">${icon("upload")} เลือกรูป QR ร้านค้า<input type="file" accept="image/*" data-mqimg hidden></label><span class="muted small">แคปหน้าจอ QR จากแอปธนาคาร/ถุงเงิน แล้วเลือกรูปนั้น (ใช้ได้ทั้ง iPhone/iPad)</span></div>
        <div data-mqinfo></div>
        <details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">ใส่ข้อความ QR เอง (ไม่จำเป็น)</summary><label class="field" style="margin-top:6px"><span>ข้อมูล QR ร้านค้า (ข้อความ)</span><textarea class="input" rows="2" data-mqtxt placeholder="000201010211...">${""}</textarea></label></details></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-qsave>${icon("check")} บันทึกบัญชีรับเงิน</button>${cfg.qrReady ? `<button class="btn" data-qtest>ทดสอบ QR ฿1</button>` : ""}</div></div></div>
      <div class="card"><div class="card-h"><h3>ลงบัญชีอัตโนมัติ</h3></div><div class="card-b"><label class="check"><input type="checkbox" data-auto ${cfg.autoIncome ? "checked" : ""}> สร้าง “รายรับ” จากยอดขายทุกวันให้อัตโนมัติ (1 เอกสารต่อวันต่อช่องทาง · ยกเลิก/คืนเงินแล้วยอดปรับเอง)</label>
        <div class="grid g3" style="margin-top:12px"><label class="field"><span>หมวดรายรับ</span><select class="input" data-icat>${opt("", "อัตโนมัติ (หมวดที่มีคำว่า ขาย/อาหาร)")}${incCats.map(n => opt(n, n, n === cfg.incomeCategory)).join("")}</select></label>
          <label class="field"><span>ช่องทางเมื่อจ่าย QR</span><select class="input" data-chq>${opt("", "อัตโนมัติ (โอน/พร้อมเพย์)")}${boot.channels.map(n => opt(n, n, n === cfg.chQr)).join("")}</select></label>
          <label class="field"><span>ช่องทางเมื่อจ่ายเงินสด</span><select class="input" data-chc>${opt("", "อัตโนมัติ (เงินสด)")}${boot.channels.map(n => opt(n, n, n === cfg.chCash)).join("")}</select></label></div>
        <div class="grid g2"><label class="field"><span>ชื่อร้านบนใบเสร็จ/จอลูกค้า</span><input class="input" data-shop value="${esc(cfg.shopName)}"></label><label class="field"><span>ข้อความท้ายใบเสร็จ</span><input class="input" data-foot value="${esc(cfg.receiptFooter)}"></label></div>
        <label class="field"><span>ลำดับหมวดเมนู (คั่นด้วย ,)</span><input class="input" data-mcats value="${esc((cfg.menuCats || []).join(", "))}" placeholder="เช่น ข้าวซอย, กับข้าว, เครื่องดื่ม"></label>
        <button class="btn primary" data-csave>${icon("check")} บันทึก</button></div></div>`;
    let mode = cfg.qrMode;
    $$("[data-q]", body).forEach(b => { b.onclick = () => { mode = b.dataset.q; $$("[data-q]", body).forEach(x => x.classList.toggle("on", x === b)); $$("[data-qp]", body).forEach(p => { p.hidden = p.dataset.qp !== mode; }); }; });
    const setMode = m => { mode = m; $$("[data-q]", body).forEach(x => x.classList.toggle("on", x.dataset.q === m)); $$("[data-qp]", body).forEach(p => { p.hidden = p.dataset.qp !== m; }); };
    const onQrImg = async e => { const f = e.target.files[0], lbl = e.target.closest("label"); e.target.value = ""; if (!f) return;
      lbl.classList.add("loading");
      try { const r = await posReadQrImage(f);
        if (r.kind === "merchant") { setMode("merchant"); $("[data-mqtxt]", body).value = r.text;
          $("[data-mqinfo]", body).innerHTML = `<div class="info-box ok" style="margin-top:10px">${icon("check")} อ่าน QR ร้านค้าได้แล้ว${r.name ? ` · <b>${esc(r.name)}</b>` : ""}${r.merchantCode ? ` · รหัสร้านค้า <b>${esc(r.merchantCode)}</b>` : ""}<br><span class="small">กด “บันทึกบัญชีรับเงิน” ด้านล่าง แล้วลอง “ทดสอบ QR ฿1” สแกนด้วยแอปธนาคารเพื่อตรวจชื่อร้าน</span></div>`;
          toast("อ่าน QR ร้านค้าแล้ว — กดบันทึก"); }
        else if (r.kind === "promptpay") { setMode("promptpay"); $("[data-ppid]", body).value = r.promptpayId; toast("รูปนี้เป็น QR พร้อมเพย์ส่วนตัว — ใส่เลข " + r.promptpayId + " ให้แล้ว กดบันทึก"); }
        else toast("อ่านได้ แต่ QR นี้ไม่ใช่ QR รับเงิน (Thai QR) — ลองใช้รูป QR รับเงินจากแอปธนาคาร", "bad");
      } catch (er) { toast(er.message, "bad"); } finally { lbl.classList.remove("loading"); } };
    $("[data-mqimg]", body).onchange = onQrImg; $("[data-mqimg2]", body).onchange = onQrImg;
    $("[data-qsave]", body).onclick = e => withBtn(e.currentTarget, async () => { const b2 = { qrMode: mode };
      if (mode === "promptpay") b2.promptpayId = $("[data-ppid]", body).value; if (mode === "merchant" && $("[data-mqtxt]", body).value.trim()) b2.merchantTemplate = $("[data-mqtxt]", body).value.trim();
      await bapi("PUT", "/pos/config", b2); toast("บันทึกบัญชีรับเงินแล้ว"); rr(); }).catch(() => {});
    const qt = $("[data-qtest]", body); if (qt) qt.onclick = async () => { const r = await bapi("POST", "/pos/qr", { amount: 1 }); openModal({ title: "ทดสอบ QR ฿1.00", body: `<div class="pq-box" style="max-width:280px;margin:0 auto">${r.svg}</div><div class="muted small" style="text-align:center;margin-top:8px">สแกนด้วยแอปธนาคาร ต้องขึ้นชื่อร้าน/บัญชีที่ถูกต้อง และยอด 1.00 บาท (ไม่ต้องโอนจริง)</div>`, foot: `<button class="btn primary" data-close>ปิด</button>` }); bapi("POST", "/pos/display", { mode: "idle" }).catch(() => {}); };
    $("[data-csave]", body).onclick = e => withBtn(e.currentTarget, async () => {
      await bapi("PUT", "/pos/config", { autoIncome: $("[data-auto]", body).checked, incomeCategory: $("[data-icat]", body).value, chQr: $("[data-chq]", body).value, chCash: $("[data-chc]", body).value,
        shopName: $("[data-shop]", body).value, receiptFooter: $("[data-foot]", body).value, menuCats: $("[data-mcats]", body).value.split(",").map(s => s.trim()).filter(Boolean) });
      toast("บันทึกแล้ว"); rr(); }).catch(() => {});
    if (!ed) $$("button,input,select,textarea", body).forEach(x => { x.disabled = true; });
  } else if (st.tab === "display") {
    const url = location.origin + location.pathname + "#/display/" + cfg.displayKey;
    body.innerHTML = `<div class="card"><div class="card-b"><h3 style="margin-top:0">จอลูกค้า / จอเรียกคิว</h3>
      <p class="muted">เปิดลิงก์นี้บนแท็บเล็ตหรือทีวีที่หันให้ลูกค้าเห็น (ไม่ต้องล็อกอิน) — แสดงรายการในตะกร้า, QR สำหรับจ่ายเงินตามยอด, เลขคิว และคิวที่ทำเสร็จแล้ว</p>
      <div class="disp-link"><input class="input" readonly value="${esc(url)}" data-durl><button class="btn" data-dcopy>${icon("copy")} คัดลอก</button><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("external")} เปิด</a></div>
      ${ed ? `<button class="btn sm ghost danger-t" data-dnew style="margin-top:12px">เปลี่ยนลิงก์ใหม่ (ลิงก์เดิมจะใช้ไม่ได้)</button>` : ""}</div></div>`;
    $("[data-dcopy]", body).onclick = async () => { try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว"); } catch (e) { $("[data-durl]", body).select(); } };
    const dn = $("[data-dnew]", body); if (dn) dn.onclick = async () => { if (!await confirmBox("เปลี่ยนลิงก์จอลูกค้า? จอที่เปิดลิงก์เดิมอยู่จะใช้ไม่ได้", { okText: "เปลี่ยน" })) return; await bapi("PUT", "/pos/config", { newDisplayKey: true }); rr(); };
  } else {
    body.innerHTML = `<div class="card"><div class="card-b"><h3 style="margin-top:0">นำเข้าจากระบบ POS เดิม</h3>
      <p class="muted">ใส่ลิงก์ของระบบ POS เดิม (ที่อยู่บน Railway) ระบบจะดึง <b>เมนูทั้งหมด พร้อมรูป แบบ/ขนาด Add-on</b> และ <b>บัญชี QR รับเงิน (QR ร้านค้า/พร้อมเพย์)</b> มาให้ — เมนูที่ชื่อซ้ำจะข้าม · ไม่ยุ่งกับข้อมูลในระบบเดิม</p>
      <div class="disp-link"><input class="input" data-iurl placeholder="เช่น pos-restaurant-production.up.railway.app"><button class="btn primary" data-igo ${ed ? "" : "disabled"}>${icon("download")} นำเข้า</button></div></div></div>`;
    $("[data-igo]", body).onclick = e => withBtn(e.currentTarget, async () => { const r = await bapi("POST", "/pos/import", { url: $("[data-iurl]", body).value });
      toast("นำเข้าเมนู " + r.added + " รายการ" + (r.skipped ? " (ข้ามชื่อซ้ำ " + r.skipped + ")" : "") + (r.qr ? " + " + r.qr : "")); st.tab = "menu"; rr(); }).catch(() => {});
  }
} };
function posMenuModal(m, boot, after) {
  const isNew = !m; m = m || { name: "", names: {}, category: "", price: "", types: [], addons: [], dailyLimit: null, soldout: false, active: true, imageV: 0 };
  const types = m.types.map(x => ({ ...x })), addons = m.addons.map(x => ({ ...x }));
  const cats = [...new Set(posCats(boot).concat(boot.config.menuCats || []))];
  const md = openModal({ title: isNew ? "เพิ่มเมนู" : "แก้ไขเมนู · " + esc(m.name), size: "lg", body: `<div class="grid g2">
      <label class="field"><span>ชื่อเมนู <em>*</em></span><input class="input" name="name" value="${esc(m.name)}" placeholder="เช่น ข้าวซอยไก่"></label>
      <label class="field"><span>หมวด</span><input class="input" name="category" value="${esc(m.category)}" list="pos-cats" placeholder="เช่น ข้าวซอย"><datalist id="pos-cats">${cats.map(n => opt(n)).join("")}</datalist></label>
      <label class="field"><span>ราคา (บาท) <em>*</em></span><input class="input num" name="price" inputmode="decimal" value="${m.price === "" ? "" : m.price}"><div class="field-hint">ถ้ามีหลายแบบ/ขนาด ใช้ราคาในตารางด้านล่าง</div></label>
      <label class="field"><span>จำนวนที่ขายได้ต่อวัน (ไม่บังคับ)</span><input class="input num" name="dailyLimit" inputmode="numeric" value="${m.dailyLimit == null ? "" : m.dailyLimit}" placeholder="ไม่จำกัด"></label></div>
    <div style="margin-top:12px">${photoBox(m.imageV ? posImg(m) : "", "รูปเมนู", false, 700)}</div>
    <div class="section-t" style="margin-top:16px">แบบ / ขนาด (ไม่บังคับ) <span class="muted small">เช่น ธรรมดา 60 · พิเศษ 80</span></div><div data-trows></div><button type="button" class="btn sm" data-tadd>${icon("plus")} เพิ่มแบบ</button>
    <div class="section-t" style="margin-top:16px">Add-on (ไม่บังคับ) <span class="muted small">เช่น ไข่ต้ม +10</span></div><div data-arows></div><button type="button" class="btn sm" data-aadd>${icon("plus")} เพิ่ม Add-on</button>
    <details style="margin-top:16px"><summary class="bold" style="cursor:pointer">ชื่อภาษาอื่น (ให้พนักงาน/ลูกค้าต่างชาติอ่าน)</summary><div class="grid g3" style="margin-top:8px">
      <label class="field"><span>English</span><input class="input" name="n_en" value="${esc(m.names.en || "")}"></label><label class="field"><span>မြန်မာ</span><input class="input" name="n_my" value="${esc(m.names.my || "")}"></label><label class="field"><span>ລາວ</span><input class="input" name="n_lo" value="${esc(m.names.lo || "")}"></label></div></details>
    <div class="row wrap" style="margin-top:14px"><label class="check"><input type="checkbox" name="active" ${m.active ? "checked" : ""}> เปิดขาย (แสดงในหน้าขาย)</label><label class="check"><input type="checkbox" name="soldout" ${m.soldout ? "checked" : ""}> หมดชั่วคราว</label></div>`,
    foot: `${isNew ? "" : `<div class="left"><button class="btn danger" data-mdel>${icon("trash")} ลบ</button><button class="btn" data-mdup>${icon("copy")} ทำสำเนา</button></div>`}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-msave>${icon("check")} บันทึก</button>` });
  const el = md.el, getImg = bindPhotoBox(el);
  const rows = (arr, sel, ph) => { const w = $(sel, el); w.innerHTML = arr.map((x, i) => `<div class="u-row"><input class="input sm" data-n="${i}" value="${esc(x.name)}" placeholder="${ph}"><span>฿</span><input class="input sm num" data-p="${i}" value="${x.price}" inputmode="decimal"><button type="button" class="btn ghost sm icon" data-r="${i}">${icon("trash")}</button></div>`).join("");
    $$("[data-n]", w).forEach(x => { x.oninput = () => { arr[+x.dataset.n].name = x.value; }; }); $$("[data-p]", w).forEach(x => { x.oninput = () => { arr[+x.dataset.p].price = x.value; }; });
    $$("[data-r]", w).forEach(x => { x.onclick = () => { arr.splice(+x.dataset.r, 1); rows(arr, sel, ph); }; }); };
  rows(types, "[data-trows]", "เช่น พิเศษ"); rows(addons, "[data-arows]", "เช่น ไข่ต้ม");
  $("[data-tadd]", el).onclick = () => { types.push({ name: types.length ? "" : "ธรรมดา", price: $("[name=price]", el).value || "" }); rows(types, "[data-trows]", "เช่น พิเศษ"); };
  $("[data-aadd]", el).onclick = () => { addons.push({ name: "", price: "" }); rows(addons, "[data-arows]", "เช่น ไข่ต้ม"); };
  const sv = $("[data-msave]", el); sv.onclick = () => withBtn(sv, async () => { const f = formData(el);
    const b = { name: f.name, category: f.category, price: types.length && f.price === "" ? Math.min(...types.map(t => num(t.price))) : f.price, dailyLimit: f.dailyLimit, active: $("[name=active]", el).checked, soldout: $("[name=soldout]", el).checked,
      types: types.filter(t => String(t.name).trim()).map(t => ({ name: t.name, price: num(t.price) })), addons: addons.filter(t => String(t.name).trim()).map(t => ({ name: t.name, price: num(t.price) })), names: { en: f.n_en, my: f.n_my, lo: f.n_lo } };
    const im = getImg(); if (im !== undefined) b.image = im;
    if (isNew) await bapi("POST", "/pos/menu", b); else await bapi("PUT", "/pos/menu/" + m.id, b);
    md.close(); toast("บันทึกเมนูแล้ว"); after(); }).catch(() => {});
  const du = $("[data-mdup]", el); if (du) du.onclick = () => withBtn(du, async () => { const r = await bapi("POST", "/pos/menu/" + m.id + "/duplicate"); md.close(); toast("ทำสำเนาแล้ว — แก้ชื่อ/ราคาได้เลย"); await after();
    const nb = await bapi("GET", "/pos/boot"), nm = nb.menu.find(x => x.id === r.id); if (nm) posMenuModal(nm, nb, after); }).catch(() => {});
  const dl = $("[data-mdel]", el); if (dl) dl.onclick = async () => { if (!await confirmBox("ลบเมนู “" + esc(m.name) + "”? (ออเดอร์เก่ายังอยู่)", { danger: true, okText: "ลบ" })) return; await bapi("DELETE", "/pos/menu/" + m.id); md.close(); toast("ลบแล้ว"); after(); };
}
// ผู้ดูแล: คัดลอกเมนูระหว่างสาขา — dir "from" = จากสาขานี้ไปสาขาอื่น, "to" = ดึงจากสาขาอื่นมาสาขานี้
async function posCopyMenuModal(dir, after) {
  const [br, cnt] = await Promise.all([api("GET", "/api/admin/branches"), api("GET", "/api/admin/pos/menus")]);
  const all = br.branches.filter(b => b.active !== false), here = all.find(b => b.id === S.bid) || { id: S.bid, businessId: S.biz };
  const others = all.filter(b => b.id !== S.bid).sort((a, b) => (a.businessId === here.businessId ? 0 : 1) - (b.businessId === here.businessId ? 0 : 1));
  const st = { dir, src: dir === "from" ? S.bid : ((others.find(b => cnt.counts[b.id]) || {}).id || ""), to: new Set(dir === "to" ? [S.bid] : []), menu: [], pick: new Set() };
  const bname = b => esc(b.name) + (b.businessId && b.businessId !== here.businessId ? ` <span class="chip">ธุรกิจอื่น</span>` : "") + (b.posEnabled ? "" : ` <span class="chip">ยังไม่เปิด POS</span>`);
  const md = openModal({ title: "คัดลอกเมนู POS ระหว่างสาขา", size: "lg", body: `<div class="seg" data-cdir style="margin-bottom:12px"><button data-d="to">ดึงเมนูจากสาขาอื่น มาสาขานี้</button><button data-d="from">ส่งเมนูของสาขานี้ ไปสาขาอื่น</button></div><div data-cb></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-cgo>${icon("copy")} คัดลอก</button>` });
  const el = md.el, cb = $("[data-cb]", el);
  const loadMenu = async () => { st.menu = st.src ? (await api("GET", "/api/admin/pos/menus?branch=" + encodeURIComponent(st.src))).menu : []; st.pick = new Set(st.menu.map(m => m.id)); };
  const draw = () => {
    $$("[data-d]", el).forEach(b => b.classList.toggle("on", b.dataset.d === st.dir));
    const cats = [...new Set(st.menu.map(m => m.category || "อื่นๆ"))];
    cb.innerHTML = (st.dir === "to"
      ? `<label class="field"><span>คัดลอกจากสาขา</span><select class="input" data-csrc>${opt("", "— เลือกสาขา —")}${others.map(b => opt(b.id, b.name + " (" + (cnt.counts[b.id] || 0) + " เมนู)", b.id === st.src)).join("")}</select></label>`
      : `<div class="section-t">ส่งไปสาขา</div><div class="card pm-list">${others.map(b => `<label class="check pm-row" style="margin:0"><input type="checkbox" data-cto="${b.id}" ${st.to.has(b.id) ? "checked" : ""}> <span class="grow">${bname(b)}</span><span class="muted small">${cnt.counts[b.id] || 0} เมนู</span></label>`).join("") || `<div class="muted" style="padding:12px">ยังไม่มีสาขาอื่น</div>`}</div>`)
      + (st.menu.length ? `<div class="row" style="margin-top:14px"><div class="section-t grow" style="margin:0">เลือกเมนู <span class="muted small">${st.pick.size}/${st.menu.length}</span></div><button class="btn ghost sm" data-call>เลือกทั้งหมด</button><button class="btn ghost sm" data-cnone>ไม่เลือก</button></div>
        <div style="max-height:44vh;overflow:auto">${cats.map(cn => `<div class="q-gh">${esc(cn)}</div><div class="card pm-list">${st.menu.filter(m => (m.category || "อื่นๆ") === cn).map(m => `<label class="check pm-row" style="margin:0"><input type="checkbox" data-cm="${m.id}" ${st.pick.has(m.id) ? "checked" : ""}> <span class="grow">${esc(m.name)}${m.active ? "" : ` <span class="chip">ปิดอยู่</span>`}</span><span class="muted small">฿${fmt(m.price).replace(/\.00$/, "")}</span></label>`).join("")}</div>`).join("")}</div>`
        : st.src ? `<div class="muted" style="margin-top:12px">สาขานี้ยังไม่มีเมนู</div>` : "")
      + `<div class="section-t" style="margin-top:14px">ถ้าสาขาปลายทางมีเมนูชื่อเดียวกันอยู่แล้ว</div>
        <div class="row wrap"><label class="check"><input type="radio" name="cmode" value="skip" checked> ข้าม (ไม่แตะเมนูเดิม)</label><label class="check"><input type="radio" name="cmode" value="update"> อัปเดตราคา/แบบ/Add-on ให้เหมือนต้นทาง</label></div>
        <label class="check" style="margin-top:6px"><input type="checkbox" data-cimg checked> คัดลอกรูปเมนูด้วย</label>
        <div class="info-box" style="margin-top:10px">คัดลอกเฉพาะเมนู (ชื่อ ราคา หมวด แบบ/ขนาด Add-on รูป) — ไม่คัดลอกยอดขาย/ออเดอร์ และไม่แตะบัญชีรับเงิน QR</div>`;
    const sel = $("[data-csrc]", cb); if (sel) sel.onchange = async () => { st.src = sel.value; await loadMenu(); draw(); };
    $$("[data-cto]", cb).forEach(x => { x.onchange = () => { x.checked ? st.to.add(x.dataset.cto) : st.to.delete(x.dataset.cto); }; });
    $$("[data-cm]", cb).forEach(x => { x.onchange = () => { x.checked ? st.pick.add(x.dataset.cm) : st.pick.delete(x.dataset.cm); $(".section-t .muted", cb).textContent = st.pick.size + "/" + st.menu.length; }; });
    const ca = $("[data-call]", cb); if (ca) ca.onclick = () => { st.pick = new Set(st.menu.map(m => m.id)); draw(); };
    const cn = $("[data-cnone]", cb); if (cn) cn.onclick = () => { st.pick = new Set(); draw(); };
  };
  $$("[data-d]", el).forEach(b => { b.onclick = async () => { if (st.dir === b.dataset.d) return; st.dir = b.dataset.d;
    if (st.dir === "from") { st.src = S.bid; st.to = new Set(); } else { st.src = (others.find(x => cnt.counts[x.id]) || {}).id || ""; st.to = new Set([S.bid]); }
    await loadMenu(); draw(); }; });
  await loadMenu(); draw();
  const go = $("[data-cgo]", el); go.onclick = () => withBtn(go, async () => {
    if (!st.src) throw new Error("กรุณาเลือกสาขาต้นทาง"); if (!st.to.size) throw new Error("กรุณาเลือกสาขาปลายทาง"); if (!st.pick.size) throw new Error("กรุณาเลือกเมนูอย่างน้อย 1 รายการ");
    const r = await api("POST", "/api/admin/pos/copy-menu", { from: st.src, to: [...st.to], ids: [...st.pick], mode: ($("[name=cmode]:checked", el) || {}).value, images: $("[data-cimg]", el).checked });
    md.close();
    openModal({ title: "คัดลอกเมนูเรียบร้อย", body: `<table class="tbl"><thead><tr><th>สาขา</th><th class="num">เพิ่มใหม่</th><th class="num">อัปเดต</th><th class="num">ข้าม (ชื่อซ้ำ)</th></tr></thead><tbody>${r.result.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.added}</td><td class="num">${x.updated}</td><td class="num">${x.skipped}</td></tr>`).join("")}</tbody></table>
      ${r.result.some(x => !(all.find(b => b.id === x.branchId) || {}).posEnabled) ? `<div class="muted small" style="margin-top:8px">สาขาที่ยังไม่เปิด POS: เมนูถูกเก็บไว้แล้ว จะเห็นเมื่อเปิดใช้ POS ที่ Admin → จัดการสาขา</div>` : ""}`, foot: `<button class="btn primary" data-close>ตกลง</button>` });
    after();}).catch(() => {});
}
/* ---------- รายงานขาย ---------- */
BRANCH_PAGES.posreport = { title: () => "รายงานขาย POS", nav: "posreport", async render(c) {
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>รายงานขาย POS</h2><div class="muted small">ไม่นับบิลที่ยกเลิก · หักยอดคืนเงินแล้ว</div></div>${rangeBar()}</div><div data-rb><div class="muted">กำลังโหลด…</div></div>`;
  bindRange(c, () => BRANCH_PAGES.posreport.render(c));
  const r = await bapi("GET", "/pos/report?" + rq());
  $("[data-rb]", c).innerHTML = `<div class="kpis"><div class="card kpi"><div class="lbl"><i style="background:var(--income)"></i>ยอดขายสุทธิ</div><div class="val">${baht(r.net)}</div><div class="sub">ก่อนคืนเงิน ${baht(r.gross)}${r.refunds ? " · คืน " + baht(r.refunds) : ""}</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--primary)"></i>จำนวนบิล</div><div class="val">${r.bills.toLocaleString()}</div><div class="sub">เฉลี่ย ${baht(r.avgBill)} / บิล</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--bad)"></i>ยกเลิก</div><div class="val">${r.cancelled.bills}</div><div class="sub">${baht(r.cancelled.total)}</div></div></div>
    ${r.days.length > 1 ? `<div class="card"><div class="card-h"><h3>ยอดขายรายวัน</h3></div><div class="card-b"><div data-rch></div></div></div>` : ""}
    <div class="dash-grid even"><div class="card"><div class="card-h"><h3>เมนูขายดี</h3></div><div class="card-b"><table class="tbl"><thead><tr><th>เมนู</th><th class="num">จำนวน</th><th class="num">ยอดขาย</th></tr></thead><tbody>${r.menus.slice(0, 30).map(m => `<tr><td>${esc(m.name)}</td><td class="num">${m.qty}</td><td class="num">${fmt(m.total)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>ตามช่องทางรับเงิน</h3></div><div class="card-b">${hbars(r.channels, "#257de0")}</div><div class="card-h"><h3>ตามช่วงเวลา</h3></div><div class="card-b">${hbars(r.hours.map(h => ({ name: String(h.hour).padStart(2, "0") + ":00", total: h.total })), "#f47230")}</div></div></div>`;
  const ch = $("[data-rch]", c); if (ch) barChart(ch, r.days.map(d => ({ ...d, key: d.date, income: d.total })), [{ k: "income", label: "ยอดขาย", color: "#257de0" }], d => thDate(d.key, true).replace(/\s\d+$/, ""), d => thDate(d.key));
} };
/* ---------- จอลูกค้า (ไม่ต้องล็อกอิน) ---------- */
async function renderDisplay(key) {
  const app = $("#app"); document.title = "จอลูกค้า";
  app.innerHTML = `<div class="disp" data-disp><div class="muted" style="margin:auto">กำลังเชื่อมต่อ…</div></div>`;
  let last = "";
  const tick = async () => {
    if (location.hash.indexOf("#/display/") !== 0) { clearInterval(S.dispTimer); S.dispTimer = null; return; }
    let d; try { d = await api("GET", "/api/pos-display/" + encodeURIComponent(key), null, { noRedirect: true }); } catch (e) { $("[data-disp]").innerHTML = `<div class="disp-err">${esc(e.message)}</div>`; return; }
    const sig = JSON.stringify([d.state, d.queue, d.shop]); if (sig === last) return; last = sig;
    const s = d.state, q = d.queue;
    const board = `<div class="disp-board"><div class="db-col ready"><div class="db-h">✅ เสร็จแล้ว รับได้เลย<br><small>Ready · ပြီးပါပြီ · ແລ້ວ</small></div><div class="db-nums">${q.ready.map(n => `<span>${esc(n)}</span>`).join("") || `<em>—</em>`}</div></div>
      <div class="db-col wait"><div class="db-h">⏳ กำลังทำ<br><small>Preparing · ချက်နေသည် · ກຳລັງເຮັດ</small></div><div class="db-nums">${q.waiting.map(n => `<span>${esc(n)}</span>`).join("") || `<em>—</em>`}</div></div></div>`;
    const head = `<div class="disp-head">${d.logo ? `<img src="${esc(d.logo)}">` : ""}<b>${esc(d.shop)}</b></div>`;
    let main;
    if (s.mode === "pay") main = `<div class="disp-pay"><div class="dp-t">สแกนเพื่อชำระเงิน · Scan to pay</div><div class="dp-qr">${s.svg}</div><div class="dp-amt">฿${fmt(s.amount)}</div></div>`;
    else if (s.mode === "cart") main = `<div class="disp-cart"><div class="dc-list">${s.items.map(i => `<div class="dc-row"><span>${i.qty}× ${esc(i.name)}</span><b>${fmt(i.total)}</b></div>`).join("")}</div><div class="dc-tot"><span>รวม Total</span><b>฿${fmt(s.amount)}</b></div></div>`;
    else if (s.mode === "done") main = `<div class="disp-done"><div>ขอบคุณค่ะ · Thank you</div><div class="dd-l">เลขคิวของคุณ · Your queue</div><div class="dd-q">${esc(s.queueNo)}</div>${s.change != null ? `<div class="dd-c">เงินทอน ฿${fmt(s.change)}</div>` : ""}</div>`;
    else main = "";
    $("[data-disp]").innerHTML = head + (main ? `<div class="disp-body"><div class="disp-main">${main}</div>${board}</div>` : `<div class="disp-body idle">${board}</div>`);
  };
  clearInterval(S.dispTimer); await tick(); S.dispTimer = setInterval(tick, 1500);
}
/* ===================== ธุรกิจ (v2.9) — แยกบัญชีธุรกิจอื่นที่ไม่เกี่ยวข้องกัน ===================== */
const curBiz = () => (S.bizList || []).find(z => z.id === S.biz) || (S.bizList || [])[0] || null;
const bizBranches = br => br.filter(b => !S.biz || !b.businessId || b.businessId === S.biz);
const bizLogo = (z, sz) => z && z.logo ? `<img class="biz-logo" src="${esc(z.logo)}" style="width:${sz}px;height:${sz}px" alt="">` : `<span class="biz-logo ini" style="width:${sz}px;height:${sz}px">${esc(initials(z ? z.name : ""))}</span>`;
ADMIN_PAGES.businesses = { title: "ธุรกิจ", async render(c) {
  const list = (await api("GET", "/api/admin/businesses")).businesses; S.bizList = list;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ธุรกิจ</h2><div class="muted small">แต่ละธุรกิจมีชื่อ โลโก้ หมวดหมู่ สาขา รายงาน แยกกันทั้งหมด ตัวเลขไม่ปนกัน — ใช้ทำบัญชีธุรกิจอื่นได้ (เช่น ร้านกาแฟ ร้านค้า บริการ)</div></div><button class="btn primary" data-new>${icon("plus")} เพิ่มธุรกิจ</button></div>
    <div class="biz-grid">${list.map(z => `<div class="card biz-card ${z.id === S.biz ? "on" : ""}"><div class="row">${bizLogo(z, 52)}<div class="grow"><div class="bold" style="font-size:16px">${esc(z.name)}</div><div class="muted small">${z.branchCount} สาขา${z.kind ? " · " + esc(z.kind) : ""}${z.taxId ? " · " + esc(z.taxId) : ""}</div></div></div>
      <div class="row wrap" style="margin-top:12px">${z.id === S.biz ? `<span class="chip good">กำลังใช้งาน</span>` : `<button class="btn sm primary" data-use="${z.id}">สลับมาธุรกิจนี้</button>`}<button class="btn sm" data-edit="${z.id}">${icon("edit")} แก้ไข</button>${!z.branchCount && list.length > 1 ? `<button class="btn sm ghost danger-t" data-del="${z.id}">ลบ</button>` : ""}</div></div>`).join("")}</div>`;
  const rr = () => ADMIN_PAGES.businesses.render(c);
  $("[data-new]", c).onclick = () => bizModal(null, rr);
  $$("[data-edit]", c).forEach(b => { b.onclick = () => bizModal(list.find(z => z.id === b.dataset.edit), rr); });
  $$("[data-use]", c).forEach(b => { b.onclick = () => { setBiz(b.dataset.use); render(); }; });
  $$("[data-del]", c).forEach(b => { b.onclick = async () => { const z = list.find(x => x.id === b.dataset.del); if (!await confirmBox("ลบธุรกิจ “" + esc(z.name) + "”?", { danger: true, okText: "ลบ" })) return;
    try { await api("DELETE", "/api/admin/businesses/" + z.id); toast("ลบแล้ว"); if (S.biz === z.id) setBiz(""); rr(); } catch (e) { toast(e.message, "bad"); } }; });
} };
function setBiz(id) { S.biz = id; try { localStorage.setItem("biz", id); } catch (e) {} }
function bizModal(z, after) {
  const isNew = !z; z = z || { name: "", kind: "", taxId: "", phone: "", address: "", logo: "" };
  const m = openModal({ title: isNew ? "เพิ่มธุรกิจใหม่" : "แก้ไขธุรกิจ · " + esc(z.name), body: `<div class="grid g2">
    <label class="field"><span>ชื่อธุรกิจ / บริษัท <em>*</em></span><input class="input" name="name" value="${esc(z.name)}" placeholder="เช่น ร้านกาแฟ ณ เหนือ"></label>
    <label class="field"><span>ประเภทธุรกิจ</span><input class="input" name="kind" value="${esc(z.kind)}" list="biz-kinds" placeholder="เช่น ร้านอาหาร"><datalist id="biz-kinds">${["ร้านอาหาร", "ร้านกาแฟ", "ร้านค้าปลีก", "บริการ", "ที่พัก", "อื่นๆ"].map(n => opt(n)).join("")}</datalist></label>
    <label class="field"><span>เลขประจำตัวผู้เสียภาษี</span><input class="input" name="taxId" value="${esc(z.taxId)}"></label><label class="field"><span>เบอร์โทร</span><input class="input" name="phone" value="${esc(z.phone)}"></label></div>
    <label class="field" style="margin-top:14px"><span>ที่อยู่ (แสดงบนเอกสาร)</span><textarea class="input" name="address" rows="2">${esc(z.address)}</textarea></label>
    <div style="margin-top:14px">${photoBox(z.logo || "", "โลโก้ธุรกิจ (แสดงบนหน้าแรกและเอกสาร)", false, 400)}</div>
    ${isNew ? `<div class="info-box" style="margin-top:14px">ธุรกิจใหม่จะเริ่มด้วยหมวดหมู่มาตรฐาน และไม่ใช้ข้อมูลร่วมกับธุรกิจอื่น · สร้างแล้วไปที่ “จัดการสาขา” เพื่อเพิ่มสาขาแรก</div>` : ""}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} ${isNew ? "สร้างธุรกิจ" : "บันทึก"}</button>` });
  const getLogo = bindPhotoBox(m.el), sv = $("[data-save]", m.el);
  sv.onclick = () => withBtn(sv, async () => { const f = formData(m.el); const lg = getLogo(); if (lg !== undefined) f.logo = lg;
    if (isNew) { const r = await api("POST", "/api/admin/businesses", f); setBiz(r.id); toast("สร้างธุรกิจแล้ว — เพิ่มสาขาแรกได้ที่ “จัดการสาขา”"); } else { await api("PUT", "/api/admin/businesses/" + z.id, f); toast("บันทึกแล้ว"); }
    S.info = null; m.close(); after(); }).catch(() => {});
}
ADMIN_PAGES.overview = { title: "ภาพรวมทุกสาขา", async render(c) {
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ภาพรวมทุกสาขา</h2><div class="muted small">เปรียบเทียบผลการดำเนินงานของแต่ละสาขา</div></div>${rangeBar()}</div><div data-body><div class="boot" style="height:300px"><div class="spinner"></div></div></div>`;
  bindRange(c, () => ADMIN_PAGES.overview.render(c));
  const o = await api("GET", "/api/admin/overview?" + rq() + "&biz=" + encodeURIComponent(S.biz || ""));
  const t = o.totals;
  $("[data-body]", c).innerHTML = !o.branches.length ? `<div class="empty-hero">${icon("building")}<h3 style="margin:8px 0 4px">ยังไม่มีสาขา</h3><div>สร้างสาขาแรก แล้วระบบจะสร้างบัญชี สต็อก และเงินเดือนแยกให้สาขานั้นอัตโนมัติ</div><div style="margin-top:16px"><a class="btn primary" href="#/admin/branches">${icon("plus")} สร้างสาขา</a></div></div>` : `
    <div class="kpis"><div class="card kpi"><div class="lbl"><i style="background:var(--income)"></i>รายรับรวมทุกสาขา</div><div class="val">${baht(t.income)}</div><div class="sub">${o.branches.length} สาขา</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--expense)"></i>รายจ่ายรวม</div><div class="val">${baht(t.expense)}</div><div class="sub">งบลงทุน ${baht(t.invest)}</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:${t.net >= 0 ? "var(--good)" : "var(--bad)"}"></i>กำไร (ขาดทุน) สุทธิ <span class="muted small">รวมสต็อก</span></div><div class="val ${t.net < 0 ? "neg" : ""}">${baht(t.net)}</div><div class="sub">รับ−จ่าย ${baht(t.cashNet)} · สต็อก ${t.stockAdj >= 0 ? "+" : ""}${baht(t.stockAdj)} · อัตรากำไร ${t.income ? Math.round(t.net / t.income * 1000) / 10 : 0}%</div></div>
      <div class="card kpi"><div class="lbl"><i style="background:var(--invest)"></i>มูลค่าสต็อกรวม</div><div class="val">${baht(t.stockValue)}</div><div class="sub">พนักงาน ${t.employees} คน</div></div></div>
    <div class="card" style="margin-bottom:14px"><div class="card-h"><h3 class="grow">เปรียบเทียบรายสาขา</h3><div class="legend"><span><i style="background:#257de0"></i>รายรับ</span><span><i style="background:#f47230"></i>รายจ่าย</span></div></div><div class="card-b" data-chart></div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>สาขา</th><th class="num">รายรับ</th><th class="num">รายจ่าย</th><th class="num">กำไรสุทธิ</th><th class="num">ค้างจ่าย</th><th class="num">มูลค่าสต็อก</th><th class="num">พนักงาน</th><th></th></tr></thead><tbody>
      ${o.branches.map(b => `<tr><td><div class="row">${bdotH(b, `width:30px;height:30px;font-size:11px;border-radius:8px;background:${esc(b.color)}`)}<div><div class="bold">${esc(b.name)}</div>${b.active ? "" : `<span class="chip">ปิดใช้งาน</span>`}${b.lowStock ? ` <span class="chip warn">สต็อกใกล้หมด ${b.lowStock}</span>` : ""}</div></div></td>
        <td class="num">${fmt(b.income)}</td><td class="num">${fmt(b.expense)}</td><td class="num bold ${b.net < 0 ? "neg" : ""}">${fmt(b.net)}</td><td class="num">${b.payable ? fmt(b.payable) : "-"}</td><td class="num">${fmt(b.stockValue)}</td><td class="num">${b.employees}</td>
        <td><button class="btn sm" data-open="${b.id}">เปิดบัญชีสาขา →</button></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>รวม</td><td class="num">${fmt(t.income)}</td><td class="num">${fmt(t.expense)}</td><td class="num">${fmt(t.net)}</td><td></td><td class="num">${fmt(t.stockValue)}</td><td class="num">${t.employees}</td><td></td></tr></tfoot></table></div></div>`;
  const ch = $("[data-chart]", c); if (ch) barChart(ch, o.branches, [{ k: "income", label: "รายรับ", color: "#257de0" }, { k: "expense", label: "รายจ่าย", color: "#f47230" }], d => d.code || d.name.replace(/^สาขา\s*/, "").slice(0, 10), d => d.name);
  $$("[data-open]", c).forEach(b => { b.onclick = () => openBranchAsAdmin(b.dataset.open); });
} };
const COLORS = ["#1f6feb", "#0f8a4a", "#f47230", "#6a4ce2", "#d92d20", "#0891b2", "#c2410c", "#be185d", "#4d7c0f", "#18212f"];
ADMIN_PAGES.branches = { title: "จัดการสาขา", async render(c) {
  const self = this;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>สาขาทั้งหมด</h2><div class="muted small">เมื่อสร้างสาขาใหม่ ระบบจะสร้างบัญชี สต็อก และระบบเงินเดือนของสาขานั้นแยกให้ทันที</div></div><button class="btn primary" data-new>${icon("plus")} สร้างสาขาใหม่</button></div><div class="card"><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  const br = bizBranches((await api("GET", "/api/admin/branches")).branches);
  $("[data-new]", c).onclick = () => branchModal(null, br, () => self.render(c));
  $("[data-tbl]", c).innerHTML = br.length ? `<table class="tbl"><thead><tr><th></th><th>สาขา</th><th>ติดต่อ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th>เปลี่ยนรหัสล่าสุด</th><th></th></tr></thead><tbody>
    ${br.map((b, i) => `<tr><td style="width:64px"><div class="row" style="gap:0"><button class="btn ghost sm icon" data-up="${i}" ${i ? "" : "disabled"}>${icon("up")}</button><button class="btn ghost sm icon" data-dn="${i}" ${i < br.length - 1 ? "" : "disabled"}>${icon("down")}</button></div></td>
      <td><div class="row">${bdotH(b, `width:34px;height:34px;font-size:12px;border-radius:9px;background:${esc(b.color)}`)}<div><div class="bold">${esc(b.name)}</div><div class="muted small">${esc(b.code)}${b.taxId ? " · เลขผู้เสียภาษี " + esc(b.taxId) : ""}</div></div></div></td>
      <td class="small">${esc(b.phone || "-")}<div class="muted desc" style="max-width:220px">${esc(b.address)}</div></td><td>${b.active ? `<span class="chip good">ใช้งาน</span>` : `<span class="chip">ปิดใช้งาน</span>`}</td>
      <td class="small">${thDateTime(b.lastLoginAt)}</td><td class="small">${thDateTime(b.passChangedAt)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-open="${b.id}">เปิดบัญชี</button> <button class="btn sm" data-edit="${b.id}">${icon("edit")} แก้ไข</button> <button class="btn sm" data-pw="${b.id}">${icon("key")} ตั้งรหัสใหม่</button> <button class="btn sm" data-ci="${b.id}">${icon("pin")} เช็คอิน${b.checkin.enabled ? ` <span class="chip good plain" style="padding:0 6px">เปิด</span>` : ""}</button></td></tr>`).join("")}</tbody></table>`
    : emptyBox("ยังไม่มีสาขา — กด “สร้างสาขาใหม่”", "building");
  const find = id => br.find(b => b.id === id);
  $$("[data-open]", c).forEach(b => { b.onclick = () => openBranchAsAdmin(b.dataset.open); });
  $$("[data-edit]", c).forEach(b => { b.onclick = () => branchModal(find(b.dataset.edit), br, () => self.render(c)); });
  $$("[data-ci]", c).forEach(b => { b.onclick = () => checkinConfigModal(find(b.dataset.ci), () => self.render(c)); });
  $$("[data-pw]", c).forEach(b => { b.onclick = () => { const x = find(b.dataset.pw);
    const m = openModal({ title: "ตั้งรหัสผ่านใหม่ · " + esc(x.name), body: `<div class="stack"><label class="field"><span>รหัสผ่านใหม่ของสาขา (อย่างน้อย 6 ตัว)</span>${pwInput("password", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่าน</span>${pwInput("confirm", "", "new-password")}</label><div class="warn-box">ทุกอุปกรณ์ที่เข้าสาขานี้อยู่จะถูกออกจากระบบทันที</div></div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึกรหัสใหม่</button>` });
    bindPwEyes(m.el);
    const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); if (f.password !== f.confirm) throw new Error("ยืนยันรหัสผ่านไม่ตรงกัน"); await api("POST", "/api/admin/branches/" + x.id + "/password", { password: f.password }); m.close(); toast("ตั้งรหัสผ่านใหม่ให้ " + x.name + " แล้ว"); self.render(c); }).catch(() => {}); }; });
  const order = async (i, d) => { const ids = br.map(x => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await api("POST", "/api/admin/branches/x/order", { ids }); self.render(c); };
  $$("[data-up]", c).forEach(b => { b.onclick = () => order(+b.dataset.up, -1); }); $$("[data-dn]", c).forEach(b => { b.onclick = () => order(+b.dataset.dn, 1); });
} };
function checkinConfigModal(b, after) {
  const k = b.checkin; const link = location.origin + location.pathname + "#/checkin/" + b.id;
  const m = openModal({ title: "ตั้งค่าเช็คอิน · " + esc(b.name), size: "lg", body: `<label class="check" style="margin-bottom:14px"><input type="checkbox" name="enabled" ${k.enabled ? "checked" : ""}> <b>เปิดระบบเช็คอินเข้า-ออกงานของสาขานี้</b></label>
    <div class="section-t">พิกัดร้าน</div><div class="grid g3"><label class="field"><span>ละติจูด (Latitude)</span><input class="input num" name="lat" value="${k.lat == null ? "" : k.lat}" inputmode="decimal" placeholder="เช่น 18.788343"></label>
      <label class="field"><span>ลองจิจูด (Longitude)</span><input class="input num" name="lng" value="${k.lng == null ? "" : k.lng}" inputmode="decimal" placeholder="เช่น 98.985300"></label>
      <div class="field" style="align-self:end"><button type="button" class="btn" style="width:100%" data-here>${icon("pin")} ใช้ตำแหน่งปัจจุบัน</button></div></div>
    <div class="field-hint" data-maplink style="margin-top:6px"></div><div class="field-hint">วิธีหาพิกัด: ยืนอยู่ที่ร้านแล้วกด “ใช้ตำแหน่งปัจจุบัน” หรือเปิด Google Maps → กดค้างที่ร้าน → คัดลอกตัวเลข 2 ชุด</div>
    <div class="section-t" style="margin-top:16px">กติกา</div><div class="grid g3"><label class="field"><span>ระยะห่างสูงสุดจากร้าน (เมตร)</span><input class="input num" name="radius" value="${k.radius}" inputmode="numeric"><div class="field-hint">แนะนำ 50–200 ม. (GPS มือถือคลาดเคลื่อนได้ 10–50 ม.)</div></label>
      <label class="field"><span>เวลาเข้างาน</span><input type="time" class="input" name="workStart" value="${esc(k.workStart)}"></label>
      <label class="field"><span>ผ่อนผันก่อนนับว่าสาย (นาที)</span><input class="input num" name="lateGrace" value="${k.lateGrace}" inputmode="numeric"></label></div>
    <div class="info-box" style="margin-top:16px">ลิงก์เช็คอินสำหรับพนักงาน (ส่งให้เปิดบนมือถือ หรือทำ QR ติดหน้าร้าน):<div style="margin-top:4px;word-break:break-all"><b>${esc(link)}</b></div><div class="small" style="margin-top:4px">พนักงานต้องมี PIN — ตั้งได้ที่เมนู “พนักงาน” ของสาขา</div></div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn" data-copy>${icon("copy")} คัดลอกลิงก์</button><button class="btn primary" data-ok>${icon("check")} บันทึก</button>` });
  const ml = () => { const f = formData(m.el); $("[data-maplink]", m.el).innerHTML = f.lat && f.lng ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(f.lat)},${encodeURIComponent(f.lng)}" target="_blank">${icon("pin", "").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} ตรวจตำแหน่งบน Google Maps</a>` : ""; };
  $$("[name=lat],[name=lng]", m.el).forEach(i => { i.oninput = ml; }); ml();
  $("[data-copy]", m.el).onclick = () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast("คัดลอกลิงก์แล้ว")); };
  const here = $("[data-here]", m.el); here.onclick = () => withBtn(here, () => new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error("เบราว์เซอร์นี้ไม่รองรับ GPS"));
    navigator.geolocation.getCurrentPosition(p => { $("[name=lat]", m.el).value = p.coords.latitude.toFixed(6); $("[name=lng]", m.el).value = p.coords.longitude.toFixed(6); ml(); toast("ได้ตำแหน่งแล้ว (คลาดเคลื่อน ±" + Math.round(p.coords.accuracy) + " ม.)"); res(); },
      e => rej(new Error(e.code === 1 ? "กรุณาอนุญาตให้เว็บนี้ใช้ตำแหน่ง" : "อ่านตำแหน่งไม่ได้")), { enableHighAccuracy: true, timeout: 15000 }); })).catch(() => {});
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { const f = formData(m.el); await api("PUT", "/api/admin/branches/" + b.id + "/checkin", f); m.close(); toast("บันทึกการตั้งค่าเช็คอินแล้ว"); after(); }).catch(() => {});
}
function branchModal(b, all, after) {
  const isNew = !b; b = b || { name: "", code: "", color: COLORS[all.length % COLORS.length], phone: "", taxId: "", address: "", active: true };
  const m = openModal({ title: isNew ? "สร้างสาขาใหม่" : "แก้ไขสาขา · " + esc(b.name), size: "lg", body: `<div class="grid g2">
    <label class="field"><span>ชื่อสาขา <em>*</em></span><input class="input" name="name" value="${esc(b.name)}" placeholder="เช่น สาขาสยาม"></label>
    <label class="field"><span>รหัสสาขา (ย่อ)</span><input class="input" name="code" value="${esc(b.code)}" maxlength="6" placeholder="เช่น SY, 01"></label>
    ${(S.bizList || []).length > 1 ? `<label class="field" style="grid-column:1/-1"><span>อยู่ในธุรกิจ</span><select class="input" name="businessId">${S.bizList.map(z => opt(z.id, z.name, z.id === (b.businessId || S.biz))).join("")}</select>${!isNew ? `<div class="field-hint">ย้ายธุรกิจ = ข้อมูลของสาขานี้ไปรวมในรายงานของธุรกิจใหม่</div>` : ""}</label>` : ""}
    <label class="field"><span>เบอร์โทร</span><input class="input" name="phone" value="${esc(b.phone)}"></label>
    <label class="field"><span>เลขประจำตัวผู้เสียภาษี (ถ้าแยกจากบริษัท)</span><input class="input" name="taxId" value="${esc(b.taxId)}"></label></div>
    <label class="field" style="margin-top:14px"><span>ที่อยู่</span><textarea class="input" name="address" rows="2">${esc(b.address)}</textarea></label>
    <div style="margin-top:14px">${photoBox(b.logo || "", "รูปโปรไฟล์ / โลโก้สาขา (แสดงแทนรหัสสาขา)", false, 320)}</div>
    <label class="check pos-toggle" style="margin-top:14px"><input type="checkbox" name="posEnabled" ${b.posEnabled ? "checked" : ""}> <span><b>เปิดใช้ระบบ POS ขายหน้าร้าน</b><br><span class="muted small">มีเมนูขายหน้าร้าน ออเดอร์/คิว จอลูกค้า · ยอดขายเข้ารายรับรายวันอัตโนมัติ</span></span></label>
    <div class="field" style="margin-top:14px"><span class="small" style="display:block;margin-bottom:6px;color:var(--text-2);font-weight:500">สีประจำสาขา</span><div class="color-pick">${COLORS.map(x => `<button type="button" data-color="${x}" class="${x === b.color ? "on" : ""}" style="background:${x}"></button>`).join("")}</div></div>
    ${isNew ? `<div class="section-t" style="margin-top:18px">รหัสผ่านเข้าสาขา</div><div class="grid g2"><label class="field"><span>รหัสผ่าน (อย่างน้อย 6 ตัว) <em>*</em></span>${pwInput("password", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่าน <em>*</em></span>${pwInput("confirm", "", "new-password")}</label></div>
      <label class="field" style="margin-top:14px"><span>หมวด / ช่องทาง / หน่วยนับเริ่มต้น</span><select class="input" name="copyFrom">${opt("", "ใช้ค่าเริ่มต้นของระบบ (ร้านอาหาร)", !all.length)}${all.map((x, i) => opt(x.id, "คัดลอกจาก " + x.name, i === 0)).join("")}</select></label>` : ""}
    ${!isNew ? `<div class="section-t" style="margin-top:18px">อันตราย</div><div class="row wrap"><button type="button" class="btn" data-toggle>${b.active ? "ปิดใช้งานสาขา (ซ่อนจากหน้าแรก)" : "เปิดใช้งานสาขาอีกครั้ง"}</button><button type="button" class="btn danger" data-delete>${icon("trash")} ลบสาขาและข้อมูลทั้งหมด</button></div>` : ""}`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} ${isNew ? "สร้างสาขา" : "บันทึก"}</button>` });
  bindPwEyes(m.el); const getLogo = bindPhotoBox(m.el);
  let color = b.color;
  $$("[data-color]", m.el).forEach(x => { x.onclick = () => { color = x.dataset.color; $$("[data-color]", m.el).forEach(y => y.classList.toggle("on", y === x)); }; });
  const sv = $("[data-save]", m.el);
  sv.onclick = () => withBtn(sv, async () => { const f = formData(m.el); f.color = color; f.posEnabled = $("[name=posEnabled]", m.el).checked; const lg = getLogo(); if (lg !== undefined) f.logo = lg;
    if (isNew) { if (f.password !== f.confirm) throw new Error("ยืนยันรหัสผ่านไม่ตรงกัน"); await api("POST", "/api/admin/branches", f); } else await api("PUT", "/api/admin/branches/" + b.id, f);
    m.close(); toast(isNew ? "สร้างสาขา " + f.name + " แล้ว" : "บันทึกแล้ว"); after(); }).catch(() => {});
  const tg = $("[data-toggle]", m.el); if (tg) tg.onclick = async () => { await api("PUT", "/api/admin/branches/" + b.id, { active: !b.active }); m.close(); toast("อัปเดตสถานะสาขาแล้ว"); after(); };
  const dl = $("[data-delete]", m.el); if (dl) dl.onclick = () => { m.close();
    const d = openModal({ title: "ลบสาขา " + esc(b.name), body: `<div class="err-box">การลบจะลบ <b>เอกสารบัญชี ไฟล์แนบ สต็อก พนักงาน และเงินเดือน</b> ทั้งหมดของสาขานี้ถาวร กู้คืนไม่ได้ (แนะนำให้ดาวน์โหลดไฟล์สำรองข้อมูลก่อน)</div>
      <div class="stack"><label class="field"><span>พิมพ์ชื่อสาขา “${esc(b.name)}” เพื่อยืนยัน</span><input class="input" name="confirmName"></label><label class="field"><span>รหัสผ่านผู้ดูแลของคุณ</span>${pwInput("adminPassword")}</label></div>`,
      foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn danger solid" data-ok>ลบถาวร</button>` });
    bindPwEyes(d.el);
    const ok = $("[data-ok]", d.el); ok.onclick = () => withBtn(ok, async () => { await api("DELETE", "/api/admin/branches/" + b.id, formData(d.el)); delete S.branchTokens[b.id]; saveBT(); d.close(); toast("ลบสาขาแล้ว"); after(); }).catch(() => {}); };
}
ADMIN_PAGES.lists = { title: "หมวด & ช่องทาง", state: { kind: "expense_category", bid: "" }, async render(c) {
  const br = bizBranches((await api("GET", "/api/admin/branches")).branches); const st = this.state;
  if (!br.length) { c.innerHTML = emptyBox("ธุรกิจนี้ยังไม่มีสาขา", "building"); return; }
  if (!br.some(b => b.id === st.bid)) st.bid = br[0].id;
  const synced = (await api("GET", "/api/admin/settings")).settings.lists_sync_all === "1";
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>หมวด & ช่องทาง</h2><div class="muted small">${synced ? "โหมด <b>ใช้ร่วมกันทุกสาขา (ในธุรกิจเดียวกัน)</b> — แก้ที่สาขาไหนก็มีผลทุกสาขา" : "โหมดแยกสาขา — แต่ละสาขาตั้งหมวดของตัวเอง"} · เปลี่ยนโหมดได้ที่ ตั้งค่าบริษัท & ระบบ</div></div>
    <label class="row"><span class="muted small">สาขา</span><select class="input" style="width:220px" data-bid>${br.map(b => opt(b.id, b.name, b.id === st.bid)).join("")}</select></label>
    ${br.length > 1 ? `<button class="btn" data-copystock>${icon("stock")} คัดลอกสินค้าสต็อก</button><button class="btn primary" data-copy>${icon("copy")} คัดลอกจากสาขาหนึ่งไปสาขาอื่น</button>` : ""}</div><div data-ed></div>`;
  $("[data-bid]", c).onchange = e => { st.bid = e.target.value; ADMIN_PAGES.lists.render(c); };
  if ($("[data-copy]", c)) $("[data-copy]", c).onclick = () => copyListsModal(br, st.bid, () => ADMIN_PAGES.lists.render(c));
  if ($("[data-copystock]", c)) $("[data-copystock]", c).onclick = () => copyStockModal(st.bid);
  await listsEditor($("[data-ed]", c), st.bid, S.adminToken, st);
} };
// คัดลอกหมวด / ช่องทาง / ผู้ขาย / หน่วย (และสินค้าสต็อก) จากสาขาต้นทาง ไปสาขาอื่น
/* Admin: คัดลอกสินค้าสต็อกที่เลือก ไปสาขาอื่น — คัดลอกเฉพาะรายละเอียด ไม่คัดลอกจำนวน (v2.6) */
async function copyStockModal(fromId, after, preIds) {
  let br; try { br = (await api("GET", "/api/admin/branches")).branches; } catch (e) { return toast(e.message, "bad"); }
  if (br.length < 2) return toast("มีสาขาเดียว ยังไม่มีสาขาให้คัดลอกไป", "bad");
  if (!br.some(b => b.id === fromId)) fromId = br[0].id;
  let items = [], sel = new Set();
  const m = openModal({ title: "คัดลอกสินค้าสต็อกไปสาขาอื่น", size: "lg", body: `
    <div class="info-box" style="margin-bottom:12px">คัดลอกเฉพาะ <b>รายละเอียด</b> (ชื่อ รหัส หมวด หน่วย จุดสั่งซื้อ หมายเหตุ รูป) — <b>ไม่คัดลอกจำนวนคงเหลือและต้นทุน</b> สาขาปลายทางจะเริ่มที่ 0</div>
    <label class="field"><span>จากสาขา (ต้นทาง)</span><select class="input" name="from">${br.map(b => opt(b.id, b.name, b.id === fromId)).join("")}</select></label>
    <div class="section-t row" style="margin-top:14px"><span class="grow">เลือกสินค้า <span class="muted" data-cnt></span></span><button type="button" class="btn sm" data-all>เลือกทั้งหมด</button><button type="button" class="btn sm ghost" data-none>ล้าง</button></div>
    <div class="search" style="margin-bottom:8px;max-width:none">${icon("search", "")}<input class="input" data-q placeholder="ค้นหาสินค้า"></div>
    <div class="cs-list" data-list><div class="muted small">กำลังโหลด…</div></div>
    <div class="section-t" style="margin-top:14px">ไปยังสาขา (ปลายทาง)</div><div class="row wrap" data-tgs></div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="withPhoto" checked> คัดลอกรูปสินค้าด้วย</label>
    <label class="check" style="margin-top:6px"><input type="checkbox" name="updateExisting"> ถ้าสาขาปลายทางมีสินค้าชื่อเดียวกันแล้ว ให้อัปเดตรายละเอียดตามต้นทาง (จำนวนคงเหลือไม่เปลี่ยน)</label>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("copy")} คัดลอก</button>` });
  const el = m.el;
  const drawT = () => { const f = $("[name=from]", el).value; $("[data-tgs]", el).innerHTML = br.filter(b => b.id !== f).map(b => `<label class="check chip-check"><input type="checkbox" data-tg="${b.id}" ${br.length === 2 ? "checked" : ""}> ${esc(b.name)}</label>`).join(""); };
  const drawL = () => {
    const q = $("[data-q]", el).value.trim().toLowerCase();
    const show = items.filter(i => !q || (i.name + " " + i.sku + " " + i.category).toLowerCase().includes(q));
    const cats = [...new Set(show.map(i => i.category || NOCAT))];
    $("[data-list]", el).innerHTML = !items.length ? `<div class="muted small">สาขานี้ยังไม่มีสินค้าในสต็อก</div>` : !show.length ? `<div class="muted small">ไม่พบสินค้า</div>` :
      cats.map(cn => `<div class="cs-gh">${esc(cn)}</div>` + show.filter(i => (i.category || NOCAT) === cn).map(i => `<label class="cs-item ${i.active ? "" : "off"}"><input type="checkbox" data-it="${i.id}" ${sel.has(i.id) ? "checked" : ""}><span class="grow"><b>${esc(i.name)}</b> <span class="muted small">${esc(i.unit || "")}${i.sku ? " · " + esc(i.sku) : ""}${i.active ? "" : " · ปิดใช้งาน"}${i.hasPhoto ? " · มีรูป" : ""}</span></span></label>`).join("")).join("");
    $$("[data-it]", el).forEach(c => { c.onchange = () => { c.checked ? sel.add(c.dataset.it) : sel.delete(c.dataset.it); cnt(); }; });
    cnt();
  };
  const cnt = () => { $("[data-cnt]", el).textContent = `(เลือก ${sel.size} / ${items.length})`; };
  const load = async () => { sel = new Set(preIds || []); preIds = null; $("[data-list]", el).innerHTML = `<div class="muted small">กำลังโหลด…</div>`;
    try { items = (await api("GET", "/api/admin/stock/items?branch=" + encodeURIComponent($("[name=from]", el).value))).items; } catch (e) { items = []; toast(e.message, "bad"); } drawL(); };
  $("[name=from]", el).onchange = () => { drawT(); load(); };
  $("[data-q]", el).oninput = debounce(drawL, 150);
  $("[data-all]", el).onclick = () => { const q = $("[data-q]", el).value.trim().toLowerCase(); items.filter(i => i.active && (!q || (i.name + " " + i.sku + " " + i.category).toLowerCase().includes(q))).forEach(i => sel.add(i.id)); drawL(); };
  $("[data-none]", el).onclick = () => { sel.clear(); drawL(); };
  drawT(); load();
  const ok = $("[data-ok]", el); ok.onclick = () => withBtn(ok, async () => {
    const to = $$("[data-tg]", el).filter(x => x.checked).map(x => x.dataset.tg);
    if (!sel.size) throw new Error("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
    if (!to.length) throw new Error("กรุณาเลือกสาขาปลายทาง");
    const r = await api("POST", "/api/admin/stock/copy", { from: $("[name=from]", el).value, to, itemIds: [...sel], withPhoto: $("[name=withPhoto]", el).checked, updateExisting: $("[name=updateExisting]", el).checked });
    m.close();
    openModal({ title: `คัดลอก ${r.count} รายการจาก ${esc(r.from)} แล้ว`, body: `<table class="tbl"><thead><tr><th>สาขา</th><th class="num">เพิ่มใหม่</th><th class="num">อัปเดต</th><th class="num">ข้าม (มีอยู่แล้ว)</th></tr></thead><tbody>
      ${r.result.map(x => `<tr><td>${esc(x.branch)}</td><td class="num bold">${x.added}</td><td class="num">${x.updated}</td><td class="num muted">${x.skipped}</td></tr>`).join("")}</tbody></table>
      <div class="muted small" style="margin-top:10px">สินค้าที่เพิ่มใหม่มีจำนวนคงเหลือ 0 — สาขาปลายทางรับเข้า/ตรวจนับเองได้เลย</div>`, foot: `<button class="btn primary" data-close>ตกลง</button>` });
    if (after) after();
  }).catch(() => {});
}
function copyListsModal(br, fromId, after) {
  const m = openModal({ title: "คัดลอกหมวด & รายการ ระหว่างสาขา", size: "lg", body: `<div class="grid g2"><label class="field"><span>คัดลอกจากสาขา (ต้นทาง)</span><select class="input" name="from">${br.map(b => opt(b.id, b.name, b.id === fromId)).join("")}</select></label><div></div></div>
    <div class="section-t" style="margin-top:16px">ไปยังสาขา (ปลายทาง)</div><label class="check" style="margin-bottom:8px"><input type="checkbox" data-alltg> ทุกสาขา</label><div class="row wrap" data-tgs></div>
    <div class="section-t" style="margin-top:16px">คัดลอกอะไรบ้าง</div><div class="row wrap">${Object.keys(LIST_LABEL).map(k => `<label class="check chip-check"><input type="checkbox" data-kind="${k}" checked> ${LIST_LABEL[k]}</label>`).join("")}</div>
    <label class="check chip-check" style="margin-top:10px"><input type="checkbox" name="stockItems" checked> รายการสินค้าในสต็อก (ชื่อ รหัส หมวด หน่วย จุดสั่งซื้อ — <b>ไม่</b>คัดลอกจำนวนคงเหลือ)</label>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="removeExtra"> ลบรายการในสาขาปลายทางที่ไม่มีในสาขาต้นทาง (ให้เหมือนกันทุกอย่าง)</label>
    <div class="info-box" style="margin-top:14px">ระบบจะ <b>เพิ่ม</b> รายการที่สาขาปลายทางยังไม่มี และปรับลำดับ / เครดิต / กลุ่มในงบ ให้เหมือนต้นทาง · ไม่แตะเอกสาร ยอดเงิน ยอดยกมา หรือจำนวนสต็อกของสาขาปลายทาง · สินค้าที่ชื่อซ้ำจะข้าม</div>`,
    foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>${icon("copy")} คัดลอก</button>` });
  const drawT = () => { const f = $("[name=from]", m.el).value; $("[data-tgs]", m.el).innerHTML = br.filter(b => b.id !== f).map(b => `<label class="check chip-check"><input type="checkbox" data-tg="${b.id}" ${br.length === 2 ? "checked" : ""}> ${esc(b.name)}</label>`).join(""); };
  $("[name=from]", m.el).onchange = drawT; drawT();
  $("[data-alltg]", m.el).onchange = e => $$("[data-tg]", m.el).forEach(x => { x.checked = e.target.checked; });
  const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => {
    const to = $$("[data-tg]", m.el).filter(x => x.checked).map(x => x.dataset.tg), kinds = $$("[data-kind]", m.el).filter(x => x.checked).map(x => x.dataset.kind);
    if (!to.length) throw new Error("กรุณาเลือกสาขาปลายทาง");
    const removeExtra = $("[name=removeExtra]", m.el).checked;
    if (removeExtra && !await confirmBox("ยืนยันลบรายการในสาขาปลายทางที่ไม่มีในต้นทาง?\n(เอกสารเก่ายังเก็บชื่อเดิมไว้ ไม่หาย)", { danger: true, okText: "ยืนยัน" })) return;
    const r = await api("POST", "/api/admin/lists/copy", { from: $("[name=from]", m.el).value, to, kinds, stockItems: $("[name=stockItems]", m.el).checked, removeExtra });
    m.close();
    openModal({ title: "คัดลอกจาก " + esc(r.from) + " เรียบร้อย", body: `<table class="tbl"><thead><tr><th>สาขา</th><th class="num">เพิ่มใหม่</th><th class="num">ปรับให้ตรง</th><th class="num">ลบ</th><th class="num">สินค้าสต็อกใหม่</th></tr></thead><tbody>${r.result.map(x => `<tr><td class="bold">${esc(x.branch)}</td><td class="num">${x.added}</td><td class="num">${x.updated}</td><td class="num">${x.removed}</td><td class="num">${x.stockAdded}</td></tr>`).join("")}</tbody></table>`, foot: `<button class="btn primary" data-close>ตกลง</button>` });
    after();
  }).catch(() => {});
}
ADMIN_PAGES.settings = { title: "ตั้งค่าบริษัท & ระบบ", async render(c) {
  const s = (await api("GET", "/api/admin/settings")).settings;
  const bz = curBiz(); if (bz) Object.assign(s, { company_name: bz.name, company_tax_id: bz.taxId, company_phone: bz.phone, company_address: bz.address, company_logo: bz.logo });
  let logo = s.company_logo || "";
  const inp = (k, l, h, t) => `<label class="field"><span>${l}</span><input class="input ${t === "num" ? "num" : ""}" name="${k}" value="${esc(s[k])}" ${t === "num" ? 'inputmode="decimal"' : ""}>${h ? `<div class="field-hint">${h}</div>` : ""}</label>`;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ตั้งค่าบริษัท & ระบบ</h2></div><button class="btn primary" data-save>${icon("check")} บันทึกการตั้งค่า</button></div><form data-f class="stack" style="max-width:900px">
    <div class="card"><div class="card-h"><h3>ข้อมูลบริษัท / ร้าน${(S.bizList || []).length > 1 ? ` <span class="chip blue">ธุรกิจ: ${esc(bz.name)}</span>` : ""}</h3></div><div class="card-b"><div class="row" style="gap:16px;align-items:flex-start;margin-bottom:14px"><div class="brand-logo" style="width:64px;height:64px;font-size:22px" data-logo>${logo ? `<img src="${esc(logo)}">` : esc(initials(s.company_name))}</div>
      <div><div class="bold">โลโก้</div><div class="muted small" style="margin-bottom:8px">แสดงบนหน้าแรก เอกสาร และสลิปเงินเดือน (ไม่เกิน 1MB)</div><div class="row"><button type="button" class="btn sm" data-up>อัปโหลดโลโก้</button><button type="button" class="btn sm ghost" data-rm>ลบโลโก้</button><input type="file" accept="image/*" hidden data-file></div></div></div>
      <div class="grid g2">${inp("company_name", "ชื่อบริษัท / ร้าน")}${inp("company_tax_id", "เลขประจำตัวผู้เสียภาษี")}${inp("company_phone", "เบอร์โทร")}</div><label class="field" style="margin-top:14px"><span>ที่อยู่</span><textarea class="input" name="company_address" rows="2">${esc(s.company_address)}</textarea></label></div></div>
    <div class="card"><div class="card-h"><h3>หมวด & ช่องทาง ของสาขา</h3></div><div class="card-b"><label class="field" style="max-width:520px"><span>การใช้หมวดหมู่ / ช่องทาง / ผู้ขาย / หน่วยนับ</span><select class="input" name="lists_sync_all">${opt("1", "ใช้ร่วมกันทุกสาขา (เพิ่ม/แก้/ลบ ที่ไหนก็มีผลทุกสาขา)", s.lists_sync_all === "1")}${opt("0", "แยกแต่ละสาขา", s.lists_sync_all !== "1")}</select>
      <div class="field-hint">เปิดใช้ร่วมกันแล้ว ถ้าสาขาเดิมมีหมวดไม่ตรงกัน ให้ไปที่ “หมวด & ช่องทาง” → “คัดลอกจากสาขาหนึ่งไปสาขาอื่น” หนึ่งครั้ง</div></label></div></div>
    <div class="card"><div class="card-h"><h3>เงินเดือน / ประกันสังคม</h3></div><div class="card-b"><div class="grid g3">${inp("sso_rate", "อัตราเงินสมทบ (%)", "", "num")}${inp("sso_min", "ฐานค่าจ้างต่ำสุด (บาท)", "", "num")}${inp("sso_max", "ฐานค่าจ้างสูงสุด (บาท)", "ปี 2569–2571 = 17,500 (หักสูงสุด 875 บาท)", "num")}</div></div></div>
    <div class="card"><div class="card-h"><h3>ความปลอดภัย</h3></div><div class="card-b"><div class="grid g2">${inp("admin_idle_min", "ออกจากระบบผู้ดูแลอัตโนมัติเมื่อไม่ใช้งาน (นาที)", "5–240 นาที · และต้องใส่ User/Password ใหม่ทุกครั้งที่เปิดหน้าผู้ดูแล", "num")}${inp("branch_idle_hours", "ออกจากระบบสาขาอัตโนมัติเมื่อไม่ใช้งาน (ชั่วโมง)", "1–168 ชั่วโมง", "num")}</div></div></div>
    <div class="card"><div class="card-h"><h3>เลขที่เอกสาร</h3></div><div class="card-b"><div class="grid g3">${inp("doc_prefix_income", "คำนำหน้ารายรับ", "เช่น RE2611-0001")}${inp("doc_prefix_expense", "คำนำหน้ารายจ่าย", "เช่น EX2611-0001")}${inp("doc_prefix_invest", "คำนำหน้าสินทรัพย์", "เช่น AS2611-0001")}</div><div class="field-hint" style="margin-top:8px">เลขรันใหม่ทุกเดือน แยกตามสาขา</div></div></div></form>`;
  $("[data-up]", c).onclick = () => $("[data-file]", c).click();
  $("[data-file]", c).onchange = async e => { const f = e.target.files[0]; if (!f) return; const x = await fileToB64(f, 512); logo = x.url.startsWith("data:") ? x.url : "data:" + x.mime + ";base64," + x.data; $("[data-logo]", c).innerHTML = `<img src="${logo}">`; };
  $("[data-rm]", c).onclick = () => { logo = ""; $("[data-logo]", c).textContent = initials(s.company_name); };
  const sv = $("[data-save]", c);
  sv.onclick = () => withBtn(sv, async () => { const f = formData($("[data-f]", c)); f.company_logo = logo;
    if (bz) await api("PUT", "/api/admin/businesses/" + bz.id, { name: f.company_name, taxId: f.company_tax_id, phone: f.company_phone, address: f.company_address, kind: bz.kind, logo });
    await api("PUT", "/api/admin/settings", f); S.info = null; toast("บันทึกการตั้งค่าแล้ว"); render(); }).catch(() => {});
} };
ADMIN_PAGES.admins = { title: "ผู้ดูแลระบบ", async render(c) {
  const self = this; const ad = (await api("GET", "/api/admin/admins")).admins;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ผู้ดูแลระบบ</h2><div class="muted small">ผู้ดูแลเข้าได้ทุกสาขาและตั้งค่าทุกอย่าง — ผู้ดูแลใหม่ต้องเปลี่ยนรหัสผ่านเมื่อเข้าครั้งแรก</div></div><button class="btn primary" data-new>${icon("plus")} เพิ่มผู้ดูแล</button></div>
    <div class="card"><table class="tbl"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>${ad.map(a => `<tr><td class="bold">${esc(a.username)} ${a.isMe ? `<span class="chip blue plain">คุณ</span>` : ""}</td><td>${esc(a.name)}</td>
      <td>${a.active ? (a.mustChange ? `<span class="chip warn">รอเปลี่ยนรหัส</span>` : `<span class="chip good">ใช้งาน</span>`) : `<span class="chip">ปิดใช้งาน</span>`}</td><td class="small">${thDateTime(a.lastLoginAt)}</td>
      <td style="white-space:nowrap">${a.isMe ? `<a class="btn sm" href="#/admin/account">เปลี่ยนรหัสของฉัน</a>` : `<button class="btn sm" data-reset="${a.id}">${icon("key")} รีเซ็ตรหัส</button> <button class="btn sm" data-tog="${a.id}">${a.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button> <button class="btn sm danger icon" data-del="${a.id}">${icon("trash")}</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  const find = id => ad.find(a => a.id === id);
  $("[data-new]", c).onclick = () => { const m = openModal({ title: "เพิ่มผู้ดูแลระบบ", body: `<div class="stack"><label class="field"><span>ชื่อผู้ใช้ (a-z, 0-9)</span><input class="input" name="username" autocapitalize="off"></label><label class="field"><span>ชื่อที่แสดง</span><input class="input" name="name"></label><label class="field"><span>รหัสผ่านชั่วคราว (อย่างน้อย 6 ตัว)</span>${pwInput("password", "", "new-password")}</label></div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>เพิ่ม</button>` });
    bindPwEyes(m.el); const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { await api("POST", "/api/admin/admins", formData(m.el)); m.close(); toast("เพิ่มผู้ดูแลแล้ว"); self.render(c); }).catch(() => {}); };
  $$("[data-reset]", c).forEach(b => { b.onclick = () => { const a = find(b.dataset.reset); const m = openModal({ title: "รีเซ็ตรหัส · " + esc(a.username), body: `<label class="field"><span>รหัสผ่านชั่วคราวใหม่</span>${pwInput("password", "", "new-password")}</label><div class="field-hint">ผู้ดูแลคนนี้ต้องเปลี่ยนรหัสเมื่อเข้าครั้งถัดไป</div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึก</button>` });
    bindPwEyes(m.el); const ok = $("[data-ok]", m.el); ok.onclick = () => withBtn(ok, async () => { await api("PUT", "/api/admin/admins/" + a.id, { password: $("[name=password]", m.el).value }); m.close(); toast("รีเซ็ตรหัสแล้ว"); self.render(c); }).catch(() => {}); }; });
  $$("[data-tog]", c).forEach(b => { b.onclick = async () => { const a = find(b.dataset.tog); try { await api("PUT", "/api/admin/admins/" + a.id, { active: !a.active }); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
  $$("[data-del]", c).forEach(b => { b.onclick = async () => { const a = find(b.dataset.del); if (!await confirmBox("ลบผู้ดูแล " + a.username + "?", { danger: true, okText: "ลบ" })) return; try { await api("DELETE", "/api/admin/admins/" + a.id); self.render(c); } catch (e) { toast(e.message, "bad"); } }; });
} };
ADMIN_PAGES.activity = { title: "Log การใช้งาน", state: { bid: "", actor: "", kind: "" }, async render(c) {
  const st = this.state; const br = (await api("GET", "/api/admin/branches")).branches;
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>Log การใช้งาน</h2><div class="muted small">ใคร · ทำอะไร · สาขาไหน · เมื่อไร · อย่างไร (IP / อุปกรณ์ / พิกัดตอนเช็คอิน) — รวมการใส่รหัสผิดและการพยายามเข้าสาขาหรือเมนูที่ไม่มีสิทธิ์</div></div>${rangeBar()}</div>
    <div class="card"><div class="toolbar"><select class="input" style="width:200px" data-bid><option value="">ทุกสาขา + ระบบ</option>${opt("_system", "เฉพาะระบบ / Admin", st.bid === "_system")}${br.map(b => opt(b.id, b.name, b.id === st.bid)).join("")}</select>
      <select class="input" style="width:230px" data-actor></select><select class="input" style="width:210px" data-kind>${opt("", "ทุกการกระทำ")}${opt("sec", "เฉพาะความปลอดภัย (รหัสผิด / ไม่มีสิทธิ์)", st.kind === "sec")}${opt("login", "เฉพาะการเข้าสู่ระบบ", st.kind === "login")}${opt("att", "เฉพาะเช็คอิน", st.kind === "att")}</select>
      <div class="grow"></div><button class="btn sm" data-csv>${icon("download")} CSV</button></div><div class="tbl-wrap" data-tbl><div class="boot" style="height:160px"><div class="spinner"></div></div></div></div>`;
  bindRange(c, () => ADMIN_PAGES.activity.render(c));
  $("[data-bid]", c).onchange = e => { st.bid = e.target.value; ADMIN_PAGES.activity.render(c); };
  const a = (await api("GET", "/api/admin/activity?limit=5000&" + rq() + (st.bid ? "&branchId=" + st.bid : ""))).activity;
  const actors = [...new Set(a.map(x => x.actor))].sort();
  if (st.actor && !actors.includes(st.actor)) st.actor = "";
  $("[data-actor]", c).innerHTML = opt("", "ผู้ใช้ทุกคน (" + actors.length + ")") + actors.map(x => opt(x, x, x === st.actor)).join("");
  const filt = () => a.filter(x => (!st.actor || x.actor === st.actor) && (!st.kind || (st.kind === "sec" ? /fail|denied/.test(x.action) : st.kind === "login" ? /^login/.test(x.action) : /^check/.test(x.action))));
  const draw = () => { $("[data-tbl]", c).innerHTML = activityTable(filt(), true); };
  $("[data-actor]", c).onchange = e => { st.actor = e.target.value; draw(); };
  $("[data-kind]", c).onchange = e => { st.kind = e.target.value; draw(); };
  $("[data-csv]", c).onclick = () => activityCsv("log-" + S.range.from + "_" + S.range.to + ".csv", filt());
  draw();
} };
const PERM_PRESETS = {
  owner: ["ผู้จัดการ / เจ้าของ (ทุกเมนู + อนุมัติทั้งหมด)", m => Object.fromEntries(m.map(x => [x.key, "edit"])), { s: 1, l: 1, a: 1 }],
  account: ["พนักงานบัญชี", () => ({ dashboard: "view", income: "edit", expense: "edit", invest: "edit", ledger: "view", accounts: "edit", statements: "view", cards: "edit", stock: "view", settings: "view" }), {}],
  stock: ["พนักงานร้าน (สต็อกอย่างเดียว)", () => ({ stock: "edit" }), {}],
  cashier: ["แคชเชียร์ / พนักงานหน้าร้าน (POS + เบิกของ)", () => ({ pos: "edit", stock: "edit" }), {}],
  lead: ["หัวหน้างาน (ลา/เบิก/ลงเวลา)", () => ({ stock: "edit", leave: "edit", advance: "edit", attendance: "edit", employees: "view" }), {}],
  viewer: ["ดูอย่างเดียว (ทุกเมนู)", m => Object.fromEntries(m.map(x => [x.key, "view"])), {}]
};
ADMIN_PAGES.users = { title: "ผู้ใช้งาน & สิทธิ์", async render(c) {
  const self = this;
  const [{ users, menus }, { branches }] = await Promise.all([api("GET", "/api/admin/users"), api("GET", "/api/admin/branches")]);
  const bname = id => (branches.find(b => b.id === id) || {}).name || "(สาขาถูกลบ)";
  const permSummary = u => { const e = menus.filter(m => u.perms[m.key] === "edit").length, v = menus.filter(m => u.perms[m.key] === "view").length;
    if (e === menus.length) return "ทุกเมนู (แก้ไขได้)"; const names = menus.filter(m => u.perms[m.key] !== "none").map(m => m.label + (u.perms[m.key] === "view" ? " (ดู)" : ""));
    return names.length > 4 ? names.slice(0, 4).join(", ") + ` +${names.length - 4}` : names.join(", ") || "-"; };
  c.innerHTML = `<div class="page-head"><div class="grow"><h2>ผู้ใช้งาน & สิทธิ์</h2><div class="muted small">สร้างบัญชีให้พนักงาน กำหนดสาขาที่เข้าได้ สิทธิ์แต่ละเมนู (ไม่เห็น / ดูอย่างเดียว / แก้ไขได้) และสิทธิ์อนุมัติ · ผู้ใช้ใหม่ต้องเปลี่ยนรหัสเมื่อเข้าครั้งแรก</div></div><button class="btn primary" data-new>${icon("plus")} เพิ่มผู้ใช้</button></div>
    <div class="card"><div class="tbl-wrap">${users.length ? `<table class="tbl"><thead><tr><th>ผู้ใช้</th><th>สาขาที่เข้าได้</th><th>สิทธิ์เมนู</th><th>อนุมัติ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>${users.map(u => `<tr class="click" data-id="${u.id}" style="${u.active ? "" : "opacity:.55"}">
      <td><div class="bold">${esc(u.name)}</div><div class="muted small">${esc(u.username)}</div></td><td class="small">${u.allBranches ? `<span class="chip blue plain">ทุกสาขา</span>` : u.branchIds.map(id => esc(bname(id))).join(", ")}</td>
      <td class="small" style="max-width:300px">${esc(permSummary(u))}</td><td class="small">${[u.approveStock && "สต็อก", u.approveLeave && "การลา", u.approveAdvance && "เบิกเงิน"].filter(Boolean).map(x => `<span class="chip good plain">${x}</span>`).join(" ") || "-"}</td>
      <td>${!u.active ? `<span class="chip">ปิดใช้งาน</span>` : u.mustChange ? `<span class="chip warn">รอเปลี่ยนรหัส</span>` : `<span class="chip good">ใช้งาน</span>`}</td><td class="small">${thDateTime(u.lastLoginAt)}</td><td>${icon("edit")}</td></tr>`).join("")}</tbody></table>`
      : emptyBox("ยังไม่มีผู้ใช้ — กด “เพิ่มผู้ใช้” เพื่อสร้างบัญชีให้พนักงาน", "userKey")}</div></div>
    <div class="info-box" style="margin-top:14px">รหัสผ่านสาขาเดิมยังใช้ได้ตามปกติ: ที่หน้าเข้าสาขา <b>เว้นชื่อผู้ใช้ว่าง</b> แล้วใส่รหัสสาขา = ผู้จัดการสาขา (สิทธิ์เต็มเฉพาะสาขานั้น)</div>`;
  $("[data-new]", c).onclick = () => userModal(null, menus, branches, () => self.render(c));
  $$("tr[data-id]", c).forEach(tr => { tr.onclick = () => userModal(users.find(u => u.id === tr.dataset.id), menus, branches, () => self.render(c)); });
} };
function userModal(u, menus, branches, after) {
  const isNew = !u; u = u || { username: "", name: "", allBranches: false, branchIds: branches.length === 1 ? [branches[0].id] : [], perms: {}, approveStock: false, approveLeave: false, approveAdvance: false, note: "", active: true };
  const perms = { ...u.perms };
  const lv = [["none", "ไม่เห็น"], ["view", "ดูอย่างเดียว"], ["edit", "แก้ไขได้"]];
  const m = openModal({ title: isNew ? "เพิ่มผู้ใช้งาน" : "แก้ไขผู้ใช้ · " + esc(u.username), size: "xl", sticky: true, body: `<div class="grid g3">
      <label class="field"><span>ชื่อผู้ใช้ (ใช้เข้าระบบ) <em>*</em></span><input class="input" name="username" value="${esc(u.username)}" autocapitalize="off" ${isNew ? "" : "readonly"} placeholder="เช่น somchai"></label>
      <label class="field"><span>ชื่อที่แสดง</span><input class="input" name="name" value="${esc(u.name)}" placeholder="เช่น สมชาย (ครัว)"></label>
      ${isNew ? `<label class="field"><span>รหัสผ่านชั่วคราว (อย่างน้อย 6 ตัว) <em>*</em></span>${pwInput("password", "", "new-password")}</label>` : `<div class="field" style="align-self:end"><button type="button" class="btn" style="width:100%" data-reset>${icon("key")} รีเซ็ตรหัสผ่าน</button></div>`}</div>
    <div class="section-t" style="margin-top:18px">ก) สาขาที่เข้าได้</div>
    <label class="check"><input type="checkbox" name="allBranches" ${u.allBranches ? "checked" : ""}> ทุกสาขา (รวมสาขาที่สร้างใหม่ในอนาคต)</label>
    <div class="row wrap" style="margin-top:8px" data-brs>${branches.map(b => `<label class="check chip-check"><input type="checkbox" data-br="${b.id}" ${u.branchIds.includes(b.id) ? "checked" : ""}> ${esc(b.name)}</label>`).join("")}</div>
    <div class="section-t" style="margin-top:18px">ข) สิทธิ์แต่ละเมนู</div>
    <div class="row wrap" style="margin-bottom:10px"><span class="muted small">ชุดสำเร็จรูป:</span>${Object.keys(PERM_PRESETS).map(k => `<button type="button" class="btn sm" data-preset="${k}">${PERM_PRESETS[k][0]}</button>`).join("")}</div>
    <div class="perm-grid" data-perms></div>
    <div class="section-t" style="margin-top:18px">ค) สิทธิ์อนุมัติ</div>
    <div class="row wrap"><label class="check chip-check"><input type="checkbox" name="approveStock" ${u.approveStock ? "checked" : ""}> อนุมัติสต็อก (รับเข้า/เบิก/ของเสีย/ตรวจนับ)</label><label class="check chip-check"><input type="checkbox" name="approveLeave" ${u.approveLeave ? "checked" : ""}> อนุมัติการลา</label><label class="check chip-check"><input type="checkbox" name="approveAdvance" ${u.approveAdvance ? "checked" : ""}> อนุมัติเบิกเงิน (และเลือกบัญชีจ่าย)</label></div>
    <div class="field-hint" style="margin-top:6px">คนที่ไม่มีสิทธิ์อนุมัติสต็อก เมื่อเพิ่ม/ลดสต็อก รายการจะ “รออนุมัติ” และยังไม่กระทบยอด · ผู้อนุมัติจะเห็นเมนู “รออนุมัติ” พร้อมตัวเลขแจ้งเตือน</div>
    <label class="field" style="margin-top:14px"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(u.note)}"></label>`,
    foot: `${isNew ? "" : `<div class="left"><button class="btn danger" data-del>${icon("trash")} ลบ</button><button class="btn" data-tog>${u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button></div>`}<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-save>${icon("check")} บันทึก</button>` });
  bindPwEyes(m.el);
  const drawPerms = () => { $("[data-perms]", m.el).innerHTML = menus.map(x => `<div class="perm-row"><div class="grow">${esc(x.label)}</div><div class="seg">${lv.map(([k, l]) => `<button type="button" data-pk="${x.key}" data-pv="${k}" class="${(perms[x.key] || "none") === k ? "on " + k : ""}">${l}</button>`).join("")}</div></div>`).join("");
    $$("[data-pk]", m.el).forEach(b => { b.onclick = () => { perms[b.dataset.pk] = b.dataset.pv; drawPerms(); }; }); };
  drawPerms();
  const allB = $("[name=allBranches]", m.el); const syncB = () => { $("[data-brs]", m.el).style.opacity = allB.checked ? ".45" : ""; $$("[data-br]", m.el).forEach(x => { x.disabled = allB.checked; }); }; allB.onchange = syncB; syncB();
  $$("[data-preset]", m.el).forEach(b => { b.onclick = () => { const p = PERM_PRESETS[b.dataset.preset]; Object.keys(perms).forEach(k => delete perms[k]); Object.assign(perms, p[1](menus));
    $("[name=approveStock]", m.el).checked = !!p[2].s; $("[name=approveLeave]", m.el).checked = !!p[2].l; $("[name=approveAdvance]", m.el).checked = !!p[2].a; drawPerms(); }; });
  const sv = $("[data-save]", m.el);
  sv.onclick = () => withBtn(sv, async () => { const f = formData(m.el);
    const body = { username: f.username.trim(), name: f.name, password: f.password, allBranches: !!f.allBranches, branchIds: $$("[data-br]", m.el).filter(x => x.checked).map(x => x.dataset.br),
      perms, approveStock: !!f.approveStock, approveLeave: !!f.approveLeave, approveAdvance: !!f.approveAdvance, note: f.note };
    if (isNew) await api("POST", "/api/admin/users", body); else { delete body.password; await api("PUT", "/api/admin/users/" + u.id, body); }
    toast(isNew ? "สร้างผู้ใช้ " + body.username + " แล้ว — แจ้งรหัสชั่วคราวให้พนักงาน" : "บันทึกแล้ว"); m.close(); after(); }).catch(() => {});
  const rs = $("[data-reset]", m.el); if (rs) rs.onclick = () => { const x = openModal({ title: "รีเซ็ตรหัส · " + esc(u.username), body: `<label class="field"><span>รหัสผ่านชั่วคราวใหม่</span>${pwInput("password", "", "new-password")}</label><div class="field-hint">ผู้ใช้จะถูกออกจากระบบ และต้องเปลี่ยนรหัสเมื่อเข้าครั้งถัดไป</div>`, foot: `<button class="btn" data-close>ยกเลิก</button><button class="btn primary" data-ok>บันทึก</button>` });
    bindPwEyes(x.el); const ok = $("[data-ok]", x.el); ok.onclick = () => withBtn(ok, async () => { await api("PUT", "/api/admin/users/" + u.id, { password: $("[name=password]", x.el).value }); x.close(); toast("รีเซ็ตรหัสแล้ว"); }).catch(() => {}); };
  const tg = $("[data-tog]", m.el); if (tg) tg.onclick = async () => { await api("PUT", "/api/admin/users/" + u.id, { active: !u.active }); m.close(); toast("อัปเดตสถานะแล้ว"); after(); };
  const dl = $("[data-del]", m.el); if (dl) dl.onclick = async () => { if (!await confirmBox("ลบผู้ใช้ " + u.username + "?\nประวัติใน Log ยังอยู่", { danger: true, okText: "ลบ" })) return; await api("DELETE", "/api/admin/users/" + u.id); m.close(); toast("ลบแล้ว"); after(); };
}
ADMIN_PAGES.backup = { title: "สำรองข้อมูล", async render(c) {
  c.innerHTML = `<div class="card" style="max-width:640px"><div class="card-h"><h3>สำรองข้อมูลทั้งระบบ</h3></div><div class="card-b stack"><p style="margin:0">ดาวน์โหลดข้อมูลทุกสาขา (เอกสารบัญชี สต็อก พนักงาน เงินเดือน การตั้งค่า) เป็นไฟล์ JSON เก็บไว้ในเครื่อง แนะนำให้ทำทุกสิ้นเดือน</p>
    <div class="info-box">Railway มีระบบ Backup ของฐานข้อมูล PostgreSQL ด้วย (แท็บ Backups ของตัวฐานข้อมูล) ใช้คู่กันจะปลอดภัยที่สุด</div>
    <div class="row wrap"><button class="btn primary" data-dl="0">${icon("download")} ดาวน์โหลด (ไม่รวมไฟล์แนบ)</button><button class="btn" data-dl="1">${icon("download")} ดาวน์โหลดรวมไฟล์แนบ (ไฟล์ใหญ่)</button></div></div></div>`;
  $$("[data-dl]", c).forEach(b => { b.onclick = () => withBtn(b, async () => { const r = await fetch("/api/admin/backup?files=" + b.dataset.dl, { headers: { Authorization: "Bearer " + S.adminToken } }); if (!r.ok) throw new Error("ดาวน์โหลดไม่สำเร็จ");
    const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "backup-" + today() + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("ดาวน์โหลดไฟล์สำรองแล้ว"); }).catch(() => {}); });
} };
ADMIN_PAGES.account = { title: "เปลี่ยนรหัสผ่านของฉัน", async render(c) {
  c.innerHTML = `<div class="card" style="max-width:480px"><div class="card-h"><h3>บัญชีผู้ดูแล: ${esc(S.admin.username)}</h3></div><form class="card-b stack" data-f>
    <label class="field"><span>ชื่อผู้ใช้ (User)</span><input class="input" name="newUsername" value="${esc(S.admin.username)}" autocapitalize="off"></label>
    <label class="field"><span>รหัสผ่านปัจจุบัน</span>${pwInput("oldPassword", "", "current-password")}</label><label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</span>${pwInput("newPassword", "", "new-password")}</label><label class="field"><span>ยืนยันรหัสผ่านใหม่</span>${pwInput("confirm", "", "new-password")}</label>
    <button class="btn primary">${icon("check")} บันทึก</button></form></div>`;
  bindPwEyes(c);
  $("[data-f]", c).onsubmit = e => { e.preventDefault(); const f = formData(c); if (f.newPassword !== f.confirm) return toast("ยืนยันรหัสผ่านไม่ตรงกัน", "bad");
    withBtn($("button.primary", c), async () => { const r = await api("POST", "/api/admin/change-password", f); S.admin.username = r.username; toast("บันทึกแล้ว"); renderAdmin("account"); }).catch(() => {}); };
} };

/* ===================== router ===================== */
let rendering = false, pending = false;
async function render() {
  if (rendering) { pending = true; return; } rendering = true;
  try {
    window.onbeforeunload = null; posStopTimers();
    $("#modal-root").innerHTML = "";
    const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
    // ออกจากหน้าผู้ดูแลเมื่อไหร่ ต้องใส่ User/Password ใหม่ทุกครั้ง
    const inAdmin = parts[0] === "admin" || (parts[0] === "b" && S.adminToken && S.adminBranch === parts[1]);
    if (S.adminToken && !inAdmin) await adminLogout(false);
    if (parts[0] === "admin") await renderAdmin(parts[1] || "overview", parts.slice(2));
    else if (parts[0] === "b" && parts[1]) await renderBranch(parts[1], parts[2] || "home", parts.slice(3));
    else if (parts[0] === "checkin" && parts[1]) await renderCheckin(parts[1]);
    else if (parts[0] === "display" && parts[1]) { await renderDisplay(parts[1]); return; }
    else { S.bid = null; S.binfo = null; await renderLanding(); }
    window.scrollTo(0, 0);
  } finally { rendering = false; if (pending) { pending = false; render(); } }
}
window.addEventListener("hashchange", render);
// ผู้ดูแลไม่ได้ใช้งานนานเกินกำหนด → ล็อกอัตโนมัติ (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
["click", "keydown"].forEach(ev => document.addEventListener(ev, () => { if (S.adminToken) S.adminLastAct = Date.now(); }, true));
setInterval(() => { if (S.adminToken && Date.now() - S.adminLastAct > (S.adminIdle || 30) * 60000) { adminLogout(false); toast("ออกจากระบบผู้ดูแลอัตโนมัติ (ไม่ได้ใช้งานนาน)", "bad"); go("#/admin"); } }, 30000);
render();
})();
