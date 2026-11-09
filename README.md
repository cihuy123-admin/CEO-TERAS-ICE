# TerasIce — Realtime (User ↔ Admin)

Project ini sudah diubah dari versi **localStorage** menjadi versi **pakai backend + realtime**:
- Realtime update stok, menu, pengaturan, antrian, dan QRIS antara **customer** dan **admin** (Socket.IO).
- Riwayat pesanan tersimpan di **server**.
- Admin bisa **download rekapan penjualan (CSV)**.
- Dine-in mendukung **Nomor Meja** (default **1–10**) dengan status meja (Kosong/Terisi). Customer bisa pilih meja di form, dan admin bisa menambah/mengurangi jumlah meja dari panel admin.

## Cara Menjalankan

1) Install dependency:
```bash
npm install
```

2) Jalankan server:
```bash
npm start
```

3) Buka di browser:
- Customer: `http://localhost:3000/index.html`
- Admin: `http://localhost:3000/admin.html`

## Login Admin
- Username: `adminteras`
- Password: `ter@sice`

> Opsional: ubah via environment variable saat menjalankan:
> - `ADMIN_USER`
> - `ADMIN_PASS`
>
> Contoh:
> ```bash
> ADMIN_USER=admin ADMIN_PASS=12345 npm start
> ```

## File Data
Data tersimpan di `data.json` (otomatis dibuat saat server pertama kali jalan).

## Nomor Meja (Opsional via QR per meja)
Untuk Dine-in, customer bisa **memilih meja** langsung di form. Jika ingin pakai QR, QR bisa mengarah ke URL seperti:
- Meja 1: `https://DOMAIN/index.html?meja=1`
- Meja 5: `https://DOMAIN/index.html?meja=5`
- Meja 10: `https://DOMAIN/index.html?meja=10`

Catatan:
- Nomor meja akan tercatat di pesanan (khusus **Dine-in**).
- Jika meja sudah **Terisi**, customer tidak bisa membuat pesanan baru sampai admin klik **Selesai** / **Kosongkan** meja di panel admin.
