/* TerasIce - Laman Pemesanan (Realtime via Socket.IO + backend) */

const TZ = "Asia/Jakarta"; // WIB

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

function getNowParts() {
  const dt = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(dt.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return map;
}

function getTodayKey() {
  const dt = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(dt.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`; // YYYY-MM-DD
}

function safeFilePart(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-#]/g, "");
}

// ====== Info WiFi (untuk Nota) ======
const WIFI_USERNAME = "TERAS SCOOPS";
const WIFI_PASSWORD = "0987654321";

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let serverState = {
  menu: [],
  stock: {},
  settings: { maxPerItem: 5, tableCount: 10, enableTableSelection: false },
  queue: { lastKey: getTodayKey(), lastNumber: 0 },
  qrisImg: "",
  tables: {}
};

async function fetchState() {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (!r.ok) throw new Error("Gagal memuat state dari server.");
  serverState = await r.json();
}

function getMenu() {
  const menu = Array.isArray(serverState.menu) ? serverState.menu : [];
  return menu
    .map((m) => ({
      ...m,
      category: normalizeCategory(m.category),
      price: Number(m.price || 0),
      name: String(m.name || "").trim(),
      id: String(m.id || "").trim()
    }))
    .filter((m) => m.id && m.name);
}
function getStock() {
  return serverState.stock && typeof serverState.stock === "object" ? serverState.stock : {};
}
function getSettings() {
  const s = serverState.settings || {};
  const maxPerItem = Number.isFinite(Number(s.maxPerItem)) && Number(s.maxPerItem) >= 1 ? Number(s.maxPerItem) : 5;
  const tableCount = Number.isFinite(Number(s.tableCount)) && Number(s.tableCount) >= 1 ? Number(s.tableCount) : 10;
  const enableTableSelection = s.enableTableSelection !== undefined ? !!s.enableTableSelection : false;
  return {
    maxPerItem: Math.floor(maxPerItem),
    tableCount: Math.min(50, Math.floor(tableCount)),
    enableTableSelection
  };
}
function getQueueState() {
  return serverState.queue && typeof serverState.queue === "object" ? serverState.queue : { lastKey: getTodayKey(), lastNumber: 0 };
}

function setCopyrightYear() {
  const el = document.getElementById("copyrightYear");
  if (!el) return;
  el.textContent = String(new Date().getFullYear());
}

function renderClock() {
  const p = getNowParts();
  const text = `${p.weekday}, ${p.day} ${p.month} ${p.year} • ${p.hour}.${p.minute} WIB`;
  const el = document.getElementById("clockChip");
  if (el) el.textContent = text;
}

function renderQueueChip() {
  const q = getQueueState();
  const el = document.getElementById("queueChip");
  if (!el) return;
  el.textContent = `Antrian hari ini: #${String(q.lastNumber || 0).padStart(3, "0")}`;
}

const state = {
  menu: [],
  cart: {},
  buyerName: "",
  lastOrder: null,
  tableNumber: null, // khusus Dine-in
  tableFromUrl: null,
  discountCode: "",
  discount: null // {code,type,value,discountAmount,totalAfterDiscount}
};

function parseTableFromUrl() {
  const sp = new URLSearchParams(window.location.search || "");
  const raw = sp.get("meja") || sp.get("table") || "";
  const n = Math.floor(Number(raw || 0));
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  return null;
}

function isTableOccupied(n) {
  const t = serverState.tables && typeof serverState.tables === "object" ? serverState.tables : {};
  const v = t[String(n)];
  return !!v;
}

function normalizeTableNumber(n) {
  const tc = getSettings().tableCount;
  const x = Math.floor(Number(n || 0));
  if (Number.isFinite(x) && x >= 1 && x <= tc) return x;
  return null;
}

function buildTableOptions(selectEl) {
  const tc = getSettings().tableCount;
  const selected = normalizeTableNumber(state.tableNumber);
  const prev = selectEl.value;

  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Pilih meja…";
  selectEl.appendChild(opt0);

  for (let i = 1; i <= tc; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Meja ${i}`;
    if (isTableOccupied(i) && i !== selected) opt.disabled = true;
    selectEl.appendChild(opt);
  }

  // restore selection
  if (selected) selectEl.value = String(selected);
  else if (prev) selectEl.value = prev;
  else selectEl.value = "";
}

function syncCartWithMenu(menu) {
  const next = { ...(state.cart || {}) };
  for (const m of menu) {
    if (!Number.isFinite(Number(next[m.id]))) next[m.id] = 0;
  }
  for (const key of Object.keys(next)) {
    if (!menu.some((m) => m.id === key)) delete next[key];
  }
  state.cart = next;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function createItemCard(m, settings) {
  const wrap = document.createElement("div");
  wrap.className = "item";
  wrap.dataset.id = m.id;

  const top = document.createElement("div");
  top.className = "item__top";

  const left = document.createElement("div");
  const name = document.createElement("div");
  name.className = "item__name";
  name.textContent = m.name;

  const badge = document.createElement("div");
  badge.className = "badge";
  left.appendChild(name);
  left.appendChild(badge);

  const price = document.createElement("div");
  price.className = "item__price";
  price.textContent = rupiah(m.price);

  top.appendChild(left);
  top.appendChild(price);

  const qty = document.createElement("div");
  qty.className = "qty";

  const control = document.createElement("div");
  control.className = "qty__control";

  const btnMinus = document.createElement("button");
  btnMinus.className = "qty__btn";
  btnMinus.textContent = "−";
  btnMinus.type = "button";

  const input = document.createElement("input");
  input.className = "qty__input";
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = "0";
  input.inputMode = "numeric";

  const btnPlus = document.createElement("button");
  btnPlus.className = "qty__btn";
  btnPlus.textContent = "+";
  btnPlus.type = "button";

  control.appendChild(btnMinus);
  control.appendChild(input);
  control.appendChild(btnPlus);
  qty.appendChild(control);

  function syncButtons() {
    const stock = getStock();
    const s = Number(stock[m.id] ?? 0);
    badge.className = "badge" + (s <= 0 ? " badge--danger" : "");
    badge.textContent = s <= 0 ? "Stok habis" : `Stok: ${s}`;

    const cur = Number(input.value || 0);
    const maxNow = Math.min(settings.maxPerItem, s);
    input.max = String(maxNow);
    btnMinus.disabled = cur <= 0;
    btnPlus.disabled = cur >= maxNow || maxNow <= 0;
    input.disabled = maxNow <= 0;
  }

  function setQty(next) {
    const stock = getStock();
    const s = Number(stock[m.id] ?? 0);
    const maxNow = Math.min(settings.maxPerItem, s);
    const safe = clamp(Number(next || 0), 0, maxNow);
    input.value = String(safe);
    state.cart[m.id] = safe;
    syncButtons();
    updateSummary();
  }

  btnMinus.addEventListener("click", () => setQty(Number(input.value || 0) - 1));
  btnPlus.addEventListener("click", () => setQty(Number(input.value || 0) + 1));
  input.addEventListener("input", () => setQty(input.value));

  // init
  syncButtons();

  wrap.appendChild(top);
  wrap.appendChild(qty);
  return { el: wrap, syncButtons };
}

function getSelectedValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : "";
}

function getCartSubtotal() {
  return state.menu.reduce((sum, m) => sum + (state.cart[m.id] || 0) * m.price, 0);
}

let discountRevalidateTimer = null;
let lastSubtotalForDiscount = null;

async function validateDiscount({ silent = false } = {}) {
  const input = document.getElementById("discountCode");
  const hint = document.getElementById("discountHint");
  const codeRaw = (input ? input.value : state.discountCode || "").trim();

  state.discountCode = codeRaw;
  if (!codeRaw) {
    state.discount = null;
    if (hint) hint.textContent = "";
    return true;
  }

  const subtotal = getCartSubtotal();
  if (subtotal <= 0) {
    state.discount = null;
    if (hint) hint.textContent = "";
    if (!silent) alert("Diskon hanya bisa dipakai jika sudah memilih minimal 1 menu.");
    return false;
  }

  try {
    const r = await fetch("/api/discount/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeRaw, subtotal })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.discount = null;
      if (hint) hint.textContent = "Kode diskon tidak valid / tidak aktif.";
      if (!silent) alert(data?.error || "Kode diskon tidak valid / tidak aktif.");
      return false;
    }
    state.discount = data;
    if (hint) hint.textContent = `Diskon ${data.code} diterapkan (−${rupiah(data.discountAmount)}).`;
    updateSummary({ skipDiscountRevalidate: true });
    return true;
  } catch {
    state.discount = null;
    if (hint) hint.textContent = "Gagal memvalidasi kode diskon (cek koneksi/server).";
    if (!silent) alert("Gagal memvalidasi kode diskon. Pastikan server berjalan.");
    return false;
  }
}

function updateSummary({ skipDiscountRevalidate = false } = {}) {
  const subtotal = getCartSubtotal();
  const discountAmount = state.discount && typeof state.discount === "object" ? Number(state.discount.discountAmount || 0) : 0;
  const totalPay = Math.max(0, subtotal - Math.max(0, discountAmount));
  const name = (state.buyerName || "").trim() || "—";
  const type = getSelectedValue("orderType") || "—";
  const pay = getSelectedValue("payment") || "—";
  const elSubtotal = document.getElementById("summarySubtotal");
  const elDiscount = document.getElementById("summaryDiscount");
  if (elSubtotal) elSubtotal.textContent = rupiah(subtotal);
  if (elDiscount) elDiscount.textContent = discountAmount > 0 ? `−${rupiah(discountAmount)}` : rupiah(0);
  document.getElementById("summaryTotal").textContent = rupiah(totalPay);
  document.getElementById("summaryName").textContent = name;
  document.getElementById("summaryType").textContent = type;
  document.getElementById("summaryPay").textContent = pay;

  // revalidasi diskon jika subtotal berubah (tanpa spam request)
  if (!skipDiscountRevalidate && state.discountCode) {
    if (lastSubtotalForDiscount !== subtotal) {
      lastSubtotalForDiscount = subtotal;
      if (discountRevalidateTimer) clearTimeout(discountRevalidateTimer);
      discountRevalidateTimer = setTimeout(() => validateDiscount({ silent: true }), 350);
    }
  }
}

let itemCardSyncFns = [];

function renderTableSection() {
  const type = getSelectedValue("orderType");
  const card = document.getElementById("tableCard");
  const input = document.getElementById("tableNumber");
  const hint = document.getElementById("tableHint");
  if (!card || !input || !hint) return;

  const settings = getSettings();
  const show = type === "Dine-in" && settings.enableTableSelection;
  card.style.display = show ? "" : "none";
  if (!show) {
    // jika fitur pemilihan meja dimatikan, jangan pakai tableNumber sama sekali
    state.tableNumber = null;
    return;
  }

  // set default dari URL (jika ada) selama masih valid
  const tc = settings.tableCount;
  if (!state.tableNumber && state.tableFromUrl && state.tableFromUrl <= tc) state.tableNumber = state.tableFromUrl;
  if (state.tableNumber && state.tableNumber > tc) state.tableNumber = null;

  buildTableOptions(input);

  const selected = normalizeTableNumber(input.value);
  state.tableNumber = selected;

  if (!selected) {
    hint.textContent = "Silakan pilih nomor meja untuk Dine-in.";
    return;
  }

  if (isTableOccupied(selected)) {
    hint.textContent = "Status: Meja ini sedang terisi. Jika ingin pesan, minta admin mengosongkan meja terlebih dahulu.";
  } else {
    hint.textContent = "Status: Meja tersedia.";
  }
}

function rerenderMenu() {
  const menu = getMenu();
  state.menu = menu;
  syncCartWithMenu(menu);

  const settings = getSettings();
  document.getElementById("maxPerItemLabel").textContent = String(settings.maxPerItem);

  const iceGrid = document.getElementById("icecreamGrid");
  const floatGrid = document.getElementById("floatGrid");
  iceGrid.innerHTML = "";
  floatGrid.innerHTML = "";
  itemCardSyncFns = [];

  for (const m of menu) {
    const { el, syncButtons } = createItemCard(m, settings);
    itemCardSyncFns.push(syncButtons);
    if (m.category === "ICE_CREAM") iceGrid.appendChild(el);
    else floatGrid.appendChild(el);
  }
}

function openModal() {
  const modal = document.getElementById("modal");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  const modal = document.getElementById("modal");
  modal.setAttribute("aria-hidden", "true");
}
function bindModal() {
  const modal = document.getElementById("modal");
  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "true") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

function buildTicket({
  serial,
  queueNumber,
  buyerName,
  type,
  tableNumber,
  payment,
  paid,
  items,
  subtotal,
  discount,
  total,
  timestampText
}) {
  document.getElementById("ticketQueue").textContent = `#${String(queueNumber).padStart(3, "0")}`;
  document.getElementById("ticketTime").textContent = timestampText;
  const serialEl = document.getElementById("ticketSerial");
  if (serialEl) serialEl.textContent = serial ? `ID Pesanan: ${serial}` : "—";
  const safeName = (buyerName || "").trim();
  const meja = type === "Dine-in" && tableNumber ? ` • Meja ${tableNumber}` : "";
  const paidText = paid ? "SUDAH BAYAR" : "BELUM BAYAR";
  document.getElementById("ticketTypePay").textContent = safeName
    ? `${safeName} • ${type}${meja} • ${payment} • ${paidText}`
    : `${type}${meja} • ${payment} • ${paidText}`;
  document.getElementById("ticketTotal").textContent = rupiah(total);

  const box = document.getElementById("ticketItems");
  box.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "ticket__row";
    row.innerHTML = `<div><b>${it.qty}×</b> ${it.name}</div><div>${rupiah(it.qty * it.price)}</div>`;
    box.appendChild(row);
  }

  const sub = Number.isFinite(Number(subtotal)) ? Number(subtotal) : items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);
  const disc = discount && typeof discount === "object" ? discount : null;
  if (disc && Number(disc.amount || 0) > 0) {
    const r1 = document.createElement("div");
    r1.className = "ticket__row";
    r1.innerHTML = `<div><b>Subtotal</b></div><div>${rupiah(sub)}</div>`;
    box.appendChild(r1);

    const r2 = document.createElement("div");
    r2.className = "ticket__row";
    r2.innerHTML = `<div><b>Diskon</b> ${disc.code || ""}</div><div>−${rupiah(Number(disc.amount || 0))}</div>`;
    box.appendChild(r2);
  }
}

function buildReceiptHtml(order) {
  const year = new Date().getFullYear();
  const subtotal = Number.isFinite(Number(order.subtotal)) ? Number(order.subtotal) : (order.items || []).reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);
  const disc = order.discount && typeof order.discount === "object" ? order.discount : null;
  const discAmount = disc ? Math.max(0, Math.floor(Number(disc.amount || 0))) : 0;
  const rows = (order.items || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px dashed rgba(0,0,0,.25)">${it.qty}× ${it.name}</td>
        <td style="padding:8px 0;border-bottom:1px dashed rgba(0,0,0,.25);text-align:right">${rupiah(it.qty * it.price)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Nota TerasIce</title>
  <style>
    :root{--red:#ca2a1a;--ink:#1a140f;}
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f7f3ea;margin:0;padding:22px;color:var(--ink)}
    .wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:18px;border:1px solid rgba(0,0,0,.1)}
    .brand{font-weight:900;letter-spacing:.8px;text-transform:uppercase;color:var(--red);font-size:18px}
    .tag{font-weight:800;font-size:11px;letter-spacing:.8px;text-transform:uppercase;opacity:.78;margin-top:4px}
    .meta{margin-top:14px;font-size:13px}
    .meta div{display:flex;justify-content:space-between;gap:10px;padding:5px 0}
    .queue{margin-top:12px;padding:12px 14px;border-radius:14px;background:rgba(202,42,26,.08);border:1px solid rgba(202,42,26,.18);display:flex;justify-content:space-between;align-items:center}
    .queue b{font-size:20px;color:var(--red)}
    table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13.5px}
    .total{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.12)}
    .total .label{font-weight:900}
    .total .value{font-weight:1000;color:var(--red);font-size:16px}
    .hint{margin-top:12px;font-size:12px;opacity:.72}
    .wifi{margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(26,20,15,.03);border:1px dashed rgba(26,20,15,.22)}
    .wifi .title{font-weight:1000;font-size:12px;letter-spacing:.6px;text-transform:uppercase;opacity:.78}
    .wifi .row{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:13px}
    .wifi code{font-weight:900}
    @media print{body{background:#fff;padding:0}.wrap{border:0}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">TERASICE</div>
    <div class="tag">ICE CREAM &amp; FLOAT SPECIALIST</div>

    <div class="queue">
      <div>
        <div style="font-size:12px;font-weight:800;opacity:.75">No. Antrian</div>
        <b>#${String(order.queueNumber).padStart(3, "0")}</b>
      </div>
      <div style="text-align:right;font-size:12.5px;opacity:.8">${order.timestampText}</div>
    </div>

    <div class="meta">
      ${order.serial ? `<div><span>ID Pesanan</span><b>${order.serial}</b></div>` : ``}
      <div><span>Nama</span><b>${order.buyerName}</b></div>
      <div><span>Tipe</span><b>${order.type}</b></div>
      ${
        order.type === "Dine-in" && order.tableNumber
          ? `<div><span>Meja</span><b>${order.tableNumber}</b></div>`
          : ``
      }
      <div><span>Pembayaran</span><b>${order.payment}</b></div>
      <div><span>Status Bayar</span><b>${order.paid ? "SUDAH" : "BELUM"}</b></div>
    </div>

    <table><tbody>${rows}</tbody></table>

    <div class="total" style="display:block">
      ${discAmount > 0 ? `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><div class="label">SUBTOTAL</div><div style="font-weight:900">${rupiah(subtotal)}</div></div>` : ``}
      ${discAmount > 0 ? `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><div class="label">DISKON ${disc?.code || ""}</div><div style="font-weight:900">−${rupiah(discAmount)}</div></div>` : ``}
      <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid rgba(0,0,0,.12);margin-top:8px">
        <div class="label">TOTAL</div>
        <div class="value">${rupiah(order.total)}</div>
      </div>
    </div>

    <div class="wifi">
      <div class="title">Informasi WiFi</div>
      <div class="row"><div>Username</div><div><code>${WIFI_USERNAME}</code></div></div>
      <div class="row"><div>Password</div><div><code>${WIFI_PASSWORD}</code></div></div>
    </div>

    <div class="hint">Terima kasih! Simpan nota ini jika diperlukan.</div>
    <div class="hint" style="margin-top:8px">© ${year} TerasIce. Hak cipta dilindungi.</div>
  </div>
</body>
</html>`;
}

function openReceiptWindow(order) {
  const html = buildReceiptHtml(order);
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up diblokir. Izinkan pop-up untuk membuka nota, atau gunakan tombol Download Nota.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // ignore
    }
  }, 400);
}

function renderQrisSection() {
  const payment = getSelectedValue("payment");
  const card = document.getElementById("qrisCard");
  if (!card) return;
  const show = payment === "QRIS";
  card.style.display = show ? "" : "none";
  if (!show) return;

  const imgEl = document.getElementById("qrisImg");
  const hintEl = document.getElementById("qrisHint");
  const src = serverState.qrisImg || "";
  if (src) {
    imgEl.src = src;
    hintEl.textContent = "QRIS siap discan.";
  } else {
    imgEl.removeAttribute("src");
    hintEl.textContent = "QRIS belum diupload. Admin bisa upload gambar QRIS di panel admin.";
  }
}

async function submitOrder() {
  const type = getSelectedValue("orderType");
  const payment = getSelectedValue("payment");
  const buyerName = (state.buyerName || "").trim();
  const settings = getSettings();
  const stock = getStock();

  const items = state.menu
    .map((m) => ({ ...m, qty: Number(state.cart[m.id] || 0) }))
    .filter((x) => x.qty > 0);

  if (!buyerName) return alert("Silakan isi nama pemesan.");
  if (!type) return alert("Silakan pilih tipe pesanan (Dine-in / Takeaway).");
  if (!payment) return alert("Silakan pilih metode pembayaran (Cash / QRIS).");
  if (!items.length) return alert("Silakan pilih minimal 1 menu.");

  if (type === "Dine-in" && settings.enableTableSelection) {
    if (!state.tableNumber) return alert("Silakan pilih nomor meja untuk Dine-in.");
    if (state.tableNumber && isTableOccupied(state.tableNumber)) {
      return alert("Meja ini sedang terisi. Minta admin mengosongkan meja terlebih dahulu.");
    }
  }

  // validasi diskon (opsional) sebelum submit
  if (state.discountCode) {
    const okDisc = await validateDiscount({ silent: false });
    if (!okDisc) return;
  }

  // validasi cepat di client (server akan validasi ulang)
  for (const it of items) {
    if (it.qty > settings.maxPerItem) return alert(`Maksimal beli per menu adalah ${settings.maxPerItem} pcs.\nMenu: ${it.name}`);
    const s = Number(stock[it.id] ?? 0);
    if (it.qty > s) return alert(`Stok tidak cukup untuk ${it.name}. (Sisa stok: ${s})`);
  }

  const payload = {
    buyerName,
    type,
    payment,
    items: items.map((it) => ({ id: it.id, qty: it.qty })),
    tableNumber: type === "Dine-in" && settings.enableTableSelection ? state.tableNumber : null,
    discountCode: state.discountCode ? state.discountCode.trim() : ""
  };

  const btn = document.getElementById("submitBtn");
  if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return alert(data?.error || "Gagal membuat pesanan.");

    const order = data.order;
    state.lastOrder = { ...order, dateKey: getTodayKey() };

    buildTicket({
      serial: order.serial,
      queueNumber: order.queueNumber,
      buyerName: order.buyerName,
      type: order.type,
      tableNumber: order.tableNumber,
      payment: order.payment,
      paid: order.paid,
      items: order.items,
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.total,
      timestampText: order.timestampText
    });
    openModal();

    // Download nota otomatis setelah order berhasil (dipicu oleh klik "Buat Pesanan")
    try {
      const fn = `TerasIce_Nota_${safeFilePart("#" + String(order.queueNumber).padStart(3, "0"))}_${state.lastOrder.dateKey}.html`;
      const html = buildReceiptHtml(state.lastOrder);
      downloadBlob(fn, new Blob([html], { type: "text/html;charset=utf-8" }));
    } catch {
      // ignore (download bisa diblokir browser)
    }

    // reset cart
    state.cart = Object.fromEntries(state.menu.map((m) => [m.id, 0]));
    state.buyerName = "";
    const nameInput = document.getElementById("buyerName");
    if (nameInput) nameInput.value = "";

    // reset diskon
    state.discount = null;
    state.discountCode = "";
    const discInput = document.getElementById("discountCode");
    const discHint = document.getElementById("discountHint");
    if (discInput) discInput.value = "";
    if (discHint) discHint.textContent = "";
    updateSummary();

    // refresh state agar stok/queue ikut terbaru (socket juga akan update)
    await fetchState();
    rerenderMenu();
    itemCardSyncFns.forEach((fn) => fn());
    renderQueueChip();
    renderQrisSection();
    renderTableSection();
  } catch (e) {
    alert("Gagal terhubung ke server. Pastikan web dijalankan melalui server (bukan dibuka langsung via file).");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function connectSocket() {
  if (typeof io !== "function") return;
  const socket = io();
  socket.on("state:update", (s) => {
    serverState = s || serverState;
    rerenderMenu();
    itemCardSyncFns.forEach((fn) => fn());
    renderQueueChip();
    updateSummary();
    renderQrisSection();
    renderTableSection();
  });
}

function bindTableSelect() {
  const input = document.getElementById("tableNumber");
  if (!input) return;
  input.addEventListener("change", () => {
    state.tableNumber = normalizeTableNumber(input.value);
    renderTableSection();
  });
}

function bindDiscount() {
  const input = document.getElementById("discountCode");
  const btn = document.getElementById("applyDiscountBtn");
  const hint = document.getElementById("discountHint");
  if (input) {
    input.addEventListener("input", () => {
      state.discountCode = input.value.trim();
      state.discount = null;
      if (hint) hint.textContent = "";
      updateSummary({ skipDiscountRevalidate: true });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") validateDiscount({ silent: false });
    });
  }
  if (btn) {
    btn.addEventListener("click", () => {
      validateDiscount({ silent: false });
    });
  }
}

async function boot() {
  bindModal();
  bindTableSelect();
  bindDiscount();
  setCopyrightYear();
  renderClock();
  setInterval(renderClock, 10_000);

  // isi meja awal dari URL (jika ada)
  state.tableFromUrl = parseTableFromUrl();

  try {
    await fetchState();
  } catch (e) {
    alert("Gagal memuat data dari server. Jalankan server dulu (npm install && npm start).");
  }

  rerenderMenu();
  updateSummary();
  renderQueueChip();
  renderQrisSection();
  renderTableSection();
  connectSocket();

  document.getElementById("submitBtn").addEventListener("click", submitOrder);
  document.getElementById("typeGroup").addEventListener("change", () => {
    updateSummary();
    renderTableSection();
  });
  document.getElementById("payGroup").addEventListener("change", () => {
    updateSummary();
    renderQrisSection();
  });
  const nameInput = document.getElementById("buyerName");
  if (nameInput) {
    nameInput.addEventListener("input", () => {
      state.buyerName = nameInput.value;
      updateSummary();
    });
  }

  const dlBtn = document.getElementById("downloadReceiptBtn");
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      if (!state.lastOrder) return alert("Belum ada pesanan yang dibuat.");
      const fn = `TerasIce_Nota_${safeFilePart("#" + String(state.lastOrder.queueNumber).padStart(3, "0"))}_${state.lastOrder.dateKey}.html`;
      const html = buildReceiptHtml(state.lastOrder);
      downloadBlob(fn, new Blob([html], { type: "text/html;charset=utf-8" }));
    });
  }

  const printBtn = document.getElementById("printReceiptBtn");
  if (printBtn) {
    printBtn.addEventListener("click", () => {
      if (!state.lastOrder) return alert("Belum ada pesanan yang dibuat.");
      openReceiptWindow(state.lastOrder);
    });
  }
}

boot();
