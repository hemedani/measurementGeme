# ترازو، اندازه‌گیری و مقیاس‌ها

یک بازی آموزشی فارسی (RTL) برای پایهٔ سوم دبستان، ساخته‌شده بر پایهٔ پژوهش کلاسی
«ترازو، اندازه‌گیری و مقیاس‌ها» — ارائه‌دهنده: سیده ساره حسینی.

---

## How to open / اجرا

Double-click `index.html` — it opens in any modern browser (Chrome, Safari, Edge, Firefox).
No server, no install, no internet needed.

فایل `index.html` را دوبار کلیک کن. بازی بدون اینترنت و بدون نصب اجرا می‌شود.

Everything is in one file: HTML + CSS + JS, no external images, fonts, audio or CDN.

---

## Change the presenter name / تغییر نام ارائه‌دهنده

Open `index.html` in any text editor and edit the `CONFIG` object at the top of the `<script>` block:

```js
var CONFIG = {
  gameTitle: 'ترازو، اندازه‌گیری و مقیاس‌ها',
  presenterName: 'سیده ساره حسینی',   // ← your name here
  showPresenterName: true,            // ← set to false to hide it everywhere
  childFriendlyMode: true,
  storageKey: 'sareh-measure-game-v1'
};
```

The name appears on the title screen, the certificate and the parent panel.
All other text lives in the `TXT` object and in the `STATIONS`, `GLOSS`, `QUIZ_BANK` arrays.

---

## The six stations / ایستگاه‌ها

| Station | What it teaches | Levels |
|---|---|---|
| بازار ترازو | mass, g/kg, using a two-pan balance, zeroing | 5 |
| کارگاه خط‌کش | length, cm/mm/m, aligning to zero, estimating | 5 |
| آزمایشگاه گنجایش | capacity, mL/L, reading a graduated beaker at eye level | 5 |
| جزیرهٔ نقشه | map scale, classroom plan (1 cm = 50 cm) | 5 |
| سالن پرسش‌ها | review quiz — 14 questions, 5 random per play | unlocks after 3 stations |
| جورچین ابزارها | matching each tool to what it measures | bonus |

---

## Features included

- Persian-only UI, `lang="fa"`, `dir="rtl"`, Persian digits everywhere (۱۰۰۰ not 1000)
- Mascot «ترازک» with speech bubbles, hints and idle nudges
- Estimate-first scoring (bonus star when the guess is close)
- Drag with pointer events (mouse + touch), plus keyboard arrows on the ruler
- Stars, 6 badges, 5 stickers, progress bar, reward chest
- Printable certificate with Persian calendar date (`Intl` fa-IR)
- WebAudio sound effects generated in code (no audio files), mute preference saved
- Progress, badges and settings saved in `localStorage` (try/catch guarded)
- Reduced-motion toggle + `prefers-reduced-motion` support
- No network requests, no analytics, no links, no data collection

## Curriculum notes

Content follows the research document: measurement, estimation, tools, metric units,
conversions (۱ کیلوگرم = ۱۰۰۰ گرم, ۱ متر = ۱۰۰ سانتی‌متر, ۱ لیتر = ۱۰۰۰ میلی‌لیتر),
correct balance use, sources of measurement error, and the three meanings of «مقیاس».

Mass vs. weight is kept as a single optional enrichment note (the Moon fact in the reward chest),
and map scale is flagged as an enrichment topic in the parent panel — as the research document recommends.
