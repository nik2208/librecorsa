# Loghi del brand per il kiosk

All'avvio, `kiosk/server.mjs` genera i loghi e gli striscioni del kiosk (`kiosk/brand.mjs`) nella build servita
(`out/kiosk/brand/`): intestazione HUAWEI e Milan Games Week, striscioni a bordo pista Huawei, Milan Games Week e
combinato.

Ogni immagine viene, in ordine di precedenza:

1. **Immagine già pronta** qui, con il nome dell'uscita (`huawei-logo.png`, `mgw-logo.png`, `banner-huawei.png`,
   `banner-mgw.png`, `banner-combo.png`): usata così com'è, senza bisogno di loghi sorgente.
2. **Brand kit ufficiale**: disegnata da `sponsor-logo.svg` (o `.png`, il wordmark HUAWEI) e `event-logo.svg` (o `.png`,
   il logo Milan Games Week) messi qui. Un colore solo con sfondo trasparente: il generatore lo ricolora (rosso/bianco).
   Vanno bene anche gli SVG esportati da Illustrator (DOCTYPE ed entità comprese).
3. **Download automatico**, tenuto in cache per indirizzo in `kiosk/data/brand-src/`, quindi dopo la prima volta funziona
   anche offline:
   - wordmark HUAWEI da Wikimedia Commons (`KIOSK_SPONSOR_LOGO_URL` per cambiarlo, vuoto per non scaricarlo);
   - logo Milan Games Week 2026 da milangamesweek.it (`KIOSK_EVENT_LOGO_URL`): il sito **rifiuta i download automatici**,
     quindi salva questo file da un browser come `kiosk/brand/event-logo.svg`.
   Un download fallito viene ritentato solo dopo 6 ore (o subito con `--force`); un download che non risponde viene
   abbandonato dopo 10 s (`KIOSK_BRAND_TIMEOUT_MS`).

Un'immagine senza nessuna di queste fonti viene tolta e il gioco disegna il testo al suo posto.

Si rigenera solo ciò che è cambiato: un'impronta (`out/kiosk/brand/.brand-key.json`) registra per ogni immagine l'hash
delle sue fonti, dei testi e del generatore, quindi un logo sostituito o un testo cambiato vengono ridisegnati al
prossimo avvio, e un riavvio senza cambiamenti è immediato.

Questa cartella è nel `.gitignore` (tranne questo file): gli asset di marca non vengono committati né pubblicati.

Comandi: `npm run kiosk:brand` (genera in `out/`), `node kiosk/brand.mjs --public` (in `public/`, per `next dev`),
`--force` per rifare tutto e ritentare i download. `KIOSK_BRAND=0` disattiva la generazione all'avvio. Testi:
`KIOSK_EVENT_DATES`, `KIOSK_EVENT_VENUE`, `KIOSK_EVENT_NAME`.
