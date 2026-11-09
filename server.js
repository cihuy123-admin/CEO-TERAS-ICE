const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ====== Konfigurasi ======
const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.TZ_APP || "Asia/Jakarta";

// Kredensial admin (bisa dioverride via ENV)
const ADMIN_USER = process.env.ADMIN_USER || "adminteras";
const ADMIN_PASS = process.env.ADMIN_PASS || "ter@sice";

const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_TABLE_COUNT = 10;
const MAX_TABLE_COUNT = 50;

const DEFAULT_MENU = [
  // ICE CREAM
  { id: "ice_cemil_3", category: "ICE_CREAM", name: "Ice Cemil 3 Scoops", price: 10000 },
  { id: "ice_cemil_2", category: "ICE_CREAM", name: "Ice Cemil 2 Scoops", price: 8000 },
  { id: "lotus_caramel", category: "ICE_CREAM", name: "Lotus Caramel", price: 15000 },
  { id: "strawberry_velvet", category: "ICE_CREAM", name: "Strawberry Velvet", price: 15000 },
  { id: "matchacih", category: "ICE_CREAM", name: "Matchacih", price: 15000 },
  { id: "milosaurus", category: "ICE_CREAM", name: "Milosaurus", price: 20000 },
  // FLOAT
  { id: "fanta_float", category: "FLOAT", name: "Fanta Float", price: 10000 },
  { id: "cola_float", category: "FLOAT", name: "Cola Float", price: 10000 },
  { id: "choco_milk_float", category: "FLOAT", name: "Chocolate Milk Float", price: 15000 },
  { id: "straw_milk_float", category: "FLOAT", name: "Strawberry Milk Float", price: 15000 },
  { id: "regal_milk_float", category: "FLOAT", name: "Regal Milk Float", price: 15000 }
];

function normalizeCategory(cat) {
  const c = String(cat || "").toUpperCase();
  if (c.includes("ICE") && c.includes("CREAM")) return "ICE_CREAM";
  if (c.includes("ICE_CREAM")) return "ICE_CREAM";
  return "FLOAT";
}

function rupiah(n) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(n)
    .replace("Rp", "Rp ");
}

function getNowParts(date = new Date()) {
  const dt = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(dt.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return map;
}

function getTodayKey(date = new Date()) {
  const dt = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(dt.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatTimestampText(iso) {
  const d = new Date(iso);
  const p = getNowParts(d);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} • ${p.hour}.${p.minute} WIB`;
}

function safeText(s) {
  return String(s || "").trim();
}

function normalizeUsername(u) {
  return safeText(u).toLowerCase();
}

function normalizeDiscountCode(code) {
  return safeText(code).toUpperCase().replace(/\s+/g, "");
}

function hashPassword(password, salt) {
  const pw = String(password || "");
  const s = String(salt || "");
  if (!pw || !s) return "";
  return crypto.pbkdf2Sync(pw, s, 120_000, 32, "sha256").toString("hex");
}

function makeAdminUser(username, password) {
  const u = normalizeUsername(username);
  if (!u) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  if (!hash) return null;
  return { username: u, salt, hash, createdAt: new Date().toISOString() };
}

function verifyAdminPassword(user, password) {
  if (!user || typeof user !== "object") return false;
  const salt = String(user.salt || "");
  const hash = String(user.hash || "");
  if (!salt || !hash) return false;
  const next = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

function normalizeDiscount(input) {
  const code = normalizeDiscountCode(input?.code);
  const type = String(input?.type || "PERCENT").toUpperCase();
  const active = input?.active !== undefined ? !!input.active : true;
  const valueRaw = Number(input?.value || 0);
  const value = Math.floor(valueRaw);
  if (!code) return null;
  if (type !== "PERCENT" && type !== "AMOUNT") return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  if (type === "PERCENT" && value > 100) return null;
  return { code, type, value, active, createdAt: input?.createdAt || new Date().toISOString() };
}

function applyDiscount(discount, subtotal) {
  const sub = Math.max(0, Math.floor(Number(subtotal || 0)));
  if (!discount || !discount.active) return { amount: 0, totalAfter: sub };
  let amount = 0;
  if (discount.type === "PERCENT") amount = Math.floor((sub * discount.value) / 100);
  else amount = discount.value;
  amount = Math.max(0, Math.min(amount, sub));
  return { amount, totalAfter: sub - amount };
}

function ensureStockForMenu(menu, stock) {
  const nextStock = stock && typeof stock === "object" ? { ...stock } : {};
  let changed = false;
  for (const m of menu) {
    if (!Number.isFinite(Number(nextStock[m.id]))) {
      nextStock[m.id] = 100;
      changed = true;
    }
  }
  for (const key of Object.keys(nextStock)) {
    if (!menu.some((m) => m.id === key)) {
      delete nextStock[key];
      changed = true;
    }
  }
  return { stock: nextStock, changed };
}

function normalizeTableCount(v) {
  const x = Math.floor(Number(v || 0));
  if (Number.isFinite(x) && x >= 1 && x <= MAX_TABLE_COUNT) return x;
  return DEFAULT_TABLE_COUNT;
}

function initTables(count = DEFAULT_TABLE_COUNT) {
  const c = normalizeTableCount(count);
  const t = {};
  for (let i = 1; i <= c; i += 1) t[String(i)] = null;
  return t;
}

function sanitizeTableNumber(n, count = DEFAULT_TABLE_COUNT) {
  const c = normalizeTableCount(count);
  const x = Math.floor(Number(n || 0));
  if (Number.isFinite(x) && x >= 1 && x <= c) return x;
  return null;
}

async function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    const today = getTodayKey();
    const { stock } = ensureStockForMenu(DEFAULT_MENU, {});
    const defaultAdmin = makeAdminUser(ADMIN_USER, ADMIN_PASS);
    const init = {
      menu: DEFAULT_MENU,
      stock,
      settings: { maxPerItem: 5, tableCount: DEFAULT_TABLE_COUNT, enableTableSelection: false },
      queue: { lastKey: today, lastNumber: 0 },
      qrisImg: "",
      serialLast: 0,
      admins: defaultAdmin ? [defaultAdmin] : [],
      discounts: [],
      orders: [],
      tables: initTables(DEFAULT_TABLE_COUNT)
    };
    await fsp.writeFile(DATA_FILE, JSON.stringify(init, null, 2), "utf-8");
    return init;
  }

  try {
    const raw = await fsp.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    const menu = Array.isArray(parsed.menu) && parsed.menu.length ? parsed.menu : DEFAULT_MENU;
    const normalizedMenu = menu
      .map((m) => ({
        id: safeText(m.id),
        name: safeText(m.name),
        category: normalizeCategory(m.category),
        price: Math.floor(Number(m.price || 0))
      }))
      .filter((m) => m.id && m.name);
    const { stock } = ensureStockForMenu(normalizedMenu, parsed.stock);
    const maxPerItem = Number.isFinite(Number(parsed?.settings?.maxPerItem)) && Number(parsed.settings.maxPerItem) >= 1
      ? Math.floor(Number(parsed.settings.maxPerItem))
      : 5;
    const tableCount = normalizeTableCount(parsed?.settings?.tableCount);
    const enableTableSelection = parsed?.settings?.enableTableSelection !== undefined ? !!parsed.settings.enableTableSelection : false;
    const settings = { maxPerItem, tableCount, enableTableSelection };
    const today = getTodayKey();
    const queue = parsed.queue && typeof parsed.queue === "object" ? parsed.queue : { lastKey: today, lastNumber: 0 };
    const fixedQueue = queue.lastKey === today ? queue : { lastKey: today, lastNumber: 0 };

    const orders = Array.isArray(parsed.orders) ? parsed.orders : [];
    const qrisImg = typeof parsed.qrisImg === "string" ? parsed.qrisImg : "";
    const serialLast = Math.max(0, Math.floor(Number(parsed.serialLast || 0)));

    const adminsRaw = Array.isArray(parsed.admins) ? parsed.admins : [];
    const admins = adminsRaw
      .map((a) => ({
        username: normalizeUsername(a?.username),
        salt: safeText(a?.salt),
        hash: safeText(a?.hash),
        createdAt: safeText(a?.createdAt) || new Date().toISOString()
      }))
      .filter((a) => a.username && a.salt && a.hash);
    if (!admins.length) {
      const def = makeAdminUser(ADMIN_USER, ADMIN_PASS);
      if (def) admins.push(def);
    }

    const discountsRaw = Array.isArray(parsed.discounts) ? parsed.discounts : [];
    const discounts = discountsRaw.map(normalizeDiscount).filter(Boolean);
    const tables = parsed.tables && typeof parsed.tables === "object" ? parsed.tables : initTables(tableCount);

    // Normalisasi tables -> pastikan semua meja ada
    const fixedTables = initTables(tableCount);
    for (let i = 1; i <= tableCount; i += 1) {
      const k = String(i);
      fixedTables[k] = typeof tables[k] === "string" && tables[k] ? tables[k] : null;
    }

    // Rebuild occupancy dari order yang masih OPEN (jika data lama tidak konsisten)
    for (const o of orders) {
      const status = String(o?.status || "DONE").toUpperCase();
      const type = String(o?.type || "");
      const tableNumber = sanitizeTableNumber(o?.tableNumber, tableCount);
      if (status === "OPEN" && type === "Dine-in" && tableNumber) {
        const k = String(tableNumber);
        if (!fixedTables[k]) fixedTables[k] = String(o.id || "");
      }
    }

    const next = {
      menu: normalizedMenu,
      stock,
      settings,
      queue: fixedQueue,
      qrisImg,
      serialLast,
      admins,
      discounts,
      orders,
      tables: fixedTables
    };

    // normalisasi tersimpan jika ada perbedaan
    await saveState(next);
    return next;
  } catch {
    // fallback jika file rusak
    const today = getTodayKey();
    const { stock } = ensureStockForMenu(DEFAULT_MENU, {});
    const defaultAdmin = makeAdminUser(ADMIN_USER, ADMIN_PASS);
    const init = {
      menu: DEFAULT_MENU,
      stock,
      settings: { maxPerItem: 5, tableCount: DEFAULT_TABLE_COUNT, enableTableSelection: false },
      queue: { lastKey: today, lastNumber: 0 },
      qrisImg: "",
      serialLast: 0,
      admins: defaultAdmin ? [defaultAdmin] : [],
      discounts: [],
      orders: [],
      tables: initTables(DEFAULT_TABLE_COUNT)
    };
    await saveState(init);
    return init;
  }
}

async function saveState(state) {
  await fsp.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function publicState(state) {
  const s = state?.settings && typeof state.settings === "object" ? state.settings : {};
  const maxPerItem = Number.isFinite(Number(s.maxPerItem)) && Number(s.maxPerItem) >= 1 ? Math.floor(Number(s.maxPerItem)) : 5;
  const tableCount = normalizeTableCount(s.tableCount);
  const enableTableSelection = s.enableTableSelection !== undefined ? !!s.enableTableSelection : false;

  const t = state.tables && typeof state.tables === "object" ? state.tables : initTables(tableCount);
  const tablesPublic = {};
  for (let i = 1; i <= tableCount; i += 1) {
    const k = String(i);
    tablesPublic[k] = !!t[k]; // hanya status occupied
  }
  return {
    menu: state.menu,
    stock: state.stock,
    settings: { maxPerItem, tableCount, enableTableSelection },
    queue: state.queue,
    qrisImg: state.qrisImg,
    tables: tablesPublic
  };
}

function adminStateForUi(state) {
  const s = state?.settings && typeof state.settings === "object" ? state.settings : {};
  const maxPerItem = Number.isFinite(Number(s.maxPerItem)) && Number(s.maxPerItem) >= 1 ? Math.floor(Number(s.maxPerItem)) : 5;
  const tableCount = normalizeTableCount(s.tableCount);
  const enableTableSelection = s.enableTableSelection !== undefined ? !!s.enableTableSelection : false;
  const settings = { maxPerItem, tableCount, enableTableSelection };

  const tables = state.tables && typeof state.tables === "object" ? state.tables : initTables(tableCount);
  const admins = Array.isArray(state.admins)
    ? state.admins.map((a) => ({ username: normalizeUsername(a?.username), createdAt: safeText(a?.createdAt) }))
      .filter((a) => a.username)
    : [];
  const discounts = Array.isArray(state.discounts) ? state.discounts.map(normalizeDiscount).filter(Boolean) : [];
  const orders = Array.isArray(state.orders) ? state.orders : [];

  return {
    menu: state.menu,
    stock: state.stock,
    settings,
    queue: state.queue,
    qrisImg: state.qrisImg,
    orders,
    tables,
    admins,
    discounts
  };
}

function escapeCsvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ====== App ======
const app = express();
app.use(express.json({ limit: "6mb" })); // untuk dataURL QRIS

// serve static web
app.use(express.static(__dirname, { extensions: ["html"] }));

const server = http.createServer(app);
const io = new Server(server);

let STATE = null;
const adminTokens = new Map(); // token -> createdAt

function emitStateUpdate() {
  io.emit("state:update", publicState(STATE));
}

function emitOrdersUpdate(order) {
  // kirim order baru hanya ke room admin (agar data customer tidak terbuka ke publik)
  io.to("admins").emit("orders:new", order);
}

function getAuthToken(req) {
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const alt = String(req.headers["x-admin-token"] || "").trim();
  return alt;
}

function requireAdmin(req, res, next) {
  const token = getAuthToken(req);
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: "UNAUTHORIZED" });
  return next();
}

// ====== API (Public) ======
app.get("/api/state", async (_req, res) => {
  res.json(publicState(STATE));
});

app.post("/api/discount/validate", async (req, res) => {
  const code = normalizeDiscountCode(req.body?.code);
  const subtotal = Math.max(0, Math.floor(Number(req.body?.subtotal ?? req.body?.total ?? 0)));
  if (!code) return res.status(400).json({ error: "KODE_DISKON_TIDAK_VALID" });
  if (!Number.isFinite(subtotal) || subtotal < 0) return res.status(400).json({ error: "SUBTOTAL_TIDAK_VALID" });

  const discounts = Array.isArray(STATE?.discounts) ? STATE.discounts : [];
  const d = discounts.map(normalizeDiscount).filter(Boolean).find((x) => x.code === code && x.active);
  if (!d) return res.status(404).json({ error: "KODE_DISKON_TIDAK_DITEMUKAN" });

  const { amount, totalAfter } = applyDiscount(d, subtotal);
  return res.json({
    ok: true,
    code: d.code,
    type: d.type,
    value: d.value,
    discountAmount: amount,
    totalAfterDiscount: totalAfter
  });
});

app.post("/api/order", async (req, res) => {
  try {
    const buyerName = safeText(req.body?.buyerName);
    const type = safeText(req.body?.type);
    const payment = safeText(req.body?.payment);
    const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];
    const tableNumber = sanitizeTableNumber(req.body?.tableNumber, STATE?.settings?.tableCount);
    const discountCode = normalizeDiscountCode(req.body?.discountCode);
    const tableEnabled = !!STATE?.settings?.enableTableSelection;

    if (!buyerName) return res.status(400).json({ error: "Nama pemesan wajib diisi." });
    if (!type) return res.status(400).json({ error: "Tipe pesanan wajib dipilih." });
    if (!payment) return res.status(400).json({ error: "Metode pembayaran wajib dipilih." });

    // Meja hanya untuk Dine-in
    if (type === "Dine-in" && tableEnabled) {
      if (!tableNumber) return res.status(400).json({ error: "Nomor meja wajib untuk Dine-in." });
      const tables = STATE.tables && typeof STATE.tables === "object" ? STATE.tables : initTables(STATE?.settings?.tableCount);
      if (tables[String(tableNumber)]) {
        return res.status(400).json({ error: `Meja ${tableNumber} sedang terisi. Minta admin mengosongkan meja dulu.` });
      }
    }

    const menuById = new Map(STATE.menu.map((m) => [m.id, m]));
    const items = itemsInput
      .map((it) => ({ id: safeText(it.id), qty: Math.floor(Number(it.qty || 0)) }))
      .filter((it) => it.id && it.qty > 0 && menuById.has(it.id));

    if (!items.length) return res.status(400).json({ error: "Minimal pilih 1 menu." });

    // validasi max + stok
    for (const it of items) {
      if (it.qty > STATE.settings.maxPerItem) {
        return res.status(400).json({ error: `Maksimal beli per menu adalah ${STATE.settings.maxPerItem} pcs.` });
      }
      const s = Number(STATE.stock[it.id] ?? 0);
      if (it.qty > s) {
        const nm = menuById.get(it.id)?.name || it.id;
        return res.status(400).json({ error: `Stok tidak cukup untuk ${nm}. (Sisa stok: ${s})` });
      }
    }

    // potong stok
    const nextStock = { ...STATE.stock };
    for (const it of items) nextStock[it.id] = Number(nextStock[it.id] ?? 0) - it.qty;

    // nomor antrian (auto reset harian)
    const today = getTodayKey();
    const nextQueue = STATE.queue?.lastKey === today ? { ...STATE.queue } : { lastKey: today, lastNumber: 0 };
    nextQueue.lastNumber = (nextQueue.lastNumber || 0) + 1;

    // serial id (global, tidak reset harian)
    const nextSerialLast = Math.max(0, Math.floor(Number(STATE.serialLast || 0))) + 1;
    const serial = `TERICE-${String(nextSerialLast).padStart(6, "0")}`;

    const nowIso = new Date().toISOString();
    const fullItems = items.map((it) => {
      const m = menuById.get(it.id);
      return { id: m.id, name: m.name, category: m.category, price: Number(m.price || 0), qty: it.qty };
    });
    const subtotal = fullItems.reduce((sum, it) => sum + it.qty * it.price, 0);

    // diskon (opsional)
    let discount = null;
    let discountAmount = 0;
    let total = subtotal;
    if (discountCode) {
      const discounts = Array.isArray(STATE?.discounts) ? STATE.discounts : [];
      const d = discounts.map(normalizeDiscount).filter(Boolean).find((x) => x.code === discountCode && x.active);
      if (!d) return res.status(400).json({ error: "Kode diskon tidak valid / tidak aktif." });
      const applied = applyDiscount(d, subtotal);
      discountAmount = applied.amount;
      total = applied.totalAfter;
      discount = { code: d.code, type: d.type, value: d.value, amount: discountAmount };
    }

    const order = {
      id: `q${nextQueue.lastNumber}_${Date.now()}`,
      serial,
      queueNumber: nextQueue.lastNumber,
      buyerName,
      type,
      tableNumber: type === "Dine-in" && tableEnabled ? tableNumber : null,
      payment,
      paid: false,
      paidAt: null,
      subtotal,
      discount,
      total,
      time: nowIso,
      timestampText: formatTimestampText(nowIso),
      items: fullItems.map((x) => ({ id: x.id, name: x.name, price: x.price, qty: x.qty })),
      status: type === "Dine-in" ? "OPEN" : "DONE"
    };

    const nextOrders = [order, ...(STATE.orders || [])].slice(0, 1000);
    const nextTables = STATE.tables && typeof STATE.tables === "object" ? { ...STATE.tables } : initTables(STATE?.settings?.tableCount);
    if (type === "Dine-in" && tableEnabled && tableNumber) nextTables[String(tableNumber)] = order.id;
    STATE = { ...STATE, stock: nextStock, queue: nextQueue, serialLast: nextSerialLast, orders: nextOrders, tables: nextTables };
    await saveState(STATE);

    emitStateUpdate();
    emitOrdersUpdate(order);

    res.json({ order });
  } catch (e) {
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ====== API (Admin) ======
app.post("/api/admin/login", async (req, res) => {
  const u = normalizeUsername(req.body?.username);
  const p = String(req.body?.password || "");

  const admins = Array.isArray(STATE?.admins) ? STATE.admins : [];
  const found = admins.find((a) => normalizeUsername(a?.username) === u);
  const ok = found ? verifyAdminPassword(found, p) : false;

  // fallback kompatibilitas (jika state lama belum punya admins)
  const okLegacy = !admins.length && safeText(req.body?.username) === ADMIN_USER && p === ADMIN_PASS;

  if (ok || okLegacy) {
    const token = crypto.randomUUID();
    adminTokens.set(token, { createdAt: Date.now(), username: u || normalizeUsername(ADMIN_USER) });
    return res.json({ token });
  }
  return res.status(401).json({ error: "USERNAME_PASSWORD_SALAH" });
});

app.get("/api/admin/state", requireAdmin, async (_req, res) => {
  res.json(adminStateForUi(STATE));
});

// ====== Admin Users ======
app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const admins = Array.isArray(STATE?.admins) ? STATE.admins : [];
  const users = admins
    .map((a) => ({ username: normalizeUsername(a?.username), createdAt: safeText(a?.createdAt) }))
    .filter((a) => a.username);
  res.json({ users });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  if (!username) return res.status(400).json({ error: "Username tidak valid." });
  if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter." });

  const admins = Array.isArray(STATE?.admins) ? [...STATE.admins] : [];
  if (admins.some((a) => normalizeUsername(a?.username) === username)) {
    return res.status(400).json({ error: "Username sudah ada." });
  }
  const nu = makeAdminUser(username, password);
  if (!nu) return res.status(400).json({ error: "Gagal membuat user admin." });
  admins.push(nu);
  STATE = { ...STATE, admins };
  await saveState(STATE);
  res.json({ ok: true });
});

app.post("/api/admin/users/:username/password", requireAdmin, async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const password = String(req.body?.password || "");
  if (!username) return res.status(400).json({ error: "Username tidak valid." });
  if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter." });

  const admins = Array.isArray(STATE?.admins) ? [...STATE.admins] : [];
  const idx = admins.findIndex((a) => normalizeUsername(a?.username) === username);
  if (idx < 0) return res.status(404).json({ error: "USER_TIDAK_DITEMUKAN" });
  const next = makeAdminUser(username, password);
  if (!next) return res.status(400).json({ error: "Gagal mengubah password." });
  next.createdAt = admins[idx]?.createdAt || next.createdAt;
  admins[idx] = next;
  STATE = { ...STATE, admins };
  await saveState(STATE);
  res.json({ ok: true });
});

app.post("/api/admin/users/:username/delete", requireAdmin, async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) return res.status(400).json({ error: "Username tidak valid." });
  const admins = Array.isArray(STATE?.admins) ? [...STATE.admins] : [];
  if (admins.length <= 1) return res.status(400).json({ error: "Minimal harus ada 1 akun admin." });
  const next = admins.filter((a) => normalizeUsername(a?.username) !== username);
  if (next.length === admins.length) return res.status(404).json({ error: "USER_TIDAK_DITEMUKAN" });
  if (next.length <= 0) return res.status(400).json({ error: "Minimal harus ada 1 akun admin." });
  STATE = { ...STATE, admins: next };
  await saveState(STATE);
  res.json({ ok: true });
});

// ====== Discounts ======
app.post("/api/admin/discounts/add", requireAdmin, async (req, res) => {
  const d = normalizeDiscount(req.body);
  if (!d) return res.status(400).json({ error: "Data diskon tidak valid." });
  const discounts = Array.isArray(STATE?.discounts) ? [...STATE.discounts].map(normalizeDiscount).filter(Boolean) : [];
  if (discounts.some((x) => x.code === d.code)) return res.status(400).json({ error: "Kode diskon sudah ada." });
  discounts.unshift(d);
  STATE = { ...STATE, discounts };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/discounts/:code/update", requireAdmin, async (req, res) => {
  const code = normalizeDiscountCode(req.params.code);
  if (!code) return res.status(400).json({ error: "Kode diskon tidak valid." });
  const discounts = Array.isArray(STATE?.discounts) ? [...STATE.discounts].map(normalizeDiscount).filter(Boolean) : [];
  const idx = discounts.findIndex((x) => x.code === code);
  if (idx < 0) return res.status(404).json({ error: "KODE_DISKON_TIDAK_DITEMUKAN" });
  const next = normalizeDiscount({ ...discounts[idx], ...req.body, code });
  if (!next) return res.status(400).json({ error: "Data diskon tidak valid." });
  discounts[idx] = next;
  STATE = { ...STATE, discounts };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/discounts/:code/delete", requireAdmin, async (req, res) => {
  const code = normalizeDiscountCode(req.params.code);
  if (!code) return res.status(400).json({ error: "Kode diskon tidak valid." });
  const discounts = Array.isArray(STATE?.discounts) ? [...STATE.discounts].map(normalizeDiscount).filter(Boolean) : [];
  const next = discounts.filter((x) => x.code !== code);
  if (next.length === discounts.length) return res.status(404).json({ error: "KODE_DISKON_TIDAK_DITEMUKAN" });
  STATE = { ...STATE, discounts: next };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const nextSettings = STATE?.settings && typeof STATE.settings === "object" ? { ...STATE.settings } : {};

  if (body.maxPerItem !== undefined) {
    const max = Math.floor(Number(body.maxPerItem || 0));
    if (!Number.isFinite(max) || max < 1) return res.status(400).json({ error: "maxPerItem tidak valid" });
    nextSettings.maxPerItem = max;
  }

  if (body.tableCount !== undefined) {
    const nextCount = normalizeTableCount(body.tableCount);
    const curCount = normalizeTableCount(nextSettings.tableCount);

    // jika menurunkan jumlah meja, pastikan meja yang akan dihapus tidak sedang terisi
    if (nextCount < curCount) {
      const tables = STATE.tables && typeof STATE.tables === "object" ? STATE.tables : initTables(curCount);
      for (let i = nextCount + 1; i <= curCount; i += 1) {
        if (tables[String(i)]) {
          return res.status(400).json({ error: `Tidak bisa mengurangi meja. Meja ${i} masih terisi.` });
        }
      }
    }

    // sesuaikan struktur tables agar sesuai dengan count terbaru
    const curTables = STATE.tables && typeof STATE.tables === "object" ? STATE.tables : initTables(curCount);
    const resizedTables = initTables(nextCount);
    for (let i = 1; i <= nextCount; i += 1) resizedTables[String(i)] = curTables[String(i)] || null;

    STATE = { ...STATE, tables: resizedTables };
    nextSettings.tableCount = nextCount;
  }

  // pastikan default jika field kosong
  if (!Number.isFinite(Number(nextSettings.maxPerItem)) || Number(nextSettings.maxPerItem) < 1) nextSettings.maxPerItem = 5;
  nextSettings.tableCount = normalizeTableCount(nextSettings.tableCount);
  nextSettings.enableTableSelection = nextSettings.enableTableSelection !== undefined ? !!nextSettings.enableTableSelection : false;

  if (body.enableTableSelection !== undefined) {
    nextSettings.enableTableSelection = !!body.enableTableSelection;
  }

  STATE = { ...STATE, settings: nextSettings };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/queue/reset", requireAdmin, async (_req, res) => {
  const today = getTodayKey();
  STATE = { ...STATE, queue: { lastKey: today, lastNumber: 0 } };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/qris", requireAdmin, async (req, res) => {
  const qrisImg = typeof req.body?.qrisImg === "string" ? req.body.qrisImg : "";
  STATE = { ...STATE, qrisImg };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/menu", requireAdmin, async (req, res) => {
  const menu = Array.isArray(req.body?.menu) ? req.body.menu : [];
  const stock = req.body?.stock && typeof req.body.stock === "object" ? req.body.stock : {};

  const normalizedMenu = menu
    .map((m) => ({
      id: safeText(m.id),
      name: safeText(m.name),
      category: normalizeCategory(m.category),
      price: Math.floor(Number(m.price || 0))
    }))
    .filter((m) => m.id && m.name && Number.isFinite(m.price) && m.price >= 0);

  if (!normalizedMenu.length) return res.status(400).json({ error: "Menu kosong / tidak valid." });

  const { stock: fixedStock } = ensureStockForMenu(normalizedMenu, stock);
  STATE = { ...STATE, menu: normalizedMenu, stock: fixedStock };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/orders/:id/complete", requireAdmin, async (req, res) => {
  const id = safeText(req.params.id);
  const orders = Array.isArray(STATE.orders) ? [...STATE.orders] : [];
  const idx = orders.findIndex((o) => String(o.id) === id);
  if (idx < 0) return res.status(404).json({ error: "ORDER_TIDAK_DITEMUKAN" });

  const order = { ...orders[idx] };
  order.status = "DONE";
  orders[idx] = order;

  const nextTables = STATE.tables && typeof STATE.tables === "object"
    ? { ...STATE.tables }
    : initTables(STATE?.settings?.tableCount);
  const tableNumber = sanitizeTableNumber(order.tableNumber, STATE?.settings?.tableCount);
  if (tableNumber && nextTables[String(tableNumber)] === order.id) nextTables[String(tableNumber)] = null;

  STATE = { ...STATE, orders, tables: nextTables };
  await saveState(STATE);
  emitStateUpdate();

  res.json({ ok: true, order });
});

app.post("/api/admin/orders/:id/pay", requireAdmin, async (req, res) => {
  const id = safeText(req.params.id);
  const paid = !!req.body?.paid;
  const orders = Array.isArray(STATE.orders) ? [...STATE.orders] : [];
  const idx = orders.findIndex((o) => String(o.id) === id);
  if (idx < 0) return res.status(404).json({ error: "ORDER_TIDAK_DITEMUKAN" });

  const order = { ...orders[idx] };
  order.paid = paid;
  order.paidAt = paid ? new Date().toISOString() : null;
  orders[idx] = order;

  STATE = { ...STATE, orders };
  await saveState(STATE);

  io.to("admins").emit("orders:update", { id, paid: order.paid, paidAt: order.paidAt });
  res.json({ ok: true, order });
});

app.post("/api/admin/tables/:no/clear", requireAdmin, async (req, res) => {
  const no = sanitizeTableNumber(req.params.no, STATE?.settings?.tableCount);
  if (!no) return res.status(400).json({ error: "NOMOR_MEJA_TIDAK_VALID" });

  const nextTables = STATE.tables && typeof STATE.tables === "object"
    ? { ...STATE.tables }
    : initTables(STATE?.settings?.tableCount);
  nextTables[String(no)] = null;
  STATE = { ...STATE, tables: nextTables };
  await saveState(STATE);
  emitStateUpdate();
  res.json({ ok: true });
});

app.post("/api/admin/orders/clear", requireAdmin, async (_req, res) => {
  STATE = { ...STATE, orders: [], tables: initTables(STATE?.settings?.tableCount) };
  await saveState(STATE);
  // tidak perlu emit orders:new; cukup update state public (menu/stok/setting/queue/qris) tetap sama
  emitStateUpdate();
  res.json({ ok: true });
});

app.get("/api/admin/sales.csv", requireAdmin, async (req, res) => {
  const from = safeText(req.query.from);
  const to = safeText(req.query.to);

  // Jika kosong: semua data
  const fromKey = from || "0000-01-01";
  const toKey = to || "9999-12-31";

  const rows = [];
  rows.push(
    [
      "order_id",
      "serial",
      "tanggal",
      "waktu",
      "no_antrian",
      "nama",
      "tipe",
      "nomor_meja",
      "pembayaran",
      "status",
      "status_bayar",
      "diskon_kode",
      "diskon_jumlah",
      "item_id",
      "item_nama",
      "qty",
      "harga",
      "subtotal_item",
      "subtotal_order",
      "total_order"
    ].map(escapeCsvCell).join(",")
  );

  let grandTotal = 0;
  let totalQty = 0;

  for (const o of STATE.orders || []) {
    const localKey = getTodayKey(new Date(o.time));
    if (localKey < fromKey || localKey > toKey) continue;

    const tsText = formatTimestampText(o.time);
    const timeOnly = tsText.split(" • ")[1] || "";

    for (const it of o.items || []) {
      const subtotal = Number(it.qty || 0) * Number(it.price || 0);
      const disc = o.discount && typeof o.discount === "object" ? o.discount : null;
      rows.push(
        [
          o.id,
          String(o.serial || ""),
          localKey,
          timeOnly,
          String(o.queueNumber || ""),
          o.buyerName || "",
          o.type || "",
          String(o.tableNumber || ""),
          o.payment || "",
          String(o.status || ""),
          o.paid ? "SUDAH" : "BELUM",
          String(disc?.code || ""),
          String(disc?.amount || 0),
          it.id || "",
          it.name || "",
          String(it.qty || 0),
          String(it.price || 0),
          String(subtotal || 0),
          String(o.subtotal || 0),
          String(o.total || 0)
        ].map(escapeCsvCell).join(",")
      );
      totalQty += Number(it.qty || 0);
    }
    grandTotal += Number(o.total || 0);
  }

  rows.push("");
  rows.push(
    [
      "RINGKASAN",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ].map(escapeCsvCell).join(",")
  );
  rows.push(["TOTAL_QTY", String(totalQty)].map(escapeCsvCell).join(","));
  rows.push(["TOTAL_PENDAPATAN", String(grandTotal), rupiah(grandTotal)].map(escapeCsvCell).join(","));

  const fileName = `rekapan_penjualan_${from || "all"}_${to || "all"}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(rows.join("\n"));
});

// ====== Socket.IO ======
io.on("connection", (socket) => {
  // kirim state awal (public)
  socket.emit("state:update", publicState(STATE));

  // admin auth untuk menerima event sensitif (orders:new)
  socket.on("admin:auth", (token, ack) => {
    const ok = !!token && adminTokens.has(String(token));
    if (ok) socket.join("admins");
    if (typeof ack === "function") ack({ ok });
  });
});

// ====== Start ======
(async () => {
  STATE = await loadState();
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`TerasIce realtime running on http://localhost:${PORT}`);
  });
})();
