/*******************************************************
 * ระบบบัญชีร้านอาหาร (หลายสาขา) — Node.js + PostgreSQL
 * รันด้วย: npm install && npm start
 * ต้องการ ENV: DATABASE_URL (Railway สร้างให้อัตโนมัติเมื่อเพิ่ม PostgreSQL)
 * ไม่บังคับ: ADMIN_USER, ADMIN_PASS (ใช้ครั้งแรกครั้งเดียว — ระบบบังคับเปลี่ยนรหัสหลังเข้าครั้งแรก)
 * ไม่ใช้ express: ใช้ http ที่มากับ Node — ไลบรารีภายนอกมีแค่ pg ตัวเดียว
 *******************************************************/
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;
const BUILD_ID = "2.5.0";
const INIT_ADMIN_USER = String(process.env.ADMIN_USER || "admin").trim();
const INIT_ADMIN_PASS = String(process.env.ADMIN_PASS || "admin1234");
const PUBLIC_DIR = path.join(__dirname, "public");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && /railway|rlwy/.test(process.env.DATABASE_URL) && !/railway\.internal/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : (process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false)
});
pool.on("error", e => console.error("pg pool error:", e.message));

/* ================= helpers ================= */
const uid = () => crypto.randomUUID();
const now = () => Date.now();
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const r4 = x => Math.round((Number(x) || 0) * 10000) / 10000;
const num = (x, d = 0) => { const n = Number(x); return isFinite(n) ? n : d; };
const str = (x, max = 500) => String(x == null ? "" : x).trim().slice(0, max);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isPeriod = s => /^\d{4}-\d{2}$/.test(String(s || ""));
function todayBkk() { return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); }
function daysInMonth(period) { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function eachDay(from, to) {
  const out = []; let d = new Date(from + "T00:00:00Z"); const end = new Date(to + "T00:00:00Z");
  while (d <= end && out.length < 1200) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function eachMonth(from, to) {
  const out = []; let y = +from.slice(0, 4), m = +from.slice(5, 7); const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while ((y < ey || (y === ey && m <= em)) && out.length < 240) { out.push(y + "-" + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);

// รหัสผ่าน: เก็บเป็น scrypt hash + salt (ไม่เก็บรหัสจริง ใครเปิดฐานข้อมูลก็อ่านรหัสไม่ได้)
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return "s1$" + salt.toString("hex") + "$" + h.toString("hex");
}
function verifyPw(pw, stored) {
  try {
    const [v, saltHex, hashHex] = String(stored || "").split("$");
    if (v !== "s1") return false;
    const h = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(hashHex, "hex");
    return want.length === h.length && crypto.timingSafeEqual(h, want);
  } catch (e) { return false; }
}
function checkNewPassword(pw) {
  pw = String(pw || "");
  if (pw.length < 6) throw bad("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
  if (pw.length > 100) throw bad("รหัสผ่านยาวเกินไป");
  return pw;
}
const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");

// ป้องกันการเดารหัส: ผิด 5 ครั้งใน 15 นาที → ล็อก 5 นาที (แยกตาม IP + เป้าหมาย)
const loginFails = new Map();
function rateKey(req, target) { return (req.socket.remoteAddress || "") + "|" + (req.headers["x-forwarded-for"] || "").split(",")[0] + "|" + target; }
function checkRate(key) {
  const e = loginFails.get(key);
  if (e && e.lockUntil > now()) throw new HttpError(429, "ใส่รหัสผิดหลายครั้ง กรุณารอ " + Math.ceil((e.lockUntil - now()) / 60000) + " นาทีแล้วลองใหม่");
}
function noteFail(key) {
  const e = loginFails.get(key) || { n: 0, first: now(), lockUntil: 0 };
  if (now() - e.first > 15 * 60000) { e.n = 0; e.first = now(); }
  e.n++; if (e.n >= 5) { e.lockUntil = now() + 5 * 60000; e.n = 0; e.first = now(); }
  loginFails.set(key, e);
}
setInterval(() => { const t = now(); for (const [k, e] of loginFails) if (e.lockUntil < t && t - e.first > 15 * 60000) loginFails.delete(k); }, 10 * 60000).unref();

/* ================= settings ================= */
const DEFAULT_SETTINGS = {
  company_name: "ร้านอาหารของฉัน", company_address: "", company_tax_id: "", company_phone: "", company_logo: "",
  sso_rate: "5", sso_min: "1650", sso_max: "17500",
  admin_idle_min: "30", branch_idle_hours: "12", lists_sync_all: "1",
  doc_prefix_income: "RE", doc_prefix_expense: "EX", doc_prefix_invest: "AS"
};
async function getSettings() {
  const { rows } = await pool.query("SELECT key, value FROM settings");
  const s = { ...DEFAULT_SETTINGS }; rows.forEach(r => { s[r.key] = r.value; });
  return s;
}
async function setSetting(k, v) { await pool.query("INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [k, String(v)]); }

/* ================= DB INIT ================= */
const DEFAULT_LISTS = {
  income_category: ["ขายหน้าร้าน", "เดลิเวอรี่ (Grab / LINE MAN / ShopeeFood)", "รับจัดเลี้ยง / Catering", "รายได้อื่นๆ"],
  expense_category: ["วัตถุดิบอาหาร", "เครื่องดื่ม", "บรรจุภัณฑ์", "ค่าน้ำ-ค่าไฟ", "ค่าแก๊ส", "ค่าเช่า", "เงินเดือน / ค่าแรง", "ประกันสังคม / ภาษีนำส่ง", "ค่าการตลาด / โฆษณา", "ค่าคอมมิชชั่นแอปเดลิเวอรี่", "ซ่อมบำรุง", "อื่นๆ"],
  invest_category: ["อุปกรณ์ครัว", "เฟอร์นิเจอร์", "เครื่องใช้ไฟฟ้า", "ตกแต่งร้าน", "ระบบ / ซอฟต์แวร์", "อื่นๆ"],
  vendor: ["ตลาดสด", "แม็คโคร", "โลตัส / บิ๊กซี", "ออนไลน์ (Shopee / Lazada)", "ซัพพลายเออร์ประจำ"],
  payment_channel: ["เงินสด", "โอนเงิน / พร้อมเพย์", "บัตรเครดิต*", "เงินเชื่อ / ค้างชำระ*", "แอปเดลิเวอรี่ (รอโอน)*"],
  stock_category: ["วัตถุดิบสด", "เนื้อสัตว์ / อาหารทะเล", "ของแห้ง", "เครื่องปรุง", "เครื่องดื่ม", "บรรจุภัณฑ์", "อื่นๆ"],
  unit: ["กก.", "กรัม", "ลิตร", "มล.", "ชิ้น", "ฟอง", "แพ็ค", "ขวด", "กล่อง", "ถุง", "ลัง", "ถัง"]
};
const LIST_KINDS = Object.keys(DEFAULT_LISTS);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT, pass_hash TEXT NOT NULL,
      must_change BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT, last_login_at BIGINT, pass_changed_at BIGINT);
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL, address TEXT, phone TEXT, tax_id TEXT, color TEXT,
      pass_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, sort_order BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT, pass_changed_at BIGINT, last_login_at BIGINT);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, admin_id TEXT, branch_id TEXT,
      created_at BIGINT, last_seen BIGINT, ip TEXT);
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
      is_credit BOOLEAN NOT NULL DEFAULT FALSE, sort_order BIGINT NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_lists_branch ON lists(branch_id, kind);
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, type TEXT NOT NULL, doc_no TEXT, rec_date TEXT NOT NULL,
      party TEXT, description TEXT, category TEXT, items_json TEXT NOT NULL DEFAULT '[]',
      subtotal NUMERIC NOT NULL DEFAULT 0, discount_type TEXT, discount_value NUMERIC, discount NUMERIC NOT NULL DEFAULT 0,
      vat_mode TEXT NOT NULL DEFAULT 'none', vat_amount NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
      payment_channel TEXT, due_date TEXT, settled_at BIGINT, settled_date TEXT, settled_by TEXT,
      source TEXT NOT NULL DEFAULT 'manual', ref_id TEXT, note TEXT,
      created_by TEXT, created_at BIGINT, updated_by TEXT, updated_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_records_branch_date ON records(branch_id, rec_date);
    CREATE INDEX IF NOT EXISTS idx_records_due ON records(branch_id, due_date);
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL, branch_id TEXT NOT NULL, filename TEXT, mime TEXT,
      size INT, data TEXT, created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_files_record ON files(record_id);
    CREATE TABLE IF NOT EXISTS doc_counters (branch_id TEXT NOT NULL, prefix TEXT NOT NULL, period TEXT NOT NULL, n INT NOT NULL DEFAULT 0,
      PRIMARY KEY (branch_id, prefix, period));
    CREATE TABLE IF NOT EXISTS stock_items (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT,
      min_qty NUMERIC NOT NULL DEFAULT 0, qty NUMERIC NOT NULL DEFAULT 0, avg_cost NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE, note TEXT, created_at BIGINT, updated_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_stock_items_branch ON stock_items(branch_id);
    CREATE TABLE IF NOT EXISTS stock_moves (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, item_id TEXT NOT NULL, move_date TEXT NOT NULL, kind TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0, counted NUMERIC, unit_cost NUMERIC, amount NUMERIC, balance NUMERIC,
      note TEXT, ref_record_id TEXT, batch_id TEXT, created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_stock_moves_item ON stock_moves(item_id, move_date);
    CREATE INDEX IF NOT EXISTS idx_stock_moves_branch ON stock_moves(branch_id, move_date);
    CREATE INDEX IF NOT EXISTS idx_stock_moves_ref ON stock_moves(ref_record_id);
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL, nickname TEXT, position TEXT,
      phone TEXT, id_card TEXT, bank_name TEXT, bank_account TEXT, start_date TEXT,
      pay_type TEXT NOT NULL DEFAULT 'monthly', rate NUMERIC NOT NULL DEFAULT 0, sso BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE, note TEXT, created_at BIGINT, updated_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, period TEXT NOT NULL, title TEXT, pay_date TEXT,
      status TEXT NOT NULL DEFAULT 'draft', note TEXT, record_id TEXT, payment_channel TEXT,
      created_by TEXT, created_at BIGINT, paid_at BIGINT, paid_by TEXT);
    CREATE INDEX IF NOT EXISTS idx_payroll_runs_branch ON payroll_runs(branch_id, period);
    CREATE TABLE IF NOT EXISTS payroll_items (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, branch_id TEXT NOT NULL, employee_id TEXT, emp_json TEXT,
      pay_type TEXT, rate NUMERIC, work_days NUMERIC, base NUMERIC, ot_hours NUMERIC, ot_rate NUMERIC, ot_amount NUMERIC,
      allowance NUMERIC, bonus NUMERIC, other_income NUMERIC, sso NUMERIC, tax NUMERIC, advance NUMERIC,
      absent_deduct NUMERIC, other_deduct NUMERIC, gross NUMERIC, total_deduct NUMERIC, net NUMERIC, note TEXT, sort_order INT);
    CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(run_id);
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, at BIGINT NOT NULL, actor TEXT, actor_kind TEXT, branch_id TEXT, action TEXT, detail TEXT);
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
    ALTER TABLE lists ADD COLUMN IF NOT EXISTS opening_balance NUMERIC, ADD COLUMN IF NOT EXISTS opening_date TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS settled_channel TEXT;
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, tr_date TEXT NOT NULL, from_ch TEXT NOT NULL, to_ch TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0, note TEXT, created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_transfers_branch ON transfers(branch_id, tr_date);

    -- ===== v2.0: ผู้ใช้ & สิทธิ์ / log / อนุมัติสต็อก / ขาด-ลา / เบิกล่วงหน้า / เช็คอิน / งบการเงิน =====
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT, pass_hash TEXT NOT NULL,
      must_change BOOLEAN NOT NULL DEFAULT TRUE, active BOOLEAN NOT NULL DEFAULT TRUE,
      all_branches BOOLEAN NOT NULL DEFAULT FALSE, branch_ids TEXT NOT NULL DEFAULT '[]', perms TEXT NOT NULL DEFAULT '{}',
      approve_stock BOOLEAN NOT NULL DEFAULT FALSE, approve_leave BOOLEAN NOT NULL DEFAULT FALSE, approve_advance BOOLEAN NOT NULL DEFAULT FALSE,
      note TEXT, created_at BIGINT, last_login_at BIGINT, pass_changed_at BIGINT);
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT, ADD COLUMN IF NOT EXISTS ua TEXT;
    ALTER TABLE activity ADD COLUMN IF NOT EXISTS ip TEXT, ADD COLUMN IF NOT EXISTS ua TEXT, ADD COLUMN IF NOT EXISTS user_id TEXT,
      ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
    CREATE INDEX IF NOT EXISTS idx_activity_branch ON activity(branch_id, at);
    ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved', ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_at BIGINT, ADD COLUMN IF NOT EXISTS reject_reason TEXT;
    ALTER TABLE lists ADD COLUMN IF NOT EXISTS fs_group TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_hash TEXT;
    ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS links_json TEXT;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS checkin_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS checkin_lng DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS checkin_radius INT NOT NULL DEFAULT 100,
      ADD COLUMN IF NOT EXISTS work_start TEXT NOT NULL DEFAULT '09:00', ADD COLUMN IF NOT EXISTS late_grace INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS leaves (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, employee_id TEXT NOT NULL, emp_name TEXT, kind TEXT NOT NULL,
      date_from TEXT NOT NULL, date_to TEXT NOT NULL, days NUMERIC NOT NULL DEFAULT 0, minutes INT NOT NULL DEFAULT 0,
      reason TEXT, deduct NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT, created_at BIGINT, approved_by TEXT, approved_at BIGINT, reject_reason TEXT, payroll_run_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_leaves_branch ON leaves(branch_id, date_from);
    CREATE TABLE IF NOT EXISTS advances (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, employee_id TEXT NOT NULL, emp_name TEXT, amount NUMERIC NOT NULL DEFAULT 0,
      req_date TEXT NOT NULL, deduct_period TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT, created_at BIGINT, approved_by TEXT, approved_at BIGINT, reject_reason TEXT,
      pay_channel TEXT, pay_date TEXT, record_id TEXT, payroll_run_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_advances_branch ON advances(branch_id, req_date);
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, employee_id TEXT NOT NULL, emp_name TEXT, work_date TEXT NOT NULL, kind TEXT NOT NULL,
      at BIGINT NOT NULL, lat DOUBLE PRECISION, lng DOUBLE PRECISION, accuracy DOUBLE PRECISION, distance DOUBLE PRECISION,
      late_min INT NOT NULL DEFAULT 0, manual BOOLEAN NOT NULL DEFAULT FALSE, note TEXT, ip TEXT, ua TEXT, created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_attendance_branch ON attendance(branch_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_emp ON attendance(employee_id, work_date);
    -- ===== v2.2: บัตรเครดิต =====
    ALTER TABLE lists ADD COLUMN IF NOT EXISTS card_cut_day INT, ADD COLUMN IF NOT EXISTS card_due_day INT, ADD COLUMN IF NOT EXISTS card_limit NUMERIC;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS plan_id TEXT, ADD COLUMN IF NOT EXISTS plan_seq INT, ADD COLUMN IF NOT EXISTS plan_count INT, ADD COLUMN IF NOT EXISTS settle_batch TEXT;
    CREATE INDEX IF NOT EXISTS idx_records_plan ON records(plan_id);
    CREATE TABLE IF NOT EXISTS card_plans (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, type TEXT NOT NULL, card TEXT NOT NULL, purchase_date TEXT NOT NULL, party TEXT, description TEXT, items_json TEXT,
      total NUMERIC NOT NULL DEFAULT 0, interest NUMERIC NOT NULL DEFAULT 0, months INT NOT NULL, first_due TEXT, status TEXT NOT NULL DEFAULT 'active', created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_card_plans_branch ON card_plans(branch_id, card);
    ALTER TABLE card_plans ADD COLUMN IF NOT EXISTS pay_day INT, ADD COLUMN IF NOT EXISTS body_json TEXT;
  `);
  const a = await pool.query("SELECT COUNT(*)::int AS c FROM admins");
  if (Number(a.rows[0].c) === 0) {
    await pool.query("INSERT INTO admins (id,username,name,pass_hash,must_change,active,created_at) VALUES ($1,$2,$3,$4,TRUE,TRUE,$5)",
      [uid(), INIT_ADMIN_USER, "ผู้ดูแลระบบ", hashPw(INIT_ADMIN_PASS), now()]);
    console.log("สร้างผู้ดูแลระบบเริ่มต้นแล้ว: " + INIT_ADMIN_USER + " (ต้องเปลี่ยนรหัสหลังเข้าครั้งแรก)");
  }
  await pool.query("DELETE FROM sessions WHERE last_seen < $1", [now() - 7 * 86400000]);
}

async function seedLists(branchId, copyFrom) {
  let n = 0;
  if (copyFrom) {
    const { rows } = await pool.query("SELECT kind, name, is_credit, fs_group, card_cut_day, card_due_day, card_limit FROM lists WHERE branch_id=$1 ORDER BY sort_order", [copyFrom]);
    if (rows.length) {
      for (const r of rows) await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order,fs_group,card_cut_day,card_due_day,card_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [uid(), branchId, r.kind, r.name, !!r.is_credit, ++n, r.fs_group, r.card_cut_day, r.card_due_day, r.card_limit]);
      return;
    }
  }
  for (const kind of LIST_KINDS) for (let name of DEFAULT_LISTS[kind]) {
    const credit = name.endsWith("*"); name = name.replace(/\*$/, "");
    await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order) VALUES ($1,$2,$3,$4,$5,$6)", [uid(), branchId, kind, name, credit, now() + (n++)]);
  }
}

// บันทึก log: ใคร / ทำอะไร / สาขาไหน / เมื่อไร / อย่างไร (IP + อุปกรณ์ + พิกัดถ้ามี)
async function logActivity(ctx, action, detail, branchId, extra) {
  try {
    const s = ctx && ctx.session; const req = ctx && ctx.req; const x = extra || {};
    await pool.query("INSERT INTO activity (id,at,actor,actor_kind,branch_id,action,detail,ip,ua,user_id,lat,lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [uid(), now(), s ? s.actor : "-", s ? s.kind : "", branchId || (s && s.branch_id) || null, action, String(detail || "").slice(0, 1000),
        req ? clientIp(req) : null, req ? clientUa(req) : null, (s && s.user_id) || null, isFinite(x.lat) ? x.lat : null, isFinite(x.lng) ? x.lng : null]);
  } catch (e) { console.error("log:", e.message); }
}

/* ================= sessions ================= */
const clientIp = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 100);
const clientUa = req => String(req.headers["user-agent"] || "").slice(0, 300);
async function createSession(kind, adminId, branchId, req, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash,kind,admin_id,branch_id,created_at,last_seen,ip,user_id,ua) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)",
    [sha256(token), kind, adminId, branchId, now(), clientIp(req), userId || null, clientUa(req)]);
  return token;
}

/* ---------- สิทธิ์การใช้งาน ---------- */
// เมนูที่กำหนดสิทธิ์ได้: none = ไม่เห็น, view = ดูอย่างเดียว, edit = แก้ไขได้
const MENUS = ["dashboard", "income", "expense", "invest", "ledger", "accounts", "statements", "stock", "employees", "payroll", "leave", "advance", "attendance", "cards", "settings", "log"];
const LV = { none: 0, view: 1, edit: 2 };
function fullPerms() { const m = {}; MENUS.forEach(k => { m[k] = "edit"; }); return { menus: m, approve: { stock: true, leave: true, advance: true }, full: true }; }
function cleanPerms(p) { const m = {}; MENUS.forEach(k => { m[k] = ["none", "view", "edit"].includes(p && p[k]) ? p[k] : "none"; }); return m; }
function permsOf(s) {
  if (!s) return { menus: cleanPerms({}), approve: {} };
  if (s.kind !== "user") return fullPerms(); // Admin และผู้ใช้รหัสสาขา (ผู้จัดการสาขา) = สิทธิ์เต็ม
  let p = {}; try { p = JSON.parse(s.user_perms || "{}"); } catch (e) {}
  return { menus: cleanPerms(p), approve: { stock: !!s.user_approve_stock, leave: !!s.user_approve_leave, advance: !!s.user_approve_advance }, full: false };
}
function userBranchIds(u) { try { const a = JSON.parse(u.branch_ids || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
function userCanBranch(u, bid) { return !!u.all_branches || userBranchIds(u).includes(bid); }

async function loadSession(req, urlObj) {
  const h = String(req.headers.authorization || "");
  let token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token && urlObj.searchParams.get("t")) token = urlObj.searchParams.get("t");
  if (!token || token.length > 200) return null;
  const { rows } = await pool.query(
    `SELECT s.*, a.username, a.name AS admin_name, a.active AS admin_active, a.must_change, b.name AS branch_name, b.active AS branch_active,
       u.username AS user_username, u.name AS user_name, u.active AS user_active, u.must_change AS user_must_change, u.all_branches AS user_all_branches,
       u.branch_ids AS user_branch_ids, u.perms AS user_perms, u.approve_stock AS user_approve_stock, u.approve_leave AS user_approve_leave, u.approve_advance AS user_approve_advance
     FROM sessions s LEFT JOIN admins a ON a.id=s.admin_id LEFT JOIN branches b ON b.id=s.branch_id LEFT JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1`, [sha256(token)]);
  const s = rows[0]; if (!s) return null;
  const st = await getSettings();
  const idle = s.kind === "admin" ? num(st.admin_idle_min, 30) * 60000 : num(st.branch_idle_hours, 12) * 3600000;
  if (now() - Number(s.last_seen) > idle) { await pool.query("DELETE FROM sessions WHERE token_hash=$1", [s.token_hash]); return null; }
  if (s.kind === "admin" && !s.admin_active) return null;
  if ((s.kind === "branch" || s.kind === "user") && !s.branch_active) return null;
  if (s.kind === "user" && (!s.user_active || !userCanBranch({ all_branches: s.user_all_branches, branch_ids: s.user_branch_ids }, s.branch_id))) return null;
  if (now() - Number(s.last_seen) > 30000) await pool.query("UPDATE sessions SET last_seen=$1 WHERE token_hash=$2", [now(), s.token_hash]);
  s.actor = s.kind === "admin" ? "Admin: " + (s.admin_name || s.username)
    : s.kind === "user" ? (s.user_name || s.user_username) + " (" + s.user_username + ")" : "ผู้จัดการ (รหัสสาขา) · " + s.branch_name;
  s.isAdmin = s.kind === "admin";
  s.perms = permsOf(s);
  return s;
}
function needAdmin(ctx) {
  if (!ctx.session || !ctx.session.isAdmin) throw new HttpError(401, "กรุณาเข้าสู่ระบบผู้ดูแล");
  if (ctx.session.must_change && !ctx.allowMustChange) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน");
}
const MENU_TH = { dashboard: "ภาพรวม", income: "รายรับ", expense: "รายจ่าย", invest: "สินทรัพย์", ledger: "สมุดบัญชี", accounts: "เงินในบัญชี", statements: "งบการเงิน", stock: "สต็อก",
  employees: "พนักงาน", payroll: "เงินเดือน", leave: "ขาด-ลา", advance: "เบิกเงินล่วงหน้า", attendance: "ลงเวลา/เช็คอิน", cards: "บัตรเครดิต", settings: "ตั้งค่าหมวด", log: "log การใช้งาน" };
// ตรวจสิทธิ์ทุก API ของสาขา: menu = เมนูเดียวหรือหลายเมนู (มีสิทธิ์เมนูใดเมนูหนึ่งก็พอ), level = view / edit
async function needBranch(ctx, menu, level) {
  const bid = ctx.params.bid;
  const s = ctx.session;
  if (!s) throw new HttpError(401, "กรุณาเข้าสู่ระบบสาขา");
  if (s.isAdmin) { if (s.must_change) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน"); }
  else if ((s.kind !== "branch" && s.kind !== "user") || s.branch_id !== bid) throw new HttpError(403, "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  if (s.kind === "user" && s.user_must_change && !ctx.allowMustChange) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน");
  const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1", [bid]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  ctx.branch = rows[0];
  ctx.perms = s.perms || permsOf(s);
  if (menu) need(ctx, menu, level || "view");
}
function can(ctx, menu, level) { const ms = Array.isArray(menu) ? menu : [menu]; return ms.some(m => LV[ctx.perms.menus[m] || "none"] >= LV[level || "view"]); }
function need(ctx, menu, level) {
  if (!can(ctx, menu, level)) {
    const ms = Array.isArray(menu) ? menu : [menu];
    throw new HttpError(403, "ไม่มีสิทธิ์" + (level === "edit" ? "แก้ไข" : "เข้าดู") + "เมนู " + ms.map(m => MENU_TH[m] || m).join(" / "));
  }
}
function needApprove(ctx, what) {
  if (!ctx.perms.approve[what]) throw new HttpError(403, "ไม่มีสิทธิ์อนุมัติ" + ({ stock: "สต็อก", leave: "การลา", advance: "การเบิกเงิน" }[what]));
}

/* ================= router ================= */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, handler });
}
const B = "/api/b/:bid"; // ทุกเส้นทางของสาขา

/* ---------------- public ---------------- */
route("GET", "/api/health", async () => {
  const r = await pool.query("SELECT 1 AS ok"); return { ok: true, connected: Number(r.rows[0].ok) === 1, build: BUILD_ID };
});
route("GET", "/api/public/info", async () => {
  const s = await getSettings();
  const { rows } = await pool.query("SELECT id, code, name, color FROM branches WHERE active=TRUE ORDER BY sort_order, created_at");
  return { company: { name: s.company_name, logo: s.company_logo }, branches: rows, build: BUILD_ID };
});

/* ---------------- branch auth ---------------- */
// เข้าสาขา: ชื่อผู้ใช้ + รหัสผ่าน (สิทธิ์ตามที่ Admin กำหนด) หรือ เว้นชื่อผู้ใช้ว่าง + รหัสสาขา (ผู้จัดการสาขา สิทธิ์เต็ม)
route("POST", "/api/branch/login", async (ctx, req) => {
  const bid = str(ctx.body.branchId, 100), pw = String(ctx.body.password || ""), username = str(ctx.body.username, 100);
  const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1 AND active=TRUE", [bid]);
  const br = rows[0];
  if (!username) {
    const key = rateKey(req, "b:" + bid); checkRate(key);
    if (!br || !verifyPw(pw, br.pass_hash)) {
      noteFail(key);
      await logActivity({ req, session: { actor: "(รหัสสาขา)", kind: "branch" } }, "login_fail", "ใส่รหัสสาขาผิด" + (br ? " · " + br.name : ""), br ? bid : null);
      throw new HttpError(401, "รหัสผ่านไม่ถูกต้อง");
    }
    loginFails.delete(key);
    const token = await createSession("branch", null, bid, req);
    await pool.query("UPDATE branches SET last_login_at=$1 WHERE id=$2", [now(), bid]);
    await logActivity({ req, session: { actor: "ผู้จัดการ (รหัสสาขา) · " + br.name, kind: "branch", branch_id: bid } }, "login", "เข้าสู่ระบบสาขาด้วยรหัสสาขา", bid);
    return { token, mustChange: false, branch: { id: br.id, name: br.name, code: br.code, color: br.color } };
  }
  const key = rateKey(req, "u:" + username.toLowerCase()); checkRate(key);
  const u = (await pool.query("SELECT * FROM users WHERE lower(username)=lower($1)", [username])).rows[0];
  if (!u || !u.active || !verifyPw(pw, u.pass_hash)) {
    noteFail(key);
    await logActivity({ req, session: { actor: username, kind: "user", user_id: u ? u.id : null } }, "login_fail",
      (u && !u.active ? "บัญชีถูกปิดใช้งาน" : "ชื่อผู้ใช้หรือรหัสผ่านผิด") + (br ? " · " + br.name : ""), br ? bid : null);
    throw new HttpError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  }
  loginFails.delete(key);
  if (!br) throw new HttpError(404, "ไม่พบสาขา");
  const actor = (u.name || u.username) + " (" + u.username + ")";
  if (!userCanBranch(u, bid)) {
    await logActivity({ req, session: { actor, kind: "user", user_id: u.id } }, "access_denied", "พยายามเข้าสาขา " + br.name + " ซึ่งไม่มีสิทธิ์", bid);
    throw new HttpError(403, "บัญชีนี้ไม่มีสิทธิ์เข้าสาขา " + br.name);
  }
  const token = await createSession("user", null, bid, req, u.id);
  await pool.query("UPDATE users SET last_login_at=$1 WHERE id=$2", [now(), u.id]);
  await logActivity({ req, session: { actor, kind: "user", user_id: u.id, branch_id: bid } }, "login", "เข้าสู่ระบบสาขา " + br.name, bid);
  return { token, mustChange: !!u.must_change, user: { username: u.username, name: u.name }, branch: { id: br.id, name: br.name, code: br.code, color: br.color } };
});
// ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง
route("POST", "/api/user/change-password", async ctx => {
  const s = ctx.session;
  if (!s || s.kind !== "user") throw new HttpError(401, "กรุณาเข้าสู่ระบบ");
  const u = (await pool.query("SELECT * FROM users WHERE id=$1", [s.user_id])).rows[0];
  if (!u || !verifyPw(String(ctx.body.oldPassword || ""), u.pass_hash)) throw bad("รหัสผ่านเดิมไม่ถูกต้อง");
  const pw = checkNewPassword(ctx.body.newPassword);
  if (pw === String(ctx.body.oldPassword)) throw bad("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม");
  await pool.query("UPDATE users SET pass_hash=$1, must_change=FALSE, pass_changed_at=$2 WHERE id=$3", [hashPw(pw), now(), u.id]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [u.id, s.token_hash]);
  await logActivity(ctx, "user_password", "เปลี่ยนรหัสผ่านของตัวเอง");
  return { ok: true };
});
route("POST", "/api/logout", async (ctx, req) => {
  const h = String(req.headers.authorization || ""); const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (t) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [sha256(t)]);
  return { ok: true };
});
route("GET", "/api/session", async ctx => {
  const s = ctx.session; if (!s) return { session: null };
  return { session: { kind: s.kind, branchId: s.branch_id, branchName: s.branch_name, username: s.username || s.user_username, name: s.admin_name || s.user_name, mustChange: !!(s.must_change || s.user_must_change) } };
});
route("POST", B + "/change-password", async ctx => {
  await needBranch(ctx);
  if (ctx.session.kind === "user") throw new HttpError(403, "เปลี่ยนรหัสสาขาได้เฉพาะผู้จัดการ (รหัสสาขา) หรือ Admin");
  const pw = checkNewPassword(ctx.body.newPassword);
  if (!ctx.session.isAdmin && !verifyPw(String(ctx.body.oldPassword || ""), ctx.branch.pass_hash)) throw bad("รหัสผ่านเดิมไม่ถูกต้อง");
  await pool.query("UPDATE branches SET pass_hash=$1, pass_changed_at=$2 WHERE id=$3", [hashPw(pw), now(), ctx.branch.id]);
  await pool.query("DELETE FROM sessions WHERE kind='branch' AND branch_id=$1 AND token_hash<>$2", [ctx.branch.id, ctx.session.token_hash]);
  await logActivity(ctx, "branch_password", "เปลี่ยนรหัสผ่านสาขา " + ctx.branch.name, ctx.branch.id);
  return { ok: true };
});
route("GET", B + "/info", async ctx => {
  ctx.allowMustChange = true; await needBranch(ctx);
  const s = await getSettings(); const b = ctx.branch, ss = ctx.session;
  return { branch: { id: b.id, code: b.code, name: b.name, address: b.address, phone: b.phone, taxId: b.tax_id, color: b.color,
      checkin: { enabled: !!b.checkin_enabled, lat: b.checkin_lat, lng: b.checkin_lng, radius: Number(b.checkin_radius) || 100, workStart: b.work_start || "09:00", lateGrace: Number(b.late_grace) || 0 } },
    company: { name: s.company_name, address: s.company_address, taxId: s.company_tax_id, phone: s.company_phone, logo: s.company_logo },
    sso: { rate: num(s.sso_rate, 5), min: num(s.sso_min, 1650), max: num(s.sso_max, 17500) }, isAdmin: !!ss.isAdmin,
    me: { kind: ss.kind, name: ss.kind === "user" ? (ss.user_name || ss.user_username) : ss.isAdmin ? (ss.admin_name || ss.username) : "ผู้จัดการสาขา",
      username: ss.user_username || ss.username || "", mustChange: !!(ss.kind === "user" && ss.user_must_change) },
    perms: ctx.perms.menus, approve: ctx.perms.approve, full: !!ctx.perms.full };
});
// จำนวนรายการรออนุมัติ (ตัวเลขแจ้งเตือนบนเมนู)
async function pendingCounts(bid, ap) {
  const q = async (sql) => Number((await pool.query(sql, [bid])).rows[0].c) || 0;
  const out = { stock: 0, leave: 0, advance: 0 };
  if (ap.stock) out.stock = await q("SELECT COUNT(*)::int AS c FROM stock_moves WHERE branch_id=$1 AND status='pending'");
  if (ap.leave) out.leave = await q("SELECT COUNT(*)::int AS c FROM leaves WHERE branch_id=$1 AND status='pending'");
  if (ap.advance) out.advance = await q("SELECT COUNT(*)::int AS c FROM advances WHERE branch_id=$1 AND status='pending'");
  out.total = out.stock + out.leave + out.advance;
  return out;
}
route("GET", B + "/approvals/count", async ctx => { await needBranch(ctx); const out = await pendingCounts(ctx.branch.id, ctx.perms.approve);
  out.cards = can(ctx, "cards", "view") ? (await cardBillsDue(ctx.branch.id, 7)).length : 0; return out; });

/* ---------------- admin auth ---------------- */
route("POST", "/api/admin/login", async (ctx, req) => {
  const u = str(ctx.body.username, 100), pw = String(ctx.body.password || "");
  const key = rateKey(req, "a:" + u.toLowerCase()); checkRate(key);
  const { rows } = await pool.query("SELECT * FROM admins WHERE lower(username)=lower($1) AND active=TRUE", [u]);
  if (!rows[0] || !verifyPw(pw, rows[0].pass_hash)) {
    noteFail(key);
    await logActivity({ req, session: { actor: "Admin: " + (u || "-"), kind: "admin" } }, "login_fail", "เข้าหน้าผู้ดูแลไม่สำเร็จ (ชื่อผู้ใช้หรือรหัสผ่านผิด)");
    throw new HttpError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  }
  loginFails.delete(key);
  const token = await createSession("admin", rows[0].id, null, req);
  await pool.query("UPDATE admins SET last_login_at=$1 WHERE id=$2", [now(), rows[0].id]);
  await logActivity({ req, session: { actor: "Admin: " + (rows[0].name || rows[0].username), kind: "admin" } }, "login", "เข้าสู่ระบบผู้ดูแล");
  const st = await getSettings();
  return { token, idleMin: num(st.admin_idle_min, 30), admin: { id: rows[0].id, username: rows[0].username, name: rows[0].name, mustChange: !!rows[0].must_change } };
});
route("POST", "/api/admin/change-password", async ctx => {
  ctx.allowMustChange = true; needAdmin(ctx);
  const { rows } = await pool.query("SELECT * FROM admins WHERE id=$1", [ctx.session.admin_id]);
  if (!verifyPw(String(ctx.body.oldPassword || ""), rows[0].pass_hash)) throw bad("รหัสผ่านเดิมไม่ถูกต้อง");
  const pw = checkNewPassword(ctx.body.newPassword);
  if (pw === String(ctx.body.oldPassword)) throw bad("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม");
  let username = str(ctx.body.newUsername, 50) || rows[0].username;
  if (!/^[A-Za-z0-9._@-]{3,50}$/.test(username)) throw bad("ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - @ (3-50 ตัว)");
  const dup = await pool.query("SELECT 1 FROM admins WHERE lower(username)=lower($1) AND id<>$2", [username, rows[0].id]);
  if (dup.rows.length) throw bad("ชื่อผู้ใช้นี้มีอยู่แล้ว");
  await pool.query("UPDATE admins SET pass_hash=$1, username=$2, must_change=FALSE, pass_changed_at=$3 WHERE id=$4", [hashPw(pw), username, now(), rows[0].id]);
  await pool.query("DELETE FROM sessions WHERE admin_id=$1 AND token_hash<>$2", [rows[0].id, ctx.session.token_hash]);
  await logActivity(ctx, "admin_password", "เปลี่ยนรหัสผ่านผู้ดูแล (" + username + ")");
  return { ok: true, username };
});

/* ---------------- admin: admins ---------------- */
route("GET", "/api/admin/admins", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT id, username, name, active, must_change, created_at, last_login_at FROM admins ORDER BY created_at");
  return { admins: rows.map(r => ({ id: r.id, username: r.username, name: r.name, active: r.active, mustChange: r.must_change, lastLoginAt: Number(r.last_login_at) || null, isMe: r.id === ctx.session.admin_id })) };
});
route("POST", "/api/admin/admins", async ctx => {
  needAdmin(ctx);
  const username = str(ctx.body.username, 50), name = str(ctx.body.name, 100);
  if (!/^[A-Za-z0-9._@-]{3,50}$/.test(username)) throw bad("ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - @ (3-50 ตัว)");
  const pw = checkNewPassword(ctx.body.password);
  const dup = await pool.query("SELECT 1 FROM admins WHERE lower(username)=lower($1)", [username]);
  if (dup.rows.length) throw bad("ชื่อผู้ใช้นี้มีอยู่แล้ว");
  await pool.query("INSERT INTO admins (id,username,name,pass_hash,must_change,active,created_at) VALUES ($1,$2,$3,$4,TRUE,TRUE,$5)", [uid(), username, name || username, hashPw(pw), now()]);
  await logActivity(ctx, "admin_add", "เพิ่มผู้ดูแล " + username);
  return { ok: true };
});
route("PUT", "/api/admin/admins/:id", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT * FROM admins WHERE id=$1", [ctx.params.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบผู้ดูแล");
  const b = ctx.body;
  if (b.active === false && rows[0].id === ctx.session.admin_id) throw bad("ปิดใช้งานบัญชีตัวเองไม่ได้");
  if (b.active === false) {
    const c = await pool.query("SELECT COUNT(*)::int AS c FROM admins WHERE active=TRUE AND id<>$1", [rows[0].id]);
    if (Number(c.rows[0].c) === 0) throw bad("ต้องมีผู้ดูแลที่ใช้งานได้อย่างน้อย 1 คน");
  }
  if (b.name !== undefined) await pool.query("UPDATE admins SET name=$1 WHERE id=$2", [str(b.name, 100), rows[0].id]);
  if (b.active !== undefined) { await pool.query("UPDATE admins SET active=$1 WHERE id=$2", [!!b.active, rows[0].id]); if (!b.active) await pool.query("DELETE FROM sessions WHERE admin_id=$1", [rows[0].id]); }
  if (b.password) {
    const pw = checkNewPassword(b.password);
    await pool.query("UPDATE admins SET pass_hash=$1, must_change=TRUE, pass_changed_at=$2 WHERE id=$3", [hashPw(pw), now(), rows[0].id]);
    if (rows[0].id !== ctx.session.admin_id) await pool.query("DELETE FROM sessions WHERE admin_id=$1", [rows[0].id]);
  }
  await logActivity(ctx, "admin_edit", "แก้ไขผู้ดูแล " + rows[0].username + (b.password ? " (รีเซ็ตรหัส)" : "") + (b.active === false ? " (ปิดใช้งาน)" : b.active === true ? " (เปิดใช้งาน)" : ""));
  return { ok: true };
});
route("DELETE", "/api/admin/admins/:id", async ctx => {
  needAdmin(ctx);
  if (ctx.params.id === ctx.session.admin_id) throw bad("ลบบัญชีตัวเองไม่ได้");
  const c = await pool.query("SELECT COUNT(*)::int AS c FROM admins WHERE active=TRUE AND id<>$1", [ctx.params.id]);
  if (Number(c.rows[0].c) === 0) throw bad("ต้องมีผู้ดูแลที่ใช้งานได้อย่างน้อย 1 คน");
  const { rows } = await pool.query("DELETE FROM admins WHERE id=$1 RETURNING username", [ctx.params.id]);
  await pool.query("DELETE FROM sessions WHERE admin_id=$1", [ctx.params.id]);
  if (rows[0]) await logActivity(ctx, "admin_delete", "ลบผู้ดูแล " + rows[0].username);
  return { ok: true };
});

/* ---------------- admin: ผู้ใช้งาน & สิทธิ์ ---------------- */
function userOut(r) {
  let perms = {}; try { perms = JSON.parse(r.perms || "{}"); } catch (e) {}
  return { id: r.id, username: r.username, name: r.name || "", active: !!r.active, mustChange: !!r.must_change, allBranches: !!r.all_branches,
    branchIds: userBranchIds(r), perms: cleanPerms(perms), approveStock: !!r.approve_stock, approveLeave: !!r.approve_leave, approveAdvance: !!r.approve_advance,
    note: r.note || "", createdAt: Number(r.created_at) || null, lastLoginAt: Number(r.last_login_at) || null };
}
route("GET", "/api/admin/users", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT * FROM users ORDER BY created_at");
  return { users: rows.map(userOut), menus: MENUS.map(k => ({ key: k, label: MENU_TH[k] })) };
});
function userFields(b) {
  const name = str(b.name, 100);
  const branchIds = Array.isArray(b.branchIds) ? [...new Set(b.branchIds.map(x => str(x, 100)).filter(Boolean))] : [];
  if (!b.allBranches && !branchIds.length) throw bad("กรุณาเลือกสาขาที่ผู้ใช้นี้เข้าได้อย่างน้อย 1 สาขา");
  const perms = cleanPerms(b.perms || {});
  if (!Object.values(perms).some(v => v !== "none") && !b.approveStock && !b.approveLeave && !b.approveAdvance) throw bad("กรุณาให้สิทธิ์อย่างน้อย 1 เมนู");
  return { name, all_branches: !!b.allBranches, branch_ids: JSON.stringify(branchIds), perms: JSON.stringify(perms),
    approve_stock: !!b.approveStock, approve_leave: !!b.approveLeave, approve_advance: !!b.approveAdvance, note: str(b.note, 300) };
}
route("POST", "/api/admin/users", async ctx => {
  needAdmin(ctx);
  const username = str(ctx.body.username, 50);
  if (!/^[A-Za-z0-9._@-]{3,50}$/.test(username)) throw bad("ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - @ (3-50 ตัว)");
  const pw = checkNewPassword(ctx.body.password);
  const dup = await pool.query("SELECT 1 FROM users WHERE lower(username)=lower($1)", [username]);
  if (dup.rows.length) throw bad("ชื่อผู้ใช้นี้มีอยู่แล้ว");
  const f = userFields(ctx.body);
  await pool.query(`INSERT INTO users (id,username,name,pass_hash,must_change,active,all_branches,branch_ids,perms,approve_stock,approve_leave,approve_advance,note,created_at,pass_changed_at)
    VALUES ($1,$2,$3,$4,TRUE,TRUE,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [uid(), username, f.name || username, hashPw(pw), f.all_branches, f.branch_ids, f.perms, f.approve_stock, f.approve_leave, f.approve_advance, f.note, now()]);
  await logActivity(ctx, "user_add", "สร้างผู้ใช้ " + username);
  return { ok: true };
});
route("PUT", "/api/admin/users/:id", async ctx => {
  needAdmin(ctx);
  const cur = (await pool.query("SELECT * FROM users WHERE id=$1", [ctx.params.id])).rows[0];
  if (!cur) throw new HttpError(404, "ไม่พบผู้ใช้");
  const b = ctx.body || {}; const notes = [];
  if (b.active !== undefined && Object.keys(b).length === 1) {
    await pool.query("UPDATE users SET active=$1 WHERE id=$2", [!!b.active, cur.id]);
    if (!b.active) await pool.query("DELETE FROM sessions WHERE user_id=$1", [cur.id]);
    await logActivity(ctx, "user_edit", (b.active ? "เปิด" : "ปิด") + "ใช้งานผู้ใช้ " + cur.username);
    return { ok: true };
  }
  if (b.password) {
    const pw = checkNewPassword(b.password);
    await pool.query("UPDATE users SET pass_hash=$1, must_change=TRUE, pass_changed_at=$2 WHERE id=$3", [hashPw(pw), now(), cur.id]);
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [cur.id]);
    notes.push("รีเซ็ตรหัส");
    if (Object.keys(b).length === 1) { await logActivity(ctx, "user_edit", "รีเซ็ตรหัสผ่านผู้ใช้ " + cur.username); return { ok: true }; }
  }
  const f = userFields(b);
  await pool.query("UPDATE users SET name=$1, all_branches=$2, branch_ids=$3, perms=$4, approve_stock=$5, approve_leave=$6, approve_advance=$7, note=$8 WHERE id=$9",
    [f.name || cur.username, f.all_branches, f.branch_ids, f.perms, f.approve_stock, f.approve_leave, f.approve_advance, f.note, cur.id]);
  await logActivity(ctx, "user_edit", "แก้ไขสิทธิ์ผู้ใช้ " + cur.username + (notes.length ? " (" + notes.join(", ") + ")" : ""));
  return { ok: true };
});
route("DELETE", "/api/admin/users/:id", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("DELETE FROM users WHERE id=$1 RETURNING username", [ctx.params.id]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [ctx.params.id]);
  if (rows[0]) await logActivity(ctx, "user_delete", "ลบผู้ใช้ " + rows[0].username);
  return { ok: true };
});

/* ---------------- admin: settings ---------------- */
route("GET", "/api/admin/settings", async ctx => { needAdmin(ctx); return { settings: await getSettings() }; });
route("PUT", "/api/admin/settings", async ctx => {
  needAdmin(ctx);
  const b = ctx.body || {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (b[k] === undefined) continue;
    let v = k === "company_logo" ? String(b[k] || "") : str(b[k], 500);
    if (k === "company_logo" && v && (!/^data:image\/(png|jpe?g|webp|svg\+xml|gif);base64,/.test(v) || v.length > 1500000)) throw bad("โลโก้ต้องเป็นรูปภาพขนาดไม่เกิน 1MB");
    if (["sso_rate", "sso_min", "sso_max", "admin_idle_min", "branch_idle_hours"].includes(k)) {
      const n = Number(v); if (!isFinite(n) || n < 0) throw bad("ค่าตัวเลขไม่ถูกต้อง: " + k);
      if (k === "admin_idle_min" && (n < 5 || n > 240)) throw bad("เวลาออกจากระบบผู้ดูแลอัตโนมัติ ต้องอยู่ระหว่าง 5-240 นาที");
      if (k === "branch_idle_hours" && (n < 1 || n > 168)) throw bad("เวลาออกจากระบบสาขาอัตโนมัติ ต้องอยู่ระหว่าง 1-168 ชั่วโมง");
      v = String(n);
    }
    if (k.startsWith("doc_prefix_") && !/^[A-Za-z0-9-]{1,6}$/.test(v)) throw bad("คำนำหน้าเลขเอกสารใช้ A-Z 0-9 ได้ไม่เกิน 6 ตัว");
    if (k === "lists_sync_all") v = v === "1" || v === "true" ? "1" : "0";
    await setSetting(k, v);
  }
  await logActivity(ctx, "settings", "แก้ไขการตั้งค่าระบบ");
  return { settings: await getSettings() };
});

/* ---------------- admin: branches ---------------- */
function branchOut(r) {
  return { id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone, taxId: r.tax_id, color: r.color, active: r.active,
    createdAt: Number(r.created_at), lastLoginAt: Number(r.last_login_at) || null, passChangedAt: Number(r.pass_changed_at) || null,
    checkin: { enabled: !!r.checkin_enabled, lat: r.checkin_lat == null ? null : Number(r.checkin_lat), lng: r.checkin_lng == null ? null : Number(r.checkin_lng),
      radius: Number(r.checkin_radius) || 100, workStart: r.work_start || "09:00", lateGrace: Number(r.late_grace) || 0 } };
}
// ตั้งค่าเช็คอินของสาขา: พิกัดร้าน ระยะห่างสูงสุด เวลาเข้างาน นาทีผ่อนผัน
route("PUT", "/api/admin/branches/:id/checkin", async ctx => {
  needAdmin(ctx);
  const b = ctx.body || {};
  const enabled = !!b.enabled;
  const lat = b.lat === "" || b.lat == null ? null : Number(b.lat), lng = b.lng === "" || b.lng == null ? null : Number(b.lng);
  if (lat !== null && (!isFinite(lat) || lat < -90 || lat > 90)) throw bad("ละติจูดไม่ถูกต้อง (-90 ถึง 90)");
  if (lng !== null && (!isFinite(lng) || lng < -180 || lng > 180)) throw bad("ลองจิจูดไม่ถูกต้อง (-180 ถึง 180)");
  if (enabled && (lat === null || lng === null)) throw bad("กรุณาใส่พิกัดร้านก่อนเปิดระบบเช็คอิน");
  const radius = Math.round(num(b.radius, 100)); if (radius < 10 || radius > 50000) throw bad("ระยะห่างสูงสุดต้องอยู่ระหว่าง 10 - 50,000 เมตร");
  const ws = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.workStart || "")) ? b.workStart : "09:00";
  const grace = Math.max(0, Math.min(240, Math.round(num(b.lateGrace, 0))));
  const { rows } = await pool.query("UPDATE branches SET checkin_enabled=$1, checkin_lat=$2, checkin_lng=$3, checkin_radius=$4, work_start=$5, late_grace=$6 WHERE id=$7 RETURNING name",
    [enabled, lat, lng, radius, ws, grace, ctx.params.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  await logActivity(ctx, "branch_checkin", "ตั้งค่าเช็คอินสาขา " + rows[0].name + ": " + (enabled ? "เปิด" : "ปิด") + " ระยะ " + radius + " ม. เข้างาน " + ws + " ผ่อนผัน " + grace + " นาที", ctx.params.id);
  return { ok: true };
});
route("GET", "/api/admin/branches", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT * FROM branches ORDER BY sort_order, created_at");
  return { branches: rows.map(branchOut) };
});
function branchFields(b) {
  const name = str(b.name, 120); if (!name) throw bad("กรุณาใส่ชื่อสาขา");
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : "#2563eb";
  return { name, code: str(b.code, 20), address: str(b.address, 400), phone: str(b.phone, 40), tax_id: str(b.taxId, 30), color };
}
route("POST", "/api/admin/branches", async ctx => {
  needAdmin(ctx);
  const f = branchFields(ctx.body); const pw = checkNewPassword(ctx.body.password);
  const id = uid();
  await pool.query("INSERT INTO branches (id,code,name,address,phone,tax_id,color,pass_hash,active,sort_order,created_at,pass_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$9,$9)",
    [id, f.code, f.name, f.address, f.phone, f.tax_id, f.color, hashPw(pw), now()]);
  await seedLists(id, str(ctx.body.copyFrom, 100) || null);
  await logActivity(ctx, "branch_add", "สร้างสาขา " + f.name, id);
  return { ok: true, id };
});
route("PUT", "/api/admin/branches/:id", async ctx => {
  needAdmin(ctx);
  const cur = await pool.query("SELECT * FROM branches WHERE id=$1", [ctx.params.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  if (ctx.body.active !== undefined && Object.keys(ctx.body).length === 1) {
    await pool.query("UPDATE branches SET active=$1 WHERE id=$2", [!!ctx.body.active, ctx.params.id]);
    if (!ctx.body.active) await pool.query("DELETE FROM sessions WHERE branch_id=$1", [ctx.params.id]);
    await logActivity(ctx, "branch_active", (ctx.body.active ? "เปิด" : "ปิด") + "ใช้งานสาขา " + cur.rows[0].name, ctx.params.id);
    return { ok: true };
  }
  const f = branchFields(ctx.body);
  await pool.query("UPDATE branches SET code=$1,name=$2,address=$3,phone=$4,tax_id=$5,color=$6 WHERE id=$7", [f.code, f.name, f.address, f.phone, f.tax_id, f.color, ctx.params.id]);
  await logActivity(ctx, "branch_edit", "แก้ไขข้อมูลสาขา " + f.name, ctx.params.id);
  return { ok: true };
});
route("POST", "/api/admin/branches/:id/password", async ctx => {
  needAdmin(ctx);
  const pw = checkNewPassword(ctx.body.password);
  const { rows } = await pool.query("UPDATE branches SET pass_hash=$1, pass_changed_at=$2 WHERE id=$3 RETURNING name", [hashPw(pw), now(), ctx.params.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  await pool.query("DELETE FROM sessions WHERE kind='branch' AND branch_id=$1", [ctx.params.id]);
  await logActivity(ctx, "branch_password", "ตั้งรหัสผ่านใหม่ให้สาขา " + rows[0].name, ctx.params.id);
  return { ok: true };
});
route("POST", "/api/admin/branches/:id/order", async ctx => {
  needAdmin(ctx);
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
  for (let i = 0; i < ids.length; i++) await pool.query("UPDATE branches SET sort_order=$1 WHERE id=$2", [i + 1, String(ids[i])]);
  return { ok: true };
});
route("DELETE", "/api/admin/branches/:id", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1", [ctx.params.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  const me = await pool.query("SELECT pass_hash FROM admins WHERE id=$1", [ctx.session.admin_id]);
  if (!verifyPw(String(ctx.body.adminPassword || ""), me.rows[0].pass_hash)) throw bad("รหัสผ่านผู้ดูแลไม่ถูกต้อง");
  if (str(ctx.body.confirmName, 200) !== rows[0].name) throw bad("พิมพ์ชื่อสาขาให้ตรงเพื่อยืนยันการลบ");
  const id = rows[0].id;
  for (const t of ["files", "records", "lists", "stock_moves", "stock_items", "payroll_items", "payroll_runs", "employees", "doc_counters", "sessions", "transfers", "leaves", "advances", "attendance", "card_plans"]) {
    await pool.query("DELETE FROM " + t + " WHERE branch_id=$1", [id]);
  }
  await pool.query("DELETE FROM branches WHERE id=$1", [id]);
  await logActivity(ctx, "branch_delete", "ลบสาขา " + rows[0].name + " และข้อมูลทั้งหมดของสาขา", id);
  return { ok: true };
});

/* ---------------- admin: overview / activity / backup ---------------- */
route("GET", "/api/admin/overview", async ctx => {
  needAdmin(ctx);
  const { from, to } = rangeOf(ctx.query);
  const br = await pool.query("SELECT id, code, name, color, active FROM branches ORDER BY sort_order, created_at");
  const sums = await pool.query(`SELECT branch_id, type, SUM(total)::float AS s, COUNT(*)::int AS c FROM records WHERE rec_date BETWEEN $1 AND $2 GROUP BY branch_id, type`, [from, to]);
  const stock = await pool.query(`SELECT branch_id, SUM(qty*avg_cost)::float AS v, SUM(CASE WHEN active AND qty<=min_qty AND min_qty>0 THEN 1 ELSE 0 END)::int AS low FROM stock_items GROUP BY branch_id`);
  const emp = await pool.query(`SELECT branch_id, COUNT(*)::int AS c FROM employees WHERE active=TRUE GROUP BY branch_id`);
  const due = await pool.query(`SELECT branch_id, type, SUM(total)::float AS s FROM records WHERE due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL GROUP BY branch_id, type`);
  const months = eachMonth(from, to);
  const monthly = await pool.query(`SELECT branch_id, substr(rec_date,1,7) AS m, type, SUM(total)::float AS s FROM records WHERE rec_date BETWEEN $1 AND $2 GROUP BY branch_id, m, type`, [from, to]);
  const out = br.rows.map(b => {
    const g = t => r2(sums.rows.filter(x => x.branch_id === b.id && x.type === t).reduce((a, x) => a + Number(x.s), 0));
    const st = stock.rows.find(x => x.branch_id === b.id) || {};
    const income = g("income"), expense = g("expense"), invest = g("invest");
    return { id: b.id, code: b.code, name: b.name, color: b.color, active: b.active, income, expense, invest, net: r2(income - expense),
      stockValue: r2(st.v), lowStock: Number(st.low) || 0, employees: Number((emp.rows.find(x => x.branch_id === b.id) || {}).c) || 0,
      payable: r2((due.rows.find(x => x.branch_id === b.id && x.type !== "income") || {}).s), receivable: r2((due.rows.find(x => x.branch_id === b.id && x.type === "income") || {}).s),
      monthly: months.map(m => { const f = t => r2(monthly.rows.filter(x => x.branch_id === b.id && x.m === m && x.type === t).reduce((a, x) => a + Number(x.s), 0)); return { m, income: f("income"), expense: f("expense") }; }) };
  });
  const tot = k => r2(out.reduce((a, x) => a + x[k], 0));
  return { from, to, branches: out, months, totals: { income: tot("income"), expense: tot("expense"), invest: tot("invest"), net: tot("net"), stockValue: tot("stockValue"), employees: out.reduce((a, x) => a + x.employees, 0) } };
});
async function activityQuery(q, branchId) {
  const lim = Math.min(5000, Math.max(10, num(q.limit, 1000)));
  const params = []; let where = "WHERE 1=1";
  const bid = branchId || q.branchId;
  if (bid === "_system") where += " AND a.branch_id IS NULL";
  else if (bid) { params.push(bid); where += " AND a.branch_id=$" + params.length; }
  if (q.actor) { params.push(String(q.actor).slice(0, 200)); where += " AND a.actor=$" + params.length; }
  if (q.action) { params.push(String(q.action).slice(0, 50)); where += " AND a.action=$" + params.length; }
  if (isDate(q.from)) { params.push(new Date(q.from + "T00:00:00+07:00").getTime()); where += " AND a.at>=$" + params.length; }
  if (isDate(q.to)) { params.push(new Date(q.to + "T23:59:59.999+07:00").getTime()); where += " AND a.at<=$" + params.length; }
  const { rows } = await pool.query(`SELECT a.*, b.name AS branch_name FROM activity a LEFT JOIN branches b ON b.id=a.branch_id ${where} ORDER BY a.at DESC LIMIT ${lim}`, params);
  return rows.map(r => ({ at: Number(r.at), actor: r.actor, kind: r.actor_kind, branchName: r.branch_name || "", action: r.action, detail: r.detail,
    ip: r.ip || "", ua: r.ua || "", lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng) }));
}
route("GET", "/api/admin/activity", async ctx => {
  needAdmin(ctx);
  return { activity: await activityQuery(ctx.query) };
});
// log การใช้งานของสาขา (ตามสิทธิ์เมนู log)
route("GET", B + "/activity", async ctx => {
  await needBranch(ctx, "log", "view");
  return { activity: await activityQuery(ctx.query, ctx.branch.id) };
});
route("GET", "/api/admin/backup", async ctx => {
  needAdmin(ctx);
  const withFiles = ctx.query.files === "1";
  const out = { app: "restaurant-accounting", build: BUILD_ID, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of ["settings", "admins", "users", "branches", "lists", "records", "doc_counters", "stock_items", "stock_moves", "employees", "payroll_runs", "payroll_items", "transfers", "leaves", "advances", "attendance", "card_plans", "activity", "files"]) {
    if (t === "files" && !withFiles) { out.tables.files = (await pool.query("SELECT id, record_id, branch_id, filename, mime, size, created_at FROM files")).rows; continue; }
    out.tables[t] = (await pool.query("SELECT * FROM " + t)).rows;
  }
  await logActivity(ctx, "backup", "ดาวน์โหลดไฟล์สำรองข้อมูล" + (withFiles ? " (รวมไฟล์แนบ)" : ""));
  return { __download: "backup-" + todayBkk() + ".json", __body: JSON.stringify(out) };
});

/* ---------------- lists (หมวด / ช่องทาง / ผู้ขาย / หน่วย) ---------------- */
/* ---------- กลุ่มในงบการเงินของแต่ละหมวด ---------- */
const FS_GROUPS = {
  income_category: { sales: "รายได้จากการขาย", other_income: "รายได้อื่น" },
  expense_category: { cogs: "ต้นทุนขาย", selling: "ค่าใช้จ่ายในการขาย", staff: "ค่าใช้จ่ายพนักงาน", admin: "ค่าใช้จ่ายบริหาร", other_expense: "ค่าใช้จ่ายอื่น", income_tax: "ภาษีเงินได้" },
  invest_category: { equipment: "อุปกรณ์", furniture: "เฟอร์นิเจอร์", leasehold: "ส่วนปรับปรุงร้าน", vehicle: "ยานพาหนะ", software: "ซอฟต์แวร์", other_asset: "สินทรัพย์อื่น" }
};
// เดากลุ่มเริ่มต้นจากชื่อหมวด (หมวดเดิมที่ยังไม่ได้ตั้งกลุ่ม)
function guessFsGroup(kind, name) {
  const n = String(name || "");
  if (kind === "income_category") return /อื่น|ดอกเบี้ย|เงินปันผล|ขายทรัพย์สิน|ขายเศษ|คืนภาษี|ชดเชย/.test(n) ? "other_income" : "sales";
  if (kind === "expense_category") {
    if (/ภาษีเงินได้|ภ\.ง\.ด\.\s*5[01]/.test(n)) return "income_tax";
    if (/วัตถุดิบ|เครื่องดื่ม|บรรจุภัณฑ์|ต้นทุน|อาหารสด|เนื้อ|ผัก|น้ำแข็ง/.test(n)) return "cogs";
    if (/เงินเดือน|ค่าแรง|ประกันสังคม|สวัสดิการ|พนักงาน|โบนัส|ค่าจ้าง|เบิก/.test(n)) return "staff";
    if (/การตลาด|โฆษณา|คอมมิชชั่น|คอมมิชชัน|เดลิเวอรี่|โปรโมชั่น|ส่งเสริมการขาย|GP/.test(n)) return "selling";
    if (/ดอกเบี้ย|ขาดทุนจาก|ค่าปรับ/.test(n)) return "other_expense";
    return "admin";
  }
  if (kind === "invest_category") {
    if (/เฟอร์นิเจอร์|โต๊ะ|เก้าอี้/.test(n)) return "furniture";
    if (/ตกแต่ง|ปรับปรุง|ก่อสร้าง|ต่อเติม|ป้าย/.test(n)) return "leasehold";
    if (/รถ|ยานพาหนะ|มอเตอร์ไซค์/.test(n)) return "vehicle";
    if (/ซอฟต์แวร์|โปรแกรม|ระบบ|software/i.test(n)) return "software";
    if (/อุปกรณ์|ครัว|เครื่องใช้ไฟฟ้า|เครื่อง|ตู้|เตา/.test(n)) return "equipment";
    return "other_asset";
  }
  return null;
}
const LIST_MENU = { income_category: ["income"], expense_category: ["expense"], invest_category: ["invest"], vendor: ["expense", "invest"],
  payment_channel: ["income", "expense", "invest", "accounts"], stock_category: ["stock"], unit: ["stock", "expense", "invest"] };
route("GET", B + "/lists", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT id, kind, name, is_credit, opening_balance, opening_date, fs_group, card_cut_day, card_due_day, card_limit FROM lists WHERE branch_id=$1 ORDER BY sort_order", [ctx.branch.id]);
  const out = {}; LIST_KINDS.forEach(k => { out[k] = []; });
  rows.forEach(r => { if (out[r.kind]) out[r.kind].push({ id: r.id, name: r.name, isCredit: !!r.is_credit, openingBalance: r.opening_balance == null ? null : Number(r.opening_balance), openingDate: r.opening_date || "",
    ...(r.kind === "payment_channel" && r.card_due_day ? { card: { cutDay: Number(r.card_cut_day), dueDay: Number(r.card_due_day), limit: r.card_limit == null ? null : Number(r.card_limit) } } : {}),
    ...(FS_GROUPS[r.kind] ? { fsGroup: FS_GROUPS[r.kind][r.fs_group] ? r.fs_group : "", fsGuess: guessFsGroup(r.kind, r.name) } : {}) }); });
  return { lists: out, fsGroups: FS_GROUPS, synced: (await getSettings()).lists_sync_all === "1" };
});
route("POST", B + "/lists", async ctx => {
  await needBranch(ctx);
  const kind = ctx.body.kind, name = str(ctx.body.name, 120);
  if (!LIST_KINDS.includes(kind) || !name) throw bad("ข้อมูลไม่ถูกต้อง");
  if (!can(ctx, "settings", "edit")) need(ctx, LIST_MENU[kind], "edit");
  const dup = await pool.query("SELECT 1 FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [ctx.branch.id, kind, name]);
  if (dup.rows.length) throw bad("มีรายการนี้อยู่แล้ว");
  const id = uid();
  const ob = kind === "payment_channel" && !ctx.body.isCredit && ctx.body.openingBalance !== undefined && ctx.body.openingBalance !== "" ? r2(num(ctx.body.openingBalance, 0)) : null;
  await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order,opening_balance,opening_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, ctx.branch.id, kind, name, !!ctx.body.isCredit, now(), ob, ob !== null ? (isDate(ctx.body.openingDate) ? ctx.body.openingDate : todayBkk()) : null]);
  // โหมดใช้ร่วมกันทุกสาขา: เพิ่มให้สาขาอื่นด้วย (ยอดยกมาเป็นของสาขานี้เท่านั้น)
  const others = (await syncBranchIds(ctx.branch.id)).filter(b => b !== ctx.branch.id);
  const n = await listOpAll(others, "add", kind, { name, isCredit: !!ctx.body.isCredit });
  await logActivity(ctx, "list_add", "เพิ่ม " + name + (n ? " (และอีก " + n + " สาขา)" : ""), ctx.branch.id);
  return { ok: true, id };
});
const LIST_RENAME_MAP = {
  income_category: [["records", "category"]], expense_category: [["records", "category"]], invest_category: [["records", "category"]],
  vendor: [["records", "party"]], payment_channel: [["records", "payment_channel"], ["records", "settled_channel"], ["payroll_runs", "payment_channel"], ["transfers", "from_ch"], ["transfers", "to_ch"]],
  stock_category: [["stock_items", "category"]], unit: [["stock_items", "unit"]]
};
// เปลี่ยนชื่อรายการในสาขาหนึ่ง + เปลี่ยนชื่อในเอกสารเก่าให้ด้วย ยอดตามหมวดจะได้ไม่แยกเป็นสองชื่อ
async function renameListIn(bid, kind, oldName, name) {
  const cur = (await pool.query("SELECT id FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [bid, kind, oldName])).rows[0];
  if (!cur) return false;
  const dup = (await pool.query("SELECT id FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [bid, kind, name])).rows[0];
  if (dup) await pool.query("DELETE FROM lists WHERE id=$1", [cur.id]); // มีชื่อใหม่อยู่แล้ว → รวมเป็นรายการเดียว
  else await pool.query("UPDATE lists SET name=$1 WHERE id=$2", [name, cur.id]);
  for (const [t, c] of LIST_RENAME_MAP[kind] || []) await pool.query(`UPDATE ${t} SET ${c}=$1 WHERE branch_id=$2 AND ${c}=$3`, [name, bid, oldName]);
  if (kind.endsWith("_category")) {
    const recs = await pool.query("SELECT id, items_json FROM records WHERE branch_id=$1 AND items_json LIKE $2", [bid, "%" + oldName.replace(/[%_]/g, "") + "%"]);
    for (const r of recs.rows) {
      let items; try { items = JSON.parse(r.items_json || "[]"); } catch (e) { continue; }
      let ch = false; items.forEach(it => { if (it.category === oldName) { it.category = name; ch = true; } });
      if (ch) await pool.query("UPDATE records SET items_json=$1 WHERE id=$2", [JSON.stringify(items), r.id]);
    }
  }
  return true;
}
// สาขาที่ต้องทำด้วย: โหมดใช้ร่วมกันทุกสาขา = ทุกสาขา, ไม่ใช่ = สาขานี้สาขาเดียว
async function syncBranchIds(bid) {
  const s = await getSettings();
  if (s.lists_sync_all !== "1") return [bid];
  return (await pool.query("SELECT id FROM branches ORDER BY sort_order, created_at")).rows.map(r => r.id);
}
// ทำคำสั่งเดียวกันกับหลายสาขา โดยจับคู่รายการจาก "ประเภท + ชื่อ" · คืนค่าจำนวนสาขาที่มีการเปลี่ยนแปลง
async function listOpAll(bids, op, kind, a) {
  let changed = 0;
  for (const bid of bids) {
    const row = a.name ? (await pool.query("SELECT * FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [bid, kind, a.name])).rows[0] : null;
    if (op === "add") { if (!row) { await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order,fs_group) VALUES ($1,$2,$3,$4,$5,$6,$7)", [uid(), bid, kind, a.name, !!a.isCredit, now(), a.fsGroup || null]); changed++; } }
    else if (op === "rename") { if (await renameListIn(bid, kind, a.name, a.newName)) changed++; }
    else if (op === "delete") { if (row) { await pool.query("DELETE FROM lists WHERE id=$1", [row.id]); changed++; } }
    else if (op === "credit") { if (row) { await pool.query("UPDATE lists SET is_credit=$1 WHERE id=$2", [!!a.isCredit, row.id]); changed++; } }
    else if (op === "fs") { if (row) { await pool.query("UPDATE lists SET fs_group=$1 WHERE id=$2", [a.fsGroup, row.id]); changed++; } }
    else if (op === "card") { if (row) { await pool.query("UPDATE lists SET card_cut_day=$1, card_due_day=$2, card_limit=$3, is_credit=CASE WHEN $2::int IS NULL THEN is_credit ELSE TRUE END WHERE id=$4", [a.cutDay, a.dueDay, a.limit, row.id]); changed++; } }
    else if (op === "order") {
      const rows = (await pool.query("SELECT id, name FROM lists WHERE branch_id=$1 AND kind=$2 ORDER BY sort_order", [bid, kind])).rows;
      const pos = n => { const i = a.names.indexOf(n); return i < 0 ? 100000 : i; };
      rows.sort((x, y) => pos(x.name) - pos(y.name));
      for (let i = 0; i < rows.length; i++) await pool.query("UPDATE lists SET sort_order=$1 WHERE id=$2", [i + 1, rows[i].id]);
      changed++;
    }
  }
  return changed;
}
// จัดการหมวดสต็อกจากหน้าสต็อกได้: ผู้มีสิทธิ์ตั้งค่าหมวด หรือ ผู้แก้ไขสต็อกที่เป็นผู้อนุมัติสต็อก
const canManageList = (ctx, kind) => can(ctx, "settings", "edit") || ((kind === "stock_category" || kind === "unit") && can(ctx, "stock", "edit") && !!ctx.perms.approve.stock);
route("PUT", B + "/lists/:id", async ctx => {
  await needBranch(ctx);
  const cur = await pool.query("SELECT * FROM lists WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบรายการ");
  const L = cur.rows[0];
  if (!canManageList(ctx, L.kind)) need(ctx, "settings", "edit");
  const bids = await syncBranchIds(ctx.branch.id);
  const many = bids.length > 1 ? " (ทุกสาขา)" : "";
  if (ctx.body.fsGroup !== undefined && FS_GROUPS[L.kind]) {
    const g = FS_GROUPS[L.kind][ctx.body.fsGroup] ? ctx.body.fsGroup : null;
    await listOpAll(bids, "fs", L.kind, { name: L.name, fsGroup: g });
    await logActivity(ctx, "list_fs_group", "ตั้งกลุ่มงบการเงินของ " + L.name + " = " + (g ? FS_GROUPS[L.kind][g] : "อัตโนมัติ") + many, ctx.branch.id);
  }
  if (ctx.body.isCredit !== undefined) await listOpAll(bids, "credit", L.kind, { name: L.name, isCredit: !!ctx.body.isCredit });
  if (ctx.body.card !== undefined && L.kind === "payment_channel") {
    const cd = ctx.body.card;
    if (cd === null) await listOpAll(bids, "card", L.kind, { name: L.name, cutDay: null, dueDay: null, limit: null });
    else {
      const cut = Math.round(num(cd.cutDay, 0)), due = Math.round(num(cd.dueDay, 0));
      if (cut < 1 || cut > 31 || due < 1 || due > 31) throw bad("วันตัดรอบและวันครบกำหนดต้องอยู่ระหว่าง 1 - 31");
      const limit = cd.limit === "" || cd.limit == null ? null : r2(Math.max(0, num(cd.limit, 0)));
      await listOpAll(bids, "card", L.kind, { name: L.name, cutDay: cut, dueDay: due, limit });
    }
    await logActivity(ctx, "card_setting", cd === null ? "ยกเลิกการตั้งค่าบัตร " + L.name : "ตั้งค่าบัตร " + L.name + " ตัดรอบวันที่ " + cd.cutDay + " ครบกำหนดวันที่ " + cd.dueDay + (cd.limit ? " วงเงิน " + cd.limit : "") + many, ctx.branch.id);
  }
  if (ctx.body.name !== undefined) {
    const name = str(ctx.body.name, 120); if (!name) throw bad("กรุณาใส่ชื่อ");
    if (name !== L.name) {
      const dup = await pool.query("SELECT 1 FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [ctx.branch.id, L.kind, name]);
      if (dup.rows.length) throw bad("มีรายการนี้อยู่แล้ว");
      await listOpAll(bids, "rename", L.kind, { name: L.name, newName: name });
      await logActivity(ctx, "list_rename", "เปลี่ยนชื่อ " + L.name + " → " + name + many, ctx.branch.id);
    }
  }
  if (Array.isArray(ctx.body.order)) {
    const rows = (await pool.query("SELECT id, name FROM lists WHERE branch_id=$1 AND kind=$2", [ctx.branch.id, L.kind])).rows;
    const names = ctx.body.order.map(id => (rows.find(r => r.id === String(id)) || {}).name).filter(Boolean);
    await listOpAll(bids, "order", L.kind, { names });
  }
  return { ok: true };
});
route("DELETE", B + "/lists/:id", async ctx => {
  await needBranch(ctx);
  const L = (await pool.query("SELECT * FROM lists WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!L) return { ok: true };
  if (!canManageList(ctx, L.kind)) need(ctx, "settings", "edit");
  const bids = await syncBranchIds(ctx.branch.id);
  // ลบหมวดสต็อก: ย้ายสินค้าในหมวดนี้ไปหมวดอื่น (หรือ "ไม่ระบุหมวด")
  if (L.kind === "stock_category" && ctx.query.moveTo !== undefined) {
    const to = str(ctx.query.moveTo, 120);
    await pool.query("UPDATE stock_items SET category=$1, updated_at=$2 WHERE branch_id = ANY($3::text[]) AND category=$4", [to, now(), pgArr(bids), L.name]);
  }
  await listOpAll(bids, "delete", L.kind, { name: L.name });
  await logActivity(ctx, "list_delete", "ลบ " + L.name + (bids.length > 1 ? " (ทุกสาขา)" : ""), ctx.branch.id);
  return { ok: true };
});
// Admin: คัดลอกหมวด/ช่องทาง/ผู้ขาย/หน่วย (และรายการสินค้าสต็อก) จากสาขาหนึ่งไปสาขาอื่น
route("POST", "/api/admin/lists/copy", async ctx => {
  needAdmin(ctx);
  const b = ctx.body || {};
  const from = str(b.from, 100);
  const all = (await pool.query("SELECT id, name FROM branches ORDER BY sort_order, created_at")).rows;
  const src = all.find(x => x.id === from); if (!src) throw bad("กรุณาเลือกสาขาต้นทาง");
  const targets = (b.to === "all" ? all.map(x => x.id) : (Array.isArray(b.to) ? b.to.map(String) : [])).filter(id => id !== from && all.some(x => x.id === id));
  if (!targets.length) throw bad("กรุณาเลือกสาขาปลายทางอย่างน้อย 1 สาขา");
  const kinds = (Array.isArray(b.kinds) ? b.kinds : LIST_KINDS).filter(k => LIST_KINDS.includes(k));
  const srcRows = (await pool.query("SELECT * FROM lists WHERE branch_id=$1 ORDER BY sort_order", [from])).rows.filter(r => kinds.includes(r.kind));
  const result = [];
  for (const tid of targets) {
    const res = { branch: all.find(x => x.id === tid).name, added: 0, updated: 0, removed: 0, stockAdded: 0 };
    const cur = (await pool.query("SELECT * FROM lists WHERE branch_id=$1", [tid])).rows;
    for (let i = 0; i < srcRows.length; i++) {
      const s = srcRows[i]; const t = cur.find(r => r.kind === s.kind && r.name === s.name);
      if (!t) { await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order,fs_group,card_cut_day,card_due_day,card_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [uid(), tid, s.kind, s.name, !!s.is_credit, i + 1, s.fs_group, s.card_cut_day, s.card_due_day, s.card_limit]); res.added++; }
      else { if (!!t.is_credit !== !!s.is_credit || (t.fs_group || null) !== (s.fs_group || null) || (t.card_due_day || null) !== (s.card_due_day || null)) res.updated++;
        await pool.query("UPDATE lists SET is_credit=$1, fs_group=$2, sort_order=$3, card_cut_day=$4, card_due_day=$5, card_limit=$6 WHERE id=$7", [!!s.is_credit, s.fs_group, i + 1, s.card_cut_day, s.card_due_day, s.card_limit, t.id]); }
    }
    // รายการที่สาขาปลายทางมีแต่ต้นทางไม่มี: ลบออก (ถ้าเลือก) หรือเก็บไว้ท้ายรายการ — เอกสารเก่ายังเก็บชื่อเดิมไว้
    for (const t of cur.filter(r => kinds.includes(r.kind) && !srcRows.some(s => s.kind === r.kind && s.name === r.name))) {
      if (b.removeExtra) { await pool.query("DELETE FROM lists WHERE id=$1", [t.id]); res.removed++; }
      else await pool.query("UPDATE lists SET sort_order=$1 WHERE id=$2", [100000 + Number(t.sort_order) % 100000, t.id]);
    }
    if (b.stockItems) {
      const items = (await pool.query("SELECT * FROM stock_items WHERE branch_id=$1 AND active=TRUE ORDER BY category, name", [from])).rows;
      for (const it of items) {
        const ex = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [tid, it.name]);
        if (ex.rows.length) continue;
        await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$9)",
          [uid(), tid, it.sku, it.name, it.category, it.unit, it.min_qty, it.note, now()]);
        res.stockAdded++;
      }
    }
    result.push(res);
    await logActivity(ctx, "list_copy", "คัดลอกหมวด/ช่องทางจาก " + src.name + " ไป " + res.branch + ": เพิ่ม " + res.added + ", ปรับ " + res.updated + (b.removeExtra ? ", ลบ " + res.removed : "") + (b.stockItems ? ", สินค้าสต็อกใหม่ " + res.stockAdded : ""), tid);
  }
  return { ok: true, from: src.name, result };
});

/* ================= เอกสารบัญชี (รายรับ / รายจ่าย / สินทรัพย์) ================= */
const REC_TYPES = ["income", "expense", "invest"];
function rangeOf(q) {
  let from = q.from, to = q.to;
  if (!isDate(from) || !isDate(to)) { const t = todayBkk(); from = t.slice(0, 8) + "01"; to = t; }
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
function calcRecord(b, type) {
  const rawItems = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  const items = [];
  for (const it of rawItems) {
    const name = str(it.name, 200), category = str(it.category, 120);
    const qty = r4(num(it.qty, 1)), price = r4(num(it.price, 0));
    if (!name && !category && !price) continue;
    if (qty <= 0) throw bad("จำนวนต้องมากกว่า 0 (" + (name || category) + ")");
    if (price < 0) throw bad("ราคาต่อหน่วยต้องไม่ติดลบ");
    const line = { name, category, qty, unit: str(it.unit, 30), price, amount: r2(qty * price) };
    if (type !== "income" && it.stockItemId) line.stockItemId = str(it.stockItemId, 100);
    items.push(line);
  }
  if (!items.length) throw bad("กรุณาใส่รายการอย่างน้อย 1 บรรทัด");
  if (items.some(i => !i.category)) throw bad("กรุณาเลือกหมวดให้ครบทุกบรรทัด");
  const subtotal = r2(items.reduce((a, i) => a + i.amount, 0));
  const dType = b.discountType === "percent" ? "percent" : "baht";
  const dVal = Math.max(0, num(b.discountValue, 0));
  let discount = dType === "percent" ? r2(subtotal * Math.min(dVal, 100) / 100) : r2(Math.min(dVal, subtotal));
  const after = r2(subtotal - discount);
  const vatMode = ["incl", "excl"].includes(b.vatMode) ? b.vatMode : "none";
  let vat = 0, total = after;
  if (vatMode === "incl") vat = r2(after * 7 / 107);
  if (vatMode === "excl") { vat = r2(after * 0.07); total = r2(after + vat); }
  if (total > 100000000) throw bad("ยอดเงินมากเกินไป");
  return { items, subtotal, discountType: dType, discountValue: dVal, discount, vatMode, vat, total };
}
async function nextDocNo(branchId, type, recDate) {
  const s = await getSettings();
  const prefix = s["doc_prefix_" + type] || type.slice(0, 2).toUpperCase();
  const period = recDate.slice(2, 4) + recDate.slice(5, 7);
  const { rows } = await pool.query(
    `INSERT INTO doc_counters (branch_id,prefix,period,n) VALUES ($1,$2,$3,1)
     ON CONFLICT (branch_id,prefix,period) DO UPDATE SET n=doc_counters.n+1 RETURNING n`, [branchId, prefix, period]);
  return prefix + period + "-" + String(rows[0].n).padStart(4, "0");
}
function recordOut(r, files) {
  let items = []; try { items = JSON.parse(r.items_json || "[]"); } catch (e) {}
  return { id: r.id, type: r.type, docNo: r.doc_no, date: r.rec_date, party: r.party || "", description: r.description || "", category: r.category || "",
    items, subtotal: Number(r.subtotal), discountType: r.discount_type || "baht", discountValue: Number(r.discount_value) || 0, discount: Number(r.discount),
    vatMode: r.vat_mode, vat: Number(r.vat_amount), total: Number(r.total), paymentChannel: r.payment_channel || "", dueDate: r.due_date || "",
    settledAt: Number(r.settled_at) || null, settledDate: r.settled_date || "", settledBy: r.settled_by || "", settledChannel: r.settled_channel || "",
    source: r.source, refId: r.ref_id || "", note: r.note || "", createdBy: r.created_by || "", createdAt: Number(r.created_at),
    updatedBy: r.updated_by || "", updatedAt: Number(r.updated_at) || null, planId: r.plan_id || "", planSeq: r.plan_seq || null, planCount: r.plan_count || null, settleBatch: r.settle_batch || "", files: files || [], fileCount: r.file_count != null ? Number(r.file_count) : (files || []).length };
}
async function filesFor(ids) {
  if (!ids.length) return {};
  const { rows } = await pool.query("SELECT id, record_id, filename, mime, size, created_at FROM files WHERE record_id = ANY($1::text[]) ORDER BY created_at", ["{" + ids.map(i => '"' + i + '"').join(",") + "}"]);
  const m = {}; rows.forEach(f => { (m[f.record_id] = m[f.record_id] || []).push({ id: f.id, filename: f.filename, mime: f.mime, size: Number(f.size) || 0 }); });
  return m;
}

// เห็นเอกสารประเภทนี้ได้ไหม: มีสิทธิ์เมนูประเภทนั้น หรือ สมุดบัญชี
const canSeeType = (ctx, type) => can(ctx, [type, "ledger"], "view");
route("GET", B + "/records", async ctx => {
  await needBranch(ctx);
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "r.branch_id=$1 AND r.rec_date BETWEEN $2 AND $3";
  if (REC_TYPES.includes(ctx.query.type)) { need(ctx, [ctx.query.type, "ledger"], "view"); params.push(ctx.query.type); where += " AND r.type=$" + params.length; }
  else {
    const types = REC_TYPES.filter(t => canSeeType(ctx, t));
    if (!types.length) need(ctx, "ledger", "view");
    if (types.length < REC_TYPES.length) where += " AND r.type IN (" + types.map(t => "'" + t + "'").join(",") + ")";
  }
  if (ctx.query.status === "unsettled") where += " AND r.due_date IS NOT NULL AND r.due_date<>'' AND r.settled_at IS NULL";
  if (ctx.query.q) { params.push("%" + String(ctx.query.q).slice(0, 100) + "%"); where += ` AND (r.doc_no ILIKE $${params.length} OR r.party ILIKE $${params.length} OR r.description ILIKE $${params.length} OR r.items_json ILIKE $${params.length})`; }
  const { rows } = await pool.query(`SELECT r.*, (SELECT COUNT(*) FROM files f WHERE f.record_id=r.id)::int AS file_count FROM records r WHERE ${where} ORDER BY r.rec_date DESC, r.created_at DESC LIMIT 2000`, params);
  return { from, to, records: rows.map(r => recordOut(r)) };
});
route("GET", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  if (!canSeeType(ctx, rows[0].type) && !can(ctx, ["dashboard", "accounts"], "view")) need(ctx, rows[0].type, "view");
  const f = await filesFor([rows[0].id]);
  return { record: recordOut(rows[0], f[rows[0].id] || []) };
});

async function applyRecordStock(ctx, recId, rec) {
  // ลบการเคลื่อนไหวสต็อกเดิมของเอกสารนี้ แล้วสร้างใหม่ตามบรรทัดที่ผูกกับสินค้า (ซื้อเข้า = รับเข้าสต็อก)
  const old = await pool.query("SELECT DISTINCT item_id FROM stock_moves WHERE ref_record_id=$1", [recId]);
  await pool.query("DELETE FROM stock_moves WHERE ref_record_id=$1", [recId]);
  const touched = new Set(old.rows.map(r => r.item_id));
  if (rec && rec.type !== "income") {
    const ratio = rec.subtotal > 0 ? (rec.subtotal - rec.discount) / rec.subtotal : 1;
    for (const it of rec.items) {
      if (!it.stockItemId) continue;
      const si = await pool.query("SELECT id FROM stock_items WHERE id=$1 AND branch_id=$2", [it.stockItemId, ctx.branch.id]);
      if (!si.rows[0]) continue;
      const amount = r2(it.amount * ratio);
      await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,unit_cost,amount,note,ref_record_id,created_by,created_at)
        VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11)`,
        [uid(), ctx.branch.id, it.stockItemId, rec.date, it.qty, r4(amount / it.qty), amount, "ซื้อเข้า " + (rec.docNo || ""), recId, ctx.session.actor, now()]);
      touched.add(it.stockItemId);
    }
  }
  for (const id of touched) await recomputeItem(id);
}

async function saveRecord(ctx, existing) {
  const b = ctx.body || {};
  const type = existing ? existing.type : b.type;
  if (!REC_TYPES.includes(type)) throw bad("ประเภทเอกสารไม่ถูกต้อง");
  const date = isDate(b.date) ? b.date : todayBkk();
  const c = calcRecord(b, type);
  const payment = str(b.paymentChannel, 120);
  const chRow = payment ? (await pool.query("SELECT is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [ctx.branch.id, payment])).rows[0] : null;
  const isCredit = !!(chRow && chRow.is_credit);
  const unpaid = b.unpaid === true || isCredit;
  // ชำระแล้ว = เงินเข้า/ออกบัญชีทันที (ต้องเลือกช่องทาง) · ยังไม่ชำระ/บัตรเครดิต = ค้างรับ/ค้างจ่าย (ต้องมีวันครบกำหนด)
  let dueDate = unpaid ? (isDate(b.dueDate) ? b.dueDate : "") : "";
  // บัตรเครดิตที่ตั้งวันตัดรอบไว้: คำนวณวันครบกำหนดให้อัตโนมัติ
  if (unpaid && !dueDate && isCredit && type !== "income") { const cr = await cardRow(ctx.branch.id, payment); if (isCardRow(cr)) dueDate = cardDueFor(date, Number(cr.card_cut_day), Number(cr.card_due_day)); }
  if (unpaid && !dueDate) throw bad("รายการที่ยังไม่ชำระ ต้องระบุวันครบกำหนด");
  if (!unpaid && !payment) throw bad("กรุณาเลือกช่องทาง" + (type === "income" ? "รับเงิน" : "ชำระเงิน") + " (เงินเข้า/ออกจากบัญชีไหน)");
  const cats = [...new Set(c.items.map(i => i.category))];
  const category = cats.length === 1 ? cats[0] : cats.join(", ");
  const description = str(b.description, 300) || c.items.map(i => i.name || i.category).filter(Boolean).slice(0, 3).join(", ");
  const id = existing ? existing.id : uid();
  let docNo = existing ? existing.doc_no : await nextDocNo(ctx.branch.id, type, date);
  if (existing && existing.rec_date.slice(0, 7) !== date.slice(0, 7)) docNo = await nextDocNo(ctx.branch.id, type, date);
  const vals = [ctx.branch.id, type, docNo, date, str(b.party, 200), description, category, JSON.stringify(c.items), c.subtotal, c.discountType, c.discountValue, c.discount,
    c.vatMode, c.vat, c.total, payment, dueDate || null, str(b.note, 1000)];
  if (existing) {
    await pool.query(`UPDATE records SET branch_id=$1,type=$2,doc_no=$3,rec_date=$4,party=$5,description=$6,category=$7,items_json=$8,subtotal=$9,discount_type=$10,discount_value=$11,discount=$12,
      vat_mode=$13,vat_amount=$14,total=$15,payment_channel=$16,due_date=$17,note=$18,updated_by=$19,updated_at=$20 WHERE id=$21`, [...vals, ctx.session.actor, now(), id]);
    if (!dueDate) await pool.query("UPDATE records SET settled_at=NULL, settled_date=NULL, settled_by=NULL, settled_channel=NULL WHERE id=$1", [id]);
  } else {
    await pool.query(`INSERT INTO records (branch_id,type,doc_no,rec_date,party,description,category,items_json,subtotal,discount_type,discount_value,discount,
      vat_mode,vat_amount,total,payment_channel,due_date,note,created_by,created_at,source,id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'manual',$21)`,
      [...vals, ctx.session.actor, now(), id]);
  }
  await applyRecordStock(ctx, id, { type, date, docNo, items: c.items, subtotal: c.subtotal, discount: c.discount });
  const TYPE_TH = { income: "รายรับ", expense: "รายจ่าย", invest: "สินทรัพย์/งบลงทุน" };
  await logActivity(ctx, existing ? "record_edit" : "record_add", (existing ? "แก้ไข" : "บันทึก") + TYPE_TH[type] + " " + docNo + " ฿" + c.total.toLocaleString("en-US", { minimumFractionDigits: 2 }), ctx.branch.id);
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1", [id]);
  return recordOut(rows[0]);
}
route("POST", B + "/records", async ctx => { await needBranch(ctx); need(ctx, REC_TYPES.includes(ctx.body.type) ? ctx.body.type : "income", "edit"); return { record: await saveRecord(ctx, null) }; });
const SOURCE_LOCK = { payroll: "เอกสารนี้สร้างจากระบบเงินเดือน — แก้ไข/ยกเลิกได้ที่เมนูเงินเดือน", advance: "เอกสารนี้สร้างจากการอนุมัติเบิกเงินล่วงหน้า — ยกเลิกได้ที่เมนูเบิกเงินล่วงหน้า",
  installment: "เอกสารนี้เป็นงวดผ่อนบัตรเครดิต — ยกเลิกแผนผ่อนได้ที่เมนูบัตรเครดิต", card_fee: "เอกสารนี้สร้างจากการชำระบิลบัตร — ยกเลิกการชำระได้ที่เมนูบัตรเครดิต" };
async function getRecordFor(ctx, level) {
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  need(ctx, rows[0].type, level); return rows[0];
}
route("PUT", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const rec = await getRecordFor(ctx, "edit");
  if (SOURCE_LOCK[rec.source]) throw bad(SOURCE_LOCK[rec.source]);
  return { record: await saveRecord(ctx, rec) };
});
route("DELETE", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const rows = [await getRecordFor(ctx, "edit")];
  if (SOURCE_LOCK[rows[0].source]) throw bad(SOURCE_LOCK[rows[0].source]);
  await applyRecordStock(ctx, rows[0].id, null);
  await pool.query("DELETE FROM files WHERE record_id=$1", [rows[0].id]);
  await pool.query("DELETE FROM records WHERE id=$1", [rows[0].id]);
  await logActivity(ctx, "record_delete", "ลบเอกสาร " + rows[0].doc_no + " ฿" + Number(rows[0].total).toFixed(2), ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/records/:id/settle", async ctx => {
  await needBranch(ctx); await getRecordFor(ctx, "edit");
  const undo = !!ctx.body.undo;
  const d = isDate(ctx.body.date) ? ctx.body.date : todayBkk();
  const ch = str(ctx.body.channel, 120);
  if (!undo) {
    const c = await pool.query("SELECT is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [ctx.branch.id, ch]);
    if (!c.rows[0]) throw bad("กรุณาเลือกบัญชีที่รับ/จ่ายเงิน");
    if (c.rows[0].is_credit) throw bad("เลือกบัญชีเงินจริง (เช่น เงินสด หรือบัญชีธนาคาร) ไม่ใช่ช่องทางแบบเครดิต");
  }
  const { rows } = await pool.query(undo
    ? "UPDATE records SET settled_at=NULL, settled_date=NULL, settled_by=NULL, settled_channel=NULL, settle_batch=NULL WHERE id=$1 AND branch_id=$2 RETURNING doc_no"
    : "UPDATE records SET settled_at=$3, settled_date=$4, settled_by=$5, settled_channel=$6 WHERE id=$1 AND branch_id=$2 RETURNING doc_no",
    undo ? [ctx.params.id, ctx.branch.id] : [ctx.params.id, ctx.branch.id, now(), d, ctx.session.actor, ch]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  await logActivity(ctx, "record_settle", (undo ? "ยกเลิกสถานะชำระแล้ว " : "บันทึกชำระแล้ว (" + ch + ") ") + rows[0].doc_no, ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/records/:id/files", async ctx => {
  await needBranch(ctx); await getRecordFor(ctx, "edit");
  const rec = await pool.query("SELECT id, doc_no FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rec.rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  const mime = str(ctx.body.mime, 100), data = String(ctx.body.data || "");
  if (!/^(image\/(png|jpeg|webp|gif|heic)|application\/pdf)$/.test(mime)) throw bad("แนบได้เฉพาะรูปภาพหรือ PDF");
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw bad("ไฟล์ไม่ถูกต้อง");
  const size = Math.floor(data.length * 3 / 4);
  if (size > 8 * 1024 * 1024) throw bad("ไฟล์ใหญ่เกิน 8MB");
  const cnt = await pool.query("SELECT COUNT(*)::int AS c FROM files WHERE record_id=$1", [ctx.params.id]);
  if (Number(cnt.rows[0].c) >= 10) throw bad("แนบไฟล์ได้สูงสุด 10 ไฟล์ต่อเอกสาร");
  const id = uid();
  await pool.query("INSERT INTO files (id,record_id,branch_id,filename,mime,size,data,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, ctx.params.id, ctx.branch.id, str(ctx.body.filename, 200) || "file", mime, size, data, ctx.session.actor, now()]);
  await logActivity(ctx, "file_add", "แนบไฟล์ในเอกสาร " + rec.rows[0].doc_no, ctx.branch.id);
  return { ok: true, id };
});
route("GET", B + "/files/:fid", async (ctx, req, res) => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT f.*, r.type AS rec_type FROM files f LEFT JOIN records r ON r.id=f.record_id WHERE f.id=$1 AND f.branch_id=$2", [ctx.params.fid, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบไฟล์");
  if (!canSeeType(ctx, rows[0].rec_type || "expense") && !can(ctx, ["dashboard", "accounts"], "view")) need(ctx, rows[0].rec_type || "expense", "view");
  const buf = Buffer.from(rows[0].data, "base64");
  res.writeHead(200, { "Content-Type": rows[0].mime, "Content-Length": buf.length, "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(rows[0].filename || "file"), "X-Content-Type-Options": "nosniff" });
  res.end(buf);
  return undefined;
});
route("DELETE", B + "/files/:fid", async ctx => {
  await needBranch(ctx);
  const fr = (await pool.query("SELECT r.type FROM files f JOIN records r ON r.id=f.record_id WHERE f.id=$1 AND f.branch_id=$2", [ctx.params.fid, ctx.branch.id])).rows[0];
  need(ctx, fr ? fr.type : REC_TYPES, "edit");
  await pool.query("DELETE FROM files WHERE id=$1 AND branch_id=$2", [ctx.params.fid, ctx.branch.id]);
  return { ok: true };
});

/* ---------------- ภาพรวม (dashboard) ---------------- */
route("GET", B + "/summary", async ctx => {
  await needBranch(ctx, "dashboard", "view");
  const { from, to } = rangeOf(ctx.query);
  const bid = ctx.branch.id;
  const days = eachDay(from, to);
  const group = days.length > 62 ? "month" : "day";
  const keys = group === "month" ? eachMonth(from, to) : days;
  const keyExpr = group === "month" ? "substr(rec_date,1,7)" : "rec_date";
  const ser = await pool.query(`SELECT ${keyExpr} AS k, type, SUM(total)::float AS s, COUNT(*)::int AS c FROM records WHERE branch_id=$1 AND rec_date BETWEEN $2 AND $3 GROUP BY k, type`, [bid, from, to]);
  const map = {}; keys.forEach(k => { map[k] = { key: k, income: 0, expense: 0, invest: 0 }; });
  const tot = { income: 0, expense: 0, invest: 0, incomeCount: 0, expenseCount: 0, vatIn: 0, vatOut: 0 };
  ser.rows.forEach(r => { if (map[r.k]) map[r.k][r.type] += Number(r.s); tot[r.type] += Number(r.s); if (r.type !== "invest") tot[r.type + "Count"] += Number(r.c); });
  const recs = await pool.query("SELECT type, rec_date, items_json, subtotal, discount, total, vat_amount, vat_mode, payment_channel, due_date, settled_at, settled_channel FROM records WHERE branch_id=$1 AND rec_date BETWEEN $2 AND $3", [bid, from, to]);
  const cat = { income: {}, expense: {}, invest: {} }, pay = { income: {}, expense: {} };
  // สรุปตามช่องทางรับ/ชำระเงิน: ช่องทางเงินจริง / ช่องทางเครดิต (ยังไม่ตัดเงิน) / ค้างโดยยังไม่ระบุช่องทาง
  const chRows = await pool.query("SELECT name, is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' ORDER BY sort_order", [bid]);
  const creditSet = new Set(chRows.rows.filter(x => x.is_credit).map(x => x.name));
  const chMap = {}; const chOrder = chRows.rows.map(x => x.name);
  const chAdd = (group, name, r) => { const k = group + "|" + name; const o = chMap[k] = chMap[k] || { group, name, income: 0, out: 0, count: 0, incomeCount: 0, outCount: 0 };
    const t = Number(r.total) || 0; if (r.type === "income") { o.income += t; o.incomeCount++; } else { o.out += t; o.outCount++; } o.count++; };
  const incomeByDay = {};
  recs.rows.forEach(r => {
    const due = !!(r.due_date && r.due_date !== "");
    if (!due) chAdd("cash", r.payment_channel || "ไม่ระบุช่องทาง", r);
    else if (r.settled_at && r.settled_channel) chAdd("cash", r.settled_channel, r);
    else if (r.payment_channel && creditSet.has(r.payment_channel)) chAdd("credit", r.payment_channel, r);
    else chAdd("unsettled", r.payment_channel ? r.payment_channel + " (ยังไม่ชำระ)" : "ยังไม่ระบุช่องทาง (ค้างชำระ)", r);
    if (r.type === "income") incomeByDay[r.rec_date] = (incomeByDay[r.rec_date] || 0) + Number(r.total);
    let items = []; try { items = JSON.parse(r.items_json || "[]"); } catch (e) {}
    const sub = Number(r.subtotal) || 0, total = Number(r.total) || 0;
    // แบ่งยอดหลังส่วนลด/VAT ตามสัดส่วนของแต่ละบรรทัด (เอกสารเดียวหลายหมวด)
    items.forEach(it => { const share = sub > 0 ? total * (Number(it.amount) / sub) : total / items.length; cat[r.type][it.category || "ไม่ระบุ"] = (cat[r.type][it.category || "ไม่ระบุ"] || 0) + share; });
    if (r.type !== "invest") { const p = r.payment_channel || "ไม่ระบุ"; pay[r.type][p] = (pay[r.type][p] || 0) + total; }
    if (r.vat_mode !== "none") { if (r.type === "income") tot.vatOut += Number(r.vat_amount); else tot.vatIn += Number(r.vat_amount); }
  });
  const arr = m => Object.keys(m).map(n => ({ name: n, total: r2(m[n]) })).sort((a, b) => b.total - a.total);
  const due = await pool.query(`SELECT id, type, doc_no, rec_date, party, description, total, due_date, payment_channel FROM records
    WHERE branch_id=$1 AND due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL AND rec_date<=$2 ORDER BY due_date ASC LIMIT 200`, [bid, todayBkk()]);
  const stock = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(qty*avg_cost),0)::float AS v, SUM(CASE WHEN qty<=min_qty AND min_qty>0 THEN 1 ELSE 0 END)::int AS low FROM stock_items WHERE branch_id=$1 AND active=TRUE", [bid]);
  const lowItems = await pool.query("SELECT id, name, qty, min_qty, unit FROM stock_items WHERE branch_id=$1 AND active=TRUE AND min_qty>0 AND qty<=min_qty ORDER BY (qty/NULLIF(min_qty,0)) ASC LIMIT 8", [bid]);
  const emp = await pool.query("SELECT COUNT(*)::int AS c FROM employees WHERE branch_id=$1 AND active=TRUE", [bid]);
  const recent = await pool.query("SELECT * FROM records WHERE branch_id=$1 ORDER BY created_at DESC LIMIT 8", [bid]);
  Object.keys(tot).forEach(k => { tot[k] = r2(tot[k]); });
  tot.net = r2(tot.income - tot.expense); tot.afterInvest = r2(tot.net - tot.invest);
  tot.margin = tot.income > 0 ? Math.round(tot.net / tot.income * 1000) / 10 : 0;
  // ช่วงก่อนหน้าความยาวเท่ากัน สำหรับเทียบ %
  const len = days.length; const pTo = new Date(new Date(from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const pFrom = new Date(new Date(pTo + "T00:00:00Z").getTime() - (len - 1) * 86400000).toISOString().slice(0, 10);
  const prev = await pool.query("SELECT type, SUM(total)::float AS s FROM records WHERE branch_id=$1 AND rec_date BETWEEN $2 AND $3 GROUP BY type", [bid, pFrom, pTo]);
  const pv = { income: 0, expense: 0, invest: 0 }; prev.rows.forEach(r => { pv[r.type] = r2(r.s); });
  // ===== รายได้เฉลี่ย (แบบเดียวกับ POS) =====
  const tdy = todayBkk();
  const calEnd = to < tdy ? to : tdy; // ช่วงที่ยังไม่จบ นับถึงวันนี้
  const calDays = from <= calEnd ? eachDay(from, calEnd) : [];
  const incDays = Object.keys(incomeByDay).sort();
  const WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const wd = WD.map((name, i) => ({ dow: i, name, calDays: 0, incomeDays: 0, total: 0 }));
  calDays.forEach(d => { wd[new Date(d + "T00:00:00Z").getUTCDay()].calDays++; });
  incDays.forEach(d => { const w = wd[new Date(d + "T00:00:00Z").getUTCDay()]; w.incomeDays++; w.total += incomeByDay[d]; });
  let best = null, worst = null;
  incDays.forEach(d => { const v = r2(incomeByDay[d]); if (!best || v > best.total) best = { date: d, total: v }; if (!worst || v < worst.total) worst = { date: d, total: v }; });
  const dv = (a, b) => b > 0 ? r2(a / b) : 0;
  const averages = { calendarDays: calDays.length, incomeDays: incDays.length, countedTo: calEnd, partial: to > tdy,
    perIncomeDay: dv(tot.income, incDays.length), perCalendarDay: dv(tot.income, calDays.length),
    expensePerDay: dv(tot.expense, calDays.length), profitPerDay: dv(tot.net, calDays.length), perIncomeDoc: dv(tot.income, tot.incomeCount),
    incomeDocs: tot.incomeCount, best, worst,
    byWeekday: [1, 2, 3, 4, 5, 6, 0].map(i => { const w = wd[i]; return { ...w, total: r2(w.total), avgPerIncomeDay: dv(w.total, w.incomeDays), avgPerCalDay: dv(w.total, w.calDays) }; }) };
  const GORD = { cash: 0, credit: 1, unsettled: 2 };
  const channels = Object.values(chMap).map(o => ({ ...o, income: r2(o.income), out: r2(o.out), net: r2(o.income - o.out) }))
    .sort((a, b) => GORD[a.group] - GORD[b.group] || ((chOrder.indexOf(a.name) + 1 || 999) - (chOrder.indexOf(b.name) + 1 || 999)) || b.income + b.out - a.income - a.out);
  const cardBills = can(ctx, "cards", "view") ? await cardBillsDue(bid, 7) : [];
  return { from, to, group, totals: tot, averages, channels, cardBills, previous: { from: pFrom, to: pTo, ...pv, net: r2(pv.income - pv.expense) },
    series: keys.map(k => ({ key: k, income: r2(map[k].income), expense: r2(map[k].expense), invest: r2(map[k].invest) })),
    incomeByCategory: arr(cat.income), expenseByCategory: arr(cat.expense), investByCategory: arr(cat.invest),
    incomeByPayment: arr(pay.income), expenseByPayment: arr(pay.expense),
    due: due.rows.map(r => ({ id: r.id, type: r.type, docNo: r.doc_no, date: r.rec_date, party: r.party || "", description: r.description || "", total: Number(r.total), dueDate: r.due_date, paymentChannel: r.payment_channel || "" })),
    stock: { items: Number(stock.rows[0].n) || 0, value: r2(stock.rows[0].v), low: Number(stock.rows[0].low) || 0,
      lowItems: lowItems.rows.map(r => ({ id: r.id, name: r.name, qty: Number(r.qty), minQty: Number(r.min_qty), unit: r.unit || "" })) },
    employees: Number(emp.rows[0].c) || 0, recent: recent.rows.filter(r => canSeeType(ctx, r.type)).map(r => recordOut(r)),
    accounts: can(ctx, "accounts", "view") ? (await computeAccounts(bid, from, to)).accounts : [] };
});

/* ================= เงินในบัญชี (ยอดคงเหลือแต่ละบัญชี) ================= */
// เงินเคลื่อนไหวของแต่ละบัญชี: เอกสารที่ชำระทันที (วันที่เอกสาร) + เอกสารค้างที่กดชำระแล้ว (วันที่ชำระ) + โอนระหว่างบัญชี
async function accountMovements(bid) {
  const recs = await pool.query(`SELECT id, type, doc_no, rec_date, party, description, total, payment_channel, due_date, settled_date, settled_channel, created_at FROM records WHERE branch_id=$1`, [bid]);
  const trs = await pool.query("SELECT * FROM transfers WHERE branch_id=$1", [bid]);
  const mv = [];
  recs.rows.forEach(r => {
    const amt = Number(r.total) * (r.type === "income" ? 1 : -1);
    const base = { kind: r.type, recordId: r.id, docNo: r.doc_no, text: [r.party, r.description].filter(Boolean).join(" · "), createdAt: Number(r.created_at) || 0 };
    if (!r.due_date) { if (r.payment_channel) mv.push({ ...base, ch: r.payment_channel, date: r.rec_date, amount: amt }); }
    else if (r.settled_date && r.settled_channel) mv.push({ ...base, ch: r.settled_channel, date: r.settled_date, amount: amt, settle: true });
  });
  trs.rows.forEach(t => {
    const base = { kind: "transfer", transferId: t.id, date: t.tr_date, createdAt: Number(t.created_at) || 0, note: t.note || "" };
    mv.push({ ...base, ch: t.from_ch, amount: -Number(t.amount), text: "โอนไป " + t.to_ch + (t.note ? " · " + t.note : "") });
    mv.push({ ...base, ch: t.to_ch, amount: Number(t.amount), text: "รับโอนจาก " + t.from_ch + (t.note ? " · " + t.note : "") });
  });
  return mv;
}
async function computeAccounts(bid, from, to) {
  const ls = await pool.query("SELECT id, name, is_credit, opening_balance, opening_date FROM lists WHERE branch_id=$1 AND kind='payment_channel' ORDER BY sort_order", [bid]);
  const mv = await accountMovements(bid);
  const t = todayBkk();
  const accounts = [], credits = [];
  const known = new Set(ls.rows.map(r => r.name));
  const build = (name, row) => {
    const od = (row && row.opening_date) || "", ob = row && row.opening_balance != null ? Number(row.opening_balance) : 0;
    const mine = mv.filter(m => m.ch === name && (!od || m.date >= od));
    const balance = r2(ob + mine.filter(m => m.date <= t).reduce((a, m) => a + m.amount, 0));
    const inRange = mine.filter(m => m.date >= from && m.date <= to);
    return { id: row ? row.id : "", name, openingBalance: row && row.opening_balance != null ? ob : null, openingDate: od, balance,
      periodIn: r2(inRange.filter(m => m.amount > 0).reduce((a, m) => a + m.amount, 0)), periodOut: r2(-inRange.filter(m => m.amount < 0).reduce((a, m) => a + m.amount, 0)),
      count: mine.length, orphan: !row,
      // สำหรับหน้าภาพรวม: ยอดต้นงวด + รับเข้า − จ่ายออก = ยอดปลายงวด (รับ/จ่ายแยกส่วนที่เป็นโอนระหว่างบัญชี)
      startBalance: r2((od && od > from) ? 0 : ob + mine.filter(m => m.date < from).reduce((a, m) => a + m.amount, 0)),
      periodOpening: r2(od && od > from && od <= to ? ob : 0),
      endBalance: r2(((od && od > from) ? (od <= to ? ob : 0) : ob + mine.filter(m => m.date < from).reduce((a, m) => a + m.amount, 0)) + inRange.reduce((a, m) => a + m.amount, 0)),
      inDocs: r2(inRange.filter(m => m.amount > 0 && m.kind !== "transfer").reduce((a, m) => a + m.amount, 0)),
      outDocs: r2(-inRange.filter(m => m.amount < 0 && m.kind !== "transfer").reduce((a, m) => a + m.amount, 0)),
      inTransfer: r2(inRange.filter(m => m.amount > 0 && m.kind === "transfer").reduce((a, m) => a + m.amount, 0)),
      outTransfer: r2(-inRange.filter(m => m.amount < 0 && m.kind === "transfer").reduce((a, m) => a + m.amount, 0)),
      countIn: inRange.filter(m => m.amount > 0).length, countOut: inRange.filter(m => m.amount < 0).length };
  };
  for (const r of ls.rows) {
    if (r.is_credit) {
      const due = await pool.query("SELECT type, COALESCE(SUM(total),0)::float AS s, COUNT(*)::int AS c FROM records WHERE branch_id=$1 AND payment_channel=$2 AND due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL GROUP BY type", [bid, r.name]);
      credits.push({ id: r.id, name: r.name, payable: r2(due.rows.filter(x => x.type !== "income").reduce((a, x) => a + Number(x.s), 0)), receivable: r2(due.rows.filter(x => x.type === "income").reduce((a, x) => a + Number(x.s), 0)), count: due.rows.reduce((a, x) => a + Number(x.c), 0) });
    } else accounts.push(build(r.name, r));
  }
  [...new Set(mv.map(m => m.ch))].filter(n => !known.has(n)).forEach(n => accounts.push(build(n, null)));
  const unpaid = await pool.query("SELECT type, COALESCE(SUM(total),0)::float AS s FROM records WHERE branch_id=$1 AND due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL GROUP BY type", [bid]);
  return { accounts, credits, total: r2(accounts.reduce((a, x) => a + x.balance, 0)),
    payable: r2(unpaid.rows.filter(x => x.type !== "income").reduce((a, x) => a + Number(x.s), 0)), receivable: r2(unpaid.rows.filter(x => x.type === "income").reduce((a, x) => a + Number(x.s), 0)) };
}
route("GET", B + "/accounts", async ctx => {
  await needBranch(ctx, "accounts", "view");
  const { from, to } = rangeOf(ctx.query);
  return { from, to, ...(await computeAccounts(ctx.branch.id, from, to)) };
});
route("GET", B + "/accounts/statement", async ctx => {
  await needBranch(ctx, "accounts", "view");
  const { from, to } = rangeOf(ctx.query);
  const name = str(ctx.query.ch, 120);
  const row = (await pool.query("SELECT * FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [ctx.branch.id, name])).rows[0];
  const od = (row && row.opening_date) || "", ob = row && row.opening_balance != null ? Number(row.opening_balance) : 0;
  const mine = (await accountMovements(ctx.branch.id)).filter(m => m.ch === name && (!od || m.date >= od)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let bal = ob + mine.filter(m => m.date < from).reduce((a, m) => a + m.amount, 0);
  const startBal = r2(bal);
  const rows = mine.filter(m => m.date >= from && m.date <= to).map(m => { bal += m.amount; return { ...m, amount: r2(m.amount), balance: r2(bal) }; });
  return { name, from, to, openingBalance: row && row.opening_balance != null ? ob : null, openingDate: od, startBalance: startBal, endBalance: r2(bal), rows };
});
route("POST", B + "/accounts/opening", async ctx => {
  await needBranch(ctx, "accounts", "edit");
  const id = str(ctx.body.id, 100);
  const clear = ctx.body.amount === null || ctx.body.amount === "";
  const amt = r2(num(ctx.body.amount, NaN));
  if (!clear && !isFinite(amt)) throw bad("ยอดยกมาไม่ถูกต้อง");
  const d = isDate(ctx.body.date) ? ctx.body.date : todayBkk();
  const { rows } = await pool.query("UPDATE lists SET opening_balance=$1, opening_date=$2 WHERE id=$3 AND branch_id=$4 AND kind='payment_channel' RETURNING name",
    [clear ? null : amt, clear ? null : d, id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบบัญชี");
  await logActivity(ctx, "account_opening", clear ? "ล้างยอดยกมาของ " + rows[0].name : "ตั้งยอดยกมา " + rows[0].name + " ฿" + amt.toFixed(2) + " ณ " + d, ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/transfers", async ctx => {
  await needBranch(ctx, "accounts", "edit");
  const b = ctx.body || {};
  const fromCh = str(b.from, 120), toCh = str(b.to, 120), amount = r2(num(b.amount, NaN));
  if (!fromCh || !toCh || fromCh === toCh) throw bad("กรุณาเลือกบัญชีต้นทางและปลายทางให้ต่างกัน");
  if (!isFinite(amount) || amount <= 0) throw bad("จำนวนเงินต้องมากกว่า 0");
  const ok = await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND is_credit=FALSE AND name = ANY($2::text[])", [ctx.branch.id, "{" + [fromCh, toCh].map(x => '"' + x.replace(/["\\]/g, "") + '"').join(",") + "}"]);
  if (ok.rows.length < 2) throw bad("บัญชีไม่ถูกต้อง");
  const date = isDate(b.date) ? b.date : todayBkk();
  await pool.query("INSERT INTO transfers (id,branch_id,tr_date,from_ch,to_ch,amount,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [uid(), ctx.branch.id, date, fromCh, toCh, amount, str(b.note, 300), ctx.session.actor, now()]);
  await logActivity(ctx, "transfer", "โอน ฿" + amount.toFixed(2) + " จาก " + fromCh + " ไป " + toCh, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/transfers/:id", async ctx => {
  await needBranch(ctx, "accounts", "edit");
  const { rows } = await pool.query("DELETE FROM transfers WHERE id=$1 AND branch_id=$2 RETURNING amount, from_ch, to_ch", [ctx.params.id, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "transfer_delete", "ลบรายการโอน ฿" + Number(rows[0].amount).toFixed(2) + " " + rows[0].from_ch + " → " + rows[0].to_ch, ctx.branch.id);
  return { ok: true };
});

/* ================= สต็อกสินค้า ================= */
// คำนวณยอดคงเหลือ + ต้นทุนเฉลี่ยถ่วงน้ำหนักใหม่ทั้งหมดของสินค้า 1 ตัว (รองรับการแก้ไข/ลบย้อนหลัง)
async function recomputeItem(itemId) {
  // นับเฉพาะรายการที่อนุมัติแล้ว — รายการ "รออนุมัติ" / "ไม่อนุมัติ" ยังไม่กระทบยอด
  const { rows } = await pool.query("SELECT * FROM stock_moves WHERE item_id=$1 AND status='approved' ORDER BY move_date ASC, created_at ASC, id ASC", [itemId]);
  let qty = 0, avg = 0;
  for (const m of rows) {
    const st = stockStep({ qty, avg }, m); qty = st.qty; avg = st.avg;
    await pool.query("UPDATE stock_moves SET qty=$1, unit_cost=$2, amount=$3, balance=$4 WHERE id=$5", [r4(st.q), r4(st.unitCost), st.amount, r4(qty), m.id]);
  }
  await pool.query("UPDATE stock_items SET qty=$1, avg_cost=$2, updated_at=$3 WHERE id=$4", [r4(qty), r4(avg), now(), itemId]);
}
// คำนวณ 1 การเคลื่อนไหว (ใช้ร่วมกับการหามูลค่าสต็อก ณ วันที่ ในงบการเงิน)
function stockStep(cur, m) {
  let qty = cur.qty, avg = cur.avg;
  let q = Number(m.qty), amount = Number(m.amount) || 0, unitCost = Number(m.unit_cost) || 0;
  if (m.kind === "in") {
    const nq = qty + q;
    avg = nq > 0 ? (Math.max(qty, 0) * avg + q * unitCost) / Math.max(nq, q) : unitCost;
    qty = nq; amount = r2(q * unitCost);
  } else if (m.kind === "count") {
    q = r4(Number(m.counted) - qty); qty = Number(m.counted); unitCost = avg; amount = r2(q * avg);
  } else { // out / waste (qty เก็บเป็นค่าติดลบ)
    qty = qty + q; unitCost = avg; amount = r2(Math.abs(q) * avg);
  }
  return { qty, avg, q, unitCost, amount };
}
// มูลค่าสินค้าคงเหลือ ณ สิ้นวันที่ระบุ (ใช้ราคาทุนถัวเฉลี่ย)
async function stockValueAt(bid, date) {
  const { rows } = await pool.query("SELECT item_id, kind, qty, counted, unit_cost, amount FROM stock_moves WHERE branch_id=$1 AND status='approved' AND move_date<=$2 ORDER BY item_id, move_date ASC, created_at ASC, id ASC", [bid, date]);
  const st = {};
  rows.forEach(m => { const c = st[m.item_id] || { qty: 0, avg: 0 }; const n = stockStep(c, m); st[m.item_id] = { qty: n.qty, avg: n.avg }; });
  return r2(Object.values(st).reduce((a, x) => a + Math.max(0, x.qty) * x.avg, 0));
}
function itemOut(r) {
  const qty = Number(r.qty), min = Number(r.min_qty), avg = Number(r.avg_cost);
  return { id: r.id, sku: r.sku || "", name: r.name, category: r.category || "", unit: r.unit || "", minQty: min, qty, avgCost: avg, value: r2(qty * avg),
    active: r.active, note: r.note || "", low: min > 0 && qty <= min, moveCount: r.move_count != null ? Number(r.move_count) : undefined, lastMove: r.last_move || "",
    pending: Number(r.pending_count) || 0 };
}
route("GET", B + "/stock/items", async ctx => {
  await needBranch(ctx, ["stock", "expense", "invest"], "view");
  const { rows } = await pool.query(`SELECT i.*, (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id=i.id)::int AS move_count,
    (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id=i.id AND m.status='pending')::int AS pending_count,
    (SELECT MAX(move_date) FROM stock_moves m WHERE m.item_id=i.id) AS last_move FROM stock_items i WHERE i.branch_id=$1 ORDER BY i.active DESC, i.category, i.name`, [ctx.branch.id]);
  return { items: rows.map(itemOut), canApprove: !!ctx.perms.approve.stock };
});
function stockItemFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อสินค้า");
  const minQty = num(b.minQty, 0); if (minQty < 0) throw bad("จุดสั่งซื้อต้องไม่ติดลบ");
  return { name, sku: str(b.sku, 50), category: str(b.category, 120), unit: str(b.unit, 30), minQty: r4(minQty), note: str(b.note, 500) };
}
route("POST", B + "/stock/items", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const f = stockItemFields(ctx.body);
  const dup = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [ctx.branch.id, f.name]);
  if (dup.rows.length) throw bad("มีสินค้าชื่อนี้อยู่แล้ว");
  const id = uid();
  await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$9)",
    [id, ctx.branch.id, f.sku, f.name, f.category, f.unit, f.minQty, f.note, now()]);
  const openQty = num(ctx.body.openingQty, 0), openCost = num(ctx.body.openingCost, 0);
  let pending = false;
  if (openQty > 0) {
    const approver = !!ctx.perms.approve.stock; pending = !approver;
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,unit_cost,note,created_by,created_at,status,approved_by,approved_at) VALUES ($1,$2,$3,$4,'in',$5,$6,'ยอดยกมา',$7,$8,$9,$10,$11)`,
      [uid(), ctx.branch.id, id, isDate(ctx.body.openingDate) ? ctx.body.openingDate : todayBkk(), r4(openQty), r4(Math.max(0, openCost)), ctx.session.actor, now(),
        approver ? "approved" : "pending", approver ? ctx.session.actor : null, approver ? now() : null]);
    if (approver) await recomputeItem(id);
  }
  await logActivity(ctx, "stock_item_add", "เพิ่มสินค้า " + f.name + (openQty > 0 ? " ยอดยกมา " + openQty + (pending ? " (รออนุมัติ)" : "") : ""), ctx.branch.id);
  return { ok: true, id, pending };
});
route("PUT", B + "/stock/items/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const cur = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบสินค้า");
  if (ctx.body.active !== undefined && Object.keys(ctx.body).length === 1) {
    await pool.query("UPDATE stock_items SET active=$1 WHERE id=$2", [!!ctx.body.active, ctx.params.id]);
    await logActivity(ctx, "stock_item_edit", (ctx.body.active ? "เปิด" : "ปิด") + "ใช้งานสินค้า " + cur.rows[0].name, ctx.branch.id);
    return { ok: true };
  }
  const f = stockItemFields(ctx.body);
  const dup = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2) AND id<>$3", [ctx.branch.id, f.name, ctx.params.id]);
  if (dup.rows.length) throw bad("มีสินค้าชื่อนี้อยู่แล้ว");
  await pool.query("UPDATE stock_items SET sku=$1,name=$2,category=$3,unit=$4,min_qty=$5,note=$6,updated_at=$7 WHERE id=$8", [f.sku, f.name, f.category, f.unit, f.minQty, f.note, now(), ctx.params.id]);
  await logActivity(ctx, "stock_item_edit", "แก้ไขสินค้า " + f.name, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/stock/items/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const cur = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบสินค้า");
  const ref = await pool.query("SELECT COUNT(*)::int AS c FROM stock_moves WHERE item_id=$1 AND ref_record_id IS NOT NULL", [ctx.params.id]);
  if (Number(ref.rows[0].c) > 0) throw bad("สินค้านี้ผูกกับเอกสารซื้อแล้ว ลบไม่ได้ — ใช้ \"ปิดใช้งาน\" แทน");
  const appr = await pool.query("SELECT COUNT(*)::int AS c FROM stock_moves WHERE item_id=$1 AND status='approved'", [ctx.params.id]);
  if (Number(appr.rows[0].c) > 0 && !ctx.perms.approve.stock) throw new HttpError(403, "สินค้านี้มีรายการที่อนุมัติแล้ว — ลบได้เฉพาะผู้อนุมัติสต็อก");
  await pool.query("DELETE FROM stock_moves WHERE item_id=$1", [ctx.params.id]);
  await pool.query("DELETE FROM stock_items WHERE id=$1", [ctx.params.id]);
  await logActivity(ctx, "stock_item_delete", "ลบสินค้า " + cur.rows[0].name, ctx.branch.id);
  return { ok: true };
});
const MOVE_KINDS = { in: "รับเข้า", out: "เบิกใช้", waste: "ของเสีย / ทิ้ง", count: "ตรวจนับ (ปรับยอด)" };
// แก้ไข/ลบรายการสต็อกได้ไหม: ผู้อนุมัติ = ทุกรายการ (ยกเว้นที่มาจากเอกสารซื้อ) · พนักงาน = การเบิกของตัวเองภายในวันเดียวกัน หรือรายการของตัวเองที่ยังรออนุมัติ/ไม่อนุมัติ
function moveEditable(ctx, m) {
  if (m.ref_record_id) return false;
  if (ctx.perms.approve.stock) return true;
  if (!can(ctx, "stock", "edit") || m.created_by !== ctx.session.actor) return false;
  if (m.status !== "approved") return true;
  return m.kind === "out" && bkkDateOf(Number(m.created_at)) === todayBkk();
}
function moveOut(m, ctx) {
  return { id: m.id, itemId: m.item_id, itemName: m.item_name, unit: m.unit || "", date: m.move_date, kind: m.kind, qty: Number(m.qty),
    counted: m.counted == null ? null : Number(m.counted), unitCost: Number(m.unit_cost) || 0, amount: Number(m.amount) || 0, balance: Number(m.balance) || 0,
    note: m.note || "", refRecordId: m.ref_record_id || "", docNo: m.doc_no || "", batchId: m.batch_id || "", createdBy: m.created_by || "", createdAt: Number(m.created_at),
    status: m.status || "approved", approvedBy: m.approved_by || "", approvedAt: Number(m.approved_at) || null, rejectReason: m.reject_reason || "", itemQty: m.item_qty == null ? null : Number(m.item_qty),
    canEdit: ctx ? moveEditable(ctx, m) : false };
}
route("GET", B + "/stock/moves", async ctx => {
  await needBranch(ctx, "stock", "view");
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "m.branch_id=$1 AND m.move_date BETWEEN $2 AND $3";
  if (ctx.query.itemId) { params.push(ctx.query.itemId); where += " AND m.item_id=$" + params.length; }
  if (MOVE_KINDS[ctx.query.kind]) { params.push(ctx.query.kind); where += " AND m.kind=$" + params.length; }
  if (["pending", "approved", "rejected"].includes(ctx.query.status)) { params.push(ctx.query.status); where += " AND m.status=$" + params.length; }
  const { rows } = await pool.query(`SELECT m.*, i.name AS item_name, i.unit, r.doc_no FROM stock_moves m JOIN stock_items i ON i.id=m.item_id LEFT JOIN records r ON r.id=m.ref_record_id
    WHERE ${where} ORDER BY m.move_date DESC, m.created_at DESC LIMIT 3000`, params);
  return { from, to, moves: rows.map(m => moveOut(m, ctx)), canApprove: !!ctx.perms.approve.stock };
});
// การเบิกล่าสุด (แสดงด้านบนหน้าสต็อก): วันนี้ + เมื่อวาน
route("GET", B + "/stock/recent", async ctx => {
  await needBranch(ctx, "stock", "view");
  const y = new Date(Date.now() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
  const { rows } = await pool.query(`SELECT m.*, i.name AS item_name, i.unit, i.qty AS item_qty FROM stock_moves m JOIN stock_items i ON i.id=m.item_id
    WHERE m.branch_id=$1 AND m.kind='out' AND m.move_date>=$2 ORDER BY m.created_at DESC LIMIT 40`, [ctx.branch.id, y]);
  return { moves: rows.map(m => moveOut(m, ctx)), today: todayBkk() };
});
// แก้ไขรายการสต็อก (จำนวน / หมายเหตุ)
route("PUT", B + "/stock/moves/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const m = (await pool.query("SELECT m.*, i.name, i.qty AS item_qty, i.unit FROM stock_moves m JOIN stock_items i ON i.id=m.item_id WHERE m.id=$1 AND m.branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!m) throw new HttpError(404, "ไม่พบรายการ");
  if (m.ref_record_id) throw bad("รายการนี้มาจากเอกสารซื้อ — แก้ไขที่เอกสารรายจ่ายแทน");
  if (!moveEditable(ctx, m)) throw new HttpError(403, "แก้ไขได้เฉพาะการเบิกของตัวเองภายในวันเดียวกัน (รายการอื่นให้ผู้จัดการแก้)");
  const q = r4(num(ctx.body.qty, NaN));
  if (m.kind === "count" ? !(q >= 0) : !(q > 0)) throw bad(m.kind === "count" ? "ยอดที่นับได้ต้องเป็น 0 ขึ้นไป" : "จำนวนต้องมากกว่า 0");
  const old = m.kind === "count" ? Number(m.counted) : Math.abs(Number(m.qty));
  if ((m.kind === "out" || m.kind === "waste") && m.status === "approved") {
    const avail = Number(m.item_qty) + old;
    if (q > avail + 1e-9 && !ctx.body.allowNegative) throw bad("\"" + m.name + "\" คงเหลือ " + r4(avail) + " " + (m.unit || "") + " ไม่พอเบิก " + q);
  }
  const signed = m.kind === "in" ? q : m.kind === "count" ? 0 : -q;
  await pool.query("UPDATE stock_moves SET qty=$1, counted=$2, note=$3 WHERE id=$4", [signed, m.kind === "count" ? q : null, ctx.body.note !== undefined ? str(ctx.body.note, 300) : m.note, m.id]);
  if (m.status === "approved") await recomputeItem(m.item_id);
  await logActivity(ctx, "stock_move_edit", "แก้ไข" + MOVE_KINDS[m.kind] + " " + m.name + " จาก " + old + " เป็น " + q + " " + (m.unit || "") + " (รายการวันที่ " + m.move_date + ")", ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/stock/moves", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const b = ctx.body || {};
  const kind = b.kind; if (!MOVE_KINDS[kind]) throw bad("ประเภทการเคลื่อนไหวไม่ถูกต้อง");
  const date = isDate(b.date) ? b.date : todayBkk();
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && l.itemId).slice(0, 200);
  if (!lines.length) throw bad("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
  const batch = uid(); const note = str(b.note, 300);
  // เบิกใช้ = ตัดยอดทันที ไม่ต้องอนุมัติ · รับเข้า / ของเสีย / ตรวจนับ ของคนที่ไม่มีสิทธิ์อนุมัติ = รออนุมัติ
  const approver = !!ctx.perms.approve.stock || kind === "out";
  const items = {};
  for (const l of lines) {
    const it = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [l.itemId, ctx.branch.id]);
    if (!it.rows[0]) throw bad("ไม่พบสินค้า");
    items[l.itemId] = it.rows[0];
    const q = num(l.qty, NaN);
    if (kind === "count") { if (!isFinite(q) || q < 0) throw bad("ยอดที่นับได้ต้องเป็น 0 ขึ้นไป (" + it.rows[0].name + ")"); }
    else if (!isFinite(q) || q <= 0) throw bad("จำนวนต้องมากกว่า 0 (" + it.rows[0].name + ")");
    if ((kind === "out" || kind === "waste") && q > Number(it.rows[0].qty) + 1e-9 && !b.allowNegative)
      throw bad("\"" + it.rows[0].name + "\" คงเหลือ " + Number(it.rows[0].qty) + " " + (it.rows[0].unit || "") + " ไม่พอเบิก " + q);
  }
  for (const l of lines) {
    const q = r4(num(l.qty, 0));
    const signed = kind === "in" ? q : (kind === "count" ? 0 : -q);
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,counted,unit_cost,note,batch_id,created_by,created_at,status,approved_by,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [uid(), ctx.branch.id, l.itemId, date, kind, signed, kind === "count" ? q : null, kind === "in" ? r4(Math.max(0, num(l.unitCost, 0))) : null, note, batch, ctx.session.actor, now(),
        approver ? "approved" : "pending", approver ? ctx.session.actor : null, approver ? now() : null]);
    if (approver) await recomputeItem(l.itemId);
  }
  await logActivity(ctx, "stock_move", MOVE_KINDS[kind] + " " + lines.length + " รายการ: " + lines.map(l => items[l.itemId].name + " " + l.qty).slice(0, 5).join(", ") + (approver ? "" : " (รออนุมัติ)"), ctx.branch.id);
  return { ok: true, pending: !approver };
});
// อนุมัติ / ไม่อนุมัติ รายการสต็อก (ทีละหลายรายการได้)
route("POST", B + "/stock/moves/approve", async ctx => {
  await needBranch(ctx); needApprove(ctx, "stock");
  const ids = (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(String).slice(0, 500);
  const ok = ctx.body.approve !== false; const reason = str(ctx.body.reason, 300);
  if (!ids.length) throw bad("กรุณาเลือกรายการ");
  if (!ok && !reason) throw bad("กรุณาใส่เหตุผลที่ไม่อนุมัติ");
  const { rows } = await pool.query("SELECT m.*, i.name FROM stock_moves m JOIN stock_items i ON i.id=m.item_id WHERE m.branch_id=$1 AND m.status='pending' AND m.id = ANY($2::text[])",
    [ctx.branch.id, "{" + ids.map(i => '"' + i.replace(/["\\]/g, "") + '"').join(",") + "}"]);
  if (!rows.length) throw bad("ไม่พบรายการที่รออนุมัติ (อาจถูกอนุมัติไปแล้ว)");
  for (const m of rows) {
    await pool.query("UPDATE stock_moves SET status=$1, approved_by=$2, approved_at=$3, reject_reason=$4 WHERE id=$5", [ok ? "approved" : "rejected", ctx.session.actor, now(), ok ? null : reason, m.id]);
  }
  for (const id of new Set(rows.map(m => m.item_id))) await recomputeItem(id);
  await logActivity(ctx, ok ? "stock_approve" : "stock_reject", (ok ? "อนุมัติ" : "ไม่อนุมัติ") + "รายการสต็อก " + rows.length + " รายการ: " + rows.slice(0, 5).map(m => MOVE_KINDS[m.kind] + " " + m.name + " " + Math.abs(Number(m.kind === "count" ? m.counted : m.qty))).join(", ") + (ok ? "" : " · เหตุผล: " + reason), ctx.branch.id);
  return { ok: true, count: rows.length };
});
route("DELETE", B + "/stock/moves/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const { rows } = await pool.query("SELECT m.*, i.name FROM stock_moves m JOIN stock_items i ON i.id=m.item_id WHERE m.id=$1 AND m.branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบรายการ");
  if (rows[0].ref_record_id) throw bad("รายการนี้มาจากเอกสารซื้อ — แก้ไข/ลบที่เอกสารรายจ่ายแทน");
  if (!moveEditable(ctx, rows[0])) throw new HttpError(403, rows[0].kind === "out" ? "ลบได้เฉพาะการเบิกของตัวเองภายในวันเดียวกัน (รายการอื่นให้ผู้จัดการลบ)" : "รายการที่อนุมัติแล้ว ลบได้เฉพาะผู้อนุมัติสต็อก");
  await pool.query("DELETE FROM stock_moves WHERE id=$1", [rows[0].id]);
  await recomputeItem(rows[0].item_id);
  await logActivity(ctx, "stock_move_delete", "ลบรายการสต็อก " + MOVE_KINDS[rows[0].kind] + " " + rows[0].name + (rows[0].status !== "approved" ? " (" + (rows[0].status === "pending" ? "รออนุมัติ" : "ไม่อนุมัติ") + ")" : ""), ctx.branch.id);
  return { ok: true };
});

/* ================= พนักงาน & เงินเดือน ================= */
function empOut(r) {
  return { id: r.id, code: r.code || "", name: r.name, nickname: r.nickname || "", position: r.position || "", phone: r.phone || "", idCard: r.id_card || "",
    bankName: r.bank_name || "", bankAccount: r.bank_account || "", startDate: r.start_date || "", payType: r.pay_type, rate: Number(r.rate), sso: !!r.sso, active: !!r.active, note: r.note || "",
    hasPin: !!r.pin_hash };
}
route("GET", B + "/employees", async ctx => {
  await needBranch(ctx, ["employees", "payroll", "leave", "advance", "attendance"], "view");
  const { rows } = await pool.query("SELECT * FROM employees WHERE branch_id=$1 ORDER BY active DESC, code, name", [ctx.branch.id]);
  // คนที่ไม่มีสิทธิ์เมนูพนักงาน/เงินเดือน เห็นแค่ชื่อ (ไม่เห็นค่าจ้าง เลขบัตร บัญชีธนาคาร)
  const full = can(ctx, ["employees", "payroll"], "view");
  return { employees: rows.map(r => { const e = empOut(r); return full ? e : { id: e.id, code: e.code, name: e.name, nickname: e.nickname, position: e.position, payType: e.payType, active: e.active, hasPin: e.hasPin }; }) };
});
function checkPin(pin) { pin = String(pin == null ? "" : pin).trim(); if (!/^\d{4,6}$/.test(pin)) throw bad("PIN ต้องเป็นตัวเลข 4-6 หลัก"); return pin; }
function empFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อพนักงาน");
  const payType = b.payType === "daily" ? "daily" : "monthly";
  const rate = num(b.rate, NaN); if (!isFinite(rate) || rate < 0) throw bad("อัตราค่าจ้างไม่ถูกต้อง");
  const idCard = str(b.idCard, 20).replace(/\D/g, ""); if (idCard && idCard.length !== 13) throw bad("เลขบัตรประชาชนต้องมี 13 หลัก");
  return { code: str(b.code, 30), name, nickname: str(b.nickname, 60), position: str(b.position, 100), phone: str(b.phone, 40), idCard,
    bankName: str(b.bankName, 100), bankAccount: str(b.bankAccount, 40), startDate: isDate(b.startDate) ? b.startDate : "", payType, rate: r2(rate), sso: b.sso !== false, note: str(b.note, 500) };
}
route("POST", B + "/employees", async ctx => {
  await needBranch(ctx, "employees", "edit");
  const f = empFields(ctx.body); const id = uid();
  if (!f.code) { const c = await pool.query("SELECT COUNT(*)::int AS c FROM employees WHERE branch_id=$1", [ctx.branch.id]); f.code = "EMP" + String(Number(c.rows[0].c) + 1).padStart(3, "0"); }
  await pool.query(`INSERT INTO employees (id,branch_id,code,name,nickname,position,phone,id_card,bank_name,bank_account,start_date,pay_type,rate,sso,active,note,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16,$16)`,
    [id, ctx.branch.id, f.code, f.name, f.nickname, f.position, f.phone, f.idCard, f.bankName, f.bankAccount, f.startDate, f.payType, f.rate, f.sso, f.note, now()]);
  if (ctx.body.pin) await pool.query("UPDATE employees SET pin_hash=$1 WHERE id=$2", [hashPw(checkPin(ctx.body.pin)), id]);
  await logActivity(ctx, "employee_add", "เพิ่มพนักงาน " + f.name, ctx.branch.id);
  return { ok: true, id };
});
route("PUT", B + "/employees/:id", async ctx => {
  await needBranch(ctx, "employees", "edit");
  const cur = await pool.query("SELECT * FROM employees WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบพนักงาน");
  if (ctx.body.active !== undefined && Object.keys(ctx.body).length === 1) {
    await pool.query("UPDATE employees SET active=$1, updated_at=$2 WHERE id=$3", [!!ctx.body.active, now(), ctx.params.id]);
    await logActivity(ctx, "employee_active", (ctx.body.active ? "เปิดใช้งาน " : "ปิดใช้งาน (ลาออก) ") + cur.rows[0].name, ctx.branch.id);
    return { ok: true };
  }
  const f = empFields(ctx.body);
  await pool.query(`UPDATE employees SET code=$1,name=$2,nickname=$3,position=$4,phone=$5,id_card=$6,bank_name=$7,bank_account=$8,start_date=$9,pay_type=$10,rate=$11,sso=$12,note=$13,updated_at=$14 WHERE id=$15`,
    [f.code, f.name, f.nickname, f.position, f.phone, f.idCard, f.bankName, f.bankAccount, f.startDate, f.payType, f.rate, f.sso, f.note, now(), ctx.params.id]);
  let pinNote = "";
  if (ctx.body.clearPin) { await pool.query("UPDATE employees SET pin_hash=NULL WHERE id=$1", [ctx.params.id]); pinNote = " (ลบ PIN)"; }
  else if (ctx.body.pin) { await pool.query("UPDATE employees SET pin_hash=$1 WHERE id=$2", [hashPw(checkPin(ctx.body.pin)), ctx.params.id]); pinNote = " (ตั้ง PIN ใหม่)"; }
  await logActivity(ctx, "employee_edit", "แก้ไขข้อมูลพนักงาน " + f.name + pinNote, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/employees/:id", async ctx => {
  await needBranch(ctx, "employees", "edit");
  const used = await pool.query("SELECT COUNT(*)::int AS c FROM payroll_items WHERE employee_id=$1", [ctx.params.id]);
  if (Number(used.rows[0].c) > 0) throw bad("พนักงานคนนี้มีประวัติเงินเดือนแล้ว ลบไม่ได้ — ใช้ \"ปิดใช้งาน\" แทน");
  const { rows } = await pool.query("DELETE FROM employees WHERE id=$1 AND branch_id=$2 RETURNING name", [ctx.params.id, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "employee_delete", "ลบพนักงาน " + rows[0].name, ctx.branch.id);
  return { ok: true };
});

function ssoOf(wage, st, enabled) {
  if (!enabled) return 0;
  const base = Math.min(Math.max(wage, num(st.sso_min, 1650)), num(st.sso_max, 17500));
  return wage <= 0 ? 0 : Math.round(base * num(st.sso_rate, 5) / 100);
}
// คำนวณ 1 บรรทัดเงินเดือน (ใช้ทั้งตอนสร้างงวดและตอนบันทึกแก้ไข)
function calcPayItem(p, st, period) {
  const payType = p.payType === "daily" ? "daily" : "monthly";
  const rate = r2(num(p.rate, 0));
  const workDays = r2(num(p.workDays, payType === "daily" ? 26 : daysInMonth(period)));
  const base = payType === "daily" ? r2(rate * workDays) : rate;
  const defOtRate = payType === "daily" ? rate / 8 * 1.5 : rate / 30 / 8 * 1.5;
  const otHours = r2(Math.max(0, num(p.otHours, 0)));
  const otRate = r2(p.otRate === undefined || p.otRate === null || p.otRate === "" ? defOtRate : Math.max(0, num(p.otRate, 0)));
  const otAmount = r2(otHours * otRate);
  const allowance = r2(Math.max(0, num(p.allowance, 0))), bonus = r2(Math.max(0, num(p.bonus, 0))), otherIncome = r2(Math.max(0, num(p.otherIncome, 0)));
  const absent = r2(Math.max(0, num(p.absentDeduct, 0)));
  const gross = r2(base + otAmount + allowance + bonus + otherIncome);
  const ssoAuto = ssoOf(r2(base + otAmount + allowance - absent), st, p.ssoEnabled !== false);
  const sso = p.ssoOverride !== undefined && p.ssoOverride !== null && p.ssoOverride !== "" ? r2(Math.max(0, num(p.ssoOverride, 0))) : ssoAuto;
  const tax = r2(Math.max(0, num(p.tax, 0))), advance = r2(Math.max(0, num(p.advance, 0))), otherDeduct = r2(Math.max(0, num(p.otherDeduct, 0)));
  const totalDeduct = r2(sso + tax + advance + absent + otherDeduct);
  return { payType, rate, workDays, base, otHours, otRate, otAmount, allowance, bonus, otherIncome, sso, ssoAuto, tax, advance, absentDeduct: absent, otherDeduct,
    gross, totalDeduct, net: r2(gross - totalDeduct), note: str(p.note, 300) };
}
function payItemOut(r) {
  let emp = {}; try { emp = JSON.parse(r.emp_json || "{}"); } catch (e) {}
  return { id: r.id, employeeId: r.employee_id, emp, payType: r.pay_type, rate: Number(r.rate), workDays: Number(r.work_days), base: Number(r.base),
    otHours: Number(r.ot_hours), otRate: Number(r.ot_rate), otAmount: Number(r.ot_amount), allowance: Number(r.allowance), bonus: Number(r.bonus), otherIncome: Number(r.other_income),
    sso: Number(r.sso), tax: Number(r.tax), advance: Number(r.advance), absentDeduct: Number(r.absent_deduct), otherDeduct: Number(r.other_deduct),
    gross: Number(r.gross), totalDeduct: Number(r.total_deduct), net: Number(r.net), note: r.note || "", links: parseLinks(r.links_json) };
}
function parseLinks(j) { let x = {}; try { x = JSON.parse(j || "{}") || {}; } catch (e) {} return { leaveIds: Array.isArray(x.leaveIds) ? x.leaveIds : [], advanceIds: Array.isArray(x.advanceIds) ? x.advanceIds : [], attendanceDays: x.attendanceDays == null ? null : Number(x.attendanceDays) }; }
const pgArr = ids => "{" + ids.map(i => '"' + String(i).replace(/["\\]/g, "") + '"').join(",") + "}";
async function runOut(run, withItems) {
  const items = withItems ? (await pool.query("SELECT * FROM payroll_items WHERE run_id=$1 ORDER BY sort_order, id", [run.id])).rows.map(payItemOut) : null;
  const agg = items || (await pool.query("SELECT gross, net, sso, tax, total_deduct FROM payroll_items WHERE run_id=$1", [run.id])).rows.map(r => ({ gross: Number(r.gross), net: Number(r.net), sso: Number(r.sso), tax: Number(r.tax), totalDeduct: Number(r.total_deduct) }));
  const s = k => r2(agg.reduce((a, x) => a + x[k], 0));
  const rec = run.record_id ? (await pool.query("SELECT doc_no FROM records WHERE id=$1", [run.record_id])).rows[0] : null;
  return { id: run.id, period: run.period, title: run.title || "", payDate: run.pay_date || "", status: run.status, note: run.note || "", paymentChannel: run.payment_channel || "",
    recordId: run.record_id || "", recordDocNo: rec ? rec.doc_no : "", createdBy: run.created_by || "", paidAt: Number(run.paid_at) || null, paidBy: run.paid_by || "",
    count: agg.length, gross: s("gross"), net: s("net"), sso: s("sso"), tax: s("tax"), totalDeduct: s("totalDeduct"), items };
}
route("GET", B + "/payroll/runs", async ctx => {
  await needBranch(ctx, "payroll", "view");
  const { rows } = await pool.query("SELECT * FROM payroll_runs WHERE branch_id=$1 ORDER BY period DESC, created_at DESC LIMIT 120", [ctx.branch.id]);
  const out = []; for (const r of rows) out.push(await runOut(r, false));
  return { runs: out };
});
route("POST", B + "/payroll/runs", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const period = ctx.body.period; if (!isPeriod(period)) throw bad("กรุณาเลือกงวดเดือน");
  const st = await getSettings();
  const emps = await pool.query("SELECT * FROM employees WHERE branch_id=$1 AND active=TRUE ORDER BY code, name", [ctx.branch.id]);
  if (!emps.rows.length) throw bad("ยังไม่มีพนักงานที่ใช้งานอยู่ — เพิ่มพนักงานก่อน");
  const id = uid();
  const payDate = isDate(ctx.body.payDate) ? ctx.body.payDate : period + "-" + String(daysInMonth(period)).padStart(2, "0");
  await pool.query("INSERT INTO payroll_runs (id,branch_id,period,title,pay_date,status,created_by,created_at) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)",
    [id, ctx.branch.id, period, str(ctx.body.title, 120), payDate, ctx.session.actor, now()]);
  let i = 0;
  for (const e of emps.rows) {
    const c = calcPayItem({ payType: e.pay_type, rate: Number(e.rate), ssoEnabled: !!e.sso }, st, period);
    await insertPayItem(id, ctx.branch.id, e, c, i++);
  }
  await logActivity(ctx, "payroll_create", "สร้างงวดเงินเดือน " + period, ctx.branch.id);
  return { ok: true, id };
});
async function insertPayItem(runId, branchId, e, c, order) {
  const emp = { code: e.code || "", name: e.name, nickname: e.nickname || "", position: e.position || "", bankName: e.bank_name || "", bankAccount: e.bank_account || "", idCard: e.id_card || "", sso: !!e.sso };
  await pool.query(`INSERT INTO payroll_items (id,run_id,branch_id,employee_id,emp_json,pay_type,rate,work_days,base,ot_hours,ot_rate,ot_amount,allowance,bonus,other_income,sso,tax,advance,absent_deduct,other_deduct,gross,total_deduct,net,note,sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [uid(), runId, branchId, e.id, JSON.stringify(emp), c.payType, c.rate, c.workDays, c.base, c.otHours, c.otRate, c.otAmount, c.allowance, c.bonus, c.otherIncome, c.sso, c.tax, c.advance, c.absentDeduct, c.otherDeduct, c.gross, c.totalDeduct, c.net, c.note, order]);
}
async function getRun(ctx) {
  const { rows } = await pool.query("SELECT * FROM payroll_runs WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบงวดเงินเดือน");
  return rows[0];
}
route("GET", B + "/payroll/runs/:id", async ctx => { await needBranch(ctx, "payroll", "view"); return { run: await runOut(await getRun(ctx), true) }; });
route("PUT", B + "/payroll/runs/:id", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const run = await getRun(ctx);
  if (run.status !== "draft") throw bad("งวดนี้จ่ายแล้ว — กด \"ยกเลิกการจ่าย\" ก่อนแก้ไข");
  const st = await getSettings();
  const b = ctx.body || {};
  await pool.query("UPDATE payroll_runs SET title=$1, pay_date=$2, note=$3 WHERE id=$4", [str(b.title, 120), isDate(b.payDate) ? b.payDate : run.pay_date, str(b.note, 500), run.id]);
  if (Array.isArray(b.items)) {
    const cur = await pool.query("SELECT * FROM payroll_items WHERE run_id=$1", [run.id]);
    const byId = {}; cur.rows.forEach(r => { byId[r.id] = r; });
    for (const it of b.items) {
      const row = byId[it.id]; if (!row) continue;
      let emp = {}; try { emp = JSON.parse(row.emp_json || "{}"); } catch (e) {}
      const c = calcPayItem({ ...it, payType: row.pay_type, ssoEnabled: emp.sso !== false }, st, run.period);
      await pool.query(`UPDATE payroll_items SET rate=$1,work_days=$2,base=$3,ot_hours=$4,ot_rate=$5,ot_amount=$6,allowance=$7,bonus=$8,other_income=$9,sso=$10,tax=$11,advance=$12,absent_deduct=$13,other_deduct=$14,gross=$15,total_deduct=$16,net=$17,note=$18 WHERE id=$19`,
        [c.rate, c.workDays, c.base, c.otHours, c.otRate, c.otAmount, c.allowance, c.bonus, c.otherIncome, c.sso, c.tax, c.advance, c.absentDeduct, c.otherDeduct, c.gross, c.totalDeduct, c.net, c.note, row.id]);
    }
  }
  if (Array.isArray(b.removeIds)) for (const rid of b.removeIds) await pool.query("DELETE FROM payroll_items WHERE id=$1 AND run_id=$2", [String(rid), run.id]);
  if (Array.isArray(b.addEmployeeIds)) {
    const have = new Set((await pool.query("SELECT employee_id FROM payroll_items WHERE run_id=$1", [run.id])).rows.map(r => r.employee_id));
    let order = 1000;
    for (const eid of b.addEmployeeIds) {
      if (have.has(eid)) continue;
      const e = await pool.query("SELECT * FROM employees WHERE id=$1 AND branch_id=$2", [String(eid), ctx.branch.id]);
      if (!e.rows[0]) continue;
      await insertPayItem(run.id, ctx.branch.id, e.rows[0], calcPayItem({ payType: e.rows[0].pay_type, rate: Number(e.rows[0].rate), ssoEnabled: !!e.rows[0].sso }, st, run.period), order++);
    }
  }
  await logActivity(ctx, "payroll_edit", "แก้ไขงวดเงินเดือน " + run.period, ctx.branch.id);
  return { run: await runOut(await getRun(ctx), true) };
});
route("DELETE", B + "/payroll/runs/:id", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const run = await getRun(ctx);
  if (run.status !== "draft") throw bad("งวดนี้จ่ายแล้ว — กด \"ยกเลิกการจ่าย\" ก่อนลบ");
  await pool.query("DELETE FROM payroll_items WHERE run_id=$1", [run.id]);
  await pool.query("DELETE FROM payroll_runs WHERE id=$1", [run.id]);
  await logActivity(ctx, "payroll_delete", "ลบงวดเงินเดือน " + run.period, ctx.branch.id);
  return { ok: true };
});
// จ่ายเงินเดือน → สร้างเอกสารรายจ่ายให้อัตโนมัติ (เงินที่จ่ายพนักงาน + ประกันสังคม/ภาษีที่ต้องนำส่ง)
route("POST", B + "/payroll/runs/:id/pay", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const run = await getRun(ctx);
  if (run.status === "paid") throw bad("งวดนี้จ่ายแล้ว");
  const r = await runOut(run, true);
  if (!r.items.length) throw bad("งวดนี้ไม่มีพนักงาน");
  // รายการลา/เบิกที่ดึงเข้างวดนี้ ต้องยังไม่ถูกหักในงวดอื่น
  const leaveIds = [...new Set(r.items.flatMap(i => i.links.leaveIds))], advIds = [...new Set(r.items.flatMap(i => i.links.advanceIds))];
  if (leaveIds.length) { const c = await pool.query("SELECT emp_name FROM leaves WHERE id = ANY($1::text[]) AND (status<>'approved' OR (payroll_run_id IS NOT NULL AND payroll_run_id<>$2))", [pgArr(leaveIds), run.id]);
    if (c.rows.length) throw bad("รายการลาของ " + c.rows.map(x => x.emp_name).join(", ") + " ถูกหักในงวดอื่นแล้วหรือถูกยกเลิก — กด \"ดึงข้อมูลอัตโนมัติ\" ใหม่ก่อนจ่าย"); }
  if (advIds.length) { const c = await pool.query("SELECT emp_name FROM advances WHERE id = ANY($1::text[]) AND (status<>'approved' OR (payroll_run_id IS NOT NULL AND payroll_run_id<>$2))", [pgArr(advIds), run.id]);
    if (c.rows.length) throw bad("เงินเบิกของ " + c.rows.map(x => x.emp_name).join(", ") + " ถูกหักในงวดอื่นแล้วหรือถูกยกเลิก — กด \"ดึงข้อมูลอัตโนมัติ\" ใหม่ก่อนจ่าย"); }
  const lists = await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='expense_category'", [ctx.branch.id]);
  const names = lists.rows.map(x => x.name);
  const pick = (re, dflt) => names.find(n => re.test(n)) || dflt;
  const wageCat = pick(/เงินเดือน|ค่าแรง/, "เงินเดือน / ค่าแรง"), ssoCat = pick(/ประกันสังคม/, wageCat);
  const label = (r.title ? r.title + " " : "") + "งวด " + r.period;
  const items = [{ name: "เงินเดือน/ค่าแรงสุทธิที่จ่ายพนักงาน " + r.items.length + " คน (" + label + ")", category: wageCat, qty: 1, unit: "งวด", price: r.net }];
  if (r.sso > 0) items.push({ name: "ประกันสังคมส่วนลูกจ้าง (หักจากพนักงาน รอนำส่ง)", category: ssoCat, qty: 1, unit: "งวด", price: r.sso });
  if (r.sso > 0) items.push({ name: "ประกันสังคมส่วนนายจ้าง (สมทบเท่ากัน)", category: ssoCat, qty: 1, unit: "งวด", price: r.sso });
  if (r.tax > 0) items.push({ name: "ภาษีหัก ณ ที่จ่าย (รอนำส่ง ภ.ง.ด.1)", category: ssoCat, qty: 1, unit: "งวด", price: r.tax });
  const date = isDate(ctx.body.date) ? ctx.body.date : (run.pay_date || todayBkk());
  ctx.body = { type: "expense", date, party: "พนักงาน " + ctx.branch.name, description: "จ่ายเงินเดือน " + label, items: items.filter(i => i.price > 0),
    paymentChannel: str(ctx.body.paymentChannel, 120), note: "สร้างอัตโนมัติจากระบบเงินเดือน" };
  if (!ctx.body.items.length) throw bad("ยอดเงินเดือนเป็น 0");
  const rec = await saveRecord(ctx, null);
  await pool.query("UPDATE records SET source='payroll', ref_id=$1 WHERE id=$2", [run.id, rec.id]);
  await pool.query("UPDATE payroll_runs SET status='paid', record_id=$1, payment_channel=$2, pay_date=$3, paid_at=$4, paid_by=$5 WHERE id=$6", [rec.id, ctx.body.paymentChannel, date, now(), ctx.session.actor, run.id]);
  if (leaveIds.length) await pool.query("UPDATE leaves SET payroll_run_id=$1 WHERE id = ANY($2::text[])", [run.id, pgArr(leaveIds)]);
  if (advIds.length) await pool.query("UPDATE advances SET payroll_run_id=$1 WHERE id = ANY($2::text[])", [run.id, pgArr(advIds)]);
  await logActivity(ctx, "payroll_pay", "จ่ายเงินเดือน " + label + " สุทธิ ฿" + r.net.toFixed(2) + " → เอกสาร " + rec.docNo, ctx.branch.id);
  return { ok: true, docNo: rec.docNo };
});
route("POST", B + "/payroll/runs/:id/unpay", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const run = await getRun(ctx);
  if (run.status !== "paid") throw bad("งวดนี้ยังไม่ได้จ่าย");
  if (run.record_id) { await pool.query("DELETE FROM files WHERE record_id=$1", [run.record_id]); await pool.query("DELETE FROM records WHERE id=$1", [run.record_id]); }
  await pool.query("UPDATE payroll_runs SET status='draft', record_id=NULL, paid_at=NULL, paid_by=NULL WHERE id=$1", [run.id]);
  // ปลดการผูกรายการลา/เบิก ให้กลับไปหักได้ใหม่
  await pool.query("UPDATE leaves SET payroll_run_id=NULL WHERE payroll_run_id=$1", [run.id]);
  await pool.query("UPDATE advances SET payroll_run_id=NULL WHERE payroll_run_id=$1", [run.id]);
  await logActivity(ctx, "payroll_unpay", "ยกเลิกการจ่ายเงินเดือนงวด " + run.period + " (ลบเอกสารรายจ่ายที่สร้างอัตโนมัติ)", ctx.branch.id);
  return { ok: true };
});

/* ================= ขาด-ลา ================= */
const LEAVE_KINDS = { sick: "ลาป่วย", personal: "ลากิจ", vacation: "ลาพักร้อน", unpaid: "ลาไม่รับค่าจ้าง", absent: "ขาดงาน", late: "มาสาย" };
const dayRateOf = e => e.pay_type === "daily" ? Number(e.rate) : Number(e.rate) / 30;
// ยอดหักอัตโนมัติ: ค่าจ้างรายวัน หรือ เงินเดือน/30 · มาสาย = ค่าจ้างต่อวัน/8 ชม./60 × นาที · ลาป่วย/ลากิจ/พักร้อน = ได้รับค่าจ้าง (0)
function autoLeaveDeduct(e, kind, days, minutes) {
  const dr = dayRateOf(e);
  if (kind === "late") return r2(dr / 8 / 60 * minutes);
  if (kind === "unpaid" || kind === "absent") return r2(dr * days);
  return 0;
}
function leaveOut(r) {
  return { id: r.id, employeeId: r.employee_id, empName: r.emp_name || "", kind: r.kind, kindTh: LEAVE_KINDS[r.kind] || r.kind, dateFrom: r.date_from, dateTo: r.date_to,
    days: Number(r.days), minutes: Number(r.minutes) || 0, reason: r.reason || "", deduct: Number(r.deduct), status: r.status, requestedBy: r.requested_by || "",
    createdAt: Number(r.created_at), approvedBy: r.approved_by || "", approvedAt: Number(r.approved_at) || null, rejectReason: r.reject_reason || "",
    payrollRunId: r.payroll_run_id || "", payrollPeriod: r.run_period || "" };
}
async function getEmp(ctx, id) {
  const e = (await pool.query("SELECT * FROM employees WHERE id=$1 AND branch_id=$2", [String(id || ""), ctx.branch.id])).rows[0];
  if (!e) throw bad("กรุณาเลือกพนักงาน"); return e;
}
function leaveInput(b, e) {
  const kind = LEAVE_KINDS[b.kind] ? b.kind : null; if (!kind) throw bad("กรุณาเลือกประเภทการลา");
  const from = isDate(b.dateFrom) ? b.dateFrom : null; if (!from) throw bad("กรุณาระบุวันที่");
  let to = isDate(b.dateTo) ? b.dateTo : from; if (to < from) to = from;
  const span = eachDay(from, to).length;
  const minutes = kind === "late" ? Math.max(0, Math.round(num(b.minutes, 0))) : 0;
  if (kind === "late" && minutes <= 0) throw bad("กรุณาใส่จำนวนนาทีที่มาสาย");
  const days = kind === "late" ? 0 : r2(b.days === "" || b.days == null ? span : num(b.days, span));
  if (kind !== "late" && (days <= 0 || days > 366)) throw bad("จำนวนวันไม่ถูกต้อง");
  const auto = autoLeaveDeduct(e, kind, days, minutes);
  const deduct = b.deduct === "" || b.deduct == null ? auto : r2(Math.max(0, num(b.deduct, auto)));
  return { kind, from, to, days, minutes, deduct, auto, reason: str(b.reason, 500) };
}
route("GET", B + "/leaves/preview", async ctx => {
  await needBranch(ctx, "leave", "view");
  const e = await getEmp(ctx, ctx.query.employeeId);
  const x = leaveInput({ ...ctx.query, deduct: "" }, e);
  return { days: x.days, deduct: x.auto, dayRate: r2(dayRateOf(e)), payType: e.pay_type };
});
route("GET", B + "/leaves", async ctx => {
  await needBranch(ctx, "leave", "view");
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "l.branch_id=$1 AND l.date_from BETWEEN $2 AND $3";
  if (["pending", "approved", "rejected"].includes(ctx.query.status)) { params.push(ctx.query.status); where += " AND l.status=$" + params.length; }
  if (ctx.query.employeeId) { params.push(ctx.query.employeeId); where += " AND l.employee_id=$" + params.length; }
  const { rows } = await pool.query(`SELECT l.*, p.period AS run_period FROM leaves l LEFT JOIN payroll_runs p ON p.id=l.payroll_run_id WHERE ${where} ORDER BY l.date_from DESC, l.created_at DESC LIMIT 2000`, params);
  return { from, to, leaves: rows.map(leaveOut), kinds: LEAVE_KINDS, canApprove: !!ctx.perms.approve.leave };
});
route("POST", B + "/leaves", async ctx => {
  await needBranch(ctx, "leave", "edit");
  const e = await getEmp(ctx, ctx.body.employeeId);
  const x = leaveInput(ctx.body, e);
  const approveNow = !!ctx.perms.approve.leave && ctx.body.approveNow !== false;
  const id = uid();
  await pool.query(`INSERT INTO leaves (id,branch_id,employee_id,emp_name,kind,date_from,date_to,days,minutes,reason,deduct,status,requested_by,created_at,approved_by,approved_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, ctx.branch.id, e.id, e.name, x.kind, x.from, x.to, x.days, x.minutes, x.reason, x.deduct, approveNow ? "approved" : "pending", ctx.session.actor, now(), approveNow ? ctx.session.actor : null, approveNow ? now() : null]);
  await logActivity(ctx, "leave_add", "บันทึก" + LEAVE_KINDS[x.kind] + " " + e.name + " " + x.from + (x.to !== x.from ? " ถึง " + x.to : "") + (x.kind === "late" ? " " + x.minutes + " นาที" : " " + x.days + " วัน") + " หัก ฿" + x.deduct.toFixed(2) + (approveNow ? " (อนุมัติทันที)" : " (รออนุมัติ)"), ctx.branch.id);
  return { ok: true, id, status: approveNow ? "approved" : "pending" };
});
route("POST", B + "/leaves/:id/approve", async ctx => {
  await needBranch(ctx); needApprove(ctx, "leave");
  const l = (await pool.query("SELECT * FROM leaves WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!l) throw new HttpError(404, "ไม่พบรายการ");
  if (l.status !== "pending") throw bad("รายการนี้ถูกพิจารณาไปแล้ว");
  const ok = ctx.body.approve !== false, reason = str(ctx.body.reason, 300);
  if (!ok && !reason) throw bad("กรุณาใส่เหตุผลที่ไม่อนุมัติ");
  const deduct = ok && ctx.body.deduct !== undefined && ctx.body.deduct !== "" ? r2(Math.max(0, num(ctx.body.deduct, Number(l.deduct)))) : Number(l.deduct);
  await pool.query("UPDATE leaves SET status=$1, approved_by=$2, approved_at=$3, reject_reason=$4, deduct=$5 WHERE id=$6", [ok ? "approved" : "rejected", ctx.session.actor, now(), ok ? null : reason, deduct, l.id]);
  await logActivity(ctx, ok ? "leave_approve" : "leave_reject", (ok ? "อนุมัติ" : "ไม่อนุมัติ") + (LEAVE_KINDS[l.kind] || "") + " " + l.emp_name + " " + l.date_from + (ok ? " หัก ฿" + deduct.toFixed(2) : " · เหตุผล: " + reason), ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/leaves/:id", async ctx => {
  await needBranch(ctx, "leave", "edit");
  const l = (await pool.query("SELECT l.*, p.status AS run_status, p.period FROM leaves l LEFT JOIN payroll_runs p ON p.id=l.payroll_run_id WHERE l.id=$1 AND l.branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!l) throw new HttpError(404, "ไม่พบรายการ");
  if (l.payroll_run_id) throw bad("รายการนี้ถูกหักในงวดเงินเดือน " + (l.period || "") + " แล้ว — ยกเลิกการจ่ายงวดนั้นก่อน");
  if (l.status !== "pending" && !ctx.perms.approve.leave) throw new HttpError(403, "รายการที่พิจารณาแล้ว ลบได้เฉพาะผู้อนุมัติการลา");
  await pool.query("DELETE FROM leaves WHERE id=$1", [l.id]);
  await logActivity(ctx, "leave_delete", "ลบรายการ" + (LEAVE_KINDS[l.kind] || "") + " " + l.emp_name + " " + l.date_from, ctx.branch.id);
  return { ok: true };
});

/* ================= เบิกเงินล่วงหน้า ================= */
function advOut(r) {
  return { id: r.id, employeeId: r.employee_id, empName: r.emp_name || "", amount: Number(r.amount), date: r.req_date, deductPeriod: r.deduct_period, reason: r.reason || "",
    status: r.status, requestedBy: r.requested_by || "", createdAt: Number(r.created_at), approvedBy: r.approved_by || "", approvedAt: Number(r.approved_at) || null,
    rejectReason: r.reject_reason || "", payChannel: r.pay_channel || "", payDate: r.pay_date || "", recordId: r.record_id || "", docNo: r.doc_no || "",
    payrollRunId: r.payroll_run_id || "", payrollPeriod: r.run_period || "" };
}
async function approveAdvance(ctx, a, channel, date) {
  const ch = (await pool.query("SELECT is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [ctx.branch.id, channel])).rows[0];
  if (!ch) throw bad("กรุณาเลือกบัญชีที่จ่ายเงิน");
  if (ch.is_credit) throw bad("เลือกบัญชีเงินจริง (เช่น เงินสด หรือบัญชีธนาคาร)");
  const names = (await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='expense_category'", [ctx.branch.id])).rows.map(x => x.name);
  const cat = names.find(n => /เบิก|ล่วงหน้า/.test(n)) || names.find(n => /เงินเดือน|ค่าแรง/.test(n)) || "เงินเดือน / ค่าแรง";
  const d = isDate(date) ? date : todayBkk();
  const sub = { ...ctx, body: { type: "expense", date: d, party: a.emp_name, description: "เบิกเงินล่วงหน้า " + a.emp_name + " (หักคืนงวด " + a.deduct_period + ")",
    items: [{ name: "เบิกเงินล่วงหน้า " + a.emp_name + (a.reason ? " · " + a.reason : ""), category: cat, qty: 1, unit: "ครั้ง", price: Number(a.amount) }],
    paymentChannel: channel, note: "สร้างอัตโนมัติจากการอนุมัติเบิกเงินล่วงหน้า · จะหักคืนในงวดเงินเดือน " + a.deduct_period } };
  const rec = await saveRecord(sub, null);
  await pool.query("UPDATE records SET source='advance', ref_id=$1 WHERE id=$2", [a.id, rec.id]);
  await pool.query("UPDATE advances SET status='approved', approved_by=$1, approved_at=$2, pay_channel=$3, pay_date=$4, record_id=$5, reject_reason=NULL WHERE id=$6",
    [ctx.session.actor, now(), channel, d, rec.id, a.id]);
  return rec;
}
route("GET", B + "/advances", async ctx => {
  await needBranch(ctx, "advance", "view");
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "a.branch_id=$1 AND a.req_date BETWEEN $2 AND $3";
  if (["pending", "approved", "rejected", "cancelled"].includes(ctx.query.status)) { params.push(ctx.query.status); where += " AND a.status=$" + params.length; }
  const { rows } = await pool.query(`SELECT a.*, r.doc_no, p.period AS run_period FROM advances a LEFT JOIN records r ON r.id=a.record_id LEFT JOIN payroll_runs p ON p.id=a.payroll_run_id
    WHERE ${where} ORDER BY a.req_date DESC, a.created_at DESC LIMIT 2000`, params);
  // ยอดเบิกที่ยังไม่ได้หักคืน (ทุกช่วงเวลา)
  const out = await pool.query("SELECT COALESCE(SUM(amount),0)::float AS s, COUNT(*)::int AS c FROM advances WHERE branch_id=$1 AND status='approved' AND payroll_run_id IS NULL", [ctx.branch.id]);
  return { from, to, advances: rows.map(advOut), outstanding: { amount: r2(out.rows[0].s), count: Number(out.rows[0].c) }, canApprove: !!ctx.perms.approve.advance };
});
route("POST", B + "/advances", async ctx => {
  await needBranch(ctx, "advance", "edit");
  const b = ctx.body || {};
  const e = await getEmp(ctx, b.employeeId);
  const amount = r2(num(b.amount, NaN)); if (!isFinite(amount) || amount <= 0) throw bad("จำนวนเงินต้องมากกว่า 0");
  if (amount > 1000000) throw bad("จำนวนเงินมากเกินไป");
  const date = isDate(b.date) ? b.date : todayBkk();
  const period = isPeriod(b.deductPeriod) ? b.deductPeriod : date.slice(0, 7);
  const id = uid();
  await pool.query(`INSERT INTO advances (id,branch_id,employee_id,emp_name,amount,req_date,deduct_period,reason,status,requested_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,
    [id, ctx.branch.id, e.id, e.name, amount, date, period, str(b.reason, 300), ctx.session.actor, now()]);
  let rec = null;
  if (b.approveNow && ctx.perms.approve.advance) {
    const a = (await pool.query("SELECT * FROM advances WHERE id=$1", [id])).rows[0];
    rec = await approveAdvance(ctx, a, str(b.channel, 120), b.payDate || date);
  }
  await logActivity(ctx, "advance_add", "ขอเบิกเงินล่วงหน้า " + e.name + " ฿" + amount.toFixed(2) + " หักคืนงวด " + period + (rec ? " (อนุมัติทันที → เอกสาร " + rec.docNo + ")" : " (รออนุมัติ)"), ctx.branch.id);
  return { ok: true, id, docNo: rec ? rec.docNo : "" };
});
route("POST", B + "/advances/:id/approve", async ctx => {
  await needBranch(ctx); needApprove(ctx, "advance");
  const a = (await pool.query("SELECT * FROM advances WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!a) throw new HttpError(404, "ไม่พบรายการ");
  if (a.status !== "pending") throw bad("รายการนี้ถูกพิจารณาไปแล้ว");
  if (ctx.body.approve === false) {
    const reason = str(ctx.body.reason, 300); if (!reason) throw bad("กรุณาใส่เหตุผลที่ไม่อนุมัติ");
    await pool.query("UPDATE advances SET status='rejected', approved_by=$1, approved_at=$2, reject_reason=$3 WHERE id=$4", [ctx.session.actor, now(), reason, a.id]);
    await logActivity(ctx, "advance_reject", "ไม่อนุมัติเบิกเงิน " + a.emp_name + " ฿" + Number(a.amount).toFixed(2) + " · เหตุผล: " + reason, ctx.branch.id);
    return { ok: true };
  }
  if (isPeriod(ctx.body.deductPeriod)) { await pool.query("UPDATE advances SET deduct_period=$1 WHERE id=$2", [ctx.body.deductPeriod, a.id]); a.deduct_period = ctx.body.deductPeriod; }
  const rec = await approveAdvance(ctx, a, str(ctx.body.channel, 120), ctx.body.date);
  await logActivity(ctx, "advance_approve", "อนุมัติเบิกเงิน " + a.emp_name + " ฿" + Number(a.amount).toFixed(2) + " จ่ายจาก " + ctx.body.channel + " → เอกสาร " + rec.docNo, ctx.branch.id);
  return { ok: true, docNo: rec.docNo };
});
route("POST", B + "/advances/:id/cancel", async ctx => {
  await needBranch(ctx); needApprove(ctx, "advance");
  const a = (await pool.query("SELECT a.*, p.period FROM advances a LEFT JOIN payroll_runs p ON p.id=a.payroll_run_id WHERE a.id=$1 AND a.branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!a) throw new HttpError(404, "ไม่พบรายการ");
  if (a.status !== "approved") throw bad("ยกเลิกได้เฉพาะรายการที่อนุมัติแล้ว");
  if (a.payroll_run_id) throw bad("หักคืนในงวดเงินเดือน " + (a.period || "") + " แล้ว — ยกเลิกการจ่ายงวดนั้นก่อน");
  if (a.record_id) { await pool.query("DELETE FROM files WHERE record_id=$1", [a.record_id]); await pool.query("DELETE FROM records WHERE id=$1", [a.record_id]); }
  await pool.query("UPDATE advances SET status='cancelled', record_id=NULL, reject_reason=$1 WHERE id=$2", [str(ctx.body.reason, 300) || "ยกเลิกโดย " + ctx.session.actor, a.id]);
  await logActivity(ctx, "advance_cancel", "ยกเลิกเบิกเงิน " + a.emp_name + " ฿" + Number(a.amount).toFixed(2) + " (ลบเอกสารรายจ่ายที่สร้างอัตโนมัติ)", ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/advances/:id", async ctx => {
  await needBranch(ctx, "advance", "edit");
  const a = (await pool.query("SELECT * FROM advances WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!a) throw new HttpError(404, "ไม่พบรายการ");
  if (a.status === "approved") throw bad("รายการที่อนุมัติแล้ว ต้องกด \"ยกเลิก\" (เฉพาะผู้อนุมัติ)");
  if (a.status !== "pending" && !ctx.perms.approve.advance) throw new HttpError(403, "ลบได้เฉพาะผู้อนุมัติการเบิกเงิน");
  await pool.query("DELETE FROM advances WHERE id=$1", [a.id]);
  await logActivity(ctx, "advance_delete", "ลบคำขอเบิกเงิน " + a.emp_name + " ฿" + Number(a.amount).toFixed(2), ctx.branch.id);
  return { ok: true };
});

/* ================= รออนุมัติ (รวม) ================= */
route("GET", B + "/approvals", async ctx => {
  await needBranch(ctx);
  const ap = ctx.perms.approve, bid = ctx.branch.id;
  if (!ap.stock && !ap.leave && !ap.advance) throw new HttpError(403, "ไม่มีสิทธิ์อนุมัติรายการใด");
  const out = { approve: ap };
  if (ap.stock) out.stock = (await pool.query(`SELECT m.*, i.name AS item_name, i.unit, i.qty AS item_qty FROM stock_moves m JOIN stock_items i ON i.id=m.item_id
    WHERE m.branch_id=$1 AND m.status='pending' ORDER BY m.move_date, m.created_at`, [bid])).rows.map(m => moveOut(m, ctx));
  if (ap.leave) out.leaves = (await pool.query("SELECT * FROM leaves WHERE branch_id=$1 AND status='pending' ORDER BY date_from, created_at", [bid])).rows.map(leaveOut);
  if (ap.advance) out.advances = (await pool.query("SELECT * FROM advances WHERE branch_id=$1 AND status='pending' ORDER BY req_date, created_at", [bid])).rows.map(advOut);
  return out;
});

/* ================= ลงเวลา / เช็คอิน GPS ================= */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
const bkkMinutes = ms => { const d = new Date(ms + 7 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hmToMin = hm => { const [h, m] = String(hm || "09:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const bkkDateOf = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
function lateOf(branch, ms) { const diff = bkkMinutes(ms) - hmToMin(branch.work_start); return diff > (Number(branch.late_grace) || 0) ? diff : 0; }
function attOut(r) {
  return { id: r.id, employeeId: r.employee_id, empName: r.emp_name || "", date: r.work_date, kind: r.kind, at: Number(r.at), lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
    accuracy: r.accuracy == null ? null : Number(r.accuracy), distance: r.distance == null ? null : Math.round(Number(r.distance)), lateMin: Number(r.late_min) || 0, manual: !!r.manual,
    note: r.note || "", ip: r.ip || "", ua: r.ua || "", createdBy: r.created_by || "" };
}
// หน้าเช็คอินสาธารณะของสาขา (พนักงานเปิดบนมือถือ เลือกชื่อ + ใส่ PIN)
route("GET", "/api/checkin/:bid", async ctx => {
  const b = (await pool.query("SELECT * FROM branches WHERE id=$1 AND active=TRUE", [ctx.params.bid])).rows[0];
  if (!b) throw new HttpError(404, "ไม่พบสาขา");
  const s = await getSettings();
  const emps = b.checkin_enabled ? (await pool.query("SELECT id, name, nickname, pin_hash FROM employees WHERE branch_id=$1 AND active=TRUE ORDER BY code, name", [b.id])).rows : [];
  return { branch: { id: b.id, name: b.name, color: b.color, code: b.code }, company: { name: s.company_name, logo: s.company_logo }, enabled: !!b.checkin_enabled,
    radius: Number(b.checkin_radius) || 100, workStart: b.work_start || "09:00", lateGrace: Number(b.late_grace) || 0,
    employees: emps.map(e => ({ id: e.id, name: e.name, nickname: e.nickname || "", hasPin: !!e.pin_hash })) };
});
route("POST", "/api/checkin/:bid", async (ctx, req) => {
  const b = (await pool.query("SELECT * FROM branches WHERE id=$1 AND active=TRUE", [ctx.params.bid])).rows[0];
  if (!b) throw new HttpError(404, "ไม่พบสาขา");
  if (!b.checkin_enabled) throw bad("สาขานี้ยังไม่เปิดระบบเช็คอิน");
  const body = ctx.body || {};
  const action = ["in", "out", "status"].includes(body.action) ? body.action : "status";
  const e = (await pool.query("SELECT * FROM employees WHERE id=$1 AND branch_id=$2 AND active=TRUE", [str(body.employeeId, 100), b.id])).rows[0];
  if (!e) throw bad("กรุณาเลือกชื่อของคุณ");
  const key = rateKey(req, "pin:" + e.id); checkRate(key);
  const logCtx = { req, session: { actor: "พนักงาน: " + e.name, kind: "employee", branch_id: b.id } };
  if (!e.pin_hash) throw bad("ยังไม่ได้ตั้ง PIN — แจ้งหัวหน้าให้ตั้ง PIN ในข้อมูลพนักงาน");
  if (!verifyPw(String(body.pin || ""), e.pin_hash)) {
    noteFail(key); await logActivity(logCtx, "checkin_fail", "ใส่ PIN ผิด (" + e.name + ")", b.id);
    throw new HttpError(401, "PIN ไม่ถูกต้อง");
  }
  loginFails.delete(key);
  const t = now(), day = bkkDateOf(t);
  const todays = async () => (await pool.query("SELECT * FROM attendance WHERE employee_id=$1 AND work_date=$2 ORDER BY at", [e.id, day])).rows.map(attOut);
  if (action === "status") return { ok: true, employee: { id: e.id, name: e.name }, today: await todays(), date: day };
  const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.accuracy);
  if (!isFinite(lat) || !isFinite(lng)) throw bad("อ่านตำแหน่ง GPS ไม่ได้ — กรุณาเปิด Location และอนุญาตให้เบราว์เซอร์ใช้ตำแหน่ง");
  if (b.checkin_lat == null || b.checkin_lng == null) throw bad("ยังไม่ได้ตั้งพิกัดร้าน — แจ้งผู้ดูแลระบบ");
  const dist = haversine(lat, lng, Number(b.checkin_lat), Number(b.checkin_lng));
  const radius = Number(b.checkin_radius) || 100;
  if (dist > radius) {
    await logActivity(logCtx, "checkin_fail", (action === "in" ? "เช็คอิน" : "เช็คเอาท์") + " ไม่สำเร็จ: อยู่ห่างร้าน " + Math.round(dist) + " ม. (กำหนด " + radius + " ม.)", b.id, { lat, lng });
    throw bad("คุณอยู่ห่างจากร้าน " + Math.round(dist).toLocaleString("en-US") + " เมตร (ต้องอยู่ในระยะไม่เกิน " + radius.toLocaleString("en-US") + " เมตร)");
  }
  const today = await todays();
  const last = today[today.length - 1];
  if (action === "in" && last && last.kind === "in") throw bad("เช็คอินไปแล้วเมื่อ " + new Date(last.at + 7 * 3600000).toISOString().slice(11, 16) + " น. — กดเช็คเอาท์เมื่อเลิกงาน");
  if (action === "out" && (!last || last.kind !== "in")) throw bad("ยังไม่ได้เช็คอินวันนี้");
  const lateMin = action === "in" && !today.some(x => x.kind === "in") ? lateOf(b, t) : 0;
  await pool.query(`INSERT INTO attendance (id,branch_id,employee_id,emp_name,work_date,kind,at,lat,lng,accuracy,distance,late_min,manual,ip,ua,created_by,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13,$14,$15,$7)`,
    [uid(), b.id, e.id, e.name, day, action, t, lat, lng, isFinite(acc) ? acc : null, dist, lateMin, clientIp(req), clientUa(req), "เช็คอินด้วยตัวเอง"]);
  await logActivity(logCtx, action === "in" ? "checkin" : "checkout", (action === "in" ? "เช็คอินเข้างาน" : "เช็คเอาท์ออกงาน") + " ห่างร้าน " + Math.round(dist) + " ม." + (lateMin ? " · สาย " + lateMin + " นาที" : ""), b.id, { lat, lng });
  return { ok: true, action, at: t, distance: Math.round(dist), lateMin, employee: { id: e.id, name: e.name }, today: await todays(), date: day };
});
route("GET", B + "/attendance", async ctx => {
  await needBranch(ctx, "attendance", "view");
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "branch_id=$1 AND work_date BETWEEN $2 AND $3";
  if (ctx.query.employeeId) { params.push(ctx.query.employeeId); where += " AND employee_id=$" + params.length; }
  const { rows } = await pool.query(`SELECT * FROM attendance WHERE ${where} ORDER BY work_date DESC, at ASC LIMIT 10000`, params);
  const b = ctx.branch;
  return { from, to, entries: rows.map(attOut), settings: { enabled: !!b.checkin_enabled, workStart: b.work_start || "09:00", lateGrace: Number(b.late_grace) || 0, radius: Number(b.checkin_radius) || 100, hasLocation: b.checkin_lat != null } };
});
// เพิ่มรายการลงเวลาด้วยมือ (หัวหน้า) — ระบุว่า "บันทึกเอง"
route("POST", B + "/attendance", async ctx => {
  await needBranch(ctx, "attendance", "edit");
  const b = ctx.body || {};
  const e = await getEmp(ctx, b.employeeId);
  const date = isDate(b.date) ? b.date : todayBkk();
  const hm = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || "")) ? x : null;
  const tin = hm(b.timeIn), tout = hm(b.timeOut);
  if (!tin && !tout) throw bad("กรุณาใส่เวลาเข้า หรือเวลาออก");
  const toMs = t => new Date(date + "T" + t + ":00+07:00").getTime();
  if (tin && tout && toMs(tout) <= toMs(tin)) throw bad("เวลาออกต้องหลังเวลาเข้า");
  const note = str(b.note, 300);
  const had = (await pool.query("SELECT COUNT(*)::int AS c FROM attendance WHERE employee_id=$1 AND work_date=$2 AND kind='in'", [e.id, date])).rows[0].c;
  const ins = async (kind, t, late) => pool.query(`INSERT INTO attendance (id,branch_id,employee_id,emp_name,work_date,kind,at,late_min,manual,note,ip,ua,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12,$13)`,
    [uid(), ctx.branch.id, e.id, e.name, date, kind, toMs(t), late, note, clientIp(ctx.req), clientUa(ctx.req), ctx.session.actor, now()]);
  if (tin) await ins("in", tin, Number(had) ? 0 : lateOf(ctx.branch, toMs(tin)));
  if (tout) await ins("out", tout, 0);
  await logActivity(ctx, "attendance_manual", "บันทึกเวลาเอง " + e.name + " " + date + (tin ? " เข้า " + tin : "") + (tout ? " ออก " + tout : "") + (note ? " · " + note : ""), ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/attendance/:id", async ctx => {
  await needBranch(ctx, "attendance", "edit");
  const { rows } = await pool.query("DELETE FROM attendance WHERE id=$1 AND branch_id=$2 RETURNING emp_name, work_date, kind, at", [ctx.params.id, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "attendance_delete", "ลบรายการลงเวลา " + rows[0].emp_name + " " + rows[0].work_date + " (" + (rows[0].kind === "in" ? "เข้า" : "ออก") + ")", ctx.branch.id);
  return { ok: true };
});

/* ================= งบการเงิน (P&L / BS) ================= */
async function fsGroupMap(bid) {
  const { rows } = await pool.query("SELECT kind, name, fs_group FROM lists WHERE branch_id=$1 AND kind IN ('income_category','expense_category','invest_category')", [bid]);
  const m = {}; rows.forEach(r => { m[r.kind + "|" + r.name] = FS_GROUPS[r.kind][r.fs_group] ? r.fs_group : guessFsGroup(r.kind, r.name); });
  return (type, name) => m[type + "_category|" + name] || guessFsGroup(type + "_category", name);
}
const dayBefore = d => new Date(new Date(d + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
// ยอดแยกตามกลุ่มงบ/หมวด (ไม่รวม VAT) ของเอกสารในช่วงวันที่
async function fsAmounts(bid, from, to) {
  const grp = await fsGroupMap(bid);
  const { rows } = await pool.query("SELECT type, items_json, subtotal, total, vat_amount, vat_mode FROM records WHERE branch_id=$1 AND rec_date BETWEEN $2 AND $3", [bid, from, to]);
  const g = {}; // g[group][category] = amount
  let vatOut = 0, vatIn = 0;
  rows.forEach(r => {
    let items = []; try { items = JSON.parse(r.items_json || "[]"); } catch (e) {}
    const vat = r.vat_mode !== "none" ? Number(r.vat_amount) || 0 : 0;
    if (r.type === "income") vatOut += vat; else vatIn += vat;
    const ex = (Number(r.total) || 0) - vat, sub = Number(r.subtotal) || 0;
    items.forEach(it => { const share = sub > 0 ? ex * (Number(it.amount) / sub) : ex / items.length; const c = it.category || "ไม่ระบุหมวด"; const k = grp(r.type, c);
      g[k] = g[k] || {}; g[k][c] = (g[k][c] || 0) + share; });
  });
  return { g, vatOut: r2(vatOut), vatIn: r2(vatIn) };
}
async function manualStockIn(bid, from, to) {
  const r = await pool.query("SELECT COALESCE(SUM(amount),0)::float AS s FROM stock_moves WHERE branch_id=$1 AND status='approved' AND kind='in' AND ref_record_id IS NULL AND move_date BETWEEN $2 AND $3", [bid, from, to]);
  return r2(r.rows[0].s);
}
async function plData(bid, from, to, useInv) {
  const { g } = await fsAmounts(bid, from, to);
  const lines = k => Object.entries(g[k] || {}).map(([name, v]) => ({ name, amount: r2(v) })).sort((a, b) => b.amount - a.amount);
  const sum = k => r2(lines(k).reduce((a, x) => a + x.amount, 0));
  const purchases = sum("cogs");
  let begin = 0, end = 0, other = 0;
  if (useInv) { begin = await stockValueAt(bid, dayBefore(from)); end = await stockValueAt(bid, to); other = await manualStockIn(bid, from, to); }
  const cogs = r2(purchases + (useInv ? begin + other - end : 0));
  const sales = sum("sales"), gross = r2(sales - cogs);
  const selling = sum("selling"), staff = sum("staff"), admin = sum("admin");
  const operating = r2(gross - selling - staff - admin);
  const otherIncome = sum("other_income"), otherExpense = sum("other_expense");
  const beforeTax = r2(operating + otherIncome - otherExpense), tax = sum("income_tax"), net = r2(beforeTax - tax);
  return { from, to, useInventory: !!useInv, sales: { total: sales, lines: lines("sales") },
    cogs: { purchases, purchaseLines: lines("cogs"), beginInventory: begin, otherIn: other, endInventory: end, total: cogs },
    grossProfit: gross, grossMargin: sales ? Math.round(gross / sales * 1000) / 10 : 0,
    selling: { total: selling, lines: lines("selling") }, staff: { total: staff, lines: lines("staff") }, admin: { total: admin, lines: lines("admin") },
    operatingProfit: operating, otherIncome: { total: otherIncome, lines: lines("other_income") }, otherExpense: { total: otherExpense, lines: lines("other_expense") },
    profitBeforeTax: beforeTax, incomeTax: { total: tax, lines: lines("income_tax") }, netProfit: net, netMargin: sales ? Math.round(net / sales * 1000) / 10 : 0 };
}
route("GET", B + "/statements/pl", async ctx => {
  await needBranch(ctx, "statements", "view");
  const { from, to } = rangeOf(ctx.query);
  return await plData(ctx.branch.id, from, to, ctx.query.inv !== "0");
});
route("GET", B + "/statements/bs", async ctx => {
  await needBranch(ctx, "statements", "view");
  const bid = ctx.branch.id, D = isDate(ctx.query.date) ? ctx.query.date : todayBkk(), useInv = ctx.query.inv !== "0";
  // เงินสดและเงินฝาก ณ วันที่
  const ls = await pool.query("SELECT name, is_credit, opening_balance, opening_date FROM lists WHERE branch_id=$1 AND kind='payment_channel' ORDER BY sort_order", [bid]);
  const credit = new Set(ls.rows.filter(r => r.is_credit).map(r => r.name));
  const mv = await accountMovements(bid);
  const cashNames = [...new Set([...ls.rows.filter(r => !r.is_credit).map(r => r.name), ...mv.map(m => m.ch).filter(n => !credit.has(n))])];
  const cash = cashNames.map(name => {
    const row = ls.rows.find(r => r.name === name);
    const od = (row && row.opening_date) || "", ob = row && row.opening_balance != null ? Number(row.opening_balance) : 0;
    const bal = (od && od > D) ? 0 : ob + mv.filter(m => m.ch === name && (!od || m.date >= od) && m.date <= D).reduce((a, m) => a + m.amount, 0);
    return { name, amount: r2(bal) };
  }).filter(x => x.amount !== 0);
  // ค้างรับ / ค้างจ่าย ณ วันที่
  const due = await pool.query(`SELECT type, payment_channel, total FROM records WHERE branch_id=$1 AND due_date IS NOT NULL AND due_date<>'' AND rec_date<=$2
    AND NOT (settled_date IS NOT NULL AND settled_date<>'' AND settled_date<=$2)`, [bid, D]);
  let ar = 0, apCredit = 0, ap = 0;
  due.rows.forEach(r => { const t = Number(r.total) || 0; if (r.type === "income") ar += t; else if (credit.has(r.payment_channel)) apCredit += t; else ap += t; });
  const amt = await fsAmounts(bid, "1900-01-01", D);
  const vatNet = r2(amt.vatOut - amt.vatIn);
  const inventory = useInv ? await stockValueAt(bid, D) : 0;
  const assetGroups = Object.keys(FS_GROUPS.invest_category).map(k => ({ key: k, name: FS_GROUPS.invest_category[k],
    amount: r2(Object.values(amt.g[k] || {}).reduce((a, v) => a + v, 0)), lines: Object.entries(amt.g[k] || {}).map(([name, v]) => ({ name, amount: r2(v) })) })).filter(x => x.amount);
  const cashTotal = r2(cash.reduce((a, x) => a + x.amount, 0));
  const current = [{ key: "cash", name: "เงินสดและเงินฝากธนาคาร", amount: cashTotal, lines: cash }, { key: "ar", name: "ลูกหนี้ / รายได้ค้างรับ", amount: r2(ar) }];
  if (useInv) current.push({ key: "inventory", name: "สินค้าคงเหลือ", amount: inventory });
  if (vatNet < 0) current.push({ key: "vat", name: "ภาษีซื้อรอขอคืน / เครดิต", amount: r2(-vatNet) });
  const currentTotal = r2(current.reduce((a, x) => a + x.amount, 0));
  const fixedTotal = r2(assetGroups.reduce((a, x) => a + x.amount, 0));
  const totalAssets = r2(currentTotal + fixedTotal);
  const liab = [{ key: "ap_credit", name: "เจ้าหนี้บัตรเครดิต / ช่องทางเครดิต", amount: r2(apCredit) }, { key: "ap", name: "เจ้าหนี้การค้า / ค่าใช้จ่ายค้างจ่าย", amount: r2(ap) }];
  if (vatNet > 0) liab.push({ key: "vat", name: "ภาษีขายรอนำส่ง (สุทธิ)", amount: vatNet });
  const totalLiab = r2(liab.reduce((a, x) => a + x.amount, 0));
  const pl = await plData(bid, "1900-01-01", D, useInv);
  const retained = pl.netProfit;
  const ytd = await plData(bid, D.slice(0, 4) + "-01-01", D, useInv);
  const capital = r2(totalAssets - totalLiab - retained);
  return { date: D, useInventory: useInv,
    assets: { current, currentTotal, fixed: assetGroups, fixedTotal, total: totalAssets },
    liabilities: { lines: liab, total: totalLiab },
    equity: { capital, retained, retainedYtd: ytd.netProfit, total: r2(capital + retained) }, totalLiabEquity: r2(totalLiab + capital + retained) };
});

/* ================= บัตรเครดิต: แผนผ่อน / บิลรายเดือน / ชำระบิล ================= */
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const ymd = (y, m, d) => { while (m > 12) { m -= 12; y++; } return y + "-" + String(m).padStart(2, "0") + "-" + String(Math.min(d, lastDayOf(y, m))).padStart(2, "0"); };
const addMonthsKeep = (date, k, day) => { const [y, m, d] = date.split("-").map(Number); return ymd(y, m + k, day || d); };
// วันครบกำหนดชำระของรายการที่รูดวันที่ date: ตัดรอบวันที่ cut → ครบกำหนดวันที่ due (ถ้า due ≤ cut = เดือนถัดจากรอบ)
function cardDueFor(date, cut, due) {
  let [y, m, d] = date.split("-").map(Number);
  if (d > Math.min(cut, lastDayOf(y, m))) m++;
  if (due <= cut) m++;
  return ymd(y, m, due);
}
function defaultFirstMonth(date, payDay) {
  const [y, m, d] = date.split("-").map(Number);
  return d < Math.min(payDay, lastDayOf(y, m)) ? date.slice(0, 7) : ymd(y, m + 1, 1).slice(0, 7);
}
const isCardRow = r => !!(r && r.is_credit && r.card_due_day && r.card_cut_day);
async function cardRow(bid, name) { return (await pool.query("SELECT * FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [bid, name])).rows[0]; }
const FEE_CAT = "ค่าธรรมเนียม / ดอกเบี้ยบัตรเครดิต";
async function feeCategory(bid) {
  const names = (await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='expense_category'", [bid])).rows.map(r => r.name);
  const hit = names.find(n => n === FEE_CAT) || names.find(n => /ดอกเบี้ย/.test(n)) || names.find(n => /บัตรเครดิต/.test(n) && /ค่าธรรมเนียม/.test(n));
  if (hit) return hit;
  await listOpAll(await syncBranchIds(bid), "add", "expense_category", { name: FEE_CAT, fsGroup: "other_expense" });
  return FEE_CAT;
}
const splitAmt = (total, n) => { const per = Math.floor(total / n * 100) / 100; const a = Array(n).fill(per); a[n - 1] = r2(total - per * (n - 1)); return a; };

// สร้างแผนผ่อนชำระ: ลงค่าใช้จ่ายเป็นรายเดือน เดือนละ 1 งวด (แต่ละงวดเป็นเอกสารของเดือนนั้น และอยู่ในบิลบัตรของเดือนนั้น)
route("POST", B + "/card-plans", async ctx => {
  await needBranch(ctx);
  const b = ctx.body || {};
  const type = b.type === "invest" ? "invest" : "expense"; need(ctx, type, "edit");
  const card = await cardRow(ctx.branch.id, str(b.paymentChannel, 120));
  if (!card || !card.is_credit) throw bad("การผ่อนชำระใช้ได้กับช่องทางแบบเครดิต (เช่น บัตรเครดิต) เท่านั้น");
  const months = Math.round(num(b.months, 0)); if (months < 2 || months > 60) throw bad("จำนวนงวดผ่อนต้องอยู่ระหว่าง 2 - 60 เดือน");
  const c = calcRecord(b, type);
  if (c.items.some(i => i.stockItemId)) throw bad("การแบ่งจ่ายยังไม่รองรับการผูกสต็อก — เอาการผูกสต็อกออก แล้วบันทึกรับเข้าสต็อกแยก");
  const date = isDate(b.date) ? b.date : todayBkk();
  const interest = r2(Math.max(0, num(b.interest, 0)));
  // จ่ายทุกวันที่ payDay ของเดือน · งวดแรก = เดือน firstMonth (ค่าเริ่มต้น = วันจ่ายครั้งแรกที่ถัดจากวันที่ซื้อ)
  const payDay = Math.round(num(b.payDay, card.card_due_day || Number(date.slice(8, 10))));
  if (payDay < 1 || payDay > 31) throw bad("วันที่จ่ายต้องอยู่ระหว่าง 1 - 31");
  const firstMonth = isPeriod(b.firstMonth) ? b.firstMonth : defaultFirstMonth(date, payDay);
  if (firstMonth < date.slice(0, 7)) throw bad("งวดแรกต้องไม่ก่อนเดือนที่ซื้อ");
  const [fy, fm] = firstMonth.split("-").map(Number);
  const payDate = k => ymd(fy, fm + k, payDay);
  const firstDue = payDate(0);
  const planId = uid(), party = str(b.party, 200), note = str(b.note, 1000);
  const baseDesc = str(b.description, 300) || c.items.map(i => i.name || i.category).filter(Boolean).slice(0, 3).join(", ");
  await pool.query(`INSERT INTO card_plans (id,branch_id,type,card,purchase_date,party,description,items_json,total,interest,months,first_due,status,created_by,created_at,pay_day)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14,$15)`, [planId, ctx.branch.id, type, card.name, date, party, baseDesc, JSON.stringify(c.items), c.total, interest, months, firstDue, ctx.session.actor, now(), payDay]);
  await pool.query("UPDATE card_plans SET body_json=$1 WHERE id=$2", [JSON.stringify({ type, date, party, description: str(b.description, 300), note, items: c.items.map(i => ({ name: i.name, category: i.category, qty: i.qty, unit: i.unit, price: i.price })),
    discountType: c.discountType, discountValue: c.discountValue, vatMode: c.vatMode, paymentChannel: card.name, months, payDay, firstMonth, interest }), planId]);
  const amts = splitAmt(c.total, months), ints = interest ? splitAmt(interest, months) : null, vats = c.vat ? splitAmt(c.vat, months) : null;
  const fee = interest ? await feeCategory(ctx.branch.id) : null;
  const docs = [];
  const insert = async (rtype, k, items, vat, desc) => {
    // ค่าใช้จ่ายของงวดนี้ลงในวันที่จ่ายงวดนั้น (ไม่ลงเต็มจำนวนในเดือนที่ซื้อ)
    const recDate = payDate(k), due = recDate;
    const total = r2(items.reduce((a, i) => a + i.amount, 0));
    const cats = [...new Set(items.map(i => i.category))];
    const docNo = await nextDocNo(ctx.branch.id, rtype, recDate);
    await pool.query(`INSERT INTO records (id,branch_id,type,doc_no,rec_date,party,description,category,items_json,subtotal,discount_type,discount_value,discount,vat_mode,vat_amount,total,
      payment_channel,due_date,note,created_by,created_at,source,ref_id,plan_id,plan_seq,plan_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'baht',0,0,$11,$12,$13,$14,$15,$16,$17,$18,'installment',$19,$19,$20,$21)`,
      [uid(), ctx.branch.id, rtype, docNo, recDate, party, desc, cats.join(", "), JSON.stringify(items), total, vat ? "incl" : "none", vat || 0, total, card.name, due,
        (note ? note + " · " : "") + "ผ่อนชำระบัตร " + card.name + " ซื้อวันที่ " + date + " ยอดรวม " + c.total.toFixed(2), ctx.session.actor, now(), planId, k + 1, months]);
    docs.push(docNo);
  };
  for (let k = 0; k < months; k++) {
    // แบ่งยอดงวดตามสัดส่วนของแต่ละบรรทัด
    const items = []; let left = amts[k];
    c.items.forEach((it, i) => { const share = i === c.items.length - 1 ? r2(left) : r2(amts[k] * (c.subtotal > 0 ? it.amount / c.subtotal : 1 / c.items.length)); left = r2(left - share);
      items.push({ name: it.name, category: it.category, qty: 1, unit: "งวด", price: share, amount: share }); });
    const desc = baseDesc + " (ผ่อนงวด " + (k + 1) + "/" + months + ")";
    await insert(type, k, items, vats ? vats[k] : 0, desc);
    // ดอกเบี้ยแยกเป็นเอกสารรายจ่ายของงวดเดียวกัน (VAT จะได้ไม่ถูกเฉลี่ยไปที่ดอกเบี้ย)
    if (ints) await insert("expense", k, [{ name: "ดอกเบี้ย/ค่าธรรมเนียมผ่อนชำระ: " + baseDesc, category: fee, qty: 1, unit: "งวด", price: ints[k], amount: ints[k] }], 0, "ดอกเบี้ยผ่อน " + baseDesc + " (งวด " + (k + 1) + "/" + months + ")");
  }
  await logActivity(ctx, "card_plan_add", "บันทึกผ่อนบัตร " + card.name + ": " + baseDesc + " ฿" + c.total.toFixed(2) + " ผ่อน " + months + " งวด จ่ายทุกวันที่ " + payDay + (interest ? " ดอกเบี้ย ฿" + interest.toFixed(2) : "") + " งวดแรก " + firstDue, ctx.branch.id);
  return { ok: true, planId, firstDue, docs, perMonth: amts[0] + (ints ? ints[0] : 0) };
});
// รายละเอียดแผนผ่อน (ใช้กับปุ่ม "แก้ไขแผนผ่อน": เปิดฟอร์มเดิมให้แก้ แล้วบันทึกแทนแผนเดิม)
route("GET", B + "/card-plans/:id", async ctx => {
  await needBranch(ctx, ["cards", "expense", "invest"], "view");
  const p = (await pool.query("SELECT * FROM card_plans WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!p) throw new HttpError(404, "ไม่พบแผนผ่อน");
  const recs = (await pool.query("SELECT settled_at, plan_seq FROM records WHERE plan_id=$1", [p.id])).rows;
  let form = null; try { form = JSON.parse(p.body_json || "null"); } catch (e) {}
  if (!form) { // แผนที่สร้างก่อนเก็บฟอร์มเดิม: ประกอบจากข้อมูลที่มี
    let items = []; try { items = JSON.parse(p.items_json || "[]"); } catch (e) {}
    const sum = r2(items.reduce((a, i) => a + Number(i.amount || 0), 0)), tot = Number(p.total);
    form = { type: p.type, date: p.purchase_date, party: p.party || "", description: p.description || "", note: "", paymentChannel: p.card, months: Number(p.months), payDay: p.pay_day || Number(String(p.first_due || "").slice(8, 10)) || null,
      firstMonth: String(p.first_due || "").slice(0, 7), interest: Number(p.interest), items: items.map(i => ({ name: i.name, category: i.category, qty: i.qty, unit: i.unit, price: i.price })),
      discountType: "baht", discountValue: tot < sum ? r2(sum - tot) : 0, vatMode: tot > sum + 0.005 ? "excl" : "none" };
  }
  return { plan: { id: p.id, card: p.card, status: p.status, paid: new Set(recs.filter(r => r.settled_at).map(r => r.plan_seq)).size, count: new Set(recs.map(r => r.plan_seq)).size, form } };
});
route("DELETE", B + "/card-plans/:id", async ctx => {
  await needBranch(ctx, "cards", "edit");
  const p = (await pool.query("SELECT * FROM card_plans WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!p) throw new HttpError(404, "ไม่พบแผนผ่อน");
  const recs = (await pool.query("SELECT id, settled_at, plan_seq FROM records WHERE plan_id=$1", [p.id])).rows;
  const paid = new Set(recs.filter(r => r.settled_at).map(r => r.plan_seq)).size;
  if (paid && !ctx.query.remaining) throw bad("แผนนี้ชำระไปแล้ว " + paid + " งวด — เลือก \"ยกเลิกงวดที่เหลือ\" แทน");
  const del = recs.filter(r => !r.settled_at).map(r => r.id);
  if (del.length) { await pool.query("DELETE FROM files WHERE record_id = ANY($1::text[])", [pgArr(del)]); await pool.query("DELETE FROM records WHERE id = ANY($1::text[])", [pgArr(del)]); }
  await pool.query("UPDATE card_plans SET status=$1 WHERE id=$2", [paid ? "closed" : "cancelled", p.id]);
  await logActivity(ctx, "card_plan_cancel", (paid ? "ยกเลิกงวดที่เหลือ " + del.length + " งวด" : "ยกเลิกแผนผ่อน") + " · " + p.card + " " + p.description, ctx.branch.id);
  return { ok: true, removed: del.length };
});
async function cardBillsDue(bid, days) {
  const lim = new Date(Date.now() + 7 * 3600000 + days * 86400000).toISOString().slice(0, 10);
  const { rows } = await pool.query(`SELECT r.payment_channel AS card, r.due_date, SUM(r.total)::float AS total, COUNT(*)::int AS c FROM records r
    JOIN lists l ON l.branch_id=r.branch_id AND l.kind='payment_channel' AND l.name=r.payment_channel AND l.is_credit
    WHERE r.branch_id=$1 AND r.type<>'income' AND r.due_date IS NOT NULL AND r.due_date<>'' AND r.settled_at IS NULL AND r.due_date<=$2 GROUP BY r.payment_channel, r.due_date ORDER BY r.due_date`, [bid, lim]);
  const t = todayBkk();
  return rows.map(r => ({ card: r.card, dueDate: r.due_date, total: r2(r.total), count: Number(r.c), overdue: r.due_date < t }));
}
route("GET", B + "/cards", async ctx => {
  await needBranch(ctx, "cards", "view");
  const bid = ctx.branch.id, t = todayBkk(), soon = new Date(Date.now() + 7 * 3600000 + 7 * 86400000).toISOString().slice(0, 10);
  const chans = (await pool.query("SELECT * FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND is_credit ORDER BY sort_order", [bid])).rows;
  const cards = [];
  const used = new Set((await pool.query(`SELECT DISTINCT payment_channel AS n FROM records WHERE branch_id=$1 AND type<>'income' AND payment_channel IS NOT NULL
    UNION SELECT DISTINCT card AS n FROM card_plans WHERE branch_id=$1`, [bid])).rows.map(r => r.n));
  const shown = chans.filter(c => isCardRow(c) || used.has(c.name));
  for (const ch of shown) {
    const recs = (await pool.query(`SELECT id, type, doc_no, rec_date, party, description, total, due_date, plan_id, plan_seq, plan_count, source FROM records
      WHERE branch_id=$1 AND payment_channel=$2 AND type<>'income' AND due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL ORDER BY due_date, rec_date`, [bid, ch.name])).rows;
    const bills = {};
    recs.forEach(r => { const bl = bills[r.due_date] = bills[r.due_date] || { dueDate: r.due_date, total: 0, records: [] }; bl.total += Number(r.total);
      bl.records.push({ id: r.id, type: r.type, docNo: r.doc_no, date: r.rec_date, party: r.party || "", description: r.description || "", total: Number(r.total), planSeq: r.plan_seq, planCount: r.plan_count, installment: r.source === "installment" }); });
    const billList = Object.values(bills).map(bl => ({ ...bl, total: r2(bl.total), status: bl.dueDate < t ? "overdue" : bl.dueDate <= soon ? "soon" : "upcoming" }));
    const plans = (await pool.query(`SELECT p.*, (SELECT COUNT(DISTINCT plan_seq) FROM records r WHERE r.plan_id=p.id AND r.settled_at IS NOT NULL)::int AS paid,
      (SELECT COUNT(DISTINCT plan_seq) FROM records r WHERE r.plan_id=p.id)::int AS cnt, (SELECT COALESCE(SUM(total),0) FROM records r WHERE r.plan_id=p.id AND r.settled_at IS NULL)::float AS remaining,
      (SELECT MIN(due_date) FROM records r WHERE r.plan_id=p.id AND r.settled_at IS NULL) AS next_due
      FROM card_plans p WHERE p.branch_id=$1 AND p.card=$2 ORDER BY p.purchase_date DESC LIMIT 100`, [bid, ch.name])).rows;
    const hist = (await pool.query(`SELECT settle_batch, MAX(settled_date) AS d, MAX(settled_channel) AS ch, MAX(settled_by) AS by, SUM(total)::float AS s, COUNT(*)::int AS c FROM records
      WHERE branch_id=$1 AND payment_channel=$2 AND settle_batch IS NOT NULL GROUP BY settle_batch ORDER BY MAX(settled_at) DESC LIMIT 12`, [bid, ch.name])).rows;
    const fees = hist.length ? (await pool.query("SELECT ref_id, total FROM records WHERE source='card_fee' AND ref_id = ANY($1::text[])", [pgArr(hist.map(h => h.settle_batch))])).rows : [];
    const outstanding = r2(recs.reduce((a, r) => a + Number(r.total), 0));
    const limit = ch.card_limit == null ? null : Number(ch.card_limit);
    cards.push({ id: ch.id, name: ch.name, cutDay: Number(ch.card_cut_day) || null, dueDay: Number(ch.card_due_day) || null, limit, outstanding, available: limit == null ? null : r2(limit - outstanding),
      bills: billList, plans: plans.map(p => ({ id: p.id, type: p.type, purchaseDate: p.purchase_date, party: p.party || "", description: p.description || "", total: Number(p.total), interest: Number(p.interest),
        months: Number(p.months), payDay: p.pay_day == null ? null : Number(p.pay_day), status: p.status, paid: Number(p.paid), count: Number(p.cnt), remaining: r2(p.remaining), nextDue: p.next_due || "", createdBy: p.created_by || "" })),
      history: hist.map(h => ({ batch: h.settle_batch, date: h.d, channel: h.ch, by: h.by, total: r2(h.s), count: Number(h.c), fee: r2((fees.find(f => f.ref_id === h.settle_batch) || {}).total || 0) })) });
  }
  return { cards, notSetUp: chans.filter(c => !shown.includes(c)).map(c => ({ id: c.id, name: c.name })), alerts: await cardBillsDue(bid, 7) };
});
// ชำระบิลบัตร: เลือกรายการ (ทั้งบิล) + บัญชีที่จ่าย → ตัดเงินจากบัญชีนั้น · ใส่ดอกเบี้ย/ค่าปรับได้
route("POST", B + "/cards/pay", async ctx => {
  await needBranch(ctx, "cards", "edit");
  const b = ctx.body || {};
  const cardName = str(b.card, 120);
  const ids = (Array.isArray(b.recordIds) ? b.recordIds : []).map(String);
  if (!ids.length) throw bad("กรุณาเลือกรายการที่จะชำระ");
  const ch = await cardRow(ctx.branch.id, str(b.channel, 120));
  if (!ch) throw bad("กรุณาเลือกบัญชีที่ใช้จ่ายบิล");
  if (ch.is_credit) throw bad("เลือกบัญชีเงินจริง (เงินสด หรือบัญชีธนาคาร)");
  const date = isDate(b.date) ? b.date : todayBkk();
  const recs = (await pool.query("SELECT id, total, doc_no FROM records WHERE branch_id=$1 AND payment_channel=$2 AND settled_at IS NULL AND id = ANY($3::text[])", [ctx.branch.id, cardName, pgArr(ids)])).rows;
  if (recs.length !== ids.length) throw bad("มีบางรายการถูกชำระไปแล้ว หรือไม่ใช่รายการของบัตรนี้ — รีเฟรชหน้าแล้วลองใหม่");
  const batch = uid();
  await pool.query("UPDATE records SET settled_at=$1, settled_date=$2, settled_by=$3, settled_channel=$4, settle_batch=$5 WHERE id = ANY($6::text[])", [now(), date, ctx.session.actor, ch.name, batch, pgArr(ids)]);
  const total = r2(recs.reduce((a, r) => a + Number(r.total), 0));
  const fee = r2(Math.max(0, num(b.fee, 0)));
  let feeDoc = "";
  if (fee > 0) {
    const cat = await feeCategory(ctx.branch.id);
    const sub = { ...ctx, body: { type: "expense", date, party: cardName, description: str(b.feeNote, 200) || "ดอกเบี้ย / ค่าธรรมเนียม บัตร " + cardName,
      items: [{ name: str(b.feeNote, 200) || "ดอกเบี้ย / ค่าธรรมเนียม / ค่าปรับ บัตร " + cardName, category: cat, qty: 1, unit: "ครั้ง", price: fee }], paymentChannel: ch.name, note: "บันทึกพร้อมการชำระบิลบัตร" } };
    const rec = await saveRecord(sub, null);
    await pool.query("UPDATE records SET source='card_fee', ref_id=$1 WHERE id=$2", [batch, rec.id]); feeDoc = rec.docNo;
  }
  await logActivity(ctx, "card_pay", "ชำระบิลบัตร " + cardName + " " + recs.length + " รายการ ฿" + total.toFixed(2) + " จาก " + ch.name + (fee ? " + ดอกเบี้ย/ค่าธรรมเนียม ฿" + fee.toFixed(2) + " (" + feeDoc + ")" : ""), ctx.branch.id);
  return { ok: true, batch, total, fee, feeDoc };
});
route("POST", B + "/cards/unpay", async ctx => {
  await needBranch(ctx, "cards", "edit");
  const batch = str(ctx.body.batch, 100); if (!batch) throw bad("ไม่พบรายการชำระ");
  const { rows } = await pool.query("UPDATE records SET settled_at=NULL, settled_date=NULL, settled_by=NULL, settled_channel=NULL, settle_batch=NULL WHERE branch_id=$1 AND settle_batch=$2 RETURNING total, payment_channel", [ctx.branch.id, batch]);
  if (!rows.length) throw new HttpError(404, "ไม่พบรายการชำระ");
  const fr = (await pool.query("DELETE FROM records WHERE branch_id=$1 AND source='card_fee' AND ref_id=$2 RETURNING id", [ctx.branch.id, batch])).rows;
  if (fr.length) await pool.query("DELETE FROM files WHERE record_id = ANY($1::text[])", [pgArr(fr.map(r => r.id))]);
  await logActivity(ctx, "card_unpay", "ยกเลิกการชำระบิลบัตร " + rows[0].payment_channel + " " + rows.length + " รายการ ฿" + r2(rows.reduce((a, r) => a + Number(r.total), 0)).toFixed(2), ctx.branch.id);
  return { ok: true };
});

// ดึงข้อมูลอัตโนมัติเข้างวดเงินเดือน: วันทำงาน (รายวัน) จากการเช็คอิน + ยอดหักลาที่อนุมัติ + เงินเบิกล่วงหน้าที่อนุมัติ
const NO_WORK_KINDS = ["unpaid", "absent"];
route("POST", B + "/payroll/runs/:id/autofill", async ctx => {
  await needBranch(ctx, "payroll", "edit");
  const run = await getRun(ctx);
  if (run.status !== "draft") throw bad("งวดนี้จ่ายแล้ว — กด \"ยกเลิกการจ่าย\" ก่อน");
  const st = await getSettings();
  const from = run.period + "-01", to = run.period + "-" + String(daysInMonth(run.period)).padStart(2, "0");
  const items = (await pool.query("SELECT * FROM payroll_items WHERE run_id=$1", [run.id])).rows;
  const summary = { attendance: 0, leaves: 0, advances: 0 };
  for (const row of items) {
    let emp = {}; try { emp = JSON.parse(row.emp_json || "{}"); } catch (e) {}
    const lv = (await pool.query("SELECT * FROM leaves WHERE branch_id=$1 AND employee_id=$2 AND status='approved' AND payroll_run_id IS NULL AND date_from BETWEEN $3 AND $4", [ctx.branch.id, row.employee_id, from, to])).rows;
    const ad = (await pool.query("SELECT * FROM advances WHERE branch_id=$1 AND employee_id=$2 AND status='approved' AND payroll_run_id IS NULL AND deduct_period<=$3", [ctx.branch.id, row.employee_id, run.period])).rows;
    const att = Number((await pool.query("SELECT COUNT(DISTINCT work_date)::int AS c FROM attendance WHERE branch_id=$1 AND employee_id=$2 AND kind='in' AND work_date BETWEEN $3 AND $4", [ctx.branch.id, row.employee_id, from, to])).rows[0].c) || 0;
    const p = { payType: row.pay_type, rate: Number(row.rate), workDays: Number(row.work_days), otHours: Number(row.ot_hours), otRate: Number(row.ot_rate), allowance: Number(row.allowance),
      bonus: Number(row.bonus), otherIncome: Number(row.other_income), tax: Number(row.tax), advance: Number(row.advance), absentDeduct: Number(row.absent_deduct), otherDeduct: Number(row.other_deduct),
      note: row.note || "", ssoEnabled: emp.sso !== false };
    // ถ้าเคยแก้ประกันสังคมเอง ให้คงค่าเดิมไว้
    const autoBefore = calcPayItem(p, st, run.period);
    if (Math.abs(autoBefore.sso - Number(row.sso)) > 0.001) p.ssoOverride = Number(row.sso);
    const useAtt = row.pay_type === "daily" && att > 0;
    if (useAtt) { p.workDays = att; summary.attendance++; }
    // พนักงานรายวันที่ใช้วันทำงานจากเช็คอิน: วันขาด/ลาไม่รับค่าจ้างไม่ถูกนับเป็นวันทำงานอยู่แล้ว จึงไม่หักซ้ำ
    p.absentDeduct = r2(lv.reduce((a, l) => a + (useAtt && NO_WORK_KINDS.includes(l.kind) ? 0 : Number(l.deduct)), 0));
    p.advance = r2(ad.reduce((a, x) => a + Number(x.amount), 0));
    summary.leaves += lv.length; summary.advances += ad.length;
    const c = calcPayItem(p, st, run.period);
    const links = { leaveIds: lv.map(l => l.id), advanceIds: ad.map(x => x.id), attendanceDays: useAtt ? att : null };
    await pool.query(`UPDATE payroll_items SET work_days=$1,base=$2,sso=$3,advance=$4,absent_deduct=$5,gross=$6,total_deduct=$7,net=$8,links_json=$9 WHERE id=$10`,
      [c.workDays, c.base, c.sso, c.advance, c.absentDeduct, c.gross, c.totalDeduct, c.net, JSON.stringify(links), row.id]);
  }
  await logActivity(ctx, "payroll_autofill", "ดึงข้อมูลอัตโนมัติเข้างวด " + run.period + ": วันทำงานจากเช็คอิน " + summary.attendance + " คน, รายการลา " + summary.leaves + ", เงินเบิก " + summary.advances, ctx.branch.id);
  return { run: await runOut(await getRun(ctx), true), summary };
});

/* ================= HTTP server ================= */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json" };
const SEC_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" };

function sendBody(req, res, status, body, type, extra) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { "Content-Type": type, ...SEC_HEADERS, ...(extra || {}) };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { buf = zlib.gzipSync(buf); headers["Content-Encoding"] = "gzip"; headers["Vary"] = "Accept-Encoding"; }
  headers["Content-Length"] = buf.length;
  res.writeHead(status, headers); res.end(req.method === "HEAD" ? undefined : buf);
}
const sendJson = (req, res, status, obj) => sendBody(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": "no-store" });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > limit) { reject(new HttpError(413, "ข้อมูลใหญ่เกินไป")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const staticCache = new Map();
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/\\/g, "/");
  if (rel === "/" || !path.extname(rel)) rel = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return sendBody(req, res, 403, "forbidden", "text/plain");
  fs.readFile(full, (err, data) => {
    if (err) return sendBody(req, res, 404, "not found", "text/plain");
    const ext = path.extname(full);
    sendBody(req, res, 200, data, MIME[ext] || "application/octet-stream", { "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300" });
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, "http://x");
  const pathname = urlObj.pathname;
  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendBody(req, res, 405, "method not allowed", "text/plain");
    return serveStatic(req, res, pathname);
  }
  let match = null, ctxRef = null;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.re); if (!m) continue;
    match = { r, params: {} }; r.keys.forEach((k, i) => { match.params[k] = decodeURIComponent(m[i + 1]); }); break;
  }
  if (!match) return sendJson(req, res, 404, { error: "ไม่พบ API" });
  try {
    let body = {};
    if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
      const raw = await readBody(req, 15 * 1024 * 1024);
      if (raw) { try { body = JSON.parse(raw); } catch (e) { throw bad("รูปแบบข้อมูลไม่ถูกต้อง"); } }
      if (!body || typeof body !== "object") body = {};
    }
    const ctx = { params: match.params, query: Object.fromEntries(urlObj.searchParams), body, session: await loadSession(req, urlObj), req };
    ctxRef = ctx;
    const out = await match.r.handler(ctx, req, res);
    if (out === undefined) return; // handler ส่งเอง (ไฟล์แนบ)
    if (out && out.__download) return sendBody(req, res, 200, out.__body, "application/json; charset=utf-8", { "Content-Disposition": "attachment; filename=\"" + out.__download + "\"", "Cache-Control": "no-store" });
    sendJson(req, res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(req.method, pathname, e);
    // บันทึกการพยายามใช้งานที่ไม่มีสิทธิ์
    if (status === 403 && ctxRef && ctxRef.session) logActivity(ctxRef, "access_denied", e.message + " · " + req.method + " " + pathname.replace(/^\/api\/b\/[^/]+/, ""), ctxRef.params && ctxRef.params.bid);
    if (!res.headersSent) sendJson(req, res, status, { error: status === 500 ? "เกิดข้อผิดพลาดในระบบ: " + e.message : e.message });
  }
});

initDb().then(() => {
  server.listen(PORT, () => console.log("ระบบบัญชีร้านอาหาร พร้อมใช้งานที่พอร์ต " + PORT));
}).catch(e => { console.error("เชื่อมต่อฐานข้อมูลไม่สำเร็จ:", e.message); process.exit(1); });
