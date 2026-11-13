# Immagini del brand (generate)

Le immagini di questa cartella (`huawei-logo.png`, `mgw-logo.png`, `windtre-logo.png`, `banner-huawei.png`,
`banner-mgw.png`, `banner-windtre.png`) **non si mettono a mano**: le genera il server del kiosk all'avvio
(`kiosk/brand.mjs`) direttamente nella build servita (`out/kiosk/brand/`), dai loghi sorgente. Sorgenti, file del brand
kit e opzioni: **`kiosk/brand/README.md`**. Quali loghi si vedono, e quelli caricati a kiosk acceso: *Impostazioni →
Loghi* (`kiosk/README.md`).

Per lo sviluppo con `next dev`: `KIOSK_STATIC_DIR=public node kiosk/server.mjs` le scrive qui (cartella nel `.gitignore`) e
le indica al gioco (vedi `kiosk/README.md`).

Senza queste immagini il gioco disegna al loro posto striscioni e intestazioni di solo testo, nei colori del brand.

| File | Dove compare | Formato |
| :-- | :-- | :-- |
| `huawei-logo.png` | Schermate del kiosk (intestazione) | PNG trasparente, orizzontale |
| `mgw-logo.png` | Schermate del kiosk (intestazione) | PNG trasparente |
| `windtre-logo.png` | Schermate del kiosk (intestazione) | PNG trasparente, scritta bianca |
| `banner-huawei.png` | Cartellone HUAWEI a bordo pista | 1024 × 128 (8:1) |
| `banner-mgw.png` | Cartellone Milan Games Week a bordo pista | 1024 × 128 (8:1) |
| `banner-windtre.png` | Cartellone WINDTRE a bordo pista | 1024 × 128 (8:1) |
| `screen.png` | Maxischermi del circuito (senza questo file mostrano la classifica live) | 512 × 288 (16:9) |

La livrea della monoposto usa `public/cars/f12026/liveries/huawei_mgw/decals.png` (2048 × 512, trasparente):
per l'artwork ufficiale sostituiscila tenendo ogni immagine nel suo rettangolo
(vedi `scripts/kiosk/build_event_livery.py` e `src/lib/kiosk/event-livery.ts`).

Testi, date e colori dei segnaposto del gioco: `src/lib/kiosk/event-brand.ts`.
