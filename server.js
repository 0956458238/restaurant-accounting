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
const BUILD_ID = "3.1.0";
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
// รูปภาพเก็บเป็น data URL (ย่อขนาดจากฝั่งเว็บแล้ว) · "" = ลบรูป
function checkImg(v, maxLen) {
  v = String(v || ""); if (!v) return "";
  if (v.length > (maxLen || 600000)) throw bad("รูปภาพใหญ่เกินไป");
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) throw bad("ไฟล์รูปภาพไม่ถูกต้อง");
  return v;
}
function sendDataUrl(res, v) {
  const m = String(v || "").match(/^data:([^;]+);base64,(.*)$/); if (!m) throw new HttpError(404, "ไม่พบรูป");
  const buf = Buffer.from(m[2], "base64");
  res.writeHead(200, { "Content-Type": m[1], "Content-Length": buf.length, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" }); res.end(buf);
}

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
    -- ===== v2.6: รูปสาขา / รูปสินค้า / รูปและเอกสารพนักงาน =====
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo TEXT;
    ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS photo TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo TEXT, ADD COLUMN IF NOT EXISTS photo_at BIGINT;
    CREATE TABLE IF NOT EXISTS emp_files (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, employee_id TEXT NOT NULL, doc_type TEXT, filename TEXT, mime TEXT, size INT, data TEXT, created_by TEXT, created_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_emp_files_emp ON emp_files(employee_id);
    ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS units TEXT;
    ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS in_unit TEXT, ADD COLUMN IF NOT EXISTS in_qty NUMERIC, ADD COLUMN IF NOT EXISTS in_price NUMERIC;
    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, item_id TEXT, name TEXT NOT NULL, category TEXT, qty NUMERIC, unit TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'open', bought_qty NUMERIC, bought_unit TEXT, bought_price NUMERIC, move_id TEXT, pending BOOLEAN DEFAULT FALSE,
      created_by TEXT, created_at BIGINT, bought_by TEXT, bought_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_shop_branch ON shop_items(branch_id, status);
    ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS po_id TEXT;
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, po_no TEXT, po_date TEXT, status TEXT NOT NULL DEFAULT 'pending', note TEXT, lines_json TEXT,
      created_by TEXT, created_at BIGINT, approved_by TEXT, approved_at BIGINT, reason TEXT);
    CREATE INDEX IF NOT EXISTS idx_po_branch ON purchase_orders(branch_id, status);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;
    ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS xfer_id TEXT, ADD COLUMN IF NOT EXISTS xfer_dir TEXT, ADD COLUMN IF NOT EXISTS xfer_branch TEXT;
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, tax_id TEXT, phone TEXT, logo TEXT, kind TEXT, sort_order BIGINT, created_at BIGINT);
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS business_id TEXT;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS pos_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS pos_key TEXT;
    CREATE INDEX IF NOT EXISTS idx_records_pos ON records(branch_id, pos_key);
    CREATE TABLE IF NOT EXISTS pos_config (branch_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS pos_menu (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, name TEXT NOT NULL, names_json TEXT, category TEXT, price NUMERIC NOT NULL DEFAULT 0, image TEXT,
      types_json TEXT, addons_json TEXT, daily_limit INT, soldout BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, sort_order BIGINT, created_at BIGINT, updated_at BIGINT);
    CREATE INDEX IF NOT EXISTS idx_pos_menu_branch ON pos_menu(branch_id);
    CREATE TABLE IF NOT EXISTS pos_orders (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, queue_no TEXT, order_date TEXT NOT NULL, items_json TEXT, subtotal NUMERIC, discount NUMERIC, total NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paid', pay_method TEXT, pay_channel TEXT, cash_received NUMERIC, change_amount NUMERIC, slip TEXT, note TEXT,
      created_by TEXT, created_at BIGINT, prepared_at BIGINT, prepared_by TEXT, cancelled_at BIGINT, cancelled_by TEXT, cancel_reason TEXT, refund_amount NUMERIC DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_pos_orders_day ON pos_orders(branch_id, order_date);
    CREATE TABLE IF NOT EXISTS pos_counters (branch_id TEXT NOT NULL, day TEXT NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (branch_id, day));
  `);
  // v2.9: ธุรกิจ — ข้อมูลเดิมทั้งหมดย้ายเข้า "ธุรกิจหลัก" (ใช้ชื่อ/โลโก้บริษัทเดิม) ไม่มีข้อมูลหาย
  if (!Number((await pool.query("SELECT COUNT(*)::int AS c FROM businesses")).rows[0].c)) {
    const st = await getSettings();
    await pool.query("INSERT INTO businesses (id,name,address,tax_id,phone,logo,kind,sort_order,created_at) VALUES ($1,$2,$3,$4,$5,$6,'restaurant',$7,$7)",
      ["biz_main", st.company_name || "ธุรกิจหลัก", st.company_address || "", st.company_tax_id || "", st.company_phone || "", st.company_logo || "", now()]);
  }
  const firstBiz = (await pool.query("SELECT id FROM businesses ORDER BY sort_order, created_at LIMIT 1")).rows[0].id;
  await pool.query("UPDATE branches SET business_id=$1 WHERE business_id IS NULL OR business_id NOT IN (SELECT id FROM businesses)", [firstBiz]);
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
const MENUS = ["dashboard", "income", "expense", "invest", "ledger", "accounts", "statements", "stock", "employees", "payroll", "leave", "advance", "attendance", "cards", "settings", "log", "pos", "pos_admin"];
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
const MENU_TH = { pos: "POS ขายหน้าร้าน / ออเดอร์", pos_admin: "POS ตั้งค่าเมนู & รายงาน", dashboard: "ภาพรวม", income: "รายรับ", expense: "รายจ่าย", invest: "สินทรัพย์", ledger: "สมุดบัญชี", accounts: "เงินในบัญชี", statements: "งบการเงิน", stock: "สต็อก",
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

/* ===== QR Code encoder — QRCode for JavaScript, Copyright (c) 2009 Kazuhiko Arase, MIT license (http://www.opensource.org/licenses/mit-license.php)
   "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. Bundled from qrcode-terminal/vendor/QRCode. ===== */
const QRLib = (function () {
var QRMode = {
    MODE_NUMBER :       1 << 0,
    MODE_ALPHA_NUM :    1 << 1,
    MODE_8BIT_BYTE :    1 << 2,
    MODE_KANJI :        1 << 3
};

var QRErrorCorrectLevel = {
	L : 1,
	M : 0,
	Q : 3,
	H : 2
};


var QRMaskPattern = {
	PATTERN000 : 0,
	PATTERN001 : 1,
	PATTERN010 : 2,
	PATTERN011 : 3,
	PATTERN100 : 4,
	PATTERN101 : 5,
	PATTERN110 : 6,
	PATTERN111 : 7
};

var QRMath = {

	glog : function(n) {
	
		if (n < 1) {
			throw new Error("glog(" + n + ")");
		}
		
		return QRMath.LOG_TABLE[n];
	},
	
	gexp : function(n) {
	
		while (n < 0) {
			n += 255;
		}
	
		while (n >= 256) {
			n -= 255;
		}
	
		return QRMath.EXP_TABLE[n];
	},
	
	EXP_TABLE : new Array(256),
	
	LOG_TABLE : new Array(256)

};
	
for (var i = 0; i < 8; i++) {
	QRMath.EXP_TABLE[i] = 1 << i;
}
for (var i = 8; i < 256; i++) {
	QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4]
		^ QRMath.EXP_TABLE[i - 5]
		^ QRMath.EXP_TABLE[i - 6]
		^ QRMath.EXP_TABLE[i - 8];
}
for (var i = 0; i < 255; i++) {
	QRMath.LOG_TABLE[QRMath.EXP_TABLE[i] ] = i;
}




function QRPolynomial(num, shift) {
	if (num.length === undefined) {
		throw new Error(num.length + "/" + shift);
	}

	var offset = 0;

	while (offset < num.length && num[offset] === 0) {
		offset++;
	}

	this.num = new Array(num.length - offset + shift);
	for (var i = 0; i < num.length - offset; i++) {
		this.num[i] = num[i + offset];
	}
}

QRPolynomial.prototype = {

	get : function(index) {
		return this.num[index];
	},
	
	getLength : function() {
		return this.num.length;
	},
	
	multiply : function(e) {
	
		var num = new Array(this.getLength() + e.getLength() - 1);
	
		for (var i = 0; i < this.getLength(); i++) {
			for (var j = 0; j < e.getLength(); j++) {
				num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i) ) + QRMath.glog(e.get(j) ) );
			}
		}
	
		return new QRPolynomial(num, 0);
	},
	
	mod : function(e) {
	
		if (this.getLength() - e.getLength() < 0) {
			return this;
		}
	
		var ratio = QRMath.glog(this.get(0) ) - QRMath.glog(e.get(0) );
	
		var num = new Array(this.getLength() );
		
		for (var i = 0; i < this.getLength(); i++) {
			num[i] = this.get(i);
		}
		
		for (var x = 0; x < e.getLength(); x++) {
			num[x] ^= QRMath.gexp(QRMath.glog(e.get(x) ) + ratio);
		}
	
		// recursive call
		return new QRPolynomial(num, 0).mod(e);
	}
};




function QR8bitByte(data) {
	this.mode = QRMode.MODE_8BIT_BYTE;
	this.data = data;
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.data.length;
	},
	
	write : function(buffer) {
		for (var i = 0; i < this.data.length; i++) {
			// not JIS ...
			buffer.put(this.data.charCodeAt(i), 8);
		}
	}
};



function QRBitBuffer() {
	this.buffer = [];
	this.length = 0;
}

QRBitBuffer.prototype = {

	get : function(index) {
		var bufIndex = Math.floor(index / 8);
		return ( (this.buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
	},
	
	put : function(num, length) {
		for (var i = 0; i < length; i++) {
			this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
		}
	},
	
	getLengthInBits : function() {
		return this.length;
	},
	
	putBit : function(bit) {
	
		var bufIndex = Math.floor(this.length / 8);
		if (this.buffer.length <= bufIndex) {
			this.buffer.push(0);
		}
	
		if (bit) {
			this.buffer[bufIndex] |= (0x80 >>> (this.length % 8) );
		}
	
		this.length++;
	}
};




function QRRSBlock(totalCount, dataCount) {
	this.totalCount = totalCount;
	this.dataCount  = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [

	// L
	// M
	// Q
	// H

	// 1
	[1, 26, 19],
	[1, 26, 16],
	[1, 26, 13],
	[1, 26, 9],
	
	// 2
	[1, 44, 34],
	[1, 44, 28],
	[1, 44, 22],
	[1, 44, 16],

	// 3
	[1, 70, 55],
	[1, 70, 44],
	[2, 35, 17],
	[2, 35, 13],

	// 4		
	[1, 100, 80],
	[2, 50, 32],
	[2, 50, 24],
	[4, 25, 9],
	
	// 5
	[1, 134, 108],
	[2, 67, 43],
	[2, 33, 15, 2, 34, 16],
	[2, 33, 11, 2, 34, 12],
	
	// 6
	[2, 86, 68],
	[4, 43, 27],
	[4, 43, 19],
	[4, 43, 15],
	
	// 7		
	[2, 98, 78],
	[4, 49, 31],
	[2, 32, 14, 4, 33, 15],
	[4, 39, 13, 1, 40, 14],
	
	// 8
	[2, 121, 97],
	[2, 60, 38, 2, 61, 39],
	[4, 40, 18, 2, 41, 19],
	[4, 40, 14, 2, 41, 15],
	
	// 9
	[2, 146, 116],
	[3, 58, 36, 2, 59, 37],
	[4, 36, 16, 4, 37, 17],
	[4, 36, 12, 4, 37, 13],
	
	// 10		
	[2, 86, 68, 2, 87, 69],
	[4, 69, 43, 1, 70, 44],
	[6, 43, 19, 2, 44, 20],
	[6, 43, 15, 2, 44, 16],

	// 11
	[4, 101, 81],
	[1, 80, 50, 4, 81, 51],
	[4, 50, 22, 4, 51, 23],
	[3, 36, 12, 8, 37, 13],

	// 12
	[2, 116, 92, 2, 117, 93],
	[6, 58, 36, 2, 59, 37],
	[4, 46, 20, 6, 47, 21],
	[7, 42, 14, 4, 43, 15],

	// 13
	[4, 133, 107],
	[8, 59, 37, 1, 60, 38],
	[8, 44, 20, 4, 45, 21],
	[12, 33, 11, 4, 34, 12],

	// 14
	[3, 145, 115, 1, 146, 116],
	[4, 64, 40, 5, 65, 41],
	[11, 36, 16, 5, 37, 17],
	[11, 36, 12, 5, 37, 13],

	// 15
	[5, 109, 87, 1, 110, 88],
	[5, 65, 41, 5, 66, 42],
	[5, 54, 24, 7, 55, 25],
	[11, 36, 12],

	// 16
	[5, 122, 98, 1, 123, 99],
	[7, 73, 45, 3, 74, 46],
	[15, 43, 19, 2, 44, 20],
	[3, 45, 15, 13, 46, 16],

	// 17
	[1, 135, 107, 5, 136, 108],
	[10, 74, 46, 1, 75, 47],
	[1, 50, 22, 15, 51, 23],
	[2, 42, 14, 17, 43, 15],

	// 18
	[5, 150, 120, 1, 151, 121],
	[9, 69, 43, 4, 70, 44],
	[17, 50, 22, 1, 51, 23],
	[2, 42, 14, 19, 43, 15],

	// 19
	[3, 141, 113, 4, 142, 114],
	[3, 70, 44, 11, 71, 45],
	[17, 47, 21, 4, 48, 22],
	[9, 39, 13, 16, 40, 14],

	// 20
	[3, 135, 107, 5, 136, 108],
	[3, 67, 41, 13, 68, 42],
	[15, 54, 24, 5, 55, 25],
	[15, 43, 15, 10, 44, 16],

	// 21
	[4, 144, 116, 4, 145, 117],
	[17, 68, 42],
	[17, 50, 22, 6, 51, 23],
	[19, 46, 16, 6, 47, 17],

	// 22
	[2, 139, 111, 7, 140, 112],
	[17, 74, 46],
	[7, 54, 24, 16, 55, 25],
	[34, 37, 13],

	// 23
	[4, 151, 121, 5, 152, 122],
	[4, 75, 47, 14, 76, 48],
	[11, 54, 24, 14, 55, 25],
	[16, 45, 15, 14, 46, 16],

	// 24
	[6, 147, 117, 4, 148, 118],
	[6, 73, 45, 14, 74, 46],
	[11, 54, 24, 16, 55, 25],
	[30, 46, 16, 2, 47, 17],

	// 25
	[8, 132, 106, 4, 133, 107],
	[8, 75, 47, 13, 76, 48],
	[7, 54, 24, 22, 55, 25],
	[22, 45, 15, 13, 46, 16],

	// 26
	[10, 142, 114, 2, 143, 115],
	[19, 74, 46, 4, 75, 47],
	[28, 50, 22, 6, 51, 23],
	[33, 46, 16, 4, 47, 17],

	// 27
	[8, 152, 122, 4, 153, 123],
	[22, 73, 45, 3, 74, 46],
	[8, 53, 23, 26, 54, 24],
	[12, 45, 15, 28, 46, 16],

	// 28
	[3, 147, 117, 10, 148, 118],
	[3, 73, 45, 23, 74, 46],
	[4, 54, 24, 31, 55, 25],
	[11, 45, 15, 31, 46, 16],

	// 29
	[7, 146, 116, 7, 147, 117],
	[21, 73, 45, 7, 74, 46],
	[1, 53, 23, 37, 54, 24],
	[19, 45, 15, 26, 46, 16],

	// 30
	[5, 145, 115, 10, 146, 116],
	[19, 75, 47, 10, 76, 48],
	[15, 54, 24, 25, 55, 25],
	[23, 45, 15, 25, 46, 16],

	// 31
	[13, 145, 115, 3, 146, 116],
	[2, 74, 46, 29, 75, 47],
	[42, 54, 24, 1, 55, 25],
	[23, 45, 15, 28, 46, 16],

	// 32
	[17, 145, 115],
	[10, 74, 46, 23, 75, 47],
	[10, 54, 24, 35, 55, 25],
	[19, 45, 15, 35, 46, 16],

	// 33
	[17, 145, 115, 1, 146, 116],
	[14, 74, 46, 21, 75, 47],
	[29, 54, 24, 19, 55, 25],
	[11, 45, 15, 46, 46, 16],

	// 34
	[13, 145, 115, 6, 146, 116],
	[14, 74, 46, 23, 75, 47],
	[44, 54, 24, 7, 55, 25],
	[59, 46, 16, 1, 47, 17],

	// 35
	[12, 151, 121, 7, 152, 122],
	[12, 75, 47, 26, 76, 48],
	[39, 54, 24, 14, 55, 25],
	[22, 45, 15, 41, 46, 16],

	// 36
	[6, 151, 121, 14, 152, 122],
	[6, 75, 47, 34, 76, 48],
	[46, 54, 24, 10, 55, 25],
	[2, 45, 15, 64, 46, 16],

	// 37
	[17, 152, 122, 4, 153, 123],
	[29, 74, 46, 14, 75, 47],
	[49, 54, 24, 10, 55, 25],
	[24, 45, 15, 46, 46, 16],

	// 38
	[4, 152, 122, 18, 153, 123],
	[13, 74, 46, 32, 75, 47],
	[48, 54, 24, 14, 55, 25],
	[42, 45, 15, 32, 46, 16],

	// 39
	[20, 147, 117, 4, 148, 118],
	[40, 75, 47, 7, 76, 48],
	[43, 54, 24, 22, 55, 25],
	[10, 45, 15, 67, 46, 16],

	// 40
	[19, 148, 118, 6, 149, 119],
	[18, 75, 47, 31, 76, 48],
	[34, 54, 24, 34, 55, 25],
	[20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
	
	var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
	
	if (rsBlock === undefined) {
		throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
	}

	var length = rsBlock.length / 3;
	
	var list = [];
	
	for (var i = 0; i < length; i++) {

		var count = rsBlock[i * 3 + 0];
		var totalCount = rsBlock[i * 3 + 1];
		var dataCount  = rsBlock[i * 3 + 2];

		for (var j = 0; j < count; j++) {
			list.push(new QRRSBlock(totalCount, dataCount) );	
		}
	}
	
	return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {

	switch(errorCorrectLevel) {
	case QRErrorCorrectLevel.L :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
	case QRErrorCorrectLevel.M :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
	case QRErrorCorrectLevel.Q :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
	case QRErrorCorrectLevel.H :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
	default :
		return undefined;
	}
};




var QRUtil = {

    PATTERN_POSITION_TABLE : [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],        
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
    ],

    G15 : (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18 : (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK : (1 << 14) | (1 << 12) | (1 << 10)    | (1 << 4) | (1 << 1),

    getBCHTypeInfo : function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
            d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) ) );    
        }
        return ( (data << 10) | d) ^ QRUtil.G15_MASK;
    },

    getBCHTypeNumber : function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
            d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) ) );    
        }
        return (data << 12) | d;
    },

    getBCHDigit : function(data) {

        var digit = 0;

        while (data !== 0) {
            digit++;
            data >>>= 1;
        }

        return digit;
    },

    getPatternPosition : function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },

    getMask : function(maskPattern, i, j) {
        
        switch (maskPattern) {
            
        case QRMaskPattern.PATTERN000 : return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001 : return i % 2 === 0;
        case QRMaskPattern.PATTERN010 : return j % 3 === 0;
        case QRMaskPattern.PATTERN011 : return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100 : return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 === 0;
        case QRMaskPattern.PATTERN101 : return (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110 : return ( (i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111 : return ( (i * j) % 3 + (i + j) % 2) % 2 === 0;

        default :
            throw new Error("bad maskPattern:" + maskPattern);
        }
    },

    getErrorCorrectPolynomial : function(errorCorrectLength) {

        var a = new QRPolynomial([1], 0);

        for (var i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0) );
        }

        return a;
    },

    getLengthInBits : function(mode, type) {

        if (1 <= type && type < 10) {

            // 1 - 9

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 10;
            case QRMode.MODE_ALPHA_NUM  : return 9;
            case QRMode.MODE_8BIT_BYTE  : return 8;
            case QRMode.MODE_KANJI      : return 8;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 27) {

            // 10 - 26

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 12;
            case QRMode.MODE_ALPHA_NUM  : return 11;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 10;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 41) {

            // 27 - 40

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 14;
            case QRMode.MODE_ALPHA_NUM  : return 13;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 12;
            default :
                throw new Error("mode:" + mode);
            }

        } else {
            throw new Error("type:" + type);
        }
    },

    getLostPoint : function(qrCode) {
        
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0; 
        var col = 0;

        
        // LEVEL1
        
        for (row = 0; row < moduleCount; row++) {

            for (col = 0; col < moduleCount; col++) {

                var sameCount = 0;
                var dark = qrCode.isDark(row, col);

                for (var r = -1; r <= 1; r++) {

                    if (row + r < 0 || moduleCount <= row + r) {
                        continue;
                    }

                    for (var c = -1; c <= 1; c++) {

                        if (col + c < 0 || moduleCount <= col + c) {
                            continue;
                        }

                        if (r === 0 && c === 0) {
                            continue;
                        }

                        if (dark === qrCode.isDark(row + r, col + c) ) {
                            sameCount++;
                        }
                    }
                }

                if (sameCount > 5) {
                    lostPoint += (3 + sameCount - 5);
                }
            }
        }

        // LEVEL2

        for (row = 0; row < moduleCount - 1; row++) {
            for (col = 0; col < moduleCount - 1; col++) {
                var count = 0;
                if (qrCode.isDark(row,     col    ) ) count++;
                if (qrCode.isDark(row + 1, col    ) ) count++;
                if (qrCode.isDark(row,     col + 1) ) count++;
                if (qrCode.isDark(row + 1, col + 1) ) count++;
                if (count === 0 || count === 4) {
                    lostPoint += 3;
                }
            }
        }

        // LEVEL3

        for (row = 0; row < moduleCount; row++) {
            for (col = 0; col < moduleCount - 6; col++) {
                if (qrCode.isDark(row, col) && 
                        !qrCode.isDark(row, col + 1) && 
                         qrCode.isDark(row, col + 2) && 
                         qrCode.isDark(row, col + 3) && 
                         qrCode.isDark(row, col + 4) && 
                        !qrCode.isDark(row, col + 5) && 
                         qrCode.isDark(row, col + 6) ) {
                    lostPoint += 40;
                }
            }
        }

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount - 6; row++) {
                if (qrCode.isDark(row, col) &&
                        !qrCode.isDark(row + 1, col) &&
                         qrCode.isDark(row + 2, col) &&
                         qrCode.isDark(row + 3, col) &&
                         qrCode.isDark(row + 4, col) &&
                        !qrCode.isDark(row + 5, col) &&
                         qrCode.isDark(row + 6, col) ) {
                    lostPoint += 40;
                }
            }
        }

        // LEVEL4
        
        var darkCount = 0;

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount; row++) {
                if (qrCode.isDark(row, col) ) {
                    darkCount++;
                }
            }
        }
        
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;       
    }

};



//---------------------------------------------------------------------
// QRCode for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//   http://www.opensource.org/licenses/mit-license.php
//
// The word "QR Code" is registered trademark of 
// DENSO WAVE INCORPORATED
//   http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
// Modified to work in node for this project (and some refactoring)
//---------------------------------------------------------------------


function QRCode(typeNumber, errorCorrectLevel) {
	this.typeNumber = typeNumber;
	this.errorCorrectLevel = errorCorrectLevel;
	this.modules = null;
	this.moduleCount = 0;
	this.dataCache = null;
	this.dataList = [];
}

QRCode.prototype = {
	
	addData : function(data) {
		var newData = new QR8bitByte(data);
		this.dataList.push(newData);
		this.dataCache = null;
	},
	
	isDark : function(row, col) {
		if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
			throw new Error(row + "," + col);
		}
		return this.modules[row][col];
	},

	getModuleCount : function() {
		return this.moduleCount;
	},
	
	make : function() {
		// Calculate automatically typeNumber if provided is < 1
		if (this.typeNumber < 1 ){
			var typeNumber = 1;
			for (typeNumber = 1; typeNumber < 40; typeNumber++) {
				var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);

				var buffer = new QRBitBuffer();
				var totalDataCount = 0;
				for (var i = 0; i < rsBlocks.length; i++) {
					totalDataCount += rsBlocks[i].dataCount;
				}

				for (var x = 0; x < this.dataList.length; x++) {
					var data = this.dataList[x];
					buffer.put(data.mode, 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
					data.write(buffer);
				}
				if (buffer.getLengthInBits() <= totalDataCount * 8)
					break;
			}
			this.typeNumber = typeNumber;
		}
		this.makeImpl(false, this.getBestMaskPattern() );
	},
	
	makeImpl : function(test, maskPattern) {
		
		this.moduleCount = this.typeNumber * 4 + 17;
		this.modules = new Array(this.moduleCount);
		
		for (var row = 0; row < this.moduleCount; row++) {
			
			this.modules[row] = new Array(this.moduleCount);
			
			for (var col = 0; col < this.moduleCount; col++) {
				this.modules[row][col] = null;//(col + row) % 3;
			}
		}
	
		this.setupPositionProbePattern(0, 0);
		this.setupPositionProbePattern(this.moduleCount - 7, 0);
		this.setupPositionProbePattern(0, this.moduleCount - 7);
		this.setupPositionAdjustPattern();
		this.setupTimingPattern();
		this.setupTypeInfo(test, maskPattern);
		
		if (this.typeNumber >= 7) {
			this.setupTypeNumber(test);
		}
	
		if (this.dataCache === null) {
			this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
		}
	
		this.mapData(this.dataCache, maskPattern);
	},

	setupPositionProbePattern : function(row, col)  {
		
		for (var r = -1; r <= 7; r++) {
			
			if (row + r <= -1 || this.moduleCount <= row + r) continue;
			
			for (var c = -1; c <= 7; c++) {
				
				if (col + c <= -1 || this.moduleCount <= col + c) continue;
				
				if ( (0 <= r && r <= 6 && (c === 0 || c === 6) ) || 
                     (0 <= c && c <= 6 && (r === 0 || r === 6) ) || 
                     (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
					this.modules[row + r][col + c] = true;
				} else {
					this.modules[row + r][col + c] = false;
				}
			}		
		}		
	},
	
	getBestMaskPattern : function() {
	
		var minLostPoint = 0;
		var pattern = 0;
	
		for (var i = 0; i < 8; i++) {
			
			this.makeImpl(true, i);
	
			var lostPoint = QRUtil.getLostPoint(this);
	
			if (i === 0 || minLostPoint >  lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
	
		return pattern;
	},
	
	createMovieClip : function(target_mc, instance_name, depth) {
	
		var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
		var cs = 1;
	
		this.make();

		for (var row = 0; row < this.modules.length; row++) {
			
			var y = row * cs;
			
			for (var col = 0; col < this.modules[row].length; col++) {
	
				var x = col * cs;
				var dark = this.modules[row][col];
			
				if (dark) {
					qr_mc.beginFill(0, 100);
					qr_mc.moveTo(x, y);
					qr_mc.lineTo(x + cs, y);
					qr_mc.lineTo(x + cs, y + cs);
					qr_mc.lineTo(x, y + cs);
					qr_mc.endFill();
				}
			}
		}
		
		return qr_mc;
	},

	setupTimingPattern : function() {
		
		for (var r = 8; r < this.moduleCount - 8; r++) {
			if (this.modules[r][6] !== null) {
				continue;
			}
			this.modules[r][6] = (r % 2 === 0);
		}
	
		for (var c = 8; c < this.moduleCount - 8; c++) {
			if (this.modules[6][c] !== null) {
				continue;
			}
			this.modules[6][c] = (c % 2 === 0);
		}
	},
	
	setupPositionAdjustPattern : function() {
	
		var pos = QRUtil.getPatternPosition(this.typeNumber);
		
		for (var i = 0; i < pos.length; i++) {
		
			for (var j = 0; j < pos.length; j++) {
			
				var row = pos[i];
				var col = pos[j];
				
				if (this.modules[row][col] !== null) {
					continue;
				}
				
				for (var r = -2; r <= 2; r++) {
				
					for (var c = -2; c <= 2; c++) {
					
						if (Math.abs(r) === 2 || 
                            Math.abs(c) === 2 ||
                            (r === 0 && c === 0) ) {
							this.modules[row + r][col + c] = true;
						} else {
							this.modules[row + r][col + c] = false;
						}
					}
				}
			}
		}
	},
	
	setupTypeNumber : function(test) {
	
		var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
	
		for (var i = 0; i < 18; i++) {
			mod = (!test && ( (bits >> i) & 1) === 1);
			this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
		}
	
		for (var x = 0; x < 18; x++) {
			mod = (!test && ( (bits >> x) & 1) === 1);
			this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
		}
	},
	
	setupTypeInfo : function(test, maskPattern) {
	
		var data = (this.errorCorrectLevel << 3) | maskPattern;
		var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
	
		// vertical		
		for (var v = 0; v < 15; v++) {
	
			mod = (!test && ( (bits >> v) & 1) === 1);
	
			if (v < 6) {
				this.modules[v][8] = mod;
			} else if (v < 8) {
				this.modules[v + 1][8] = mod;
			} else {
				this.modules[this.moduleCount - 15 + v][8] = mod;
			}
		}
	
		// horizontal
		for (var h = 0; h < 15; h++) {
	
			mod = (!test && ( (bits >> h) & 1) === 1);
			
			if (h < 8) {
				this.modules[8][this.moduleCount - h - 1] = mod;
			} else if (h < 9) {
				this.modules[8][15 - h - 1 + 1] = mod;
			} else {
				this.modules[8][15 - h - 1] = mod;
			}
		}
	
		// fixed module
		this.modules[this.moduleCount - 8][8] = (!test);
	
	},
	
	mapData : function(data, maskPattern) {
		
		var inc = -1;
		var row = this.moduleCount - 1;
		var bitIndex = 7;
		var byteIndex = 0;
		
		for (var col = this.moduleCount - 1; col > 0; col -= 2) {
	
			if (col === 6) col--;
	
			while (true) {
	
				for (var c = 0; c < 2; c++) {
					
					if (this.modules[row][col - c] === null) {
						
						var dark = false;
	
						if (byteIndex < data.length) {
							dark = ( ( (data[byteIndex] >>> bitIndex) & 1) === 1);
						}
	
						var mask = QRUtil.getMask(maskPattern, row, col - c);
	
						if (mask) {
							dark = !dark;
						}
						
						this.modules[row][col - c] = dark;
						bitIndex--;
	
						if (bitIndex === -1) {
							byteIndex++;
							bitIndex = 7;
						}
					}
				}
								
				row += inc;
	
				if (row < 0 || this.moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
		
	}

};

QRCode.PAD0 = 0xEC;
QRCode.PAD1 = 0x11;

QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
	
	var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
	
	var buffer = new QRBitBuffer();
	
	for (var i = 0; i < dataList.length; i++) {
		var data = dataList[i];
		buffer.put(data.mode, 4);
		buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
		data.write(buffer);
	}

	// calc num max data.
	var totalDataCount = 0;
	for (var x = 0; x < rsBlocks.length; x++) {
		totalDataCount += rsBlocks[x].dataCount;
	}

	if (buffer.getLengthInBits() > totalDataCount * 8) {
		throw new Error("code length overflow. (" + 
            buffer.getLengthInBits() + 
            ">" +  
            totalDataCount * 8 + 
            ")");
	}

	// end code
	if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
		buffer.put(0, 4);
	}

	// padding
	while (buffer.getLengthInBits() % 8 !== 0) {
		buffer.putBit(false);
	}

	// padding
	while (true) {
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD0, 8);
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD1, 8);
	}

	return QRCode.createBytes(buffer, rsBlocks);
};

QRCode.createBytes = function(buffer, rsBlocks) {

	var offset = 0;
	
	var maxDcCount = 0;
	var maxEcCount = 0;
	
	var dcdata = new Array(rsBlocks.length);
	var ecdata = new Array(rsBlocks.length);
	
	for (var r = 0; r < rsBlocks.length; r++) {

		var dcCount = rsBlocks[r].dataCount;
		var ecCount = rsBlocks[r].totalCount - dcCount;

		maxDcCount = Math.max(maxDcCount, dcCount);
		maxEcCount = Math.max(maxEcCount, ecCount);
		
		dcdata[r] = new Array(dcCount);
		
		for (var i = 0; i < dcdata[r].length; i++) {
			dcdata[r][i] = 0xff & buffer.buffer[i + offset];
		}
		offset += dcCount;
		
		var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
		var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);

		var modPoly = rawPoly.mod(rsPoly);
		ecdata[r] = new Array(rsPoly.getLength() - 1);
		for (var x = 0; x < ecdata[r].length; x++) {
            var modIndex = x + modPoly.getLength() - ecdata[r].length;
			ecdata[r][x] = (modIndex >= 0)? modPoly.get(modIndex) : 0;
		}

	}
	
	var totalCodeCount = 0;
	for (var y = 0; y < rsBlocks.length; y++) {
		totalCodeCount += rsBlocks[y].totalCount;
	}

	var data = new Array(totalCodeCount);
	var index = 0;

	for (var z = 0; z < maxDcCount; z++) {
		for (var s = 0; s < rsBlocks.length; s++) {
			if (z < dcdata[s].length) {
				data[index++] = dcdata[s][z];
			}
		}
	}

	for (var xx = 0; xx < maxEcCount; xx++) {
		for (var t = 0; t < rsBlocks.length; t++) {
			if (xx < ecdata[t].length) {
				data[index++] = ecdata[t][xx];
			}
		}
	}

	return data;

};



  // สร้าง QR เป็น SVG (ระดับแก้ไขข้อผิดพลาด M)
  function svg(text, opt) {
    opt = opt || {}; var q = new QRCode(-1, QRErrorCorrectLevel.M); q.addData(String(text)); q.make();
    var n = q.getModuleCount(), m = opt.margin == null ? 2 : opt.margin, s = n + m * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  // ---------- ตัวอ่าน QR จากรูป (v3.1) — ใช้ได้ทุกเครื่อง เพราะอ่านที่เซิร์ฟเวอร์ ----------
  // รับภาพขาวดำ (gray 0-255 ทีละพิกเซล) → คืนข้อความใน QR หรือ null
  var GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255]; })();
  function gmul(a, b) { return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
  function gdiv(a, b) { if (b === 0) throw new Error("div0"); return a === 0 ? 0 : GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255]; }
  function gpow(x, p) { return GF_EXP[(((GF_LOG[x] * p) % 255) + 255) % 255]; }
  function ginv(x) { return GF_EXP[255 - GF_LOG[x]]; }
  function pScale(p, x) { return p.map(function (c) { return gmul(c, x); }); }
  function pAdd(p, q) { var n = Math.max(p.length, q.length), r = new Array(n).fill(0), i; for (i = 0; i < p.length; i++) r[i + n - p.length] = p[i]; for (i = 0; i < q.length; i++) r[i + n - q.length] ^= q[i]; return r; }
  function pMul(p, q) { var r = new Array(p.length + q.length - 1).fill(0); for (var j = 0; j < q.length; j++) for (var i = 0; i < p.length; i++) r[i + j] ^= gmul(p[i], q[j]); return r; }
  function pEval(p, x) { var y = p[0]; for (var i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i]; return y; }
  function pDivRem(dividend, divisor) {
    var out = dividend.slice();
    for (var i = 0; i < dividend.length - (divisor.length - 1); i++) { var c = out[i]; if (c !== 0) for (var j = 1; j < divisor.length; j++) if (divisor[j] !== 0) out[i + j] ^= gmul(divisor[j], c); }
    return out.slice(out.length - (divisor.length - 1));
  }
  // แก้ข้อผิดพลาดแบบ Reed-Solomon (ช่วยเมื่อมีโลโก้ทับกลาง QR หรือรูปไม่ชัด)
  function rsCorrect(msg, nsym) {
    var synd = [0], i, j, bad = false;
    for (i = 0; i < nsym; i++) { synd.push(pEval(msg, gpow(2, i))); if (synd[i + 1]) bad = true; }
    if (!bad) return msg;
    var errLoc = [1], oldLoc = [1];
    for (i = 0; i < nsym; i++) {
      var K = i + 1, delta = synd[K];
      for (j = 1; j < errLoc.length; j++) delta ^= gmul(errLoc[errLoc.length - 1 - j], synd[K - j]);
      oldLoc = oldLoc.concat([0]);
      if (delta !== 0) {
        if (oldLoc.length > errLoc.length) { var nl = pScale(oldLoc, delta); oldLoc = pScale(errLoc, ginv(delta)); errLoc = nl; }
        errLoc = pAdd(errLoc, pScale(oldLoc, delta));
      }
    }
    while (errLoc.length && errLoc[0] === 0) errLoc.shift();
    var errs = errLoc.length - 1;
    if (errs * 2 > nsym) return null;
    var rev = errLoc.slice().reverse(), pos = [];
    for (i = 0; i < msg.length; i++) if (pEval(rev, gpow(2, i)) === 0) pos.push(msg.length - 1 - i);
    if (pos.length !== errs) return null;
    var coef = pos.map(function (p) { return msg.length - 1 - p; });
    var eLoc = [1];
    coef.forEach(function (c) { eLoc = pMul(eLoc, pAdd([1], [gpow(2, c), 0])); });
    var sr = synd.slice().reverse();
    var prod = pMul(sr, eLoc), divisor = [1].concat(new Array(eLoc.length).fill(0));
    var eval_ = pDivRem(prod, divisor).reverse();
    var X = coef.map(function (c) { return gpow(2, -(255 - c)); });
    var out = msg.slice();
    for (i = 0; i < X.length; i++) {
      var Xi = X[i], Xinv = ginv(Xi), lp = 1;
      for (j = 0; j < X.length; j++) if (j !== i) lp = gmul(lp, 1 ^ gmul(Xinv, X[j]));
      if (lp === 0) return null;
      var y = gmul(Xi, pEval(eval_.slice().reverse(), Xinv));
      out[pos[i]] ^= gdiv(y, lp);
    }
    for (i = 0; i < nsym; i++) if (pEval(out, gpow(2, i))) return null;
    return out;
  }

  function binarize(gray, w, h, kind) {
    var bin = new Uint8Array(w * h), i;
    if (kind === "otsu") {
      var hist = new Array(256).fill(0); for (i = 0; i < gray.length; i++) hist[gray[i]]++;
      var tot = gray.length, sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
      var sB = 0, wB = 0, best = 0, th = 128;
      for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = tot - wB; if (!wF) break; sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
      for (i = 0; i < gray.length; i++) bin[i] = gray[i] <= th ? 1 : 0;
      return bin;
    }
    // แบบปรับตามพื้นที่ (เหมาะกับรูปถ่ายที่แสงไม่เท่ากัน)
    var W = w + 1, integ = new Float64Array(W * (h + 1)), x, y;
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += gray[y * w + x]; integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + row; } }
    var r = Math.max(7, Math.round(Math.min(w, h) / (kind === "local2" ? 10 : 20)));
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var s = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
        var mean = s / ((y1 - y0) * (x1 - x0)), g = gray[y * w + x];
        bin[y * w + x] = (g < mean - 6 || (g < 60)) ? 1 : 0;
      }
    }
    return bin;
  }

  function ratioOk(c, strict) {
    var t = c[0] + c[1] + c[2] + c[3] + c[4]; if (t < 7) return false;
    var m = t / 7, v = m * (strict ? 0.5 : 0.75);
    return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v;
  }
  // นับช่วง ดำ-ขาว-ดำ-ขาว-ดำ ผ่านจุดกึ่งกลาง ตามแนวที่กำหนด
  function crossCount(bin, w, h, cx, cy, dx, dy, maxRun) {
    var px = function (k) { var x = Math.round(cx + dx * k), y = Math.round(cy + dy * k); if (x < 0 || y < 0 || x >= w || y >= h) return -1; return bin[y * w + x]; };
    if (px(0) !== 1) return null;
    var c = [0, 0, 0, 0, 0], k = 0;
    while (px(k) === 1) { c[2]++; k--; }
    var neg = k;
    while (px(k) === 0 && c[1] <= maxRun) { c[1]++; k--; }
    while (px(k) === 1 && c[0] <= maxRun) { c[0]++; k--; }
    k = 1; while (px(k) === 1) { c[2]++; k++; }
    var posc = k;
    while (px(k) === 0 && c[3] <= maxRun) { c[3]++; k++; }
    while (px(k) === 1 && c[4] <= maxRun) { c[4]++; k++; }
    if (!c[0] || !c[1] || !c[3] || !c[4]) return null;
    return { c: c, center: (neg + 1 + posc - 1) / 2, total: c[0] + c[1] + c[2] + c[3] + c[4] };
  }

  function findFinders(bin, w, h) {
    var cands = [], step = h > 900 ? 2 : 1;
    for (var y = 0; y < h; y += step) {
      var runs = [], col = bin[y * w], start = 0;
      for (var x = 1; x <= w; x++) { var v = x < w ? bin[y * w + x] : -1; if (v !== col) { runs.push([start, x - start, col]); start = x; col = v; } }
      for (var i = 0; i + 4 < runs.length; i++) {
        if (runs[i][2] !== 1) continue;
        var c = [runs[i][1], runs[i + 1][1], runs[i + 2][1], runs[i + 3][1], runs[i + 4][1]];
        if (!ratioOk(c, false)) continue;
        var tot = c[0] + c[1] + c[2] + c[3] + c[4];
        var cx = runs[i + 2][0] + runs[i + 2][1] / 2 - 0.5;
        var vc = crossCount(bin, w, h, cx, y, 0, 1, tot);
        if (!vc || !ratioOk(vc.c, false) || Math.abs(vc.total - tot) > tot * 0.6) continue;
        var cy = y + vc.center;
        var hc = crossCount(bin, w, h, cx, cy, 1, 0, tot);
        if (!hc || !ratioOk(hc.c, false)) continue;
        cx = cx + hc.center;
        // ตรวจแนวทแยงเพื่อกันจับผิด
        var dc = crossCount(bin, w, h, cx, cy, 1, 1, tot);
        if (!dc || !ratioOk(dc.c, false)) continue;
        cands.push({ x: cx, y: cy, ms: (hc.total + vc.total) / 14, n: 1 });
      }
    }
    var cl = [];
    cands.forEach(function (p) {
      for (var j = 0; j < cl.length; j++) { var q = cl[j]; if (Math.abs(q.x - p.x) <= q.ms * 2 && Math.abs(q.y - p.y) <= q.ms * 2 && Math.abs(q.ms - p.ms) <= Math.max(q.ms, p.ms) * 0.5) { q.x = (q.x * q.n + p.x) / (q.n + 1); q.y = (q.y * q.n + p.y) / (q.n + 1); q.ms = (q.ms * q.n + p.ms) / (q.n + 1); q.n++; return; } }
      cl.push({ x: p.x, y: p.y, ms: p.ms, n: 1 });
    });
    cl.sort(function (a, b) { return b.n - a.n; });
    return cl.slice(0, 10);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function triples(cl) {
    var out = [];
    for (var a = 0; a < cl.length; a++) for (var b = a + 1; b < cl.length; b++) for (var c = b + 1; c < cl.length; c++) {
      var P = [cl[a], cl[b], cl[c]], ms = P.map(function (p) { return p.ms; });
      if (Math.max.apply(null, ms) / Math.min.apply(null, ms) > 1.6) continue;
      var d01 = dist(P[0], P[1]), d12 = dist(P[1], P[2]), d02 = dist(P[0], P[2]), tl, tr, bl;
      if (d12 >= d01 && d12 >= d02) { tl = P[0]; tr = P[1]; bl = P[2]; }
      else if (d02 >= d01 && d02 >= d12) { tl = P[1]; tr = P[0]; bl = P[2]; }
      else { tl = P[2]; tr = P[0]; bl = P[1]; }
      if ((tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x) < 0) { var t = tr; tr = bl; bl = t; }
      var A = dist(tl, tr), Bd = dist(tl, bl), C = dist(tr, bl);
      if (Math.abs(A - Bd) / Math.max(A, Bd) > 0.35) continue;
      var hyp = Math.hypot(A, Bd); if (Math.abs(C - hyp) / hyp > 0.25) continue;
      var msAvg = (tl.ms + tr.ms + bl.ms) / 3;
      if (A / msAvg < 12) continue;
      out.push({ tl: tl, tr: tr, bl: bl, ms: msAvg, score: tl.n + tr.n + bl.n - 20 * Math.abs(A - Bd) / Math.max(A, Bd) });
    }
    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, 6);
  }

  function s2q(x0, y0, x1, y1, x2, y2, x3, y3) {
    var dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [[x1 - x0, x2 - x1, x0], [y1 - y0, y2 - y1, y0], [0, 0, 1]];
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    var a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [[x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0], [y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0], [a13, a23, 1]];
  }
  function inv3(m) {
    var a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2], g = m[2][0], h = m[2][1], i = m[2][2];
    return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]];
  }
  function mul3(A, B) { var r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) for (var k = 0; k < 3; k++) r[i][j] += A[i][k] * B[k][j]; return r; }
  function transformFor(src, dst) { // src/dst: 4 จุด [x,y]
    var Ms = s2q(src[0][0], src[0][1], src[1][0], src[1][1], src[2][0], src[2][1], src[3][0], src[3][1]);
    var Md = s2q(dst[0][0], dst[0][1], dst[1][0], dst[1][1], dst[2][0], dst[2][1], dst[3][0], dst[3][1]);
    var M = mul3(Md, inv3(Ms));
    return function (u, v) { var z = M[2][0] * u + M[2][1] * v + M[2][2]; return [(M[0][0] * u + M[0][1] * v + M[0][2]) / z, (M[1][0] * u + M[1][1] * v + M[1][2]) / z]; };
  }

  function findAlign(bin, w, h, est, ux, uy) {
    var at = function (x, y) { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= w || y >= h ? -1 : bin[y * w + x]; };
    var ms = Math.hypot(ux[0], ux[1]), R = ms * 9, st = Math.max(1, ms / 3), best = null;
    var scales = [1, 0.8, 1.2, 0.65, 1.4];
    for (var dy = -R; dy <= R; dy += st) for (var dx = -R; dx <= R; dx += st) {
      var px = est[0] + dx, py = est[1] + dy, sc = 0;
      if (at(px, py) !== 1) continue;
      for (var si = 0; si < scales.length; si++) {
        var f = scales[si], s1 = 1;
        for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) {
          if (!a && !b) continue;
          var ring = Math.max(Math.abs(a), Math.abs(b)), want = ring === 2 ? 1 : 0;
          if (at(px + f * (a * ux[0] + b * uy[0]), py + f * (a * ux[1] + b * uy[1])) === want) s1++;
        }
        if (s1 > sc) sc = s1;
      }
      var d = Math.hypot(dx, dy);
      if (!best || sc > best.sc || (sc === best.sc && d < best.d)) best = { x: px, y: py, sc: sc, d: d };
    }
    return best && best.sc >= 22 ? best : null;
  }

  function readGrid(bin, w, h, T, n) {
    var g = [];
    for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) { var p = T(c + 0.5, r + 0.5), x = Math.round(p[0]), y = Math.round(p[1]); row.push(x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] === 1 : false); } g.push(row); }
    return g;
  }

  function bitCount(x) { var c = 0; while (x) { c += x & 1; x >>>= 1; } return c; }
  var ECLS = [1, 0, 3, 2];
  function decodeGrid(g) {
    var n = g.length, ver = (n - 17) / 4; if (ver < 1 || ver > 40 || ver % 1) return null;
    var a = 0, b = 0, v, hh;
    for (v = 0; v < 15; v++) { var r1 = v < 6 ? v : v < 8 ? v + 1 : n - 15 + v; if (g[r1][8]) a |= 1 << v; }
    for (hh = 0; hh < 15; hh++) { var c1 = hh < 8 ? n - hh - 1 : hh < 9 ? 7 : 15 - hh - 1; if (g[8][c1]) b |= 1 << hh; }
    var best = null;
    ECLS.forEach(function (ecl) { for (var mk = 0; mk < 8; mk++) { var bits = QRUtil.getBCHTypeInfo((ecl << 3) | mk), d = Math.min(bitCount(bits ^ a), bitCount(bits ^ b)); if (!best || d < best.d) best = { d: d, ecl: ecl, mk: mk }; } });
    if (!best || best.d > 3) return null;
    var q = new QRCode(ver, best.ecl); q.moduleCount = n; q.modules = [];
    for (var i = 0; i < n; i++) q.modules.push(new Array(n).fill(null));
    q.setupPositionProbePattern(0, 0); q.setupPositionProbePattern(n - 7, 0); q.setupPositionProbePattern(0, n - 7);
    q.setupPositionAdjustPattern(); q.setupTimingPattern(); q.setupTypeInfo(true, best.mk); if (ver >= 7) q.setupTypeNumber(true);
    var bytes = [], cur = 0, nb = 0, inc = -1, row = n - 1;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var c = 0; c < 2; c++) if (q.modules[row][col - c] === null) {
          var bit = g[row][col - c]; if (QRUtil.getMask(best.mk, row, col - c)) bit = !bit;
          cur = (cur << 1) | (bit ? 1 : 0); nb++; if (nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
        }
        row += inc; if (row < 0 || n <= row) { row -= inc; inc = -inc; break; }
      }
    }
    var blocks = QRRSBlock.getRSBlocks(ver, best.ecl), maxDc = 0, maxEc = 0, k = 0, s, z;
    var bl = blocks.map(function (x) { maxDc = Math.max(maxDc, x.dataCount); maxEc = Math.max(maxEc, x.totalCount - x.dataCount); return { d: [], e: [], dc: x.dataCount, ec: x.totalCount - x.dataCount }; });
    for (z = 0; z < maxDc; z++) for (s = 0; s < bl.length; s++) if (z < bl[s].dc) bl[s].d.push(bytes[k++]);
    for (z = 0; z < maxEc; z++) for (s = 0; s < bl.length; s++) if (z < bl[s].ec) bl[s].e.push(bytes[k++]);
    var data = [];
    for (s = 0; s < bl.length; s++) { var fixed = rsCorrect(bl[s].d.concat(bl[s].e), bl[s].ec); if (!fixed) return null; data = data.concat(fixed.slice(0, bl[s].dc)); }
    return parseData(data, ver);
  }

  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  function parseData(data, ver) {
    var pos = 0, total = data.length * 8;
    var read = function (nbits) { if (pos + nbits > total) throw new Error("eof"); var v = 0; for (var i = 0; i < nbits; i++) { v = (v << 1) | ((data[(pos >> 3)] >> (7 - (pos & 7))) & 1); pos++; } return v; };
    var out = [], txt = "";
    try {
      while (pos + 4 <= total) {
        var mode = read(4);
        if (mode === 0) break;
        if (mode === 7) { var e = read(8); if ((e & 0x80) === 0x80) read((e & 0x40) ? 16 : 8); continue; }
        if (mode === 1) { var cnt = read(QRUtil.getLengthInBits(1, ver)); while (cnt >= 3) { var d3 = read(10); txt += ("00" + d3).slice(-3); cnt -= 3; } if (cnt === 2) txt += ("0" + read(7)).slice(-2); else if (cnt === 1) txt += String(read(4)); continue; }
        if (mode === 2) { var ca = read(QRUtil.getLengthInBits(2, ver)); while (ca >= 2) { var p = read(11); txt += ALNUM[Math.floor(p / 45)] + ALNUM[p % 45]; ca -= 2; } if (ca === 1) txt += ALNUM[read(6)]; continue; }
        if (mode === 4) { var cb = read(QRUtil.getLengthInBits(4, ver)), buf = []; for (var i = 0; i < cb; i++) buf.push(read(8)); txt += Buffer.from(buf).toString("utf8"); continue; }
        return null; // kanji/อื่นๆ ไม่รองรับ
      }
    } catch (err) { if (!txt) return null; }
    return txt;
  }

  function decode(gray, w, h) {
    var kinds = ["otsu", "local", "local2"];
    for (var ki = 0; ki < kinds.length; ki++) {
      var bin = binarize(gray, w, h, kinds[ki]);
      var cl = findFinders(bin, w, h); if (cl.length < 3) continue;
      var tri = triples(cl);
      for (var ti = 0; ti < tri.length; ti++) {
        var t = tri[ti], tl = t.tl, tr = t.tr, bl = t.bl;
        var msDir = function (p, q) { // ขนาดช่องตามแนวเส้นระหว่างจุด (แม่นกว่าตอนภาพเอียง)
          var L = dist(p, q), dx = (q.x - p.x) / L, dy = (q.y - p.y) / L, a = crossCount(bin, w, h, p.x, p.y, dx, dy, t.ms * 14), b = crossCount(bin, w, h, q.x, q.y, dx, dy, t.ms * 14);
          var v = [a, b].filter(function (z) { return z && ratioOk(z.c, false); }).map(function (z) { return z.total / 7; });
          return v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : t.ms;
        };
        var est = (dist(tl, tr) / msDir(tl, tr) + dist(tl, bl) / msDir(tl, bl)) / 2 + 7, dim = Math.round(est);
        var m4 = dim & 3; if (m4 === 0) dim++; else if (m4 === 2) dim--; else if (m4 === 3) dim -= 2;
        var dims = [dim, dim + 4, dim - 4, dim + 8, dim - 8];
        for (var di = 0; di < dims.length; di++) {
          var n = dims[di]; if (n < 21 || n > 177) continue;
          var span = n - 7, ux = [(tr.x - tl.x) / span, (tr.y - tl.y) / span], uy = [(bl.x - tl.x) / span, (bl.y - tl.y) / span];
          var br = [tr.x + bl.x - tl.x, tr.y + bl.y - tl.y];
          var tries = [];
          if (n > 21) {
            var f = 1 - 3 / span, e2 = [tl.x + f * (br[0] - tl.x), tl.y + f * (br[1] - tl.y)];
            var al = findAlign(bin, w, h, e2, ux, uy);
            if (al) tries.push(transformFor([[3.5, 3.5], [n - 3.5, 3.5], [n - 6.5, n - 6.5], [3.5, n - 3.5]], [[tl.x, tl.y], [tr.x, tr.y], [al.x, al.y], [bl.x, bl.y]]));
          }
          tries.push(transformFor([[3.5, 3.5], [n - 3.5, 3.5], [n - 3.5, n - 3.5], [3.5, n - 3.5]], [[tl.x, tl.y], [tr.x, tr.y], br, [bl.x, bl.y]]));
          for (var k = 0; k < tries.length; k++) {
            var res = null;
            try { res = decodeGrid(readGrid(bin, w, h, tries[k], n)); } catch (e) { res = null; }
            if (res) return res;
          }
        }
      }
    }
    return null;
  }

  return { svg: svg, decode: decode, QRCode: QRCode, L: QRErrorCorrectLevel };
})();
/* =====================================================================
   POS ขายหน้าร้าน (v3.0) — เปิด/ปิดแยกแต่ละสาขา · ยอดขายเข้ารายรับรายวันอัตโนมัติ
   ===================================================================== */
const POS_DEFAULT = { qrMode: "none", promptpayId: "", merchantTemplate: "", incomeCategory: "", chQr: "", chCash: "", shopName: "", receiptFooter: "ขอบคุณที่ใช้บริการ", autoIncome: true, displayKey: "", menuCats: [] };
const posDisplay = {}; // หน้าจอลูกค้า (เก็บในหน่วยความจำ) bid -> { mode, amount, svg, items, at }
async function posConfig(bid) {
  const r = (await pool.query("SELECT data FROM pos_config WHERE branch_id=$1", [bid])).rows[0];
  let d = {}; try { d = JSON.parse(r ? r.data : "{}"); } catch (e) {}
  const c = { ...POS_DEFAULT, ...d };
  if (!c.displayKey) { c.displayKey = crypto.randomBytes(12).toString("hex"); await posSaveConfig(bid, c); }
  return c;
}
async function posSaveConfig(bid, c) {
  await pool.query("INSERT INTO pos_config (branch_id, data) VALUES ($1,$2) ON CONFLICT (branch_id) DO UPDATE SET data=EXCLUDED.data", [bid, JSON.stringify(c)]);
}
async function needPos(ctx, admin, level) {
  await needBranch(ctx, admin ? "pos_admin" : "pos", level || "view");
  if (!ctx.branch.pos_enabled) throw new HttpError(403, "สาขานี้ยังไม่ได้เปิดใช้ระบบ POS — เปิดได้ที่ Admin → จัดการสาขา → แก้ไขสาขา");
}
/* ---------- Thai QR / PromptPay (EMVCo TLV) — จาก POS เดิม ---------- */
function qrCrc16(s) { let crc = 0xFFFF; for (let i = 0; i < s.length; i++) { crc ^= (s.charCodeAt(i) << 8); for (let b = 0; b < 8; b++) { crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1); crc &= 0xFFFF; } } return crc.toString(16).toUpperCase().padStart(4, "0"); }
function qrTlvTop(str) { const out = []; let i = 0; while (i < str.length) { const tag = str.slice(i, i + 2), len = parseInt(str.slice(i + 2, i + 4), 10); if (isNaN(len)) throw new Error("โครงสร้าง QR ไม่ถูกต้อง"); out.push({ tag, value: str.slice(i + 4, i + 4 + len) }); i += 4 + len; } return out; }
function qrTlv(tag, val) { return tag + String(val.length).padStart(2, "0") + val; }
function promptPayPayload(id, amount) {
  const clean = String(id).replace(/[^0-9]/g, "");
  const [t, v] = clean.length === 13 ? ["02", clean] : clean.length === 15 ? ["03", clean] : ["01", "0066" + clean.replace(/^0/, "")];
  let p = qrTlv("00", "01") + qrTlv("01", amount != null ? "12" : "11") + qrTlv("29", qrTlv("00", "A000000677010111") + qrTlv(t, v)) + qrTlv("53", "764");
  if (amount != null) p += qrTlv("54", Number(amount).toFixed(2));
  p += qrTlv("58", "TH") + "6304"; return p + qrCrc16(p);
}
// QR ร้านค้า (เช่น ถุงเงิน) — คงทุกฟิลด์เดิมไว้ แก้เฉพาะ 00/01/54/63
function merchantPayload(tpl, amount) {
  const f = qrTlvTop(tpl), order = [], map = {};
  f.forEach(x => { if (!(x.tag in map)) order.push(x.tag); map[x.tag] = x.value; });
  map["00"] = "01"; map["01"] = amount != null ? "12" : "11";
  if (amount != null) { map["54"] = Number(amount).toFixed(2); if (order.indexOf("54") < 0) { const i = order.indexOf("58"); order.splice(i >= 0 ? i : order.length, 0, "54"); } }
  const i63 = order.indexOf("63"); if (i63 >= 0) order.splice(i63, 1);
  const body = order.map(t => qrTlv(t, map[t])).join("") + "6304"; return body + qrCrc16(body);
}
function checkMerchantTemplate(txt) {
  const top = qrTlvTop(String(txt || "").trim()); const m = top.find(x => x.tag === "30");
  if (!m) throw bad("ไม่พบข้อมูลบัญชีร้านค้าใน QR นี้ (ต้องเป็น QR ร้านค้า เช่น จากแอปถุงเงิน)");
  const sub = qrTlvTop(m.value), aid = sub.find(x => x.tag === "00");
  if (!aid || !aid.value.startsWith("A000000677010112")) throw bad("QR นี้ไม่ใช่มาตรฐาน Thai QR Payment สำหรับร้านค้า");
  const code = sub.find(x => x.tag === "02"); return code ? code.value : "";
}
function posQrPayload(c, amount) {
  if (c.qrMode === "merchant" && c.merchantTemplate) return merchantPayload(c.merchantTemplate, amount);
  if (c.qrMode === "promptpay" && c.promptpayId) return promptPayPayload(c.promptpayId, amount);
  return "";
}
/* ---------- เมนู ---------- */
function posJson(v, d) { try { const x = JSON.parse(v || ""); return x == null ? d : x; } catch (e) { return d; } }
function posMenuOut(r, soldMap) {
  return { id: r.id, name: r.name, names: posJson(r.names_json, {}), category: r.category || "", price: Number(r.price), types: posJson(r.types_json, []), addons: posJson(r.addons_json, []),
    dailyLimit: r.daily_limit == null ? null : Number(r.daily_limit), soldToday: soldMap ? (soldMap[r.id] || 0) : 0, soldout: !!r.soldout, active: !!r.active,
    imageV: r.has_image ? Number(r.updated_at) || 1 : 0, sort: Number(r.sort_order) || 0 };
}
async function posSoldToday(bid, day) {
  const { rows } = await pool.query("SELECT items_json FROM pos_orders WHERE branch_id=$1 AND order_date=$2 AND status IN ('paid','prepared')", [bid, day]);
  const m = {}; rows.forEach(r => posJson(r.items_json, []).forEach(i => { if (i.menuId) m[i.menuId] = (m[i.menuId] || 0) + (Number(i.qty) || 0); })); return m;
}
async function posMenuList(bid, all) {
  const sold = await posSoldToday(bid, todayBkk());
  const { rows } = await pool.query(`SELECT id, branch_id, name, names_json, category, price, types_json, addons_json, daily_limit, soldout, active, sort_order, updated_at, (image IS NOT NULL AND image<>'') AS has_image
    FROM pos_menu WHERE branch_id=$1 ${all ? "" : "AND active=TRUE"} ORDER BY sort_order, created_at`, [bid]);
  return rows.map(r => posMenuOut(r, sold));
}
function posMenuFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อเมนู");
  const price = r2(num(b.price, NaN)); if (!(price >= 0)) throw bad("ราคาไม่ถูกต้อง");
  const clean = (arr, what) => (Array.isArray(arr) ? arr : []).slice(0, 30).map(x => ({ name: str(x && x.name, 100), price: r2(num(x && x.price, 0)) })).filter(x => x.name).map(x => { if (x.price < 0) throw bad(what + " ราคาติดลบไม่ได้"); return x; });
  const names = {}; ["en", "my", "lo"].forEach(k => { const v = str(b.names && b.names[k], 150); if (v) names[k] = v; });
  const lim = b.dailyLimit === "" || b.dailyLimit == null ? null : Math.floor(num(b.dailyLimit, -1));
  if (lim != null && lim < 0) throw bad("จำนวนขายต่อวันไม่ถูกต้อง");
  return { name, names_json: JSON.stringify(names), category: str(b.category, 80), price, types_json: JSON.stringify(clean(b.types, "แบบ/ขนาด")), addons_json: JSON.stringify(clean(b.addons, "Add-on")),
    daily_limit: lim, soldout: !!b.soldout, active: b.active !== false, image: b.image === undefined ? undefined : checkImg(b.image, 500000) };
}
/* ---------- ยอดขาย → รายรับรายวันอัตโนมัติ (แยกช่องทาง) ---------- */
async function posSyncIncome(ctx, bid, day) {
  const c = await posConfig(bid);
  const { rows } = await pool.query("SELECT pay_channel, COUNT(*)::int AS n, SUM(total - COALESCE(refund_amount,0))::float AS net FROM pos_orders WHERE branch_id=$1 AND order_date=$2 AND status IN ('paid','prepared','refunded') GROUP BY pay_channel", [bid, day]);
  const existing = (await pool.query("SELECT * FROM records WHERE branch_id=$1 AND source='pos' AND pos_key LIKE $2", [bid, "pos:" + day + ":%"])).rows;
  const want = c.autoIncome === false ? [] : rows.filter(r => r.pay_channel && r2(r.net) > 0);
  let cat = c.incomeCategory;
  if (!cat) { const l = (await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='income_category' ORDER BY sort_order", [bid])).rows.map(x => x.name); cat = l.find(n => /ขาย|อาหาร|หน้าร้าน/.test(n)) || l[0] || "ยอดขาย"; }
  const [y, mo, d] = day.split("-");
  for (const r of want) {
    const key = "pos:" + day + ":" + r.pay_channel, net = r2(r.net);
    const items = [{ name: "ยอดขายหน้าร้าน (POS) " + r.n + " บิล", category: cat, qty: 1, unit: "วัน", price: net, amount: net }];
    const ex = existing.find(e => e.pos_key === key);
    const desc = "ยอดขาย POS " + d + "/" + mo + "/" + (Number(y) + 543) + " · " + r.pay_channel;
    if (ex) await pool.query("UPDATE records SET items_json=$1, subtotal=$2, total=$2, category=$3, description=$4, updated_by=$5, updated_at=$6 WHERE id=$7", [JSON.stringify(items), net, cat, desc, "ระบบ POS", now(), ex.id]);
    else {
      const docNo = await nextDocNo(bid, "income", day);
      await pool.query(`INSERT INTO records (id,branch_id,type,doc_no,rec_date,party,description,category,items_json,subtotal,discount,vat_mode,vat_amount,total,payment_channel,note,created_by,created_at,source,pos_key)
        VALUES ($1,$2,'income',$3,$4,'ลูกค้าหน้าร้าน (POS)',$5,$6,$7,$8,0,'none',0,$8,$9,'สร้าง/อัปเดตอัตโนมัติจากยอดขาย POS',$10,$11,'pos',$12)`,
        [uid(), bid, docNo, day, desc, cat, JSON.stringify(items), net, r.pay_channel, "ระบบ POS", now(), key]);
    }
  }
  for (const e of existing) if (!want.some(r => "pos:" + day + ":" + r.pay_channel === e.pos_key)) await pool.query("DELETE FROM records WHERE id=$1", [e.id]);
}
function posOrderOut(r, full) {
  return { id: r.id, queueNo: r.queue_no, date: r.order_date, items: posJson(r.items_json, []), subtotal: Number(r.subtotal), discount: Number(r.discount) || 0, total: Number(r.total),
    status: r.status, payMethod: r.pay_method, payChannel: r.pay_channel || "", cashReceived: r.cash_received == null ? null : Number(r.cash_received), change: r.change_amount == null ? null : Number(r.change_amount),
    hasSlip: !!r.has_slip, note: r.note || "", createdBy: r.created_by || "", createdAt: Number(r.created_at), preparedAt: Number(r.prepared_at) || null, preparedBy: r.prepared_by || "",
    cancelledAt: Number(r.cancelled_at) || null, cancelledBy: r.cancelled_by || "", cancelReason: r.cancel_reason || "", refund: Number(r.refund_amount) || 0 };
}
const POS_ORDER_COLS = "id, branch_id, queue_no, order_date, items_json, subtotal, discount, total, status, pay_method, pay_channel, cash_received, change_amount, (slip IS NOT NULL AND slip<>'') AS has_slip, note, created_by, created_at, prepared_at, prepared_by, cancelled_at, cancelled_by, cancel_reason, refund_amount";
async function posQueueLists(bid) {
  const day = todayBkk();
  const { rows } = await pool.query("SELECT queue_no, status, prepared_at FROM pos_orders WHERE branch_id=$1 AND order_date=$2 AND status IN ('paid','prepared') ORDER BY created_at", [bid, day]);
  return { waiting: rows.filter(r => r.status === "paid").map(r => r.queue_no), ready: rows.filter(r => r.status === "prepared" && now() - Number(r.prepared_at) < 30 * 60000).map(r => r.queue_no).reverse().slice(0, 12) };
}

route("GET", B + "/pos/boot", async ctx => {
  await needPos(ctx, false, "view");
  const c = await posConfig(ctx.branch.id);
  const ch = (await pool.query("SELECT name, is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' ORDER BY sort_order", [ctx.branch.id])).rows;
  return { config: { qrMode: c.qrMode, qrReady: !!posQrPayload(c, 1), promptpayId: c.promptpayId, merchantCode: c.merchantTemplate ? (() => { try { return checkMerchantTemplate(c.merchantTemplate); } catch (e) { return ""; } })() : "",
      incomeCategory: c.incomeCategory, chQr: c.chQr, chCash: c.chCash, shopName: c.shopName || ctx.branch.name, receiptFooter: c.receiptFooter, autoIncome: c.autoIncome !== false, displayKey: c.displayKey, menuCats: c.menuCats || [] },
    menu: await posMenuList(ctx.branch.id, can(ctx, "pos_admin", "view")), channels: ch.filter(x => !x.is_credit).map(x => x.name),
    canAdmin: can(ctx, "pos_admin", "edit"), canSell: can(ctx, "pos", "edit"), today: todayBkk() };
});
route("GET", B + "/pos/menu/:id/image", async (ctx, req, res) => {
  await needPos(ctx, false, "view");
  const r = (await pool.query("SELECT image FROM pos_menu WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r || !r.image) throw new HttpError(404, "ไม่มีรูป");
  sendDataUrl(res, r.image); return undefined;
});
route("POST", B + "/pos/menu", async ctx => {
  await needPos(ctx, true, "edit");
  const f = posMenuFields(ctx.body || {}), id = uid();
  await pool.query(`INSERT INTO pos_menu (id,branch_id,name,names_json,category,price,types_json,addons_json,daily_limit,soldout,active,image,sort_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13)`,
    [id, ctx.branch.id, f.name, f.names_json, f.category, f.price, f.types_json, f.addons_json, f.daily_limit, f.soldout, f.active, f.image || null, now()]);
  await logActivity(ctx, "pos_menu_add", "เพิ่มเมนู POS " + f.name + " ฿" + f.price, ctx.branch.id);
  return { ok: true, id };
});
route("PUT", B + "/pos/menu/:id", async ctx => {
  await needPos(ctx, true, "edit");
  const cur = (await pool.query("SELECT id, name FROM pos_menu WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0]; if (!cur) throw new HttpError(404, "ไม่พบเมนู");
  const b = ctx.body || {};
  if (Object.keys(b).every(k => ["soldout", "active"].includes(k))) { // สลับ หมด/ขาย หรือ เปิด/ปิด อย่างเดียว
    if (b.soldout !== undefined) await pool.query("UPDATE pos_menu SET soldout=$1 WHERE id=$2", [!!b.soldout, cur.id]);
    if (b.active !== undefined) await pool.query("UPDATE pos_menu SET active=$1 WHERE id=$2", [!!b.active, cur.id]);
    await logActivity(ctx, "pos_menu_toggle", "เมนู " + cur.name + (b.soldout !== undefined ? (b.soldout ? " → หมด" : " → ขายต่อ") : "") + (b.active !== undefined ? (b.active ? " → เปิด" : " → ปิด") : ""), ctx.branch.id);
    return { ok: true };
  }
  const f = posMenuFields(b);
  await pool.query("UPDATE pos_menu SET name=$1,names_json=$2,category=$3,price=$4,types_json=$5,addons_json=$6,daily_limit=$7,soldout=$8,active=$9,updated_at=$10 WHERE id=$11",
    [f.name, f.names_json, f.category, f.price, f.types_json, f.addons_json, f.daily_limit, f.soldout, f.active, now(), cur.id]);
  if (f.image !== undefined) await pool.query("UPDATE pos_menu SET image=$1 WHERE id=$2", [f.image || null, cur.id]);
  await logActivity(ctx, "pos_menu_edit", "แก้ไขเมนู POS " + f.name, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/pos/menu/:id", async ctx => {
  await needPos(ctx, true, "edit");
  const r = (await pool.query("DELETE FROM pos_menu WHERE id=$1 AND branch_id=$2 RETURNING name", [ctx.params.id, ctx.branch.id])).rows[0];
  if (r) await logActivity(ctx, "pos_menu_delete", "ลบเมนู POS " + r.name, ctx.branch.id);
  return { ok: true };
});
// ทำสำเนาเมนู 1 รายการ (อยู่ถัดจากเมนูเดิม)
route("POST", B + "/pos/menu/:id/duplicate", async ctx => {
  await needPos(ctx, true, "edit");
  const m = (await pool.query("SELECT * FROM pos_menu WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0]; if (!m) throw new HttpError(404, "ไม่พบเมนู");
  const id = uid(), t = now(), name = (m.name + " (สำเนา)").slice(0, 150);
  await pool.query(`INSERT INTO pos_menu (id,branch_id,name,names_json,category,price,types_json,addons_json,daily_limit,soldout,active,image,sort_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,$11,$12,$13,$13)`,
    [id, ctx.branch.id, name, m.names_json, m.category, m.price, m.types_json, m.addons_json, m.daily_limit, m.active, m.image, m.sort_order, t]);
  await logActivity(ctx, "pos_menu_add", "ทำสำเนาเมนู POS " + m.name, ctx.branch.id);
  return { ok: true, id };
});
// ผู้ดูแล: คัดลอกเมนูระหว่างสาขา (ไม่ยุ่งกับยอดขาย/ออเดอร์)
route("GET", "/api/admin/pos/menus", async ctx => {
  needAdmin(ctx);
  const counts = {}; (await pool.query("SELECT branch_id, COUNT(*)::int AS c FROM pos_menu GROUP BY branch_id")).rows.forEach(r => { counts[r.branch_id] = r.c; });
  const bid = str(ctx.query.branch, 100); let menu = [];
  if (bid) menu = (await pool.query("SELECT id, name, category, price, active, (image IS NOT NULL AND image<>'') AS has_image FROM pos_menu WHERE branch_id=$1 ORDER BY sort_order, created_at", [bid])).rows.map(r => ({ id: r.id, name: r.name, category: r.category || "", price: Number(r.price), active: r.active, hasImage: r.has_image }));
  return { counts, menu };
});
route("POST", "/api/admin/pos/copy-menu", async ctx => {
  needAdmin(ctx);
  const b = ctx.body || {}, from = str(b.from, 100);
  const src = (await pool.query("SELECT id, name FROM branches WHERE id=$1", [from])).rows[0]; if (!src) throw bad("ไม่พบสาขาต้นทาง");
  const to = [...new Set((Array.isArray(b.to) ? b.to : []).map(x => str(x, 100)).filter(x => x && x !== from))].slice(0, 100);
  if (!to.length) throw bad("กรุณาเลือกสาขาปลายทาง");
  const tgt = (await pool.query("SELECT id, name FROM branches WHERE id IN (" + to.map((x, i) => "$" + (i + 1)).join(",") + ")", to)).rows; if (tgt.length !== to.length) throw bad("ไม่พบสาขาปลายทางบางสาขา");
  let items = (await pool.query("SELECT * FROM pos_menu WHERE branch_id=$1 ORDER BY sort_order, created_at", [from])).rows;
  if (Array.isArray(b.ids)) { const ids = new Set(b.ids.map(String)); items = items.filter(m => ids.has(m.id)); }
  if (!items.length) throw bad("กรุณาเลือกเมนูที่จะคัดลอก");
  const update = b.mode === "update", withImg = b.images !== false, key = n => String(n || "").trim().toLowerCase();
  const result = [];
  {
    for (const t of tgt) {
      const ex = {}; (await pool.query("SELECT id, name FROM pos_menu WHERE branch_id=$1", [t.id])).rows.forEach(r => { ex[key(r.name)] = r.id; });
      let so = Number((await pool.query("SELECT COALESCE(MAX(sort_order),0) AS m FROM pos_menu WHERE branch_id=$1", [t.id])).rows[0].m) || 0;
      let added = 0, updated = 0, skipped = 0; const ts = now();
      for (const m of items) {
        const cur = ex[key(m.name)];
        if (cur) {
          if (!update) { skipped++; continue; }
          await pool.query("UPDATE pos_menu SET names_json=$1,category=$2,price=$3,types_json=$4,addons_json=$5,daily_limit=$6,updated_at=$7" + (withImg && m.image ? ",image=$9" : "") + " WHERE id=$8",
            [m.names_json, m.category, m.price, m.types_json, m.addons_json, m.daily_limit, ts].concat([cur]).concat(withImg && m.image ? [m.image] : []));
          updated++; continue;
        }
        await pool.query(`INSERT INTO pos_menu (id,branch_id,name,names_json,category,price,types_json,addons_json,daily_limit,soldout,active,image,sort_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,$11,$12,$13,$13)`,
          [uid(), t.id, m.name, m.names_json, m.category, m.price, m.types_json, m.addons_json, m.daily_limit, m.active, withImg ? m.image : null, ++so, ts]);
        ex[key(m.name)] = true; added++;
      }
      if (b.cats !== false) { // ลำดับหมวดเมนู
        const sc = await posConfig(from), tc = await posConfig(t.id);
        if ((sc.menuCats || []).length) { tc.menuCats = [...new Set((sc.menuCats || []).concat(tc.menuCats || []))].slice(0, 40); await pool.query("INSERT INTO pos_config (branch_id, data) VALUES ($1,$2) ON CONFLICT (branch_id) DO UPDATE SET data=EXCLUDED.data", [t.id, JSON.stringify(tc)]); }
      }
      result.push({ branchId: t.id, name: t.name, added, updated, skipped });
    }
  }
  for (const r of result) await logActivity(ctx, "pos_menu_copy", "คัดลอกเมนู POS จาก " + src.name + " → " + r.name + " (เพิ่ม " + r.added + (r.updated ? ", อัปเดต " + r.updated : "") + (r.skipped ? ", ข้ามชื่อซ้ำ " + r.skipped : "") + ")", r.branchId);
  return { ok: true, result };
});
route("POST", B + "/pos/menu-order", async ctx => {
  await needPos(ctx, true, "edit");
  const ids = (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(String).slice(0, 500); let n = 0;
  for (const id of ids) await pool.query("UPDATE pos_menu SET sort_order=$1 WHERE id=$2 AND branch_id=$3", [++n, id, ctx.branch.id]);
  return { ok: true };
});
route("PUT", B + "/pos/config", async ctx => {
  await needPos(ctx, true, "edit");
  const c = await posConfig(ctx.branch.id), b = ctx.body || {};
  if (b.qrMode !== undefined) { if (!["none", "promptpay", "merchant"].includes(b.qrMode)) throw bad("รูปแบบ QR ไม่ถูกต้อง"); c.qrMode = b.qrMode; }
  if (b.promptpayId !== undefined) { const v = String(b.promptpayId).replace(/[^0-9]/g, ""); if (v && ![10, 13, 15].includes(v.length)) throw bad("พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร/ผู้เสียภาษี 13 หลัก"); c.promptpayId = v; }
  if (b.merchantTemplate !== undefined) { const v = String(b.merchantTemplate || "").trim(); if (v) checkMerchantTemplate(v); c.merchantTemplate = v; }
  if (c.qrMode === "promptpay" && !c.promptpayId) throw bad("กรุณาใส่เลขพร้อมเพย์");
  if (c.qrMode === "merchant" && !c.merchantTemplate) throw bad("กรุณาใส่ข้อมูล QR ร้านค้า");
  for (const k of ["incomeCategory", "chQr", "chCash", "shopName", "receiptFooter"]) if (b[k] !== undefined) c[k] = str(b[k], 200);
  if (b.autoIncome !== undefined) c.autoIncome = !!b.autoIncome;
  if (Array.isArray(b.menuCats)) c.menuCats = b.menuCats.map(x => str(x, 80)).filter(Boolean).slice(0, 40);
  if (b.newDisplayKey) c.displayKey = crypto.randomBytes(12).toString("hex");
  await posSaveConfig(ctx.branch.id, c);
  await logActivity(ctx, "pos_config", "ตั้งค่า POS" + (b.merchantTemplate !== undefined || b.promptpayId !== undefined || b.qrMode !== undefined ? " (บัญชีรับเงิน QR)" : ""), ctx.branch.id);
  if (b.autoIncome !== undefined) { const days = (await pool.query("SELECT DISTINCT order_date FROM pos_orders WHERE branch_id=$1 AND order_date>=$2", [ctx.branch.id, dayBefore(todayBkk()).slice(0, 8) + "01"])).rows; for (const d of days) await posSyncIncome(ctx, ctx.branch.id, d.order_date); }
  return { ok: true };
});
// อ่าน QR จากรูป (ส่งภาพขาวดำมาจากเครื่อง) — ใช้ได้บน iPhone/iPad ทุกเบราว์เซอร์
route("POST", B + "/pos/qr-decode", async ctx => {
  await needPos(ctx, true, "edit");
  const b = ctx.body || {}, w = Math.floor(num(b.w, 0)), h = Math.floor(num(b.h, 0));
  if (!(w >= 21 && h >= 21 && w <= 2400 && h <= 2400)) throw bad("ขนาดรูปไม่ถูกต้อง");
  const gray = Buffer.from(String(b.gray || ""), "base64");
  if (gray.length !== w * h) throw bad("ข้อมูลรูปไม่ถูกต้อง");
  let text = null;
  try { text = QRLib.decode(gray, w, h); } catch (e) { text = null; }
  if (!text) throw bad("อ่าน QR จากรูปนี้ไม่ได้ — ลองครอปให้เห็น QR ชัดๆ เต็มกรอบ หรือแคปหน้าจอ QR จากแอปธนาคารโดยตรง");
  return posQrInfo(text);
});
route("POST", B + "/pos/qr-info", async ctx => { await needPos(ctx, true, "edit"); const t = String((ctx.body || {}).text || "").slice(0, 2000); if (!t) throw bad("ไม่มีข้อมูล QR"); return posQrInfo(t); });
function posQrInfo(text) {
  text = String(text).trim();
  const out = { text, kind: "other" };
  let top; try { top = qrTlvTop(text); } catch (e) { return out; }
  const get = t => (top.find(x => x.tag === t) || {}).value || "";
  if (text.length > 8 && text.slice(-8, -4) === "6304" && qrCrc16(text.slice(0, -4)) !== text.slice(-4).toUpperCase()) out.crcBad = true;
  out.name = get("59");
  try { out.merchantCode = checkMerchantTemplate(text); out.kind = "merchant"; return out; } catch (e) {}
  const pp = get("29");
  if (pp) { try { const sub = qrTlvTop(pp); const aid = (sub.find(x => x.tag === "00") || {}).value || ""; if (aid.startsWith("A000000677010111")) { const id = sub.find(x => ["01", "02", "03"].includes(x.tag)); if (id) { out.kind = "promptpay"; out.promptpayId = id.tag === "01" ? "0" + id.value.replace(/^0066/, "") : id.value; } } } catch (e) {} }
  return out;
}
// QR สำหรับยอดเงิน + ขึ้นจอลูกค้า
route("POST", B + "/pos/qr", async ctx => {
  await needPos(ctx, false, "edit");
  const c = await posConfig(ctx.branch.id), amount = r2(num(ctx.body.amount, NaN));
  if (!(amount > 0)) throw bad("ยอดเงินไม่ถูกต้อง");
  const payload = posQrPayload(c, amount); if (!payload) throw bad("ยังไม่ได้ตั้งค่าบัญชีรับเงิน QR — ตั้งได้ที่ POS → ตั้งค่า");
  const svg = QRLib.svg(payload, { margin: 2 });
  posDisplay[ctx.branch.id] = { mode: "pay", amount, svg, at: now() };
  return { svg, payload };
});
route("POST", B + "/pos/display", async ctx => {
  await needPos(ctx, false, "edit");
  const b = ctx.body || {};
  if (b.mode === "cart") posDisplay[ctx.branch.id] = { mode: "cart", amount: r2(num(b.amount, 0)), items: (Array.isArray(b.items) ? b.items : []).slice(0, 30).map(i => ({ name: str(i.name, 120), qty: num(i.qty, 1), total: r2(num(i.total, 0)) })), at: now() };
  else if (b.mode === "done") posDisplay[ctx.branch.id] = { mode: "done", queueNo: str(b.queueNo, 10), amount: r2(num(b.amount, 0)), change: b.change == null ? null : r2(num(b.change, 0)), at: now() };
  else posDisplay[ctx.branch.id] = { mode: "idle", at: now() };
  return { ok: true };
});
// หน้าจอลูกค้า (สาธารณะ ใช้กุญแจลับของสาขา)
route("GET", "/api/pos-display/:key", async ctx => {
  const key = str(ctx.params.key, 64); if (!key) throw new HttpError(404, "ไม่พบ");
  const r = (await pool.query("SELECT branch_id FROM pos_config WHERE data LIKE $1", ["%\"displayKey\":\"" + key.replace(/[^a-f0-9]/g, "") + "\"%"])).rows[0];
  if (!r) throw new HttpError(404, "ลิงก์หน้าจอลูกค้าไม่ถูกต้อง หรือถูกเปลี่ยนแล้ว");
  const b = (await pool.query("SELECT id, name, logo, color, pos_enabled FROM branches WHERE id=$1", [r.branch_id])).rows[0];
  if (!b || !b.pos_enabled) throw new HttpError(404, "สาขานี้ปิด POS อยู่");
  const c = await posConfig(b.id); let st = posDisplay[b.id] || { mode: "idle" };
  if (st.mode === "done" && now() - st.at > 20000) st = { mode: "idle" };
  if (st.mode === "pay" && now() - st.at > 10 * 60000) st = { mode: "idle" };
  return { shop: c.shopName || b.name, logo: b.logo || "", color: b.color || "", state: st, queue: await posQueueLists(b.id), time: now() };
});
// รับชำระ → สร้างออเดอร์ + เลขคิว
route("POST", B + "/pos/orders", async ctx => {
  await needPos(ctx, false, "edit");
  const b = ctx.body || {}, c = await posConfig(ctx.branch.id), day = todayBkk();
  const menu = (await pool.query("SELECT * FROM pos_menu WHERE branch_id=$1", [ctx.branch.id])).rows;
  const sold = await posSoldToday(ctx.branch.id, day), need = {};
  const raw = (Array.isArray(b.items) ? b.items : []).slice(0, 100); if (!raw.length) throw bad("ยังไม่มีรายการในตะกร้า");
  const items = [];
  for (const l of raw) {
    const m = menu.find(x => x.id === l.menuId); if (!m || !m.active) throw bad("เมนูบางรายการถูกปิดไปแล้ว — โหลดหน้าใหม่");
    if (m.soldout) throw bad(m.name + " หมดแล้ว");
    const qty = Math.floor(num(l.qty, 0)); if (qty < 1 || qty > 999) throw bad("จำนวนไม่ถูกต้อง (" + m.name + ")");
    const types = posJson(m.types_json, []), addonsDef = posJson(m.addons_json, []);
    let unit = Number(m.price), typeName = "";
    if (types.length) { const t = types.find(x => x.name === l.type) || types[0]; unit = Number(t.price); typeName = t.name; }
    const addons = (Array.isArray(l.addons) ? l.addons : []).map(a => { const d = addonsDef.find(x => x.name === (a && a.name)); const q = Math.floor(num(a && a.qty, 0)); return d && q > 0 ? { name: d.name, price: Number(d.price), qty: q } : null; }).filter(Boolean);
    const lineTotal = r2(unit * qty + addons.reduce((s, a) => s + a.price * a.qty, 0));
    need[m.id] = (need[m.id] || 0) + qty;
    if (m.daily_limit != null && (sold[m.id] || 0) + need[m.id] > Number(m.daily_limit)) { const left = Math.max(0, Number(m.daily_limit) - (sold[m.id] || 0)); throw bad(m.name + (left ? " เหลือขายได้อีก " + left : " ขายครบจำนวนวันนี้แล้ว")); }
    items.push({ menuId: m.id, name: m.name, type: typeName, price: unit, qty, addons, note: str(l.note, 200), total: lineTotal });
  }
  const subtotal = r2(items.reduce((s, i) => s + i.total, 0));
  const discount = r2(Math.min(subtotal, Math.max(0, num(b.discount, 0)))), total = r2(subtotal - discount);
  const method = ["qr", "cash", "other"].includes(b.payMethod) ? b.payMethod : "cash";
  const ch = (await pool.query("SELECT name, is_credit FROM lists WHERE branch_id=$1 AND kind='payment_channel' ORDER BY sort_order", [ctx.branch.id])).rows.filter(x => !x.is_credit).map(x => x.name);
  let channel = method === "qr" ? (c.chQr || ch.find(n => /โอน|พร้อมเพย์|QR|ธนาคาร/i.test(n)) || ch[0]) : method === "cash" ? (c.chCash || ch.find(n => /สด/.test(n)) || ch[0]) : str(b.payChannel, 120);
  if (!channel || !ch.includes(channel)) throw bad("กรุณาเลือกช่องทางรับเงิน (ตั้งช่องทางได้ที่ “หมวด & ช่องทาง”)");
  let cash = null, change = null;
  if (method === "cash" && b.cashReceived !== "" && b.cashReceived != null) { cash = r2(num(b.cashReceived, NaN)); if (!(cash >= total)) throw bad("รับเงินมาไม่พอ"); change = r2(cash - total); }
  const slip = b.slip ? checkImg(b.slip, 1500000) : null;
  const q = (await pool.query("INSERT INTO pos_counters (branch_id, day, n) VALUES ($1,$2,1) ON CONFLICT (branch_id, day) DO UPDATE SET n=pos_counters.n+1 RETURNING n", [ctx.branch.id, day])).rows[0].n;
  const queueNo = String(q).padStart(3, "0"), id = uid();
  await pool.query(`INSERT INTO pos_orders (id,branch_id,queue_no,order_date,items_json,subtotal,discount,total,status,pay_method,pay_channel,cash_received,change_amount,slip,note,created_by,created_at,refund_amount)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9,$10,$11,$12,$13,$14,$15,$16,0)`, [id, ctx.branch.id, queueNo, day, JSON.stringify(items), subtotal, discount, total, method, channel, cash, change, slip, str(b.note, 300), ctx.session.actor, now()]);
  await posSyncIncome(ctx, ctx.branch.id, day);
  posDisplay[ctx.branch.id] = { mode: "done", queueNo, amount: total, change, at: now() };
  await logActivity(ctx, "pos_sale", "ขาย POS คิว " + queueNo + " ฿" + total.toFixed(2) + " · " + channel + " · " + items.map(i => i.name + "×" + i.qty).slice(0, 4).join(", "), ctx.branch.id);
  const o = (await pool.query("SELECT " + POS_ORDER_COLS + " FROM pos_orders WHERE id=$1", [id])).rows[0];
  return { ok: true, order: posOrderOut(o) };
});
route("GET", B + "/pos/orders", async ctx => {
  await needPos(ctx, false, "view");
  const from = isDate(ctx.query.from) ? ctx.query.from : todayBkk(), to = isDate(ctx.query.to) ? ctx.query.to : from;
  const st = str(ctx.query.status, 20);
  const params = [ctx.branch.id, from, to]; let w = "branch_id=$1 AND order_date BETWEEN $2 AND $3";
  if (st) { params.push(st); w += " AND status=$" + params.length; }
  const { rows } = await pool.query("SELECT " + POS_ORDER_COLS + " FROM pos_orders WHERE " + w + " ORDER BY created_at DESC LIMIT 2000", params);
  return { orders: rows.map(posOrderOut) };
});
route("GET", B + "/pos/orders/:id/slip", async (ctx, req, res) => {
  await needPos(ctx, false, "view");
  const r = (await pool.query("SELECT slip FROM pos_orders WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r || !r.slip) throw new HttpError(404, "ไม่มีสลิป");
  sendDataUrl(res, r.slip); return undefined;
});
async function posOrderFor(ctx) {
  const o = (await pool.query("SELECT * FROM pos_orders WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!o) throw new HttpError(404, "ไม่พบออเดอร์"); return o;
}
route("POST", B + "/pos/orders/:id/prepared", async ctx => {
  await needPos(ctx, false, "edit"); const o = await posOrderFor(ctx);
  if (o.status !== "paid") throw bad("ออเดอร์นี้ไม่ได้รอทำ");
  await pool.query("UPDATE pos_orders SET status='prepared', prepared_at=$1, prepared_by=$2 WHERE id=$3", [now(), ctx.session.actor, o.id]);
  return { ok: true };
});
route("POST", B + "/pos/orders/:id/unprepare", async ctx => {
  await needPos(ctx, false, "edit"); const o = await posOrderFor(ctx);
  if (o.status !== "prepared") throw bad("ออเดอร์นี้ยังไม่เสร็จ");
  await pool.query("UPDATE pos_orders SET status='paid', prepared_at=NULL, prepared_by=NULL WHERE id=$1", [o.id]);
  return { ok: true };
});
// ยกเลิกบิล (คืนเงินเต็ม) หรือคืนเงินบางส่วน — ยอดรายรับวันนั้นปรับให้อัตโนมัติ
route("POST", B + "/pos/orders/:id/cancel", async ctx => {
  await needPos(ctx, false, "edit"); const o = await posOrderFor(ctx), b = ctx.body || {};
  if (!["paid", "prepared", "refunded"].includes(o.status)) throw bad("ออเดอร์นี้ยกเลิกไปแล้ว");
  if (o.order_date !== todayBkk() && !can(ctx, "pos_admin", "edit")) throw new HttpError(403, "ยกเลิก/คืนเงินบิลของวันก่อนได้เฉพาะผู้ดูแล POS");
  const reason = str(b.reason, 300); if (!reason) throw bad("กรุณาใส่เหตุผล");
  const total = Number(o.total), partial = b.amount !== undefined && b.amount !== "" && b.amount != null;
  if (partial) {
    const amt = r2(num(b.amount, NaN)), done = Number(o.refund_amount) || 0;
    if (!(amt > 0) || amt + done > total + 1e-9) throw bad("ยอดคืนเงินต้องมากกว่า 0 และไม่เกิน " + r2(total - done).toFixed(2));
    const full = Math.abs(amt + done - total) < 0.005;
    await pool.query("UPDATE pos_orders SET refund_amount=$1, status=$2, cancel_reason=$3, cancelled_by=$4, cancelled_at=$5 WHERE id=$6", [r2(amt + done), full ? "cancelled" : "refunded", reason, ctx.session.actor, now(), o.id]);
    await logActivity(ctx, "pos_refund", "คืนเงิน POS คิว " + o.queue_no + " ฿" + amt.toFixed(2) + " (" + reason + ")", ctx.branch.id);
  } else {
    await pool.query("UPDATE pos_orders SET status='cancelled', refund_amount=total, cancel_reason=$1, cancelled_by=$2, cancelled_at=$3 WHERE id=$4", [reason, ctx.session.actor, now(), o.id]);
    await logActivity(ctx, "pos_cancel", "ยกเลิกบิล POS คิว " + o.queue_no + " ฿" + total.toFixed(2) + " (" + reason + ")", ctx.branch.id);
  }
  await posSyncIncome(ctx, ctx.branch.id, o.order_date);
  return { ok: true };
});
route("GET", B + "/pos/report", async ctx => {
  await needPos(ctx, false, "view");
  const { from, to } = rangeOf(ctx.query);
  const { rows } = await pool.query("SELECT order_date, items_json, total, refund_amount, status, pay_channel, created_at FROM pos_orders WHERE branch_id=$1 AND order_date BETWEEN $2 AND $3", [ctx.branch.id, from, to]);
  const ok = rows.filter(r => r.status !== "cancelled");
  const days = {}, menus = {}, chs = {}, hours = {};
  let gross = 0, refunds = 0, bills = 0;
  for (const r of ok) {
    const net = Number(r.total) - (Number(r.refund_amount) || 0); gross += Number(r.total); refunds += Number(r.refund_amount) || 0; bills++;
    const d = days[r.order_date] = days[r.order_date] || { date: r.order_date, bills: 0, total: 0 }; d.bills++; d.total += net;
    const c = chs[r.pay_channel] = chs[r.pay_channel] || { name: r.pay_channel, bills: 0, total: 0 }; c.bills++; c.total += net;
    const h = new Date(Number(r.created_at) + 7 * 3600000).getUTCHours(); hours[h] = (hours[h] || 0) + net;
    posJson(r.items_json, []).forEach(i => { const m = menus[i.name] = menus[i.name] || { name: i.name, qty: 0, total: 0 }; m.qty += Number(i.qty) || 0; m.total += Number(i.total) || 0; });
  }
  const cancelled = rows.filter(r => r.status === "cancelled");
  const R = o => Object.values(o).map(x => ({ ...x, total: r2(x.total) }));
  return { from, to, bills, gross: r2(gross), refunds: r2(refunds), net: r2(gross - refunds), avgBill: bills ? r2((gross - refunds) / bills) : 0,
    cancelled: { bills: cancelled.length, total: r2(cancelled.reduce((a, r) => a + Number(r.total), 0)) },
    days: R(days).sort((a, b) => a.date.localeCompare(b.date)), menus: R(menus).sort((a, b) => b.total - a.total), channels: R(chs).sort((a, b) => b.total - a.total),
    hours: Object.keys(hours).map(h => ({ hour: Number(h), total: r2(hours[h]) })).sort((a, b) => a.hour - b.hour) };
});
// นำเข้าเมนู + บัญชี QR จาก POS เดิม (ลิงก์ของระบบ POS-Restaurant)
route("POST", B + "/pos/import", async ctx => {
  await needPos(ctx, true, "edit");
  let base = String(ctx.body.url || "").trim().replace(/\/+$/, "").replace(/#.*$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(base)) base = "https://" + base.replace(/^\/+/, "");
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) throw bad("ลิงก์ไม่ถูกต้อง — ใส่เฉพาะชื่อเว็บ เช่น pos-restaurant-production.up.railway.app");
  const get = async p => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
    try { const r = await fetch(base + p, { signal: ac.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); } catch (e) { throw bad("เปิด " + base + p + " ไม่ได้: " + e.message); } finally { clearTimeout(t); } };
  const [st, menu] = await Promise.all([get("/api/settings"), get("/api/menu")]);
  if (!Array.isArray(menu)) throw bad("ลิงก์นี้ไม่ใช่ระบบ POS เดิม");
  const existing = new Set((await pool.query("SELECT lower(name) AS n FROM pos_menu WHERE branch_id=$1", [ctx.branch.id])).rows.map(r => r.n));
  let added = 0, skipped = 0, n = now();
  for (const m of menu) {
    const name = str(m.name, 150); if (!name || existing.has(name.toLowerCase())) { skipped++; continue; }
    const types = (Array.isArray(m.types) ? m.types : []).map(t => ({ name: str(t.name, 100), price: r2(num(t.price, 0)) })).filter(t => t.name);
    const addons = (Array.isArray(m.addons) ? m.addons : []).map(t => ({ name: str(t.name, 100), price: r2(num(t.price, 0)) })).filter(t => t.name);
    let img = null; if (m.imageUrl && /^data:image\//.test(m.imageUrl) && m.imageUrl.length < 700000) img = m.imageUrl;
    const single = types.length === 1 && /ธรรมดา/.test(types[0].name);
    await pool.query(`INSERT INTO pos_menu (id,branch_id,name,names_json,category,price,types_json,addons_json,daily_limit,soldout,active,image,sort_order,created_at,updated_at) VALUES ($1,$2,$3,'{}','',$4,$5,$6,NULL,FALSE,$7,$8,$9,$9,$9)`,
      [uid(), ctx.branch.id, name, r2(num(single ? types[0].price : (types[0] ? Math.min(...types.map(t => t.price)) : m.price), 0)), JSON.stringify(single ? [] : types), JSON.stringify(addons), m.active !== false, img, n + (added++)]);
  }
  const c = await posConfig(ctx.branch.id); let qr = "";
  if (st && st.qrMode === "merchant" && st.qrMerchantTemplate) { try { checkMerchantTemplate(st.qrMerchantTemplate); c.qrMode = "merchant"; c.merchantTemplate = st.qrMerchantTemplate; qr = "QR ร้านค้า"; } catch (e) {} }
  else if (st && st.qrId) { c.qrMode = "promptpay"; c.promptpayId = String(st.qrId).replace(/[^0-9]/g, ""); qr = "พร้อมเพย์ " + c.promptpayId; }
  if (st && st.shopName && !c.shopName) c.shopName = str(st.shopName, 200);
  await posSaveConfig(ctx.branch.id, c);
  await logActivity(ctx, "pos_import", "นำเข้าจาก POS เดิม " + base + ": เมนู " + added + " รายการ" + (qr ? " + " + qr : ""), ctx.branch.id);
  return { ok: true, added, skipped, qr };
});

/* ---------------- ธุรกิจ (v2.9) ---------------- */
function bizOut(r) { return { id: r.id, name: r.name, address: r.address || "", taxId: r.tax_id || "", phone: r.phone || "", logo: r.logo || "", kind: r.kind || "", createdAt: Number(r.created_at) }; }
async function bizOfBranch(bid) {
  const r = (await pool.query("SELECT z.* FROM businesses z JOIN branches b ON b.business_id=z.id WHERE b.id=$1", [bid])).rows[0];
  return r || (await pool.query("SELECT * FROM businesses ORDER BY sort_order, created_at LIMIT 1")).rows[0];
}
const companyOfBiz = z => ({ name: z.name, address: z.address || "", taxId: z.tax_id || "", phone: z.phone || "", logo: z.logo || "", businessId: z.id });
/* ---------------- public ---------------- */
route("GET", "/api/health", async () => {
  const r = await pool.query("SELECT 1 AS ok"); return { ok: true, connected: Number(r.rows[0].ok) === 1, build: BUILD_ID };
});
route("GET", "/api/public/info", async () => {
  const { rows } = await pool.query("SELECT id, code, name, color, logo, business_id AS \"businessId\" FROM branches WHERE active=TRUE ORDER BY sort_order, created_at");
  const biz = (await pool.query("SELECT id, name, logo FROM businesses ORDER BY sort_order, created_at")).rows;
  const main = biz[0] || { name: "", logo: "" };
  return { company: { name: main.name, logo: main.logo || "" }, businesses: biz.filter(z => rows.some(b => b.businessId === z.id)).map(z => ({ id: z.id, name: z.name, logo: z.logo || "" })), branches: rows, build: BUILD_ID };
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
// ผู้ใช้ตั้งรูปโปรไฟล์ของตัวเอง (v2.8)
route("POST", "/api/user/photo", async ctx => {
  const s = ctx.session;
  if (!s || s.kind !== "user") throw new HttpError(401, "กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้");
  const v = checkImg(ctx.body && ctx.body.photo, 300000);
  await pool.query("UPDATE users SET photo=$1 WHERE id=$2", [v || null, s.user_id]);
  return { ok: true };
});
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
  return { branch: { id: b.id, code: b.code, name: b.name, address: b.address, phone: b.phone, taxId: b.tax_id, color: b.color, logo: b.logo || "",
      checkin: { enabled: !!b.checkin_enabled, lat: b.checkin_lat, lng: b.checkin_lng, radius: Number(b.checkin_radius) || 100, workStart: b.work_start || "09:00", lateGrace: Number(b.late_grace) || 0 } },
    company: companyOfBiz(await bizOfBranch(b.id)), posEnabled: !!b.pos_enabled,
    sso: { rate: num(s.sso_rate, 5), min: num(s.sso_min, 1650), max: num(s.sso_max, 17500) }, isAdmin: !!ss.isAdmin,
    me: { kind: ss.kind, name: ss.kind === "user" ? (ss.user_name || ss.user_username) : ss.isAdmin ? (ss.admin_name || ss.username) : "ผู้จัดการสาขา",
      username: ss.user_username || ss.username || "", mustChange: !!(ss.kind === "user" && ss.user_must_change),
      photo: ss.kind === "user" ? ((await pool.query("SELECT photo FROM users WHERE id=$1", [ss.user_id])).rows[0] || {}).photo || "" : "",
      canPhoto: ss.kind === "user" },
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
  return { id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone, taxId: r.tax_id, color: r.color, active: r.active, logo: r.logo || "", businessId: r.business_id || "", posEnabled: !!r.pos_enabled,
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
route("GET", "/api/admin/businesses", async ctx => {
  needAdmin(ctx);
  const { rows } = await pool.query("SELECT z.*, (SELECT COUNT(*)::int FROM branches b WHERE b.business_id=z.id) AS n FROM businesses z ORDER BY sort_order, created_at");
  return { businesses: rows.map(r => ({ ...bizOut(r), branchCount: Number(r.n) || 0 })) };
});
function bizFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อธุรกิจ");
  return { name, address: str(b.address, 400), tax_id: str(b.taxId, 30), phone: str(b.phone, 40), kind: str(b.kind, 40), logo: b.logo === undefined ? undefined : checkImg(b.logo, 1500000) };
}
route("POST", "/api/admin/businesses", async ctx => {
  needAdmin(ctx);
  const f = bizFields(ctx.body || {}), id = uid();
  await pool.query("INSERT INTO businesses (id,name,address,tax_id,phone,logo,kind,sort_order,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)", [id, f.name, f.address, f.tax_id, f.phone, f.logo || null, f.kind, now()]);
  await logActivity(ctx, "biz_add", "สร้างธุรกิจ " + f.name);
  return { ok: true, id };
});
route("PUT", "/api/admin/businesses/:id", async ctx => {
  needAdmin(ctx);
  const cur = (await pool.query("SELECT * FROM businesses WHERE id=$1", [ctx.params.id])).rows[0]; if (!cur) throw new HttpError(404, "ไม่พบธุรกิจ");
  const f = bizFields(ctx.body || {});
  await pool.query("UPDATE businesses SET name=$1,address=$2,tax_id=$3,phone=$4,kind=$5 WHERE id=$6", [f.name, f.address, f.tax_id, f.phone, f.kind, cur.id]);
  if (f.logo !== undefined) await pool.query("UPDATE businesses SET logo=$1 WHERE id=$2", [f.logo || null, cur.id]);
  await logActivity(ctx, "biz_edit", "แก้ไขธุรกิจ " + f.name);
  return { ok: true };
});
route("DELETE", "/api/admin/businesses/:id", async ctx => {
  needAdmin(ctx);
  const cur = (await pool.query("SELECT * FROM businesses WHERE id=$1", [ctx.params.id])).rows[0]; if (!cur) throw new HttpError(404, "ไม่พบธุรกิจ");
  const n = Number((await pool.query("SELECT COUNT(*)::int AS c FROM branches WHERE business_id=$1", [cur.id])).rows[0].c);
  if (n) throw bad("ธุรกิจนี้ยังมี " + n + " สาขา — ย้ายหรือลบสาขาก่อน");
  if (Number((await pool.query("SELECT COUNT(*)::int AS c FROM businesses")).rows[0].c) <= 1) throw bad("ต้องมีอย่างน้อย 1 ธุรกิจ");
  await pool.query("DELETE FROM businesses WHERE id=$1", [cur.id]);
  await logActivity(ctx, "biz_delete", "ลบธุรกิจ " + cur.name);
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
  return { name, code: str(b.code, 20), address: str(b.address, 400), phone: str(b.phone, 40), tax_id: str(b.taxId, 30), color, logo: b.logo === undefined ? undefined : checkImg(b.logo, 400000) };
}
route("POST", "/api/admin/branches", async ctx => {
  needAdmin(ctx);
  const f = branchFields(ctx.body); const pw = checkNewPassword(ctx.body.password);
  const id = uid();
  const bz = (await pool.query("SELECT id FROM businesses WHERE id=$1", [str(ctx.body.businessId, 100)])).rows[0] || (await pool.query("SELECT id FROM businesses ORDER BY sort_order, created_at LIMIT 1")).rows[0];
  let copyFrom = str(ctx.body.copyFrom, 100) || null;
  if (copyFrom) { const cb = (await pool.query("SELECT business_id FROM branches WHERE id=$1", [copyFrom])).rows[0]; if (!cb || cb.business_id !== bz.id) copyFrom = null; } // ธุรกิจใหม่ = เริ่มหมวดมาตรฐาน ไม่คัดลอกข้ามธุรกิจ
  if (!copyFrom) { const sib = (await pool.query("SELECT id FROM branches WHERE business_id=$1 ORDER BY sort_order, created_at LIMIT 1", [bz.id])).rows[0]; if (sib && (await getSettings()).lists_sync_all === "1") copyFrom = sib.id; }
  await pool.query("INSERT INTO branches (id,code,name,address,phone,tax_id,color,pass_hash,active,sort_order,created_at,pass_changed_at,business_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$9,$9,$10)",
    [id, f.code, f.name, f.address, f.phone, f.tax_id, f.color, hashPw(pw), now(), bz.id]);
  if (f.logo) await pool.query("UPDATE branches SET logo=$1 WHERE id=$2", [f.logo, id]);
  if (ctx.body.posEnabled) await pool.query("UPDATE branches SET pos_enabled=TRUE WHERE id=$1", [id]);
  await seedLists(id, copyFrom);
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
  if (f.logo !== undefined) await pool.query("UPDATE branches SET logo=$1 WHERE id=$2", [f.logo || null, ctx.params.id]);
  if (ctx.body.posEnabled !== undefined && !!ctx.body.posEnabled !== !!cur.rows[0].pos_enabled) {
    await pool.query("UPDATE branches SET pos_enabled=$1 WHERE id=$2", [!!ctx.body.posEnabled, ctx.params.id]);
    await logActivity(ctx, "pos_toggle", (ctx.body.posEnabled ? "เปิด" : "ปิด") + "ใช้ระบบ POS สาขา " + f.name, ctx.params.id);
  }
  if (ctx.body.businessId && ctx.body.businessId !== cur.rows[0].business_id) {
    const bz = (await pool.query("SELECT id, name FROM businesses WHERE id=$1", [str(ctx.body.businessId, 100)])).rows[0]; if (!bz) throw bad("ไม่พบธุรกิจ");
    await pool.query("UPDATE branches SET business_id=$1 WHERE id=$2", [bz.id, ctx.params.id]);
    await logActivity(ctx, "branch_move_biz", "ย้ายสาขา " + f.name + " ไปธุรกิจ " + bz.name, ctx.params.id);
  }
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
  for (const t of ["files", "records", "lists", "stock_moves", "stock_items", "payroll_items", "payroll_runs", "employees", "doc_counters", "sessions", "transfers", "leaves", "advances", "attendance", "card_plans", "emp_files", "shop_items", "purchase_orders", "pos_config", "pos_menu", "pos_orders", "pos_counters"]) {
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
  const biz = str(ctx.query.biz, 100);
  const br = await pool.query("SELECT id, code, name, color, active, logo, business_id FROM branches" + (biz ? " WHERE business_id=$1" : "") + " ORDER BY sort_order, created_at", biz ? [biz] : []);
  const sums = await pool.query(`SELECT branch_id, type, SUM(total)::float AS s, COUNT(*)::int AS c FROM records WHERE rec_date BETWEEN $1 AND $2 GROUP BY branch_id, type`, [from, to]);
  const stock = await pool.query(`SELECT branch_id, SUM(qty*avg_cost)::float AS v, SUM(CASE WHEN active AND qty<=min_qty AND min_qty>0 THEN 1 ELSE 0 END)::int AS low FROM stock_items GROUP BY branch_id`);
  const emp = await pool.query(`SELECT branch_id, COUNT(*)::int AS c FROM employees WHERE active=TRUE GROUP BY branch_id`);
  const due = await pool.query(`SELECT branch_id, type, SUM(total)::float AS s FROM records WHERE due_date IS NOT NULL AND due_date<>'' AND settled_at IS NULL GROUP BY branch_id, type`);
  const months = eachMonth(from, to);
  const monthly = await pool.query(`SELECT branch_id, substr(rec_date,1,7) AS m, type, SUM(total)::float AS s FROM records WHERE rec_date BETWEEN $1 AND $2 GROUP BY branch_id, m, type`, [from, to]);
  const adjs = {}; for (const b of br.rows) adjs[b.id] = await stockAdjust(b.id, from, to);
  const out = br.rows.map(b => {
    const g = t => r2(sums.rows.filter(x => x.branch_id === b.id && x.type === t).reduce((a, x) => a + Number(x.s), 0));
    const st = stock.rows.find(x => x.branch_id === b.id) || {};
    const income = g("income"), expense = g("expense"), invest = g("invest");
    const sa = adjs[b.id];
    return { id: b.id, code: b.code, name: b.name, color: b.color, logo: b.logo || "", businessId: b.business_id, active: b.active, income, expense, invest, cashNet: r2(income - expense), stockAdj: sa.adj, net: r2(income - expense + sa.adj),
      stockValue: r2(st.v), lowStock: Number(st.low) || 0, employees: Number((emp.rows.find(x => x.branch_id === b.id) || {}).c) || 0,
      payable: r2((due.rows.find(x => x.branch_id === b.id && x.type !== "income") || {}).s), receivable: r2((due.rows.find(x => x.branch_id === b.id && x.type === "income") || {}).s),
      monthly: months.map(m => { const f = t => r2(monthly.rows.filter(x => x.branch_id === b.id && x.m === m && x.type === t).reduce((a, x) => a + Number(x.s), 0)); return { m, income: f("income"), expense: f("expense") }; }) };
  });
  const tot = k => r2(out.reduce((a, x) => a + x[k], 0));
  return { from, to, branches: out, months, totals: { income: tot("income"), expense: tot("expense"), invest: tot("invest"), net: tot("net"), cashNet: tot("cashNet"), stockAdj: tot("stockAdj"), stockValue: tot("stockValue"), employees: out.reduce((a, x) => a + x.employees, 0) } };
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
  for (const t of ["settings", "admins", "users", "businesses", "branches", "lists", "records", "doc_counters", "stock_items", "stock_moves", "employees", "payroll_runs", "payroll_items", "transfers", "leaves", "advances", "attendance", "card_plans", "activity", "emp_files", "shop_items", "purchase_orders", "pos_config", "pos_menu", "pos_orders", "pos_counters", "files"]) {
    if (t === "emp_files" && !withFiles) { out.tables.emp_files = (await pool.query("SELECT id, branch_id, employee_id, doc_type, filename, mime, size, created_at FROM emp_files")).rows; continue; }
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
  // ใช้หมวด/รายการร่วมกันเฉพาะสาขาใน "ธุรกิจเดียวกัน" (v2.9)
  return (await pool.query("SELECT id FROM branches WHERE business_id=(SELECT business_id FROM branches WHERE id=$1) ORDER BY sort_order, created_at", [bid])).rows.map(r => r.id);
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
        await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,photo,units,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$10,$11,$11)",
          [uid(), tid, it.sku, it.name, it.category, it.unit, it.min_qty, it.note, it.photo || null, it.units || null, now()]);
        res.stockAdded++;
      }
    }
    result.push(res);
    await logActivity(ctx, "list_copy", "คัดลอกหมวด/ช่องทางจาก " + src.name + " ไป " + res.branch + ": เพิ่ม " + res.added + ", ปรับ " + res.updated + (b.removeExtra ? ", ลบ " + res.removed : "") + (b.stockItems ? ", สินค้าสต็อกใหม่ " + res.stockAdded : ""), tid);
  }
  return { ok: true, from: src.name, result };
});

// Admin: เลือกสินค้าสต็อกทีละรายการ คัดลอกไปสาขาอื่น (เฉพาะรายละเอียด — ไม่คัดลอกจำนวน/ต้นทุน) (v2.6)
route("GET", "/api/admin/stock/items", async ctx => {
  needAdmin(ctx);
  const bid = str(ctx.query.branch, 100);
  const { rows } = await pool.query(`SELECT id, sku, name, category, unit, min_qty, active, updated_at, (photo IS NOT NULL AND photo<>'') AS has_photo
    FROM stock_items WHERE branch_id=$1 ORDER BY category, name`, [bid]);
  return { items: rows.map(r => ({ id: r.id, sku: r.sku || "", name: r.name, category: r.category || "", unit: r.unit || "", minQty: Number(r.min_qty) || 0, active: r.active, hasPhoto: !!r.has_photo })) };
});
route("POST", "/api/admin/stock/copy", async ctx => {
  needAdmin(ctx);
  const b = ctx.body || {};
  const from = str(b.from, 100);
  const all = (await pool.query("SELECT id, name FROM branches ORDER BY sort_order, created_at")).rows;
  const src = all.find(x => x.id === from); if (!src) throw bad("กรุณาเลือกสาขาต้นทาง");
  const targets = (b.to === "all" ? all.map(x => x.id) : (Array.isArray(b.to) ? b.to.map(String) : [])).filter(id => id !== from && all.some(x => x.id === id));
  if (!targets.length) throw bad("กรุณาเลือกสาขาปลายทางอย่างน้อย 1 สาขา");
  const ids = Array.isArray(b.itemIds) ? b.itemIds.map(String).slice(0, 2000) : [];
  if (!ids.length) throw bad("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
  const items = (await pool.query("SELECT * FROM stock_items WHERE branch_id=$1 AND id = ANY($2::text[]) ORDER BY category, name", [from, pgArr(ids)])).rows;
  if (!items.length) throw bad("ไม่พบสินค้าที่เลือก");
  const withPhoto = b.withPhoto !== false, update = !!b.updateExisting;
  const result = [];
  for (const tid of targets) {
    const res = { branch: all.find(x => x.id === tid).name, added: 0, updated: 0, skipped: 0 };
    const cats = new Set((await pool.query("SELECT name FROM lists WHERE branch_id=$1 AND kind='stock_category'", [tid])).rows.map(r => r.name));
    for (const it of items) {
      if (it.category && !cats.has(it.category)) { // หมวดใหม่ → เพิ่ม (ถ้าตั้งให้ใช้หมวดร่วมกันทุกสาขา จะเพิ่มให้ทุกสาขา)
        await listOpAll(await syncBranchIds(tid), "add", "stock_category", { name: it.category });
        cats.add(it.category);
      }
      const ex = (await pool.query("SELECT id FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [tid, it.name])).rows[0];
      if (ex) {
        if (!update) { res.skipped++; continue; }
        await pool.query("UPDATE stock_items SET sku=$1, category=$2, unit=$3, min_qty=$4, note=$5, units=$6, updated_at=$7 WHERE id=$8", [it.sku, it.category, it.unit, it.min_qty, it.note, it.units, now(), ex.id]);
        if (withPhoto && it.photo) await pool.query("UPDATE stock_items SET photo=$1 WHERE id=$2", [it.photo, ex.id]);
        res.updated++; continue;
      }
      await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,photo,units,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$10,$11,$11)",
        [uid(), tid, it.sku, it.name, it.category, it.unit, it.min_qty, it.note, withPhoto ? (it.photo || null) : null, it.units || null, now()]);
      res.added++;
    }
    result.push(res);
    await logActivity(ctx, "stock_copy", "คัดลอกสินค้าสต็อก " + items.length + " รายการ จาก " + src.name + " ไป " + res.branch + ": เพิ่ม " + res.added + (update ? ", อัปเดต " + res.updated : ", ข้าม (มีแล้ว) " + res.skipped), tid);
  }
  return { ok: true, from: src.name, count: items.length, result };
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
    updatedBy: r.updated_by || "", updatedAt: Number(r.updated_at) || null, planId: r.plan_id || "", planSeq: r.plan_seq || null, planCount: r.plan_count || null, settleBatch: r.settle_batch || "", files: files || [], fileCount: r.file_count != null ? Number(r.file_count) : (files || []).length, thumbId: r.thumb_id || "" };
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
  const { rows } = await pool.query(`SELECT r.*, (SELECT COUNT(*) FROM files f WHERE f.record_id=r.id)::int AS file_count,
    (SELECT id FROM files f WHERE f.record_id=r.id AND f.mime LIKE 'image/%' ORDER BY f.created_at LIMIT 1) AS thumb_id FROM records r WHERE ${where} ORDER BY r.rec_date DESC, r.created_at DESC LIMIT 2000`, params);
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
      const si = await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [it.stockItemId, ctx.branch.id]);
      if (!si.rows[0]) continue;
      const amount = r2(it.amount * ratio);
      const uf = unitFactor(si.rows[0], it.unit, false); // หน่วยในบรรทัดตรงกับหน่วยอื่นของสินค้า (เช่น ถุง) → แปลงเป็นหน่วยหลัก
      const bq = r4(it.qty * uf.f);
      await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,unit_cost,amount,note,ref_record_id,created_by,created_at,in_unit,in_qty,in_price)
        VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [uid(), ctx.branch.id, it.stockItemId, rec.date, bq, r4(amount / bq), amount, "ซื้อเข้า " + (rec.docNo || ""), recId, ctx.session.actor, now(),
          uf.f !== 1 ? uf.unit : null, uf.f !== 1 ? it.qty : null, uf.f !== 1 ? r4(amount / it.qty) : null]);
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
const SOURCE_LOCK = { pos: "เอกสารนี้สร้าง/อัปเดตอัตโนมัติจากยอดขาย POS — ยกเลิกหรือคืนเงินที่เมนู POS → ออเดอร์ แล้วยอดจะปรับให้เอง", payroll: "เอกสารนี้สร้างจากระบบเงินเดือน — แก้ไข/ยกเลิกได้ที่เมนูเงินเดือน", advance: "เอกสารนี้สร้างจากการอนุมัติเบิกเงินล่วงหน้า — ยกเลิกได้ที่เมนูเบิกเงินล่วงหน้า",
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
  const sa = await stockAdjust(bid, from, to);
  tot.cashNet = r2(tot.income - tot.expense); tot.stockBegin = sa.begin; tot.stockEnd = sa.end; tot.stockOther = sa.other; tot.stockAdj = sa.adj; tot.stockPending = sa.pending;
  tot.net = r2(tot.cashNet + sa.adj); tot.afterInvest = r2(tot.net - tot.invest);
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
/* หน่วยนับหลายหน่วย (v2.7): สต็อกเก็บเป็น "หน่วยหลัก" เสมอ · หน่วยอื่น = [{n:"ถุง", f:2}] หมายถึง 1 ถุง = 2 หน่วยหลัก */
function parseUnits(v) { try { const a = typeof v === "string" ? JSON.parse(v || "[]") : v; return Array.isArray(a) ? a.filter(u => u && u.n && Number(u.f) > 0).map(u => ({ n: String(u.n), f: Number(u.f) })) : []; } catch (e) { return []; } }
function cleanUnits(v, base) {
  const out = [];
  for (const u of (Array.isArray(v) ? v : []).slice(0, 8)) {
    const n = str(u && (u.n || u.name), 30), f = r4(num(u && (u.f || u.factor), 0));
    if (!n && !f) continue;
    if (!n) throw bad("กรุณาใส่ชื่อหน่วยอื่น");
    if (!(f > 0)) throw bad("หน่วย \"" + n + "\" ต้องระบุว่าเท่ากับกี่ " + (base || "หน่วยหลัก") + " (มากกว่า 0)");
    if (base && n.toLowerCase() === base.toLowerCase()) throw bad("หน่วย \"" + n + "\" ซ้ำกับหน่วยหลัก");
    if (out.some(x => x.n.toLowerCase() === n.toLowerCase())) throw bad("หน่วย \"" + n + "\" ซ้ำ");
    out.push({ n, f });
  }
  return out;
}
// คืนค่าตัวคูณของหน่วยที่เลือก (หน่วยหลัก/ไม่ระบุ = 1) — ถ้าเป็นหน่วยที่ไม่รู้จักและ strict ให้ error
function unitFactor(item, unit, strict) {
  const u = String(unit || "").trim();
  if (!u || u === (item.unit || "")) return { f: 1, unit: item.unit || "" };
  const x = parseUnits(item.units).find(y => y.n.toLowerCase() === u.toLowerCase());
  if (x) return { f: x.f, unit: x.n };
  if (strict) throw bad("สินค้า \"" + item.name + "\" ไม่มีหน่วย \"" + u + "\" — ตั้งหน่วยได้ที่แก้ไขสินค้า");
  return { f: 1, unit: item.unit || "" };
}
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
    active: r.active, note: r.note || "", low: min > 0 && qty <= min, photoV: r.has_photo ? Number(r.updated_at) || 1 : 0, moveCount: r.move_count != null ? Number(r.move_count) : undefined, lastMove: r.last_move || "",
    pending: Number(r.pending_count) || 0, units: parseUnits(r.units) };
}
route("GET", B + "/stock/items", async ctx => {
  await needBranch(ctx, ["stock", "expense", "invest"], "view");
  const { rows } = await pool.query(`SELECT i.id, i.branch_id, i.sku, i.name, i.category, i.unit, i.min_qty, i.qty, i.avg_cost, i.active, i.note, i.created_at, i.updated_at, i.units, (i.photo IS NOT NULL AND i.photo<>'') AS has_photo,
    (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id=i.id)::int AS move_count,
    (SELECT COUNT(*) FROM stock_moves m WHERE m.item_id=i.id AND m.status='pending')::int AS pending_count,
    (SELECT MAX(move_date) FROM stock_moves m WHERE m.item_id=i.id) AS last_move FROM stock_items i WHERE i.branch_id=$1 ORDER BY i.active DESC, i.category, i.name`, [ctx.branch.id]);
  return { items: rows.map(itemOut), canApprove: !!ctx.perms.approve.stock };
});
function stockItemFields(b) {
  const name = str(b.name, 150); if (!name) throw bad("กรุณาใส่ชื่อสินค้า");
  const minQty = num(b.minQty, 0); if (minQty < 0) throw bad("จุดสั่งซื้อต้องไม่ติดลบ");
  const unit = str(b.unit, 30);
  return { name, sku: str(b.sku, 50), category: str(b.category, 120), unit, minQty: r4(minQty), note: str(b.note, 500), units: b.units === undefined ? undefined : JSON.stringify(cleanUnits(b.units, unit)) };
}
route("POST", B + "/stock/items", async ctx => {
  await needBranch(ctx, "stock", "edit");
  if (!(ctx.perms.full || ctx.perms.approve.stock)) throw new HttpError(403, "เพิ่ม/แก้ไขสินค้าสำหรับผู้จัดการหรือผู้อนุมัติสต็อกเท่านั้น");
  const f = stockItemFields(ctx.body);
  const dup = await pool.query("SELECT 1 FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [ctx.branch.id, f.name]);
  if (dup.rows.length) throw bad("มีสินค้าชื่อนี้อยู่แล้ว");
  const id = uid();
  await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$9)",
    [id, ctx.branch.id, f.sku, f.name, f.category, f.unit, f.minQty, f.note, now()]);
  if (ctx.body.photo) await pool.query("UPDATE stock_items SET photo=$1 WHERE id=$2", [checkImg(ctx.body.photo, 400000), id]);
  if (f.units !== undefined) await pool.query("UPDATE stock_items SET units=$1 WHERE id=$2", [f.units, id]);
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
  if (!(ctx.perms.full || ctx.perms.approve.stock)) throw new HttpError(403, "เพิ่ม/แก้ไขสินค้าสำหรับผู้จัดการหรือผู้อนุมัติสต็อกเท่านั้น");
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
  if (ctx.body.photo !== undefined) await pool.query("UPDATE stock_items SET photo=$1 WHERE id=$2", [checkImg(ctx.body.photo, 400000) || null, ctx.params.id]);
  if (f.units !== undefined) await pool.query("UPDATE stock_items SET units=$1 WHERE id=$2", [f.units, ctx.params.id]);
  await logActivity(ctx, "stock_item_edit", "แก้ไขสินค้า " + f.name, ctx.branch.id);
  return { ok: true };
});
route("DELETE", B + "/stock/items/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  if (!(ctx.perms.full || ctx.perms.approve.stock)) throw new HttpError(403, "เพิ่ม/แก้ไขสินค้าสำหรับผู้จัดการหรือผู้อนุมัติสต็อกเท่านั้น");
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
route("GET", B + "/stock/items/:id/photo", async (ctx, req, res) => {
  await needBranch(ctx, ["stock", "expense", "invest"], "view");
  const r = (await pool.query("SELECT photo FROM stock_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r || !r.photo) throw new HttpError(404, "ไม่พบรูป");
  sendDataUrl(res, r.photo); return undefined;
});
const MOVE_KINDS = { in: "รับเข้า", out: "เบิกใช้", waste: "ของเสีย / ทิ้ง", count: "ตรวจนับ (ปรับยอด)" };
// แก้ไข/ลบรายการสต็อกได้ไหม: ผู้อนุมัติ = ทุกรายการ (ยกเว้นที่มาจากเอกสารซื้อ) · พนักงาน = การเบิกของตัวเองภายในวันเดียวกัน หรือรายการของตัวเองที่ยังรออนุมัติ/ไม่อนุมัติ
function moveEditable(ctx, m) {
  if (m.xfer_id) return false;
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
    xferDir: m.xfer_dir || "", xferBranch: m.xfer_branch || "",
    inUnit: m.in_unit || "", inQty: m.in_qty == null ? null : Number(m.in_qty), inPrice: m.in_price == null ? null : Number(m.in_price),
    canEdit: ctx ? moveEditable(ctx, m) : false };
}
route("GET", B + "/stock/moves", async ctx => {
  await needBranch(ctx, "stock", "view");
  const { from, to } = rangeOf(ctx.query);
  const params = [ctx.branch.id, from, to]; let where = "m.branch_id=$1 AND m.move_date BETWEEN $2 AND $3";
  // พนักงาน (ไม่มีสิทธิ์อนุมัติสต็อก) เห็นเฉพาะรายการของตัวเอง — v2.8
  if (!(ctx.perms.full || ctx.perms.approve.stock)) { params.push(ctx.session.actor); where += " AND m.created_by=$" + params.length; }
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
  if (m.xfer_id) throw bad("รายการโยกของข้ามสาขาแก้ไขไม่ได้");
  if (!moveEditable(ctx, m)) throw new HttpError(403, "แก้ไขได้เฉพาะการเบิกของตัวเองภายในวันเดียวกัน (รายการอื่นให้ผู้จัดการแก้)");
  const it = (await pool.query("SELECT * FROM stock_items WHERE id=$1", [m.item_id])).rows[0];
  const uf = unitFactor(it, ctx.body.unit !== undefined ? ctx.body.unit : (m.in_unit || ""), true);
  const qIn = r4(num(ctx.body.qty, NaN)); const q = r4(qIn * uf.f);
  if (m.kind === "count" ? !(q >= 0) : !(q > 0)) throw bad(m.kind === "count" ? "ยอดที่นับได้ต้องเป็น 0 ขึ้นไป" : "จำนวนต้องมากกว่า 0");
  const old = m.kind === "count" ? Number(m.counted) : Math.abs(Number(m.qty));
  if ((m.kind === "out" || m.kind === "waste") && m.status === "approved") {
    const avail = Number(m.item_qty) + old;
    if (q > avail + 1e-9 && !ctx.body.allowNegative) throw bad("\"" + m.name + "\" คงเหลือ " + r4(avail) + " " + (m.unit || "") + " ไม่พอเบิก " + q);
  }
  const signed = m.kind === "in" ? q : m.kind === "count" ? 0 : -q;
  await pool.query("UPDATE stock_moves SET qty=$1, counted=$2, note=$3, in_unit=$4, in_qty=$5 WHERE id=$6", [signed, m.kind === "count" ? q : null, ctx.body.note !== undefined ? str(ctx.body.note, 300) : m.note, uf.f !== 1 ? uf.unit : null, uf.f !== 1 ? qIn : null, m.id]);
  if (m.kind === "in" && uf.f !== 1 && m.in_price != null) await pool.query("UPDATE stock_moves SET unit_cost=$1 WHERE id=$2", [r4(Number(m.in_price) / uf.f), m.id]);
  if (m.status === "approved") await recomputeItem(m.item_id);
  await logActivity(ctx, "stock_move_edit", "แก้ไข" + MOVE_KINDS[m.kind] + " " + m.name + " จาก " + old + " เป็น " + q + " " + (m.unit || "") + " (รายการวันที่ " + m.move_date + ")", ctx.branch.id);
  return { ok: true };
});
// สร้างการเคลื่อนไหวสต็อกหลายบรรทัด — ใช้ร่วมกันระหว่างหน้าสต็อก และ "รายการที่จะซื้อ"
// line = { itemId, qty, unit?, unitCost? }  qty/unitCost เป็นของ "หน่วยที่เลือก" ระบบแปลงเป็นหน่วยหลักให้
async function createStockMoves(ctx, kind, date, note, rawLines, allowNegative) {
  if (!MOVE_KINDS[kind]) throw bad("ประเภทการเคลื่อนไหวไม่ถูกต้อง");
  const lines = (Array.isArray(rawLines) ? rawLines : []).filter(l => l && l.itemId).slice(0, 200);
  if (!lines.length) throw bad("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
  if ((kind === "in" || kind === "count") && !(ctx.perms.full || ctx.perms.approve.stock))
    throw new HttpError(403, kind === "in" ? "พนักงานรับเข้า/เติมสต็อกไม่ได้ — ใช้ “รายการที่จะซื้อ” ส่งขออนุมัติซื้อแทน" : "การตรวจนับสำหรับผู้จัดการ/ผู้อนุมัติสต็อกเท่านั้น");
  const batch = uid();
  // เบิกใช้ = ตัดยอดทันที ไม่ต้องอนุมัติ · รับเข้า / ของเสีย / ตรวจนับ ของคนที่ไม่มีสิทธิ์อนุมัติ = รออนุมัติ
  const approver = !!ctx.perms.approve.stock || kind === "out";
  const prep = [], need = {};
  for (const l of lines) {
    const it = (await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [l.itemId, ctx.branch.id])).rows[0];
    if (!it) throw bad("ไม่พบสินค้า");
    const uf = unitFactor(it, l.unit, true);
    const qIn = num(l.qty, NaN);
    if (kind === "count") { if (!isFinite(qIn) || qIn < 0) throw bad("ยอดที่นับได้ต้องเป็น 0 ขึ้นไป (" + it.name + ")"); }
    else if (!isFinite(qIn) || qIn <= 0) throw bad("จำนวนต้องมากกว่า 0 (" + it.name + ")");
    const q = r4(qIn * uf.f);
    const price = kind === "in" ? Math.max(0, num(l.unitCost, 0)) : null;
    if (kind === "out" || kind === "waste") {
      need[it.id] = (need[it.id] || 0) + q;
      if (need[it.id] > Number(it.qty) + 1e-9 && !allowNegative) throw bad("\"" + it.name + "\" คงเหลือ " + r4(Number(it.qty)) + " " + (it.unit || "") + " ไม่พอ" + (kind === "out" ? "เบิก " : " ") + r4(need[it.id]) + " " + (it.unit || ""));
    }
    prep.push({ it, uf, qIn: r4(qIn), q, price });
  }
  const ids = [];
  for (const p of prep) {
    const signed = kind === "in" ? p.q : (kind === "count" ? 0 : -p.q), id = uid(); ids.push(id);
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,counted,unit_cost,note,batch_id,created_by,created_at,status,approved_by,approved_at,in_unit,in_qty,in_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, ctx.branch.id, p.it.id, date, kind, signed, kind === "count" ? p.q : null, kind === "in" ? r4(p.price / p.uf.f) : null, note, batch, ctx.session.actor, now(),
        approver ? "approved" : "pending", approver ? ctx.session.actor : null, approver ? now() : null, p.uf.f !== 1 ? p.uf.unit : null, p.uf.f !== 1 ? p.qIn : null, kind === "in" ? r4(p.price) : null]);
  }
  if (approver) for (const id of new Set(prep.map(p => p.it.id))) await recomputeItem(id);
  const qtxt = p => p.qIn + " " + (p.uf.f !== 1 ? p.uf.unit + " (=" + p.q + " " + (p.it.unit || "") + ")" : (p.it.unit || ""));
  await logActivity(ctx, "stock_move", MOVE_KINDS[kind] + " " + prep.length + " รายการ: " + prep.slice(0, 5).map(p => p.it.name + " " + qtxt(p)).join(", ") + (approver ? "" : " (รออนุมัติ)"), ctx.branch.id);
  return { ok: true, pending: !approver, ids, batch };
}
route("POST", B + "/stock/moves", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const b = ctx.body || {};
  return await createStockMoves(ctx, b.kind, isDate(b.date) ? b.date : todayBkk(), str(b.note, 300), b.lines, !!b.allowNegative);
});
// อนุมัติ / ไม่อนุมัติ รายการสต็อก (ทีละหลายรายการได้)
/* ===== โยกของข้ามสาขา (v2.8) — ต้นทางตัดสต็อกทันที · ปลายทาง "รับเข้า" รออนุมัติ · ปลายทางไม่อนุมัติ = คืนของให้ต้นทางอัตโนมัติ ===== */
route("GET", B + "/stock/transfer/targets", async ctx => {
  await needBranch(ctx, "stock", "view");
  const { rows } = await pool.query("SELECT id, name, code, color FROM branches WHERE id<>$1 AND active=TRUE AND business_id=(SELECT business_id FROM branches WHERE id=$1) ORDER BY sort_order, created_at", [ctx.branch.id]);
  return { branches: rows.map(b => ({ id: b.id, name: b.name, code: b.code || "", color: b.color || "" })) };
});
route("POST", B + "/stock/transfer", async ctx => {
  await needBranch(ctx, "stock", "edit");
  if (!(ctx.perms.full || ctx.perms.approve.stock)) throw new HttpError(403, "โยกของข้ามสาขาสำหรับผู้จัดการ/ผู้อนุมัติสต็อก");
  const b = ctx.body || {};
  const tb = (await pool.query("SELECT * FROM branches WHERE id=$1", [str(b.to, 100)])).rows[0];
  if (!tb || tb.id === ctx.branch.id) throw bad("กรุณาเลือกสาขาปลายทาง");
  if (tb.business_id !== ctx.branch.business_id) throw bad("โยกของได้เฉพาะสาขาในธุรกิจเดียวกัน");
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && l.itemId).slice(0, 200);
  if (!lines.length) throw bad("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
  const date = isDate(b.date) ? b.date : todayBkk(), note = str(b.note, 300), xid = uid(), prep = [], need = {};
  for (const l of lines) {
    const it = (await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [l.itemId, ctx.branch.id])).rows[0];
    if (!it) throw bad("ไม่พบสินค้า");
    const uf = unitFactor(it, l.unit, true), qIn = num(l.qty, NaN);
    if (!(qIn > 0)) throw bad("จำนวนต้องมากกว่า 0 (" + it.name + ")");
    const q = r4(qIn * uf.f); need[it.id] = (need[it.id] || 0) + q;
    if (need[it.id] > Number(it.qty) + 1e-9) throw bad("\"" + it.name + "\" คงเหลือ " + r4(Number(it.qty)) + " " + (it.unit || "") + " ไม่พอโยก " + r4(need[it.id]));
    // หาสินค้าชื่อเดียวกันที่สาขาปลายทาง (ไม่มี = สร้างให้ โดยคัดลอกรายละเอียด)
    let ti = (await pool.query("SELECT * FROM stock_items WHERE branch_id=$1 AND lower(name)=lower($2)", [tb.id, it.name])).rows[0], tf = 1;
    if (ti) {
      if ((ti.unit || "") !== (it.unit || "")) {
        const x = parseUnits(ti.units).find(u => u.n.toLowerCase() === String(it.unit || "").toLowerCase());
        if (!x) throw bad("\"" + it.name + "\" สาขาปลายทางนับเป็น \"" + (ti.unit || "-") + "\" แต่สาขานี้นับเป็น \"" + (it.unit || "-") + "\" — ตั้งหน่วยให้ตรงกันก่อน");
        tf = x.f;
      }
    }
    prep.push({ it, ti, tf, uf, qIn: r4(qIn), q });
  }
  for (const p of prep) {
    if (!p.ti) {
      const nid = uid();
      await pool.query("INSERT INTO stock_items (id,branch_id,sku,name,category,unit,min_qty,qty,avg_cost,active,note,photo,units,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,TRUE,$8,$9,$10,$11,$11)",
        [nid, tb.id, p.it.sku, p.it.name, p.it.category, p.it.unit, p.it.min_qty, p.it.note, p.it.photo || null, p.it.units || null, now()]);
      p.ti = { id: nid };
    }
    const cost = r4(Number(p.it.avg_cost) || 0);
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,note,batch_id,created_by,created_at,status,approved_by,approved_at,in_unit,in_qty,xfer_id,xfer_dir,xfer_branch)
      VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,'approved',$8,$9,$10,$11,$12,'out',$13)`,
      [uid(), ctx.branch.id, p.it.id, date, -p.q, "โยกไป " + tb.name + (note ? " · " + note : ""), xid, ctx.session.actor, now(), p.uf.f !== 1 ? p.uf.unit : null, p.uf.f !== 1 ? p.qIn : null, xid, tb.name]);
    await pool.query(`INSERT INTO stock_moves (id,branch_id,item_id,move_date,kind,qty,unit_cost,note,batch_id,created_by,created_at,status,in_unit,in_qty,in_price,xfer_id,xfer_dir,xfer_branch)
      VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,'in',$15)`,
      [uid(), tb.id, p.ti.id, date, r4(p.q * p.tf), r4(cost / p.tf), "รับโยกจาก " + ctx.branch.name + (note ? " · " + note : ""), xid, ctx.session.actor + " (" + ctx.branch.name + ")", now(),
        p.uf.f !== 1 ? p.uf.unit : null, p.uf.f !== 1 ? p.qIn : null, p.uf.f !== 1 ? r4(cost * p.uf.f) : null, xid, ctx.branch.name]);
    await recomputeItem(p.it.id);
  }
  const txt = prep.map(p => p.it.name + " " + p.qIn + " " + (p.uf.f !== 1 ? p.uf.unit : (p.it.unit || ""))).slice(0, 6).join(", ");
  await logActivity(ctx, "stock_xfer_out", "โยกของไป " + tb.name + " " + prep.length + " รายการ: " + txt, ctx.branch.id);
  await logActivity(ctx, "stock_xfer_in", "รับโยกของจาก " + ctx.branch.name + " (รออนุมัติ) " + prep.length + " รายการ: " + txt, tb.id);
  return { ok: true, count: prep.length, to: tb.name };
});

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
  // ปลายทางไม่อนุมัติรับโยก → คืนของให้สาขาต้นทาง (ลบรายการโยกออกของต้นทาง)
  if (!ok) for (const m of rows.filter(x => x.xfer_id && x.xfer_dir === "in")) {
    const src = (await pool.query("DELETE FROM stock_moves WHERE xfer_id=$1 AND xfer_dir='out' AND item_id IN (SELECT id FROM stock_items WHERE lower(name)=lower($2)) RETURNING item_id, branch_id", [m.xfer_id, m.name])).rows;
    for (const x of src) { await recomputeItem(x.item_id); await logActivity(ctx, "stock_xfer_return", "สาขา " + ctx.branch.name + " ไม่รับโยก " + m.name + " — คืนสต็อกให้ต้นทาง (" + reason + ")", x.branch_id); }
  }
  await logActivity(ctx, ok ? "stock_approve" : "stock_reject", (ok ? "อนุมัติ" : "ไม่อนุมัติ") + "รายการสต็อก " + rows.length + " รายการ: " + rows.slice(0, 5).map(m => MOVE_KINDS[m.kind] + " " + m.name + " " + Math.abs(Number(m.kind === "count" ? m.counted : m.qty))).join(", ") + (ok ? "" : " · เหตุผล: " + reason), ctx.branch.id);
  return { ok: true, count: rows.length };
});
route("DELETE", B + "/stock/moves/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const { rows } = await pool.query("SELECT m.*, i.name FROM stock_moves m JOIN stock_items i ON i.id=m.item_id WHERE m.id=$1 AND m.branch_id=$2", [ctx.params.id, ctx.branch.id]);
  if (!rows[0]) throw new HttpError(404, "ไม่พบรายการ");
  if (rows[0].ref_record_id) throw bad("รายการนี้มาจากเอกสารซื้อ — แก้ไข/ลบที่เอกสารรายจ่ายแทน");
  if (rows[0].xfer_id) throw bad("รายการโยกของข้ามสาขาลบไม่ได้ — ถ้าส่งผิด ให้สาขาปลายทางกด “ไม่อนุมัติ” ระบบจะคืนของให้อัตโนมัติ");
  if (!moveEditable(ctx, rows[0])) throw new HttpError(403, rows[0].kind === "out" ? "ลบได้เฉพาะการเบิกของตัวเองภายในวันเดียวกัน (รายการอื่นให้ผู้จัดการลบ)" : "รายการที่อนุมัติแล้ว ลบได้เฉพาะผู้อนุมัติสต็อก");
  await pool.query("DELETE FROM stock_moves WHERE id=$1", [rows[0].id]);
  await recomputeItem(rows[0].item_id);
  await logActivity(ctx, "stock_move_delete", "ลบรายการสต็อก " + MOVE_KINDS[rows[0].kind] + " " + rows[0].name + (rows[0].status !== "approved" ? " (" + (rows[0].status === "pending" ? "รออนุมัติ" : "ไม่อนุมัติ") + ")" : ""), ctx.branch.id);
  return { ok: true };
});

/* ===== ใบขอซื้อ / ใบสั่งซื้อ (PO) — v2.8 ===== */
const stockBoss = ctx => !!(ctx.perms.full || ctx.perms.approve.stock);
function poOut(p) {
  let lines = []; try { lines = JSON.parse(p.lines_json || "[]"); } catch (e) {}
  return { id: p.id, poNo: p.po_no, date: p.po_date, status: p.status, note: p.note || "", lines, total: r2(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)),
    createdBy: p.created_by || "", createdAt: Number(p.created_at), approvedBy: p.approved_by || "", approvedAt: Number(p.approved_at) || null, reason: p.reason || "" };
}
async function nextPoNo(bid, date) {
  const ym = date.slice(2, 4) + date.slice(5, 7);
  const n = Number((await pool.query("SELECT COUNT(*) AS c FROM purchase_orders WHERE branch_id=$1 AND po_no LIKE $2", [bid, "PO" + ym + "-%"])).rows[0].c) || 0;
  return "PO" + ym + "-" + String(n + 1).padStart(3, "0");
}
// พนักงานยืนยันรายการ → ส่งอนุมัติ (ผู้อนุมัติสต็อกสร้าง = อนุมัติทันที)
route("POST", B + "/shopping/po", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const b = ctx.body || {}; const raw = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200);
  if (!raw.length) throw bad("กรุณาเลือกรายการที่จะซื้ออย่างน้อย 1 รายการ");
  const date = todayBkk(), boss = stockBoss(ctx), poId = uid(), lines = [], rowIds = [];
  for (const l of raw) {
    const q = num(l.qty, NaN); if (!(q > 0)) throw bad("กรุณาใส่จำนวนที่จะซื้อให้ครบทุกรายการ");
    let row = null, it = null;
    if (l.id) { row = (await pool.query("SELECT * FROM shop_items WHERE id=$1 AND branch_id=$2", [l.id, ctx.branch.id])).rows[0]; if (!row) throw bad("ไม่พบรายการ"); if (row.status !== "open" || row.po_id) throw bad("\"" + row.name + "\" ถูกส่งขอซื้อไปแล้ว"); }
    const itemId = row ? row.item_id : str(l.itemId, 100);
    if (itemId) { it = (await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [itemId, ctx.branch.id])).rows[0]; if (!it) throw bad("ไม่พบสินค้า"); }
    const uf = it ? unitFactor(it, l.unit || (row && row.unit), true) : { f: 1, unit: str(l.unit, 30) || (row ? row.unit : "") };
    const name = it ? it.name : (row ? row.name : str(l.name, 150)); if (!name) throw bad("ไม่มีชื่อรายการ");
    if (!row) {
      if (it) { const dup = (await pool.query("SELECT * FROM shop_items WHERE item_id=$1 AND status='open' AND po_id IS NULL", [it.id])).rows[0]; if (dup) row = dup; }
      if (!row) { const id = uid(); await pool.query("INSERT INTO shop_items (id,branch_id,item_id,name,category,unit,status,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)", [id, ctx.branch.id, it ? it.id : null, name, it ? (it.category || "") : str(l.category, 120), uf.unit, ctx.session.actor, now()]); row = { id }; }
    }
    const price = l.price === "" || l.price == null ? (it ? r2(Number(it.avg_cost) * uf.f) : 0) : Math.max(0, num(l.price, 0));
    await pool.query("UPDATE shop_items SET qty=$1, unit=$2, note=$3, po_id=$4 WHERE id=$5", [r4(q), uf.unit, str(l.note, 300) || null, poId, row.id]);
    rowIds.push(row.id);
    lines.push({ shopId: row.id, itemId: it ? it.id : "", name, category: it ? (it.category || "") : (row.category || str(l.category, 120)), qty: r4(q), unit: uf.unit, price: r2(price), note: str(l.note, 300),
      baseQty: it ? r4(q * uf.f) : null, baseUnit: it ? (it.unit || "") : "", left: it ? r4(Number(it.qty)) : null });
  }
  const poNo = await nextPoNo(ctx.branch.id, date);
  await pool.query("INSERT INTO purchase_orders (id,branch_id,po_no,po_date,status,note,lines_json,created_by,created_at,approved_by,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [poId, ctx.branch.id, poNo, date, boss ? "approved" : "pending", str(b.note, 300), JSON.stringify(lines), ctx.session.actor, now(), boss ? ctx.session.actor : null, boss ? now() : null]);
  await logActivity(ctx, "po_create", (boss ? "สร้างใบสั่งซื้อ " : "ส่งขออนุมัติซื้อ ") + poNo + " · " + lines.length + " รายการ: " + lines.slice(0, 5).map(l => l.name + " " + l.qty + " " + l.unit).join(", "), ctx.branch.id);
  return { ok: true, id: poId, poNo, pending: !boss };
});
route("GET", B + "/shopping/po/:id", async ctx => {
  await needBranch(ctx, "stock", "view");
  const p = (await pool.query("SELECT * FROM purchase_orders WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!p) throw new HttpError(404, "ไม่พบใบสั่งซื้อ");
  return { po: poOut(p) };
});
route("POST", B + "/shopping/po/:id/approve", async ctx => {
  await needBranch(ctx, "stock", "view"); if (!stockBoss(ctx)) throw new HttpError(403, "ต้องเป็นผู้อนุมัติสต็อก");
  const p = (await pool.query("SELECT * FROM purchase_orders WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!p) throw new HttpError(404, "ไม่พบใบสั่งซื้อ"); if (p.status !== "pending") throw bad("ใบนี้ไม่ได้รออนุมัติ");
  await pool.query("UPDATE purchase_orders SET status='approved', approved_by=$1, approved_at=$2 WHERE id=$3", [ctx.session.actor, now(), p.id]);
  await logActivity(ctx, "po_approve", "อนุมัติใบสั่งซื้อ " + p.po_no, ctx.branch.id);
  return { ok: true };
});
// ไม่อนุมัติ / ยกเลิก → รายการกลับไปอยู่ในลิสต์ "ต้องซื้อ"
route("POST", B + "/shopping/po/:id/reject", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const p = (await pool.query("SELECT * FROM purchase_orders WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!p) throw new HttpError(404, "ไม่พบใบสั่งซื้อ");
  const own = p.created_by === ctx.session.actor && p.status === "pending";
  if (!stockBoss(ctx) && !own) throw new HttpError(403, "ยกเลิกได้เฉพาะใบที่ตัวเองส่ง (ยังรออนุมัติ) หรือผู้อนุมัติสต็อก");
  if (!["pending", "approved"].includes(p.status)) throw bad("ใบนี้ปิดไปแล้ว");
  const bought = Number((await pool.query("SELECT COUNT(*) AS c FROM shop_items WHERE po_id=$1 AND status<>'open'", [p.id])).rows[0].c) || 0;
  if (bought) throw bad("มีรายการในใบนี้ซื้อแล้ว " + bought + " รายการ — ยกเลิกทั้งใบไม่ได้");
  const st = own && !stockBoss(ctx) ? "cancelled" : (p.status === "pending" ? "rejected" : "cancelled");
  await pool.query("UPDATE purchase_orders SET status=$1, reason=$2, approved_by=$3, approved_at=$4 WHERE id=$5", [st, str(ctx.body && ctx.body.reason, 300), ctx.session.actor, now(), p.id]);
  await pool.query("UPDATE shop_items SET po_id=NULL WHERE po_id=$1 AND status='open'", [p.id]);
  await logActivity(ctx, "po_" + st, (st === "rejected" ? "ไม่อนุมัติใบสั่งซื้อ " : "ยกเลิกใบสั่งซื้อ ") + p.po_no, ctx.branch.id);
  return { ok: true, status: st };
});
async function closePoIfDone(poId) {
  if (!poId) return;
  const left = Number((await pool.query("SELECT COUNT(*) AS c FROM shop_items WHERE po_id=$1 AND status='open'", [poId])).rows[0].c) || 0;
  await pool.query("UPDATE purchase_orders SET status=CASE WHEN $2 THEN 'done' ELSE 'approved' END WHERE id=$1 AND status IN ('approved','done')", [poId, left === 0]);
}

/* ================= รายการที่จะซื้อ (Check List) — v2.7 ================= */
function shopOut(r, ctx) {
  return { id: r.id, itemId: r.item_id || "", name: r.name, category: r.category || "", qty: r.qty == null ? null : Number(r.qty), unit: r.unit || "", note: r.note || "",
    status: r.status, boughtQty: r.bought_qty == null ? null : Number(r.bought_qty), boughtUnit: r.bought_unit || "", boughtPrice: r.bought_price == null ? null : Number(r.bought_price),
    moveId: r.move_id || "", pending: !!r.pending, poId: r.po_id || "", moveStatus: r.move_status || "", createdBy: r.created_by || "", createdAt: Number(r.created_at), boughtBy: r.bought_by || "", boughtAt: Number(r.bought_at) || null,
    canUndo: r.status === "bought" && (!!ctx.perms.approve.stock || (r.bought_by === ctx.session.actor && (r.move_status === "pending" || !r.move_id || bkkDateOf(Number(r.bought_at)) === todayBkk()))) };
}
route("GET", B + "/shopping", async ctx => {
  await needBranch(ctx, "stock", "view");
  const since = now() - 3 * 86400000;
  const { rows } = await pool.query(`SELECT s.*, m.status AS move_status FROM shop_items s LEFT JOIN stock_moves m ON m.id=s.move_id
    WHERE s.branch_id=$1 AND (s.status='open' OR (s.status='bought' AND s.bought_at>=$2)) ORDER BY s.status, s.category, s.created_at`, [ctx.branch.id, since]);
  // ของใกล้หมด (คงเหลือ ≤ จุดสั่งซื้อ) ที่ยังไม่อยู่ในลิสต์ → แสดงเป็นรายการอัตโนมัติ
  const low = (await pool.query(`SELECT id, name, category, unit, units, qty, min_qty, avg_cost FROM stock_items i WHERE branch_id=$1 AND active=TRUE AND min_qty>0 AND qty<=min_qty
    AND NOT EXISTS (SELECT 1 FROM shop_items s WHERE s.item_id=i.id AND s.status='open') ORDER BY category, name`, [ctx.branch.id])).rows;
  const pos = (await pool.query("SELECT * FROM purchase_orders WHERE branch_id=$1 AND (status IN ('pending','approved') OR created_at>=$2) ORDER BY created_at DESC LIMIT 40", [ctx.branch.id, now() - 7 * 86400000])).rows.map(poOut);
  return { pos, boss: stockBoss(ctx), items: rows.map(r => shopOut(r, ctx)), suggest: low.map(i => ({ itemId: i.id, name: i.name, category: i.category || "", unit: i.unit || "", qty: Number(i.qty), minQty: Number(i.min_qty), avgCost: Number(i.avg_cost), units: parseUnits(i.units) })),
    canApprove: !!ctx.perms.approve.stock };
});
route("POST", B + "/shopping", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const b = ctx.body || {}; let name = str(b.name, 150), category = str(b.category, 120), unit = str(b.unit, 30), itemId = null;
  if (b.itemId) {
    const it = (await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [b.itemId, ctx.branch.id])).rows[0];
    if (!it) throw bad("ไม่พบสินค้า");
    const dup = await pool.query("SELECT 1 FROM shop_items WHERE item_id=$1 AND status='open'", [it.id]);
    if (dup.rows.length) throw bad("\"" + it.name + "\" อยู่ในรายการที่จะซื้อแล้ว");
    itemId = it.id; name = it.name; category = it.category || ""; unit = unit ? unitFactor(it, unit, true).unit : (it.unit || "");
  }
  if (!name) throw bad("กรุณาใส่ชื่อของที่จะซื้อ");
  const q = b.qty === "" || b.qty == null ? null : num(b.qty, NaN); if (q != null && !(q > 0)) throw bad("จำนวนต้องมากกว่า 0");
  const id = uid();
  await pool.query("INSERT INTO shop_items (id,branch_id,item_id,name,category,qty,unit,note,status,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10)",
    [id, ctx.branch.id, itemId, name, category, q == null ? null : r4(q), unit, str(b.note, 300), ctx.session.actor, now()]);
  await logActivity(ctx, "shop_add", "เพิ่มรายการที่จะซื้อ: " + name + (q ? " " + q + " " + unit : ""), ctx.branch.id);
  return { ok: true, id };
});
route("PUT", B + "/shopping/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const r = (await pool.query("SELECT * FROM shop_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r) throw new HttpError(404, "ไม่พบรายการ"); if (r.status !== "open") throw bad("รายการนี้ซื้อแล้ว");
  const b = ctx.body || {}; const q = b.qty === "" || b.qty == null ? null : num(b.qty, NaN); if (q != null && !(q > 0)) throw bad("จำนวนต้องมากกว่า 0");
  await pool.query("UPDATE shop_items SET qty=$1, unit=$2, note=$3, name=CASE WHEN item_id IS NULL AND $4<>'' THEN $4 ELSE name END, category=CASE WHEN item_id IS NULL THEN $5 ELSE category END WHERE id=$6",
    [q == null ? null : r4(q), str(b.unit, 30) || r.unit, b.note !== undefined ? str(b.note, 300) : r.note, str(b.name, 150), b.category !== undefined ? str(b.category, 120) : r.category, r.id]);
  return { ok: true };
});
route("DELETE", B + "/shopping/:id", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const r = (await pool.query("SELECT * FROM shop_items WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r) throw new HttpError(404, "ไม่พบรายการ");
  if (r.status === "bought" && r.move_id) throw bad("รายการนี้รับเข้าสต็อกแล้ว — กด “ยกเลิกซื้อแล้ว” ก่อน");
  if (r.po_id && r.status === "open") throw bad("รายการนี้อยู่ในใบขอซื้อ — ยกเลิกใบขอซื้อก่อน");
  await pool.query("DELETE FROM shop_items WHERE id=$1", [r.id]);
  await logActivity(ctx, "shop_delete", "ลบรายการที่จะซื้อ: " + r.name, ctx.branch.id);
  return { ok: true };
});
// ติ๊ก "ซื้อแล้ว": ใส่จำนวน + หน่วย + ราคาต่อหน่วย → รับเข้าสต็อก (ผู้ไม่มีสิทธิ์อนุมัติ = รออนุมัติ ตามกติกาเดิม)
route("POST", B + "/shopping/buy", async ctx => {
  await needBranch(ctx, "stock", "edit");
  if (!stockBoss(ctx)) throw new HttpError(403, "การรับของเข้า (ติ๊กซื้อแล้ว) สำหรับผู้จัดการ/ผู้อนุมัติสต็อก");
  const b = ctx.body || {};
  let row = null;
  if (b.id) { row = (await pool.query("SELECT * FROM shop_items WHERE id=$1 AND branch_id=$2", [b.id, ctx.branch.id])).rows[0]; if (!row) throw new HttpError(404, "ไม่พบรายการ"); if (row.status !== "open") throw bad("รายการนี้ติ๊กซื้อแล้ว"); }
  const itemId = row ? row.item_id : str(b.itemId, 100);
  const date = isDate(b.date) ? b.date : todayBkk();
  const qIn = num(b.qty, NaN), price = b.price === "" || b.price == null ? null : num(b.price, NaN);
  let moveId = null, pending = false, unit = str(b.unit, 30), name = row ? row.name : "", category = row ? row.category : "";
  if (itemId) {
    const it = (await pool.query("SELECT * FROM stock_items WHERE id=$1 AND branch_id=$2", [itemId, ctx.branch.id])).rows[0];
    if (!it) throw bad("ไม่พบสินค้าในสต็อก");
    if (!(qIn > 0)) throw bad("กรุณาใส่จำนวนที่ซื้อ");
    if (price != null && !(price >= 0)) throw bad("ราคาไม่ถูกต้อง");
    unit = unitFactor(it, unit, true).unit; name = it.name; category = it.category || "";
    const r = await createStockMoves(ctx, "in", date, str(b.note, 300) || "ซื้อตามรายการที่จะซื้อ", [{ itemId, qty: qIn, unit, unitCost: price || 0 }]);
    moveId = r.ids[0]; pending = r.pending;
  } else if (!row) throw bad("กรุณาเลือกรายการ");
  if (row && row.po_id) { const po = (await pool.query("SELECT status FROM purchase_orders WHERE id=$1", [row.po_id])).rows[0]; if (po && po.status === "pending") throw bad("ใบขอซื้อนี้ยังรออนุมัติ — อนุมัติก่อน"); }
  if (row) await pool.query("UPDATE shop_items SET status='bought', bought_qty=$1, bought_unit=$2, bought_price=$3, move_id=$4, pending=$5, bought_by=$6, bought_at=$7 WHERE id=$8",
    [isFinite(qIn) && qIn > 0 ? r4(qIn) : null, unit || row.unit, price != null && isFinite(price) ? r4(price) : null, moveId, pending, ctx.session.actor, now(), row.id]);
  else await pool.query("INSERT INTO shop_items (id,branch_id,item_id,name,category,unit,status,bought_qty,bought_unit,bought_price,move_id,pending,created_by,created_at,bought_by,bought_at) VALUES ($1,$2,$3,$4,$5,$6,'bought',$7,$8,$9,$10,$11,$12,$13,$12,$13)",
    [uid(), ctx.branch.id, itemId, name, category, unit, r4(qIn), unit, price != null ? r4(price) : null, moveId, pending, ctx.session.actor, now()]);
  if (row) await closePoIfDone(row.po_id);
  await logActivity(ctx, "shop_buy", "ซื้อแล้ว: " + name + (qIn > 0 ? " " + qIn + " " + unit : "") + (price != null ? " @" + price : "") + (moveId ? (pending ? " → รับเข้าสต็อก (รออนุมัติ)" : " → รับเข้าสต็อกแล้ว") : ""), ctx.branch.id);
  return { ok: true, pending, stocked: !!moveId };
});
// ยกเลิก "ซื้อแล้ว" → กลับเป็นรายการที่ต้องซื้อ และลบรายการรับเข้าสต็อกที่สร้างไว้
route("POST", B + "/shopping/:id/undo", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const r = (await pool.query("SELECT s.*, m.status AS move_status FROM shop_items s LEFT JOIN stock_moves m ON m.id=s.move_id WHERE s.id=$1 AND s.branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r) throw new HttpError(404, "ไม่พบรายการ");
  if (!shopOut(r, ctx).canUndo) throw new HttpError(403, "ยกเลิกได้เฉพาะคนที่ติ๊กเอง (วันเดียวกัน หรือยังรออนุมัติ) หรือผู้อนุมัติสต็อก");
  if (r.move_id) { const mv = (await pool.query("DELETE FROM stock_moves WHERE id=$1 RETURNING item_id", [r.move_id])).rows[0]; if (mv) await recomputeItem(mv.item_id); }
  await pool.query("UPDATE shop_items SET status='open', bought_qty=NULL, bought_unit=NULL, bought_price=NULL, move_id=NULL, pending=FALSE, bought_by=NULL, bought_at=NULL WHERE id=$1", [r.id]);
  await closePoIfDone(r.po_id);
  await logActivity(ctx, "shop_undo", "ยกเลิกซื้อแล้ว: " + r.name + (r.move_id ? " (ลบรายการรับเข้าสต็อก)" : ""), ctx.branch.id);
  return { ok: true };
});
// ล้างรายการที่ซื้อแล้วออกจากลิสต์
route("POST", B + "/shopping/clear", async ctx => {
  await needBranch(ctx, "stock", "edit");
  const { rowCount } = await pool.query("UPDATE shop_items SET status='done' WHERE branch_id=$1 AND status='bought'", [ctx.branch.id]);
  return { ok: true, count: rowCount };
});

/* ================= พนักงาน & เงินเดือน ================= */
function empOut(r) {
  return { id: r.id, code: r.code || "", name: r.name, nickname: r.nickname || "", position: r.position || "", phone: r.phone || "", idCard: r.id_card || "",
    bankName: r.bank_name || "", bankAccount: r.bank_account || "", startDate: r.start_date || "", payType: r.pay_type, rate: Number(r.rate), sso: !!r.sso, active: !!r.active, note: r.note || "",
    hasPin: !!r.pin_hash, photoV: r.has_photo ? Number(r.photo_at) || 1 : 0 };
}
route("GET", B + "/employees", async ctx => {
  await needBranch(ctx, ["employees", "payroll", "leave", "advance", "attendance"], "view");
  const { rows } = await pool.query(`SELECT e.*, (e.photo IS NOT NULL AND e.photo<>'') AS has_photo, (SELECT COUNT(*) FROM emp_files f WHERE f.employee_id=e.id)::int AS file_count
    FROM employees e WHERE e.branch_id=$1 ORDER BY e.active DESC, e.code, e.name`, [ctx.branch.id]);
  rows.forEach(r => { r.photo = null; });
  // คนที่ไม่มีสิทธิ์เมนูพนักงาน/เงินเดือน เห็นแค่ชื่อ (ไม่เห็นค่าจ้าง เลขบัตร บัญชีธนาคาร)
  const full = can(ctx, ["employees", "payroll"], "view");
  return { employees: rows.map(r => { const e = empOut(r); return full ? { ...e, fileCount: Number(r.file_count) || 0 } : { id: e.id, code: e.code, name: e.name, nickname: e.nickname, position: e.position, payType: e.payType, active: e.active, hasPin: e.hasPin, photoV: e.photoV }; }) };
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
  if (ctx.body.photo) await pool.query("UPDATE employees SET photo=$1, photo_at=$2 WHERE id=$3", [checkImg(ctx.body.photo, 400000), now(), id]);
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
  if (ctx.body.photo !== undefined) await pool.query("UPDATE employees SET photo=$1, photo_at=$2 WHERE id=$3", [checkImg(ctx.body.photo, 400000) || null, now(), ctx.params.id]);
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

// รูปโปรไฟล์พนักงาน (ทุกเมนูที่เห็นรายชื่อพนักงานดูรูปได้)
route("GET", B + "/employees/:id/photo", async (ctx, req, res) => {
  await needBranch(ctx, ["employees", "payroll", "leave", "advance", "attendance"], "view");
  const r = (await pool.query("SELECT photo FROM employees WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!r || !r.photo) throw new HttpError(404, "ไม่พบรูป");
  sendDataUrl(res, r.photo); return undefined;
});
// เอกสารพนักงาน (บัตรประชาชน สัญญาจ้าง ฯลฯ) — ดูได้เฉพาะสิทธิ์พนักงาน/เงินเดือน แก้ไขได้เฉพาะสิทธิ์พนักงาน (แก้ไข)
route("GET", B + "/employees/:id/files", async ctx => {
  await needBranch(ctx, ["employees", "payroll"], "view");
  const { rows } = await pool.query("SELECT id, doc_type, filename, mime, size, created_by, created_at FROM emp_files WHERE employee_id=$1 AND branch_id=$2 ORDER BY created_at DESC", [ctx.params.id, ctx.branch.id]);
  return { files: rows.map(f => ({ id: f.id, docType: f.doc_type || "", filename: f.filename, mime: f.mime, size: Number(f.size) || 0, createdBy: f.created_by || "", createdAt: Number(f.created_at) })) };
});
route("POST", B + "/employees/:id/files", async ctx => {
  await needBranch(ctx, "employees", "edit");
  const e = (await pool.query("SELECT id, name FROM employees WHERE id=$1 AND branch_id=$2", [ctx.params.id, ctx.branch.id])).rows[0];
  if (!e) throw new HttpError(404, "ไม่พบพนักงาน");
  const mime = str(ctx.body.mime, 100), data = String(ctx.body.data || "");
  if (!/^(image\/(png|jpeg|webp|gif|heic)|application\/pdf)$/.test(mime)) throw bad("แนบได้เฉพาะรูปภาพหรือ PDF");
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw bad("ไฟล์ไม่ถูกต้อง");
  const size = Math.floor(data.length * 3 / 4); if (size > 8 * 1024 * 1024) throw bad("ไฟล์ใหญ่เกิน 8MB");
  const cnt = await pool.query("SELECT COUNT(*)::int AS c FROM emp_files WHERE employee_id=$1", [e.id]);
  if (Number(cnt.rows[0].c) >= 30) throw bad("แนบเอกสารได้สูงสุด 30 ไฟล์ต่อพนักงาน");
  const id = uid(), docType = str(ctx.body.docType, 60) || "อื่นๆ";
  await pool.query("INSERT INTO emp_files (id,branch_id,employee_id,doc_type,filename,mime,size,data,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [id, ctx.branch.id, e.id, docType, str(ctx.body.filename, 200) || "file", mime, size, data, ctx.session.actor, now()]);
  await logActivity(ctx, "employee_file_add", "แนบเอกสาร " + docType + " ของ " + e.name, ctx.branch.id);
  return { ok: true, id };
});
route("GET", B + "/emp-files/:fid", async (ctx, req, res) => {
  await needBranch(ctx, ["employees", "payroll"], "view");
  const f = (await pool.query("SELECT * FROM emp_files WHERE id=$1 AND branch_id=$2", [ctx.params.fid, ctx.branch.id])).rows[0];
  if (!f) throw new HttpError(404, "ไม่พบไฟล์");
  const buf = Buffer.from(f.data, "base64");
  res.writeHead(200, { "Content-Type": f.mime, "Content-Length": buf.length, "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(f.filename || "file"), "X-Content-Type-Options": "nosniff" });
  res.end(buf); return undefined;
});
route("DELETE", B + "/emp-files/:fid", async ctx => {
  await needBranch(ctx, "employees", "edit");
  const { rows } = await pool.query("DELETE FROM emp_files WHERE id=$1 AND branch_id=$2 RETURNING doc_type, employee_id", [ctx.params.fid, ctx.branch.id]);
  if (rows[0]) await logActivity(ctx, "employee_file_delete", "ลบเอกสาร " + rows[0].doc_type + " ของพนักงาน", ctx.branch.id);
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
  return { branch: { id: b.id, name: b.name, color: b.color, code: b.code, logo: b.logo || "" }, company: (z => ({ name: z.name, logo: z.logo || "" }))(await bizOfBranch(b.id)), enabled: !!b.checkin_enabled,
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
/* กำไรรวมสต็อก (v2.9): ปรับด้วย "ส่วนเปลี่ยนแปลงสต็อก" ที่อนุมัติแล้วเท่านั้น
   = สต็อกปลายงวด − สต็อกต้นงวด − ของที่รับเข้าเองโดยไม่ผ่านรายจ่าย (ยอดยกมา/รับโยก) — สูตรเดียวกับต้นทุนขายในงบกำไรขาดทุน */
async function stockAdjust(bid, from, to) {
  const begin = await stockValueAt(bid, dayBefore(from)), end = await stockValueAt(bid, to), other = await manualStockIn(bid, from, to);
  const pending = Number((await pool.query("SELECT COUNT(*)::int AS c FROM stock_moves WHERE branch_id=$1 AND status='pending' AND move_date<=$2", [bid, to])).rows[0].c) || 0;
  return { begin, end, other, adj: r2(end - begin - other), pending };
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
