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
const BUILD_ID = "1.0.0";
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
  admin_idle_min: "30", branch_idle_hours: "12",
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
    const { rows } = await pool.query("SELECT kind, name, is_credit FROM lists WHERE branch_id=$1 ORDER BY sort_order", [copyFrom]);
    if (rows.length) {
      for (const r of rows) await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order) VALUES ($1,$2,$3,$4,$5,$6)", [uid(), branchId, r.kind, r.name, !!r.is_credit, now() + (n++)]);
      return;
    }
  }
  for (const kind of LIST_KINDS) for (let name of DEFAULT_LISTS[kind]) {
    const credit = name.endsWith("*"); name = name.replace(/\*$/, "");
    await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order) VALUES ($1,$2,$3,$4,$5,$6)", [uid(), branchId, kind, name, credit, now() + (n++)]);
  }
}

async function logActivity(ctx, action, detail, branchId) {
  try {
    const s = ctx && ctx.session;
    await pool.query("INSERT INTO activity (id,at,actor,actor_kind,branch_id,action,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [uid(), now(), s ? s.actor : "-", s ? s.kind : "", branchId || (s && s.branch_id) || null, action, String(detail || "").slice(0, 1000)]);
  } catch (e) { console.error("log:", e.message); }
}

/* ================= sessions ================= */
async function createSession(kind, adminId, branchId, req) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash,kind,admin_id,branch_id,created_at,last_seen,ip) VALUES ($1,$2,$3,$4,$5,$5,$6)",
    [sha256(token), kind, adminId, branchId, now(), String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").slice(0, 100)]);
  return token;
}
async function loadSession(req, urlObj) {
  const h = String(req.headers.authorization || "");
  let token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token && urlObj.searchParams.get("t")) token = urlObj.searchParams.get("t");
  if (!token || token.length > 200) return null;
  const { rows } = await pool.query(
    `SELECT s.*, a.username, a.name AS admin_name, a.active AS admin_active, a.must_change, b.name AS branch_name, b.active AS branch_active
     FROM sessions s LEFT JOIN admins a ON a.id=s.admin_id LEFT JOIN branches b ON b.id=s.branch_id WHERE s.token_hash=$1`, [sha256(token)]);
  const s = rows[0]; if (!s) return null;
  const st = await getSettings();
  const idle = s.kind === "admin" ? num(st.admin_idle_min, 30) * 60000 : num(st.branch_idle_hours, 12) * 3600000;
  if (now() - Number(s.last_seen) > idle) { await pool.query("DELETE FROM sessions WHERE token_hash=$1", [s.token_hash]); return null; }
  if (s.kind === "admin" && !s.admin_active) return null;
  if (s.kind === "branch" && !s.branch_active) return null;
  if (now() - Number(s.last_seen) > 30000) await pool.query("UPDATE sessions SET last_seen=$1 WHERE token_hash=$2", [now(), s.token_hash]);
  s.actor = s.kind === "admin" ? "Admin: " + (s.admin_name || s.username) : "สาขา: " + s.branch_name;
  s.isAdmin = s.kind === "admin";
  return s;
}
function needAdmin(ctx) {
  if (!ctx.session || !ctx.session.isAdmin) throw new HttpError(401, "กรุณาเข้าสู่ระบบผู้ดูแล");
  if (ctx.session.must_change && !ctx.allowMustChange) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน");
}
async function needBranch(ctx) {
  const bid = ctx.params.bid;
  const s = ctx.session;
  if (!s) throw new HttpError(401, "กรุณาเข้าสู่ระบบสาขา");
  if (s.isAdmin) { if (s.must_change) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน"); }
  else if (s.kind !== "branch" || s.branch_id !== bid) throw new HttpError(403, "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1", [bid]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบสาขา");
  ctx.branch = rows[0];
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
route("POST", "/api/branch/login", async (ctx, req) => {
  const bid = str(ctx.body.branchId, 100), pw = String(ctx.body.password || "");
  const key = rateKey(req, "b:" + bid); checkRate(key);
  const { rows } = await pool.query("SELECT * FROM branches WHERE id=$1 AND active=TRUE", [bid]);
  if (!rows[0] || !verifyPw(pw, rows[0].pass_hash)) { noteFail(key); throw new HttpError(401, "รหัสผ่านไม่ถูกต้อง"); }
  loginFails.delete(key);
  const token = await createSession("branch", null, bid, req);
  await pool.query("UPDATE branches SET last_login_at=$1 WHERE id=$2", [now(), bid]);
  await logActivity({ session: { actor: "สาขา: " + rows[0].name, kind: "branch", branch_id: bid } }, "login", "เข้าสู่ระบบสาขา", bid);
  return { token, branch: { id: rows[0].id, name: rows[0].name, code: rows[0].code, color: rows[0].color } };
});
route("POST", "/api/logout", async (ctx, req) => {
  const h = String(req.headers.authorization || ""); const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (t) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [sha256(t)]);
  return { ok: true };
});
route("GET", "/api/session", async ctx => {
  const s = ctx.session; if (!s) return { session: null };
  return { session: { kind: s.kind, branchId: s.branch_id, branchName: s.branch_name, username: s.username, name: s.admin_name, mustChange: !!s.must_change } };
});
route("POST", B + "/change-password", async ctx => {
  await needBranch(ctx);
  const pw = checkNewPassword(ctx.body.newPassword);
  if (!ctx.session.isAdmin && !verifyPw(String(ctx.body.oldPassword || ""), ctx.branch.pass_hash)) throw bad("รหัสผ่านเดิมไม่ถูกต้อง");
  await pool.query("UPDATE branches SET pass_hash=$1, pass_changed_at=$2 WHERE id=$3", [hashPw(pw), now(), ctx.branch.id]);
  await pool.query("DELETE FROM sessions WHERE kind='branch' AND branch_id=$1 AND token_hash<>$2", [ctx.branch.id, ctx.session.token_hash]);
  await logActivity(ctx, "branch_password", "เปลี่ยนรหัสผ่านสาขา " + ctx.branch.name, ctx.branch.id);
  return { ok: true };
});
route("GET", B + "/info", async ctx => {
  await needBranch(ctx);
  const s = await getSettings(); const b = ctx.branch;
  return { branch: { id: b.id, code: b.code, name: b.name, address: b.address, phone: b.phone, taxId: b.tax_id, color: b.color },
    company: { name: s.company_name, address: s.company_address, taxId: s.company_tax_id, phone: s.company_phone, logo: s.company_logo },
    sso: { rate: num(s.sso_rate, 5), min: num(s.sso_min, 1650), max: num(s.sso_max, 17500) }, isAdmin: !!ctx.session.isAdmin };
});

/* ---------------- admin auth ---------------- */
route("POST", "/api/admin/login", async (ctx, req) => {
  const u = str(ctx.body.username, 100), pw = String(ctx.body.password || "");
  const key = rateKey(req, "a:" + u.toLowerCase()); checkRate(key);
  const { rows } = await pool.query("SELECT * FROM admins WHERE lower(username)=lower($1) AND active=TRUE", [u]);
  if (!rows[0] || !verifyPw(pw, rows[0].pass_hash)) { noteFail(key); throw new HttpError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); }
  loginFails.delete(key);
  const token = await createSession("admin", rows[0].id, null, req);
  await pool.query("UPDATE admins SET last_login_at=$1 WHERE id=$2", [now(), rows[0].id]);
  await logActivity({ session: { actor: "Admin: " + (rows[0].name || rows[0].username), kind: "admin" } }, "login", "เข้าสู่ระบบผู้ดูแล");
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
    await setSetting(k, v);
  }
  await logActivity(ctx, "settings", "แก้ไขการตั้งค่าระบบ");
  return { settings: await getSettings() };
});

/* ---------------- admin: branches ---------------- */
function branchOut(r) {
  return { id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone, taxId: r.tax_id, color: r.color, active: r.active,
    createdAt: Number(r.created_at), lastLoginAt: Number(r.last_login_at) || null, passChangedAt: Number(r.pass_changed_at) || null };
}
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
  for (const t of ["files", "records", "lists", "stock_moves", "stock_items", "payroll_items", "payroll_runs", "employees", "doc_counters", "sessions", "transfers"]) {
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
route("GET", "/api/admin/activity", async ctx => {
  needAdmin(ctx);
  const lim = Math.min(1000, Math.max(10, num(ctx.query.limit, 300)));
  const params = []; let where = "WHERE 1=1";
  if (ctx.query.branchId) { params.push(ctx.query.branchId); where += " AND a.branch_id=$" + params.length; }
  if (isDate(ctx.query.from)) { params.push(new Date(ctx.query.from + "T00:00:00+07:00").getTime()); where += " AND a.at>=$" + params.length; }
  if (isDate(ctx.query.to)) { params.push(new Date(ctx.query.to + "T23:59:59.999+07:00").getTime()); where += " AND a.at<=$" + params.length; }
  const { rows } = await pool.query(`SELECT a.*, b.name AS branch_name FROM activity a LEFT JOIN branches b ON b.id=a.branch_id ${where} ORDER BY a.at DESC LIMIT ${lim}`, params);
  return { activity: rows.map(r => ({ at: Number(r.at), actor: r.actor, kind: r.actor_kind, branchName: r.branch_name || "", action: r.action, detail: r.detail })) };
});
route("GET", "/api/admin/backup", async ctx => {
  needAdmin(ctx);
  const withFiles = ctx.query.files === "1";
  const out = { app: "restaurant-accounting", build: BUILD_ID, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of ["settings", "admins", "branches", "lists", "records", "doc_counters", "stock_items", "stock_moves", "employees", "payroll_runs", "payroll_items", "transfers", "activity", "files"]) {
    if (t === "files" && !withFiles) { out.tables.files = (await pool.query("SELECT id, record_id, branch_id, filename, mime, size, created_at FROM files")).rows; continue; }
    out.tables[t] = (await pool.query("SELECT * FROM " + t)).rows;
  }
  await logActivity(ctx, "backup", "ดาวน์โหลดไฟล์สำรองข้อมูล" + (withFiles ? " (รวมไฟล์แนบ)" : ""));
  return { __download: "backup-" + todayBkk() + ".json", __body: JSON.stringify(out) };
});

/* ---------------- lists (หมวด / ช่องทาง / ผู้ขาย / หน่วย) ---------------- */
route("GET", B + "/lists", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT id, kind, name, is_credit, opening_balance, opening_date FROM lists WHERE branch_id=$1 ORDER BY sort_order", [ctx.branch.id]);
  const out = {}; LIST_KINDS.forEach(k => { out[k] = []; });
  rows.forEach(r => { if (out[r.kind]) out[r.kind].push({ id: r.id, name: r.name, isCredit: !!r.is_credit, openingBalance: r.opening_balance == null ? null : Number(r.opening_balance), openingDate: r.opening_date || "" }); });
  return { lists: out };
});
route("POST", B + "/lists", async ctx => {
  await needBranch(ctx);
  const kind = ctx.body.kind, name = str(ctx.body.name, 120);
  if (!LIST_KINDS.includes(kind) || !name) throw bad("ข้อมูลไม่ถูกต้อง");
  const dup = await pool.query("SELECT 1 FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [ctx.branch.id, kind, name]);
  if (dup.rows.length) throw bad("มีรายการนี้อยู่แล้ว");
  const id = uid();
  const ob = kind === "payment_channel" && !ctx.body.isCredit && ctx.body.openingBalance !== undefined && ctx.body.openingBalance !== "" ? r2(num(ctx.body.openingBalance, 0)) : null;
  await pool.query("INSERT INTO lists (id,branch_id,kind,name,is_credit,sort_order,opening_balance,opening_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, ctx.branch.id, kind, name, !!ctx.body.isCredit, now(), ob, ob !== null ? (isDate(ctx.body.openingDate) ? ctx.body.openingDate : todayBkk()) : null]);
  await logActivity(ctx, "list_add", "เพิ่ม " + name, ctx.branch.id);
  return { ok: true, id };
});
const LIST_RENAME_MAP = {
  income_category: [["records", "category"]], expense_category: [["records", "category"]], invest_category: [["records", "category"]],
  vendor: [["records", "party"]], payment_channel: [["records", "payment_channel"], ["records", "settled_channel"], ["payroll_runs", "payment_channel"], ["transfers", "from_ch"], ["transfers", "to_ch"]],
  stock_category: [["stock_items", "category"]], unit: [["stock_items", "unit"]]
};
route("PUT", B + "/lists/:id", async ctx => {
  await needBranch(ctx);
  const cur = await pool.query("SELECT * FROM lists WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบรายการ");
  const L = cur.rows[0];
  if (ctx.body.isCredit !== undefined) await pool.query("UPDATE lists SET is_credit=$1 WHERE id=$2", [!!ctx.body.isCredit, L.id]);
  if (ctx.body.name !== undefined) {
    const name = str(ctx.body.name, 120); if (!name) throw bad("กรุณาใส่ชื่อ");
    if (name !== L.name) {
      const dup = await pool.query("SELECT 1 FROM lists WHERE branch_id=$1 AND kind=$2 AND name=$3", [ctx.branch.id, L.kind, name]);
      if (dup.rows.length) throw bad("มีรายการนี้อยู่แล้ว");
      await pool.query("UPDATE lists SET name=$1 WHERE id=$2", [name, L.id]);
      // เปลี่ยนชื่อในรายการเก่าให้ด้วย ยอดตามหมวดจะได้ไม่แยกเป็นสองชื่อ
      for (const [t, c] of LIST_RENAME_MAP[L.kind] || []) await pool.query(`UPDATE ${t} SET ${c}=$1 WHERE branch_id=$2 AND ${c}=$3`, [name, ctx.branch.id, L.name]);
      if (L.kind.endsWith("_category")) {
        const recs = await pool.query("SELECT id, items_json FROM records WHERE branch_id=$1 AND items_json LIKE $2", [ctx.branch.id, "%" + L.name.replace(/[%_]/g, "") + "%"]);
        for (const r of recs.rows) {
          let items; try { items = JSON.parse(r.items_json || "[]"); } catch (e) { continue; }
          let ch = false; items.forEach(it => { if (it.category === L.name) { it.category = name; ch = true; } });
          if (ch) await pool.query("UPDATE records SET items_json=$1 WHERE id=$2", [JSON.stringify(items), r.id]);
        }
      }
    }
  }
  if (Array.isArray(ctx.body.order)) for (let i = 0; i < ctx.body.order.length; i++) await pool.query("UPDATE lists SET sort_order=$1 WHERE id=$2 AND branch_id=$3", [i + 1, String(ctx.body.order[i]), ctx.branch.id]);
  return { ok: true };
});
route("DELETE", B + "/lists/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("DELETE FROM lists WHERE id=$1 AND branch_id=$2 RETURNING name", [ctx.params.id, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "list_delete", "ลบ " + rows[0].name, ctx.branch.id);
  return { ok: true };
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
    updatedBy: r.updated_by || "", updatedAt: Number(r.updated_at) || null, files: files || [], fileCount: r.file_count != null ? Number(r.file_count) : (files || []).length };
}
async function filesFor(ids) {
  if (!ids.length) return {};
  const { rows } = await pool.query("SELECT id, record_id, filename, mime, size, created_at FROM files WHERE record_id = ANY($1::text[]) ORDER BY created_at", ["{" + ids.map(i => '"' + i + '"').join(",") + "}"]);
  const m = {}; rows.forEach(f => { (m[f.record_id] = m[f.record_id] || []).push({ id: f.id, filename: f.filename, mime: f.mime, size: Number(f.size) || 0 }); });
  return m;
}

route("GET", B + "/records", async ctx => {
  await needBranch(ctx);
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "r.branch_id=$1 AND r.rec_date BETWEEN $2 AND $3";
  if (REC_TYPES.includes(ctx.query.type)) { params.push(ctx.query.type); where += " AND r.type=$" + params.length; }
  if (ctx.query.status === "unsettled") where += " AND r.due_date IS NOT NULL AND r.due_date<>'' AND r.settled_at IS NULL";
  if (ctx.query.q) { params.push("%" + String(ctx.query.q).slice(0, 100) + "%"); where += ` AND (r.doc_no ILIKE $${params.length} OR r.party ILIKE $${params.length} OR r.description ILIKE $${params.length} OR r.items_json ILIKE $${params.length})`; }
  const { rows } = await pool.query(`SELECT r.*, (SELECT COUNT(*) FROM files f WHERE f.record_id=r.id)::int AS file_count FROM records r WHERE ${where} ORDER BY r.rec_date DESC, r.created_at DESC LIMIT 2000`, params);
  return { from, to, records: rows.map(r => recordOut(r)) };
});
route("GET", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
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
  const dueDate = unpaid ? (isDate(b.dueDate) ? b.dueDate : "") : "";
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
route("POST", B + "/records", async ctx => { await needBranch(ctx); return { record: await saveRecord(ctx, null) }; });
route("PUT", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  if (rows[0].source === "payroll") throw bad("เอกสารนี้สร้างจากระบบเงินเดือน — แก้ไขได้ที่เมนูเงินเดือน");
  return { record: await saveRecord(ctx, rows[0]) };
});
route("DELETE", B + "/records/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM records WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  if (rows[0].source === "payroll") throw bad("เอกสารนี้สร้างจากระบบเงินเดือน — ยกเลิกการจ่ายที่เมนูเงินเดือนแทน");
  await applyRecordStock(ctx, rows[0].id, null);
  await pool.query("DELETE FROM files WHERE record_id=$1", [rows[0].id]);
  await pool.query("DELETE FROM records WHERE id=$1", [rows[0].id]);
  await logActivity(ctx, "record_delete", "ลบเอกสาร " + rows[0].doc_no + " ฿" + Number(rows[0].total).toFixed(2), ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/records/:id/settle", async ctx => {
  await needBranch(ctx);
  const undo = !!ctx.body.undo;
  const d = isDate(ctx.body.date) ? ctx.body.date : todayBkk();
  const ch = str(ctx.body.channel, 120);
  if (!undo) {
    const c = await pool.query("SELECT is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' AND name=$2", [ctx.branch.id, ch]);
    if (!c.rows[0]) throw bad("กรุณาเลือกบัญชีที่รับ/จ่ายเงิน");
    if (c.rows[0].is_credit) throw bad("เลือกบัญชีเงินจริง (เช่น เงินสด หรือบัญชีธนาคาร) ไม่ใช่ช่องทางแบบเครดิต");
  }
  const { rows } = await pool.query(undo
    ? "UPDATE records SET settled_at=NULL, settled_date=NULL, settled_by=NULL, settled_channel=NULL WHERE id=$1 AND branch_id=$2 RETURNING doc_no"
    : "UPDATE records SET settled_at=$3, settled_date=$4, settled_by=$5, settled_channel=$6 WHERE id=$1 AND branch_id=$2 RETURNING doc_no",
    undo ? [ctx.params.id, ctx.branch.id] : [ctx.params.id, ctx.branch.id, now(), d, ctx.session.actor, ch]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบเอกสาร");
  await logActivity(ctx, "record_settle", (undo ? "ยกเลิกสถานะชำระแล้ว " : "บันทึกชำระแล้ว (" + ch + ") ") + rows[0].doc_no, ctx.branch.id);
  return { ok: true };
});
route("POST", B + "/records/:id/files", async ctx => {
  await needBranch(ctx);
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
  const { rows } = await pool.query("SELECT * FROM files WHERE id=$1 AND branch_id=$2", [ctx.params.fid, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบไฟล์");
  const buf = Buffer.from(rows[0].data, "base64");
  res.writeHead(200, { "Content-Type": rows[0].mime, "Content-Length": buf.length, "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(rows[0].filename || "file"), "X-Content-Type-Options": "nosniff" });
  res.end(buf);
  return undefined;
});
route("DELETE", B + "/files/:fid", async ctx => {
  await needBranch(ctx);
  await pool.query("DELETE FROM files WHERE id=$1 AND branch_id=$2", [ctx.params.fid, ctx.branch.id]);
  return { ok: true };
});

/* ---------------- ภาพรวม (dashboard) ---------------- */
route("GET", B + "/summary", async ctx => {
  await needBranch(ctx);
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
  const recs = await pool.query("SELECT type, items_json, subtotal, discount, total, vat_amount, vat_mode, payment_channel FROM records WHERE branch_id=$1 AND rec_date BETWEEN $2 AND $3", [bid, from, to]);
  const cat = { income: {}, expense: {}, invest: {} }, pay = { income: {}, expense: {} };
  recs.rows.forEach(r => {
    let items = []; try { items = JSON.parse(r.items_json || "[]"); } catch (e) {}
    const sub = Number(r.subtotal) || 0, total = Number(r.total) || 0;
    // แบ่งยอดหลังส่วนลด/VAT ตามสัดส่วนของแต่ละบรรทัด (เอกสารเดียวหลายหมวด)
    items.forEach(it => { const share = sub > 0 ? total * (Number(it.amount) / sub) : total / items.length; cat[r.type][it.category || "ไม่ระบุ"] = (cat[r.type][it.category || "ไม่ระบุ"] || 0) + share; });
    if (r.type !== "invest") { const p = r.payment_channel || "ไม่ระบุ"; pay[r.type][p] = (pay[r.type][p] || 0) + total; }
    if (r.vat_mode !== "none") { if (r.type === "income") tot.vatOut += Number(r.vat_amount); else tot.vatIn += Number(r.vat_amount); }
  });
  const arr = m => Object.keys(m).map(n => ({ name: n, total: r2(m[n]) })).sort((a, b) => b.total - a.total);
  const due = await pool.query(`SELECT id, type, doc_no, rec_date, party, description, total, due_date, payment_channel FROM records
    WHERE branch_id=$1 AND due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL ORDER BY due_date ASC LIMIT 200`, [bid]);
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
  return { from, to, group, totals: tot, previous: { from: pFrom, to: pTo, ...pv, net: r2(pv.income - pv.expense) },
    series: keys.map(k => ({ key: k, income: r2(map[k].income), expense: r2(map[k].expense), invest: r2(map[k].invest) })),
    incomeByCategory: arr(cat.income), expenseByCategory: arr(cat.expense), investByCategory: arr(cat.invest),
    incomeByPayment: arr(pay.income), expenseByPayment: arr(pay.expense),
    due: due.rows.map(r => ({ id: r.id, type: r.type, docNo: r.doc_no, date: r.rec_date, party: r.party || "", description: r.description || "", total: Number(r.total), dueDate: r.due_date, paymentChannel: r.payment_channel || "" })),
    stock: { items: Number(stock.rows[0].n) || 0, value: r2(stock.rows[0].v), low: Number(stock.rows[0].low) || 0,
      lowItems: lowItems.rows.map(r => ({ id: r.id, name: r.name, qty: Number(r.qty), minQty: Number(r.min_qty), unit: r.unit || "" })) },
    employees: Number(emp.rows[0].c) || 0, recent: recent.rows.map(r => recordOut(r)), accounts: (await computeAccounts(bid, from, to)).accounts };
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
      count: mine.length, orphan: !row };
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
  await needBranch(ctx);
  const { from, to } = rangeOf(ctx.query);
  return { from, to, ...(await computeAccounts(ctx.branch.id, from, to)) };
});
route("GET", B + "/accounts/statement", async ctx => {
  await needBranch(ctx);
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
  await needBranch(ctx);
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
  await needBranch(ctx);
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
  await needBranch(ctx);
  const { rows } = await pool.query("DELETE FROM transfers WHERE id=$1 AND branch_id=$2 RETURNING amount, from_ch, to_ch", [ctx.params.id, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "transfer_delete", "ลบรายการโอน ฿" + Number(rows[0].amount).toFixed(2) + " " + rows[0].from_ch + " → " + rows[0].to_ch, ctx.branch.id);
  return { ok: true };
});

/* ================= สต็อกสินค้า ================= */
// คำนวณยอดคงเหลือ + ต้นทุนเฉลี่ยถ่วงน้ำหนักใหม่ทั้งหมดของสินค้า 1 ตัว (รองรับการแก้ไข/ลบย้อนหลัง)
async function recomputeItem(itemId) {
  const { rows } = await pool.query("SELECT * FROM stock_moves WHERE item_id=$1 ORDER BY move_date ASC, created_at ASC, id ASC", [itemId]);
  let qty = 0, avg = 0;
  const item = await pool.query("SELECT avg_cost FROM stock_items WHERE id=$1", [itemId]);
  if (!rows.length && item.rows[0]) avg = 0;
  for (const m of rows) {
    let q = Number(m.qty), amount = Number(m.amount) || 0, unitCost = Number(m.unit_cost) || 0;
    if (m.kind === "in") {
      const nq = qty + q;
      avg = nq > 0 ? (Math.max(qty, 0) * avg + q * unitCost) / Math.max(nq, q) : unitCost;
      qty = nq; amount = r2(q * unitCost);
    } else if (m.kind === "count") {
      q = r4(Number(m.counted) - qty); qty = Number(m.counted); unitCost = avg; amount = r2(q * avg);
    } else { // out / waste / transfer (qty เก็บเป็นค่าติดลบ)
      qty = qty + q; unitCost = avg; amount = r2(Math.abs(q) * avg);
    }
    await pool.query("UPDATE stock_moves SET qty=$1, unit_cost=$2, amount=$3, balance=$4 WHERE id=$5", [r4(q), r4(unitCost), amount, r4(qty), m.id]);
  }
  await pool.query("UPDATE stock_items SET qty=$1, avg_cost=$2, updated_at=$3 WHERE id=$4", [r4(qty), r4(avg), now(), itemId]);
}
function itemOut(r) {
  const qty = Number(r.qty), min = Number(r.min_qty), avg = Number(r.avg_cost);
  return { id: r.id, sku: r.sku || "", name: r.name, category: r.category || "", unit: r.unit || "", minQty: min, qty, avgCost: avg, value: r2(qty * avg),
    active: r.active, note: r.note || "", low: min > 0 && qty <= min, moveCount: r.move_count != null ? Number(r.move_count) : undefined, lastMove: r.last_move || "" };
}
route("GET", B + "/stock/items", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query(`SELECT i.*, (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id=i.id)::int AS move_count,
    (SELECT MAX(move_date) FROM stock_moves m WHERE m.item_id=i.id) AS last_move FROM stock_items i WHERE i.branch_id=$1 ORDER BY i.active DESC, i.category, i.name`, [ctx.branch.id]);
  return { items: rows.map(itemOut) };
});
function stockItemFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อสินค้า");
  const minQty = num(b.minQty, 0); if (minQty < 0) throw bad("จุดสั่งซื้อต้องไม่ติดลบ");
  return { name, sku: str(b.sku, 50), category: str(b.category, 120), unit: str(b.unit, 30), minQty: r4(minQty), note: str(b.note, 500) };
}
route("POST", B + "/stock/items", async ctx => {
  await needBranch(ctx);
  const f = stockItemFields(ctx.body);
  const dup = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [ctx.branch.id, f.name]);
  if (dup.rows.length) throw bad("มีสินค้าชื่อนี้อยู่แล้ว");
  const id = uid();
  await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$9)",
    [id, ctx.branch.id, f.sku, f.name, f.category, f.unit, f.minQty, f.note, now()]);
  const openQty = num(ctx.body.openingQty, 0), openCost = num(ctx.body.openingCost, 0);
  if (openQty > 0) {
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,unit_cost,note,created_by,created_at) VALUES ($1,$2,$3,$4,'in',$5,$6,'ยอดยกมา',$7,$8)`,
      [uid(), ctx.branch.id, id, isDate(ctx.body.openingDate) ? ctx.body.openingDate : todayBkk(), r4(openQty), r4(Math.max(0, openCost)), ctx.session.actor, now()]);
    await recomputeItem(id);
  }
  await logActivity(ctx, "stock_item_add", "เพิ่มสินค้า " + f.name, ctx.branch.id);
  return { ok: true, id };
});
route("PUT", B + "/stock/items/:id", async ctx => {
  await needBranch(ctx);
  const cur = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบสินค้า");
  if (ctx.body.active !== undefined && Object.keys(ctx.body).length === 1) {
    await pool.query("UPDATE stock_items SET active=$1 WHERE id=$2", [!!ctx.body.active, ctx.params.id]); return { ok: true };
  }
  const f = stockItemFields(ctx.body);
  const dup = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2) AND id<>$3", [ctx.branch.id, f.name, ctx.params.id]);
  if (dup.rows.length) throw bad("มีสินค้าชื่อนี้อยู่แล้ว");
  await pool.query("UPDATE stock_items SET sku=$1,name=$2,category=$3,unit=$4,min_qty=$5,note=$6,updated_at=$7 WHERE id=$8", [f.sku, f.name, f.category, f.unit, f.minQty, f.note, now(), ctx.params.id]);
  await logActivity(ctx, "stock_item_edit", "แก้ไขสินค้า " + f.name, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/stock/items/:id", async ctx => {
  await needBranch(ctx);
  const cur = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!cur.rows[0]) throw new HttpError(404, "ไม่พบสินค้า");
  const ref = await pool.query("SELECT COUNT(*)::int AS c FROM stock_moves WHERE item_id=$1 AND ref_record_id IS NOT NULL", [ctx.params.id]);
  if (Number(ref.rows[0].c) > 0) throw bad("สินค้านี้ผูกกับเอกสารซื้อแล้ว ลบไม่ได้ — ใช้ \"ปิดใช้งาน\" แทน");
  await pool.query("DELETE FROM stock_moves WHERE item_id=$1", [ctx.params.id]);
  await pool.query("DELETE FROM stock_items WHERE id=$1", [ctx.params.id]);
  await logActivity(ctx, "stock_item_delete", "ลบสินค้า " + cur.rows[0].name, ctx.branch.id);
  return { ok: true };
});
const MOVE_KINDS = { in: "รับเข้า", out: "เบิกใช้", waste: "ของเสีย / ทิ้ง", count: "ตรวจนับ (ปรับยอด)" };
route("GET", B + "/stock/moves", async ctx => {
  await needBranch(ctx);
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "m.branch_id=$1 AND m.move_date BETWEEN $2 AND $3";
  if (ctx.query.itemId) { params.push(ctx.query.itemId); where += " AND m.item_id=$" + params.length; }
  if (MOVE_KINDS[ctx.query.kind]) { params.push(ctx.query.kind); where += " AND m.kind=$" + params.length; }
  const { rows } = await pool.query(`SELECT m.*, i.name AS item_name, i.unit, r.doc_no FROM stock_moves m JOIN stock_items i ON i.id=m.item_id LEFT JOIN records r ON r.id=m.ref_record_id
    WHERE ${where} ORDER BY m.move_date DESC, m.created_at DESC LIMIT 3000`, params);
  return { from, to, moves: rows.map(m => ({ id: m.id, itemId: m.item_id, itemName: m.item_name, unit: m.unit || "", date: m.move_date, kind: m.kind, qty: Number(m.qty),
    counted: m.counted == null ? null : Number(m.counted), unitCost: Number(m.unit_cost) || 0, amount: Number(m.amount) || 0, balance: Number(m.balance) || 0,
    note: m.note || "", refRecordId: m.ref_record_id || "", docNo: m.doc_no || "", batchId: m.batch_id || "", createdBy: m.created_by || "", createdAt: Number(m.created_at) })) };
});
route("POST", B + "/stock/moves", async ctx => {
  await needBranch(ctx);
  const b = ctx.body || {};
  const kind = b.kind; if (!MOVE_KINDS[kind]) throw bad("ประเภทการเคลื่อนไหวไม่ถูกต้อง");
  const date = isDate(b.date) ? b.date : todayBkk();
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && l.itemId).slice(0, 200);
  if (!lines.length) throw bad("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
  const batch = uid(); const note = str(b.note, 300);
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
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,counted,unit_cost,note,batch_id,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [uid(), ctx.branch.id, l.itemId, date, kind, signed, kind === "count" ? q : null, kind === "in" ? r4(Math.max(0, num(l.unitCost, 0))) : null, note, batch, ctx.session.actor, now()]);
    await recomputeItem(l.itemId);
  }
  await logActivity(ctx, "stock_move", MOVE_KINDS[kind] + " " + lines.length + " รายการ: " + lines.map(l => items[l.itemId].name + " " + l.qty).slice(0, 5).join(", "), ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/stock/moves/:id", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT m.*, i.name FROM stock_moves m JOIN stock_items i ON i.id=m.item_id WHERE m.id=$1 AND m.branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบรายการ");
  if (rows[0].ref_record_id) throw bad("รายการนี้มาจากเอกสารซื้อ — แก้ไข/ลบที่เอกสารรายจ่ายแทน");
  await pool.query("DELETE FROM stock_moves WHERE id=$1", [rows[0].id]);
  await recomputeItem(rows[0].item_id);
  await logActivity(ctx, "stock_move_delete", "ลบรายการสต็อก " + MOVE_KINDS[rows[0].kind] + " " + rows[0].name, ctx.branch.id);
  return { ok: true };
});

/* ================= พนักงาน & เงินเดือน ================= */
function empOut(r) {
  return { id: r.id, code: r.code || "", name: r.name, nickname: r.nickname || "", position: r.position || "", phone: r.phone || "", idCard: r.id_card || "",
    bankName: r.bank_name || "", bankAccount: r.bank_account || "", startDate: r.start_date || "", payType: r.pay_type, rate: Number(r.rate), sso: !!r.sso, active: !!r.active, note: r.note || "" };
}
route("GET", B + "/employees", async ctx => {
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM employees WHERE branch_id=$1 ORDER BY active DESC, code, name", [ctx.branch.id]);
  return { employees: rows.map(empOut) };
});
function empFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อพนักงาน");
  const payType = b.payType === "daily" ? "daily" : "monthly";
  const rate = num(b.rate, NaN); if (!isFinite(rate) || rate < 0) throw bad("อัตราค่าจ้างไม่ถูกต้อง");
  const idCard = str(b.idCard, 20).replace(/\D/g, ""); if (idCard && idCard.length !== 13) throw bad("เลขบัตรประชาชนต้องมี 13 หลัก");
  return { code: str(b.code, 30), name, nickname: str(b.nickname, 60), position: str(b.position, 100), phone: str(b.phone, 40), idCard,
    bankName: str(b.bankName, 100), bankAccount: str(b.bankAccount, 40), startDate: isDate(b.startDate) ? b.startDate : "", payType, rate: r2(rate), sso: b.sso !== false, note: str(b.note, 500) };
}
route("POST", B + "/employees", async ctx => {
  await needBranch(ctx);
  const f = empFields(ctx.body); const id = uid();
  if (!f.code) { const c = await pool.query("SELECT COUNT(*)::int AS c FROM employees WHERE branch_id=$1", [ctx.branch.id]); f.code = "EMP" + String(Number(c.rows[0].c) + 1).padStart(3, "0"); }
  await pool.query(`INSERT INTO employees (id,branch_id,code,name,nickname,position,phone,id_card,bank_name,bank_account,start_date,pay_type,rate,sso,active,note,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16,$16)`,
    [id, ctx.branch.id, f.code, f.name, f.nickname, f.position, f.phone, f.idCard, f.bankName, f.bankAccount, f.startDate, f.payType, f.rate, f.sso, f.note, now()]);
  await logActivity(ctx, "employee_add", "เพิ่มพนักงาน " + f.name, ctx.branch.id);
  return { ok: true, id };
});
route("PUT", B + "/employees/:id", async ctx => {
  await needBranch(ctx);
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
  await logActivity(ctx, "employee_edit", "แก้ไขข้อมูลพนักงาน " + f.name, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/employees/:id", async ctx => {
  await needBranch(ctx);
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
    gross: Number(r.gross), totalDeduct: Number(r.total_deduct), net: Number(r.net), note: r.note || "" };
}
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
  await needBranch(ctx);
  const { rows } = await pool.query("SELECT * FROM payroll_runs WHERE branch_id=$1 ORDER BY period DESC, created_at DESC LIMIT 120", [ctx.branch.id]);
  const out = []; for (const r of rows) out.push(await runOut(r, false));
  return { runs: out };
});
route("POST", B + "/payroll/runs", async ctx => {
  await needBranch(ctx);
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
route("GET", B + "/payroll/runs/:id", async ctx => { await needBranch(ctx); return { run: await runOut(await getRun(ctx), true) }; });
route("PUT", B + "/payroll/runs/:id", async ctx => {
  await needBranch(ctx);
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
  await needBranch(ctx);
  const run = await getRun(ctx);
  if (run.status !== "draft") throw bad("งวดนี้จ่ายแล้ว — กด \"ยกเลิกการจ่าย\" ก่อนลบ");
  await pool.query("DELETE FROM payroll_items WHERE run_id=$1", [run.id]);
  await pool.query("DELETE FROM payroll_runs WHERE id=$1", [run.id]);
  await logActivity(ctx, "payroll_delete", "ลบงวดเงินเดือน " + run.period, ctx.branch.id);
  return { ok: true };
});
// จ่ายเงินเดือน → สร้างเอกสารรายจ่ายให้อัตโนมัติ (เงินที่จ่ายพนักงาน + ประกันสังคม/ภาษีที่ต้องนำส่ง)
route("POST", B + "/payroll/runs/:id/pay", async ctx => {
  await needBranch(ctx);
  const run = await getRun(ctx);
  if (run.status === "paid") throw bad("งวดนี้จ่ายแล้ว");
  const r = await runOut(run, true);
  if (!r.items.length) throw bad("งวดนี้ไม่มีพนักงาน");
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
  await logActivity(ctx, "payroll_pay", "จ่ายเงินเดือน " + label + " สุทธิ ฿" + r.net.toFixed(2) + " → เอกสาร " + rec.docNo, ctx.branch.id);
  return { ok: true, docNo: rec.docNo };
});
route("POST", B + "/payroll/runs/:id/unpay", async ctx => {
  await needBranch(ctx);
  const run = await getRun(ctx);
  if (run.status !== "paid") throw bad("งวดนี้ยังไม่ได้จ่าย");
  if (run.record_id) { await pool.query("DELETE FROM files WHERE record_id=$1", [run.record_id]); await pool.query("DELETE FROM records WHERE id=$1", [run.record_id]); }
  await pool.query("UPDATE payroll_runs SET status='draft', record_id=NULL, paid_at=NULL, paid_by=NULL WHERE id=$1", [run.id]);
  await logActivity(ctx, "payroll_unpay", "ยกเลิกการจ่ายเงินเดือนงวด " + run.period + " (ลบเอกสารรายจ่ายที่สร้างอัตโนมัติ)", ctx.branch.id);
  return { ok: true };
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
  let match = null;
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
    const ctx = { params: match.params, query: Object.fromEntries(urlObj.searchParams), body, session: await loadSession(req, urlObj) };
    const out = await match.r.handler(ctx, req, res);
    if (out === undefined) return; // handler ส่งเอง (ไฟล์แนบ)
    if (out && out.__download) return sendBody(req, res, 200, out.__body, "application/json; charset=utf-8", { "Content-Disposition": "attachment; filename=\"" + out.__download + "\"", "Cache-Control": "no-store" });
    sendJson(req, res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(req.method, pathname, e);
    if (!res.headersSent) sendJson(req, res, status, { error: status === 500 ? "เกิดข้อผิดพลาดในระบบ: " + e.message : e.message });
  }
});

initDb().then(() => {
  server.listen(PORT, () => console.log("ระบบบัญชีร้านอาหาร พร้อมใช้งานที่พอร์ต " + PORT));
}).catch(e => { console.error("เชื่อมต่อฐานข้อมูลไม่สำเร็จ:", e.message); process.exit(1); });
