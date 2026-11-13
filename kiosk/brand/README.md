# Loghi del brand per il kiosk

All'avvio, `kiosk/server.mjs` genera i loghi e gli striscioni del kiosk (`kiosk/brand.mjs`) nella build servita
(`out/kiosk/brand/`): intestazione HUAWEI e Milan Games Week, striscioni a bordo pista Huawei, Milan Games Week e
combinato.

Sorgenti, in ordine di precedenza:

1. **Brand kit ufficiale**: metti qui `sponsor-logo.svg` (o `.png`, il wordmark HUAWEI) e `event-logo.svg` (o `.png`,
   il logo Milan Games Week). Un colore solo con sfondo trasparente: il generatore lo ricolora (rosso/bianco).
2. **Download automatico** (solo la prima volta, poi in cache in `kiosk/data/brand-src/`, quindi funziona anche offline):
   - wordmark HUAWEI da Wikimedia Commons (`KIOSK_SPONSOR_LOGO_URL` per cambiarlo);
   - logo ufficiale Milan Games Week 2026 da milangamesweek.it (`KIOSK_EVENT_LOGO_URL`).

Un'immagine già pronta qui con il nome di un'uscita (`huawei-logo.png`, `mgw-logo.png`, `banner-huawei.png`,
`banner-mgw.png`, `banner-combo.png`) viene usata così com'è al posto di quella generata.

Questa cartella è nel `.gitignore` (tranne questo file): gli asset di marca non vengono committati né pubblicati.

Comandi: `npm run kiosk:brand` (genera in `out/`), `node kiosk/brand.mjs --public` (in `public/`, per `next dev`),
`--force` per rigenerare. `KIOSK_BRAND=0` disattiva la generazione all'avvio. Testi (date, luogo):
`KIOSK_EVENT_DATES`, `KIOSK_EVENT_VENUE`.
