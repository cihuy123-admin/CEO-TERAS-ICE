/* TerasIce - Admin (Realtime via Socket.IO + backend) */

const TZ = "Asia/Jakarta"; // WIB
const SESSION_TOKEN_KEY = "terasice_admin_token_v2";

function normalizeCategory(cat) {
  const c = String(cat || "").toUpperCase();
  if (c.includes("ICE") && c.includes("CREAM")) return "ICE_CREAM";
  if (c.includes("ICE_CREAM")) return "ICE_CREAM";
  return "FLOAT";
}

function categoryLabel(cat) {
  return normalizeCategory(cat) === "ICE_CREAM" ? "Ice Cream" : "Float";
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

function renderClock() {
  const p = getNowParts();
  const text = `${p.weekday}, ${p.day} ${p.month} ${p.year} • ${p.hour}.${p.minute} WIB`;
  document.getElementById("adminClock").textContent = text;
}

function safeText(s) {
  return String(s || "").trim();
}

function getToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
}
function setToken(t) {
  if (t) sessionStorage.setItem(SESSION_TOKEN_KEY, t);
  else sessionStorage.removeItem(SESSION_TOKEN_KEY);
}
function isLoggedIn() {
  return !!getToken();
}

async function apiAdmin(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...options, headers });
  return r;
}

let serverState = {
  menu: [],
  stock: {},
  settings: { maxPerItem: 5, tableCount: 10, enableTableSelection: false },
  queue: { lastKey: "", lastNumber: 0 },
  qrisImg: "",
  orders: [],
  tables: {}
};

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
  return serverState.queue && typeof serverState.queue === "object" ? serverState.queue : { lastKey: "", lastNumber: 0 };
}
function getTables() {
  return serverState.tables && typeof serverState.tables === "object" ? serverState.tables : {};
}

function getAdmins() {
  return Array.isArray(serverState.admins) ? serverState.admins : [];
}

function getDiscounts() {
  return Array.isArray(serverState.discounts) ? serverState.discounts : [];
}

function setCopyrightYearAdmin() {
  const el = document.getElementById("copyrightYearAdmin");
  if (!el) return;
  el.textContent = String(new Date().getFullYear());
}

let socketRef = null;

function authAdminSocket() {
  if (!socketRef) return;
  if (!isLoggedIn()) return;
  const token = getToken();
  socketRef.emit("admin:auth", token, () => {});
}

async function fetchAdminState() {
  const r = await apiAdmin("/api/admin/state", { cache: "no-store" });
  if (!r.ok) throw new Error("UNAUTHORIZED");
  serverState = await r.json();
}

function showAdminUI() {
  document.getElementById("loginSection").style.display = "none";
  document.getElementById("adminSection").style.display = "";
  document.getElementById("logoutBtn").style.display = "";
  hydrateAll();
}

function showLoginUI() {
  document.getElementById("loginSection").style.display = "";
  document.getElementById("adminSection").style.display = "none";
  document.getElementById("logoutBtn").style.display = "none";
}

async function login() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value;
  const hint = document.getElementById("loginHint");
  hint.textContent = "";

  try {
    const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      hint.textContent = "Username atau password salah.";
      return;
    }
    setToken(data.token);
    authAdminSocket();
    await fetchAdminState();
    showAdminUI();
  } catch (e) {
    hint.textContent = "Gagal terhubung ke server. Jalankan server dulu.";
  }
}

function logout() {
  setToken("");
  showLoginUI();
}

function hydrateSettings() {
  const s = getSettings();
  document.getElementById("maxPerItem").value = String(s.maxPerItem);
  const tc = document.getElementById("tableCount");
  if (tc) tc.value = String(s.tableCount);
  const et = document.getElementById("enableTableSelection");
  if (et) et.checked = !!s.enableTableSelection;
}

async function saveSettings() {
  const max = Number(document.getElementById("maxPerItem").value);
  if (!Number.isFinite(max) || max < 1) return alert("Nilai maksimal beli per menu harus angka >= 1.");
  const tableCount = Number(document.getElementById("tableCount")?.value);
  if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 50) {
    return alert("Jumlah meja harus angka 1–50.");
  }
  const enableTableSelection = !!document.getElementById("enableTableSelection")?.checked;

  const r = await apiAdmin("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxPerItem: Math.floor(max), tableCount: Math.floor(tableCount), enableTableSelection })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menyimpan pengaturan.");
  alert("Pengaturan tersimpan.");
}

function renderQueueInfo() {
  const q = getQueueState();
  document.getElementById("queueInfo").value = `#${String(q.lastNumber || 0).padStart(3, "0")} (hari ini)`;
}

async function resetQueueToday() {
  const r = await apiAdmin("/api/admin/queue/reset", { method: "POST" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal reset antrian.");
  alert("Antrian hari ini sudah direset.");
}

function getDateKeyFromIso(iso) {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "";
    const p = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(dt);
    const map = Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return "";
  }
}

function computeSalesSummary() {
  const from = safeText(document.getElementById("salesFrom")?.value);
  const to = safeText(document.getElementById("salesTo")?.value);
  const fromKey = from || "0000-01-01";
  const toKey = to || "9999-12-31";

  const orders = Array.isArray(serverState.orders) ? serverState.orders : [];
  let totalOrders = 0;
  let totalQty = 0;
  let totalRevenue = 0;

  for (const o of orders) {
    const k = getDateKeyFromIso(o.time);
    if (!k || k < fromKey || k > toKey) continue;
    totalOrders += 1;
    totalRevenue += Number(o.total || 0);
    for (const it of o.items || []) totalQty += Number(it.qty || 0);
  }
  return { totalOrders, totalQty, totalRevenue };
}

function renderSalesSummary() {
  const sumOrders = document.getElementById("sumOrders");
  const sumQty = document.getElementById("sumQty");
  const sumRevenue = document.getElementById("sumRevenue");
  if (!sumOrders || !sumQty || !sumRevenue) return;

  const s = computeSalesSummary();
  sumOrders.value = String(s.totalOrders);
  sumQty.value = String(s.totalQty);
  sumRevenue.value = rupiah(s.totalRevenue);
}

async function completeOrder(orderId) {
  const id = safeText(orderId);
  if (!id) return;
  const r = await apiAdmin(`/api/admin/orders/${encodeURIComponent(id)}/complete`, { method: "POST" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menyelesaikan pesanan.");

  // update local
  serverState.orders = (serverState.orders || []).map((o) => (String(o.id) === id ? data.order : o));
  renderTables();
  renderOrders();
  renderSalesSummary();
}

async function clearTable(no) {
  const n = Number(no || 0);
  const tc = getSettings().tableCount;
  if (!Number.isFinite(n) || n < 1 || n > tc) return;
  const r = await apiAdmin(`/api/admin/tables/${n}/clear`, { method: "POST" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal mengosongkan meja.");
  await fetchAdminState();
  hydrateAll();
}

function renderTables() {
  const enabled = !!getSettings().enableTableSelection;
  const card = document.getElementById("tablesCard");
  if (card) card.style.display = enabled ? "" : "none";
  if (!enabled) return;

  const box = document.getElementById("tablesBox");
  const hint = document.getElementById("tablesHint");
  if (!box) return;
  const tables = getTables();
  const orders = Array.isArray(serverState.orders) ? serverState.orders : [];
  const tc = getSettings().tableCount;
  box.innerHTML = "";
  if (hint) hint.textContent = "";

  for (let i = 1; i <= tc; i += 1) {
    const k = String(i);
    const occId = tables[k];
    const order = occId ? orders.find((o) => String(o.id) === String(occId)) : null;

    const card = document.createElement("div");
    card.className = "item";
    card.style.padding = "12px";

    const title = document.createElement("div");
    title.style.fontWeight = "1000";
    title.textContent = `Meja ${i}`;

    const status = document.createElement("div");
    status.className = "small";
    if (!occId) {
      status.textContent = "Kosong";
    } else {
      const q = order ? `#${String(order.queueNumber || "").padStart(3, "0")}` : "(order)";
      const nm = order ? (order.buyerName || "").trim() : "";
      status.textContent = `Terisi — ${q}${nm ? " • " + nm : ""}`;
    }

    const actions = document.createElement("div");
    actions.style.marginTop = "10px";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";

    if (occId && order) {
      const doneBtn = document.createElement("button");
      doneBtn.className = "btn btn--primary";
      doneBtn.type = "button";
      doneBtn.style.padding = "10px 12px";
      doneBtn.textContent = "Selesai";
      doneBtn.addEventListener("click", async () => {
        if (!confirm(`Selesaikan pesanan untuk Meja ${i}?`)) return;
        await completeOrder(order.id);
        await fetchAdminState();
        hydrateAll();
      });
      actions.appendChild(doneBtn);
    }

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn--ghost";
    clearBtn.type = "button";
    clearBtn.style.padding = "10px 12px";
    clearBtn.textContent = "Kosongkan";
    clearBtn.addEventListener("click", async () => {
      if (!confirm(`Kosongkan Meja ${i}?`)) return;
      await clearTable(i);
    });
    actions.appendChild(clearBtn);

    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(actions);
    box.appendChild(card);
  }

  if (hint) hint.textContent = `Total meja aktif: ${tc}`;
}

function setAll100() {
  document.querySelectorAll("[data-stock-input]").forEach((el) => {
    el.value = "100";
  });
}

function slugifyId(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return (base ? base : "menu") + "_" + rand;
}

function renderMenuTable() {
  const menu = getMenu();
  const stock = getStock();
  const table = document.getElementById("menuTable");

  table.innerHTML = `
    <thead>
      <tr>
        <th style="min-width:220px">Menu</th>
        <th style="width:170px">Kategori</th>
        <th style="width:160px">Harga</th>
        <th style="width:160px">Stok</th>
        <th style="width:110px">Aksi</th>
      </tr>
    </thead>
    <tbody>
      ${menu
        .map((m) => {
          const s = Number(stock[m.id] ?? 0);
          const cat = normalizeCategory(m.category);
          return `
          <tr data-row-id="${m.id}">
            <td>
              <div style="display:flex;flex-direction:column;gap:6px">
                <input class="input" style="width:100%" data-name-input="${m.id}" value="${m.name.replace(/\"/g, "&quot;")}" />
                <div class="small">ID: <code>${m.id}</code></div>
              </div>
            </td>
            <td>
              <select class="input" style="width:100%" data-cat-input="${m.id}">
                <option value="ICE_CREAM" ${cat === "ICE_CREAM" ? "selected" : ""}>Ice Cream</option>
                <option value="FLOAT" ${cat === "FLOAT" ? "selected" : ""}>Float</option>
              </select>
            </td>
            <td>
              <input class="input" style="width:100%" type="number" min="0" step="500" data-price-input="${m.id}" value="${String(
            Number(m.price || 0)
          )}" />
            </td>
            <td>
              <input class="input" style="width:100%" type="number" min="0" step="1" data-stock-input="${m.id}" value="${String(s)}" />
            </td>
            <td>
              <button class="btn btn--ghost" type="button" data-del-btn="${m.id}" style="width:100%">Hapus</button>
            </td>
          </tr>
        `;
        })
        .join("")}
    </tbody>
  `;

  table.querySelectorAll("[data-del-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del-btn");
      if (!confirm("Hapus menu ini?")) return;
      const row = table.querySelector(`[data-row-id="${id}"]`);
      if (row) row.remove();
    });
  });
}

async function saveMenuAndStock() {
  const table = document.getElementById("menuTable");
  if (!table) return;

  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const nextMenu = [];
  const nextStock = {};

  for (const r of rows) {
    const id = r.getAttribute("data-row-id");
    const nameEl = r.querySelector(`[data-name-input="${id}"]`);
    const catEl = r.querySelector(`[data-cat-input="${id}"]`);
    const priceEl = r.querySelector(`[data-price-input="${id}"]`);
    const stockEl = r.querySelector(`[data-stock-input="${id}"]`);

    const name = String(nameEl?.value || "").trim();
    const category = normalizeCategory(catEl?.value || "FLOAT");
    const price = Number(priceEl?.value || 0);
    const stock = Number(stockEl?.value || 0);

    if (!name) return alert(`Nama menu tidak boleh kosong. (ID: ${id})`);
    if (!Number.isFinite(price) || price < 0) return alert(`Harga tidak valid untuk "${name}".`);
    if (!Number.isFinite(stock) || stock < 0) return alert(`Stok tidak valid untuk "${name}".`);

    nextMenu.push({ id, name, category, price: Math.floor(price) });
    nextStock[id] = Math.floor(stock);
  }

  const ids = nextMenu.map((m) => m.id);
  if (new Set(ids).size !== ids.length) return alert("Ada ID menu yang duplikat. Coba refresh & simpan ulang.");

  const r = await apiAdmin("/api/admin/menu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu: nextMenu, stock: nextStock })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menyimpan menu/stok.");

  alert("Menu, harga, dan stok tersimpan.");
}

async function addMenu() {
  const name = String(document.getElementById("newName").value || "").trim();
  const category = normalizeCategory(document.getElementById("newCategory").value);
  const price = Number(document.getElementById("newPrice").value || 0);
  const stock = Number(document.getElementById("newStock").value || 100);
  if (!name) return alert("Nama menu baru wajib diisi.");
  if (!Number.isFinite(price) || price < 0) return alert("Harga menu baru tidak valid.");
  if (!Number.isFinite(stock) || stock < 0) return alert("Stok awal menu baru tidak valid.");

  const menu = getMenu();
  const id = slugifyId(name);
  menu.push({ id, name, category, price: Math.floor(price) });

  const nextStock = { ...getStock() };
  nextStock[id] = Math.floor(stock);

  const r = await apiAdmin("/api/admin/menu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu, stock: nextStock })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menambah menu.");

  document.getElementById("newName").value = "";
  document.getElementById("newPrice").value = "";
  document.getElementById("newStock").value = "100";
  document.getElementById("newCategory").value = category;

  alert("Menu baru ditambahkan.");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Gagal membaca file."));
    r.readAsDataURL(file);
  });
}

function hydrateQris() {
  const src = serverState.qrisImg || "";
  const img = document.getElementById("qrisPreview");
  const st = document.getElementById("qrisStatus");
  if (!img || !st) return;
  if (src) {
    img.src = src;
    st.textContent = "QRIS tersimpan (di server).";
  } else {
    img.removeAttribute("src");
    st.textContent = "Belum ada QRIS.";
  }
}

async function saveQris() {
  const input = document.getElementById("qrisFile");
  if (!input || !input.files || !input.files[0]) return alert("Pilih file gambar QRIS dulu.");
  const file = input.files[0];
  if (!file.type.startsWith("image/")) return alert("File harus gambar (PNG/JPG).");

  const dataUrl = await readFileAsDataUrl(file);
  const r = await apiAdmin("/api/admin/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrisImg: dataUrl })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menyimpan QRIS.");
  alert("QRIS tersimpan.");
}

async function removeQris() {
  if (!confirm("Hapus QRIS yang tersimpan?")) return;
  const r = await apiAdmin("/api/admin/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrisImg: "" })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menghapus QRIS.");
  const input = document.getElementById("qrisFile");
  if (input) input.value = "";
  alert("QRIS dihapus.");
}

function formatOrderDate(iso) {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "";
    const p = new Intl.DateTimeFormat("id-ID", {
      timeZone: TZ,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(dt);
    const map = Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
    return `${map.weekday}, ${map.day} ${map.month} ${map.year} • ${map.hour}.${map.minute} WIB`;
  } catch {
    return "";
  }
}

function renderAdminsTable() {
  const table = document.getElementById("adminsTable");
  if (!table) return;
  const admins = getAdmins();

  table.innerHTML = `
    <thead>
      <tr>
        <th style="min-width:220px">Username</th>
        <th style="min-width:220px">Dibuat</th>
        <th style="width:240px">Aksi</th>
      </tr>
    </thead>
    <tbody>
      ${
        admins.length
          ? admins
              .map((a) => {
                const u = String(a.username || "").trim();
                const c = String(a.createdAt || "").trim();
                return `
                  <tr>
                    <td style="font-weight:900">${u}</td>
                    <td>${c ? c : "—"}</td>
                    <td>
                      <button class="btn btn--ghost" type="button" data-admin-pass="${u}" style="padding:8px 10px">Ubah Password</button>
                      <button class="btn btn--ghost" type="button" data-admin-del="${u}" style="padding:8px 10px">Hapus</button>
                    </td>
                  </tr>
                `;
              })
              .join("")
          : `<tr><td colspan="3" class="small">Belum ada data admin.</td></tr>`
      }
    </tbody>
  `;

  table.querySelectorAll("[data-admin-pass]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = btn.getAttribute("data-admin-pass");
      const pw = prompt(`Masukkan password baru untuk '${u}' (minimal 4 karakter):`);
      if (pw === null) return;
      if (String(pw).length < 4) return alert("Password minimal 4 karakter.");
      const r = await apiAdmin(`/api/admin/users/${encodeURIComponent(u)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: String(pw) })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error || "Gagal mengubah password.");
      alert("Password berhasil diubah.");
      await fetchAdminState();
      hydrateAll();
    });
  });

  table.querySelectorAll("[data-admin-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = btn.getAttribute("data-admin-del");
      if (!confirm(`Hapus akun admin '${u}'?`)) return;
      const r = await apiAdmin(`/api/admin/users/${encodeURIComponent(u)}/delete`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error || "Gagal menghapus admin.");
      await fetchAdminState();
      hydrateAll();
    });
  });
}

async function addAdminUser() {
  const u = document.getElementById("newAdminUsername")?.value.trim();
  const p = document.getElementById("newAdminPassword")?.value || "";
  if (!u) return alert("Username admin wajib diisi.");
  if (String(p).length < 4) return alert("Password minimal 4 karakter.");
  const r = await apiAdmin("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menambah admin.");
  document.getElementById("newAdminUsername").value = "";
  document.getElementById("newAdminPassword").value = "";
  await fetchAdminState();
  hydrateAll();
  alert("Admin baru ditambahkan.");
}

function discountLabel(d) {
  const type = String(d?.type || "").toUpperCase();
  const value = Number(d?.value || 0);
  if (type === "PERCENT") return `${value}%`;
  if (type === "AMOUNT") return rupiah(value);
  return String(value || "");
}

function renderDiscountsTable() {
  const table = document.getElementById("discountsTable");
  if (!table) return;
  const discounts = getDiscounts();

  table.innerHTML = `
    <thead>
      <tr>
        <th style="min-width:200px">Kode</th>
        <th style="min-width:140px">Tipe</th>
        <th style="min-width:160px">Nilai</th>
        <th style="min-width:140px">Status</th>
        <th style="width:260px">Aksi</th>
      </tr>
    </thead>
    <tbody>
      ${
        discounts.length
          ? discounts
              .map((d) => {
                const code = String(d.code || "").trim();
                const type = String(d.type || "").toUpperCase();
                const active = !!d.active;
                return `
                  <tr>
                    <td style="font-weight:900">${code}</td>
                    <td>${type === "AMOUNT" ? "Rupiah" : "Persen"}</td>
                    <td>${discountLabel(d)}</td>
                    <td>${active ? "<b>Aktif</b>" : "Nonaktif"}</td>
                    <td>
                      <button class="btn btn--ghost" type="button" data-disc-toggle="${code}" data-next="${
                        active ? "0" : "1"
                      }" style="padding:8px 10px">${active ? "Nonaktifkan" : "Aktifkan"}</button>
                      <button class="btn btn--ghost" type="button" data-disc-del="${code}" style="padding:8px 10px">Hapus</button>
                    </td>
                  </tr>
                `;
              })
              .join("")
          : `<tr><td colspan="5" class="small">Belum ada kode diskon.</td></tr>`
      }
    </tbody>
  `;

  table.querySelectorAll("[data-disc-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-disc-toggle");
      const next = btn.getAttribute("data-next") === "1";
      const r = await apiAdmin(`/api/admin/discounts/${encodeURIComponent(code)}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error || "Gagal mengubah status diskon.");
      await fetchAdminState();
      hydrateAll();
    });
  });

  table.querySelectorAll("[data-disc-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-disc-del");
      if (!confirm(`Hapus kode diskon '${code}'?`)) return;
      const r = await apiAdmin(`/api/admin/discounts/${encodeURIComponent(code)}/delete`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error || "Gagal menghapus diskon.");
      await fetchAdminState();
      hydrateAll();
    });
  });
}

async function addDiscount() {
  const code = document.getElementById("newDiscountCode")?.value.trim();
  const type = document.getElementById("newDiscountType")?.value;
  const value = Number(document.getElementById("newDiscountValue")?.value);
  const active = document.getElementById("newDiscountActive")?.value === "1";
  if (!code) return alert("Kode diskon wajib diisi.");
  if (!Number.isFinite(value) || value <= 0) return alert("Nilai diskon harus angka > 0.");

  const r = await apiAdmin("/api/admin/discounts/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, type, value: Math.floor(value), active })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menambah diskon.");

  document.getElementById("newDiscountCode").value = "";
  document.getElementById("newDiscountValue").value = "";
  document.getElementById("newDiscountActive").value = "1";

  await fetchAdminState();
  hydrateAll();
  alert("Kode diskon ditambahkan.");
}

function renderOrders() {
  const box = document.getElementById("ordersBox");
  const orders = Array.isArray(serverState.orders) ? serverState.orders : [];
  box.innerHTML = "";

  if (!orders.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "Belum ada riwayat pesanan.";
    box.appendChild(empty);
    return;
  }

  for (const o of orders.slice(0, 12)) {
    const card = document.createElement("div");
    card.className = "card";
    const items = (o.items || []).map((it) => `${it.qty}× ${it.name}`).join(", ");
    const nm = (o.buyerName || "").trim();
    const when = formatOrderDate(o.time);
    const meja = o.type === "Dine-in" && o.tableNumber ? ` (Meja ${o.tableNumber})` : "";
    const status = String(o.status || "DONE").toUpperCase();
    const serial = String(o.serial || "").trim();
    const paid = !!o.paid;
    const disc = o.discount && typeof o.discount === "object" ? o.discount : null;
    const subtotal = Number(o.subtotal || 0) || (o.items || []).reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-weight:1000">${serial ? serial + " • " : ""}#${String(o.queueNumber).padStart(3, "0")} — ${o.type}${meja}</div>
          ${nm ? `<div class="small"><b>Nama:</b> ${nm}</div>` : ``}
          ${when ? `<div class="small"><b>Waktu:</b> ${when}</div>` : ``}
          <div class="small">${o.payment} • <b>Status:</b> ${status} • <b>Bayar:</b> ${paid ? "SUDAH" : "BELUM"}</div>
          ${
            disc && disc.code
              ? `<div class="small"><b>Diskon:</b> ${disc.code} (−${rupiah(Number(disc.amount || 0))}) • <b>Subtotal:</b> ${rupiah(subtotal || 0)}</div>`
              : ``
          }
          <div class="small" style="margin-top:6px">${items}</div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          ${
            status === "OPEN"
              ? `<div style="margin-top:10px"><button class="btn btn--primary" type="button" data-complete="${String(
                  o.id
                )}" style="padding:10px 12px">Selesai</button></div>`
              : ``
          }
            <button class="btn btn--ghost" type="button" data-pay="${String(o.id)}" data-next-paid="${paid ? "0" : "1"}" style="padding:10px 12px">
              ${paid ? "Tandai Belum Bayar" : "Tandai Sudah Bayar"}
            </button>
          </div>
        </div>
        <div style="font-weight:1000;color:var(--c-primary)">${rupiah(o.total || 0)}</div>
      </div>
    `;
    box.appendChild(card);

    const btn = card.querySelector("[data-complete]");
    if (btn) {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-complete");
        if (!confirm("Selesaikan pesanan ini?")) return;
        await completeOrder(id);
        await fetchAdminState();
        hydrateAll();
      });
    }

    const payBtn = card.querySelector("[data-pay]");
    if (payBtn) {
      payBtn.addEventListener("click", async () => {
        const id = payBtn.getAttribute("data-pay");
        const nextPaid = payBtn.getAttribute("data-next-paid") === "1";
        const label = nextPaid ? "Tandai pesanan ini SUDAH BAYAR?" : "Tandai pesanan ini BELUM BAYAR?";
        if (!confirm(label)) return;
        const r = await apiAdmin(`/api/admin/orders/${encodeURIComponent(id)}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paid: nextPaid })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return alert(data?.error || "Gagal mengubah status bayar.");
        await fetchAdminState();
        hydrateAll();
      });
    }
  }
}

async function clearOrders() {
  if (!confirm("Hapus semua riwayat pesanan di server?")) return;
  const r = await apiAdmin("/api/admin/orders/clear", { method: "POST" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data?.error || "Gagal menghapus riwayat.");
  alert("Riwayat pesanan dihapus.");
}

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

async function downloadSalesCsv() {
  const from = safeText(document.getElementById("salesFrom").value);
  const to = safeText(document.getElementById("salesTo").value);
  const hint = document.getElementById("downloadSalesHint");
  hint.textContent = "";

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  try {
    const r = await apiAdmin(`/api/admin/sales.csv?${qs.toString()}`, { method: "GET" });
    if (!r.ok) {
      const t = await r.text();
      hint.textContent = t || "Gagal download CSV.";
      return;
    }
    const blob = await r.blob();
    const fn = `rekapan_penjualan_${from || "all"}_${to || "all"}.csv`;
    downloadBlob(fn, blob);
  } catch {
    hint.textContent = "Gagal terhubung ke server.";
  }
}

function hydrateAll() {
  hydrateSettings();
  renderAdminsTable();
  renderMenuTable();
  renderQueueInfo();
  renderOrders();
  renderDiscountsTable();
  renderTables();
  renderSalesSummary();
  hydrateQris();
}

function connectSocket() {
  if (typeof io !== "function") return;
  socketRef = io();
  authAdminSocket();

  socketRef.on("connect", () => {
    authAdminSocket();
  });

  socketRef.on("state:update", (s) => {
    if (!isLoggedIn()) return;
    // state:update adalah state publik (tanpa orders lengkap)
    // update sebagian saja agar tidak merusak serverState admin
    const pub = s || {};
    serverState.menu = pub.menu || serverState.menu;
    serverState.stock = pub.stock || serverState.stock;
    serverState.settings = pub.settings || serverState.settings;
    serverState.queue = pub.queue || serverState.queue;
    serverState.qrisImg = pub.qrisImg || serverState.qrisImg;
    hydrateAll();
  });

  socketRef.on("orders:new", async (order) => {
    if (!isLoggedIn()) return;
    // order baru dari server (khusus admin)
    serverState.orders = [order, ...(serverState.orders || [])].slice(0, 1000);
    // refresh state admin agar tables ikut terupdate
    await fetchAdminState();
    hydrateAll();
  });

  socketRef.on("orders:update", async (payload) => {
    if (!isLoggedIn()) return;
    const id = String(payload?.id || "");
    if (!id) return;
    // refresh state agar status bayar sinkron
    await fetchAdminState();
    hydrateAll();
  });
}

function bind() {
  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    await saveSettings();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("resetQueueBtn").addEventListener("click", async () => {
    await resetQueueToday();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("setAll100Btn").addEventListener("click", setAll100);
  document.getElementById("saveMenuBtn").addEventListener("click", async () => {
    await saveMenuAndStock();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("addMenuBtn").addEventListener("click", async () => {
    await addMenu();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("clearOrdersBtn").addEventListener("click", async () => {
    await clearOrders();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("saveQrisBtn").addEventListener("click", async () => {
    await saveQris();
    await fetchAdminState();
    hydrateAll();
  });
  document.getElementById("removeQrisBtn").addEventListener("click", async () => {
    await removeQris();
    await fetchAdminState();
    hydrateAll();
  });

  const addAdminBtn = document.getElementById("addAdminBtn");
  if (addAdminBtn) addAdminBtn.addEventListener("click", addAdminUser);

  const addDiscountBtn = document.getElementById("addDiscountBtn");
  if (addDiscountBtn) addDiscountBtn.addEventListener("click", addDiscount);

  document.getElementById("downloadSalesBtn").addEventListener("click", downloadSalesCsv);
  document.getElementById("salesFrom").addEventListener("change", renderSalesSummary);
  document.getElementById("salesTo").addEventListener("change", renderSalesSummary);

  document.getElementById("qrisFile").addEventListener("change", () => {
    const input = document.getElementById("qrisFile");
    if (input && input.files && input.files[0]) {
      const img = document.getElementById("qrisPreview");
      if (img) img.src = URL.createObjectURL(input.files[0]);
      const st = document.getElementById("qrisStatus");
      if (st) st.textContent = "Preview dipilih (belum disimpan).";
    }
  });

  document.getElementById("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
}

async function boot() {
  bind();
  setCopyrightYearAdmin();
  renderClock();
  setInterval(renderClock, 10_000);
  connectSocket();

  if (isLoggedIn()) {
    try {
      await fetchAdminState();
      showAdminUI();
    } catch {
      logout();
    }
  } else {
    showLoginUI();
  }
}

boot();
