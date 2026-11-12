# Grafiche ufficiali dell'evento (kiosk)

Questa cartella è vuota di proposito: il gioco disegna **segnaposto testuali** con i colori del brand
(nessun logo viene ricreato). Mettendo qui i file ufficiali con questi nomi, vengono usati al posto dei segnaposto,
senza ricompilare se il kiosk serve già la build (basta copiarli anche in `out/kiosk/brand/`).

| File | Dove compare | Formato |
| :-- | :-- | :-- |
| `huawei-logo.png` | Schermate del kiosk (intestazione) | PNG trasparente, orizzontale, alto almeno 120 px |
| `mgw-logo.png` | Schermate del kiosk (intestazione) | PNG trasparente, orizzontale, alto almeno 120 px |
| `banner-huawei.png` | Striscioni a bordo pista (1° tipo, anche sul portale di partenza) | **1024 × 128** (8:1) |
| `banner-mgw.png` | Striscioni a bordo pista (2° tipo) | **1024 × 128** (8:1) |
| `banner-combo.png` | Striscioni a bordo pista (3° tipo) | **1024 × 128** (8:1) |
| `screen.png` | Maxischermi del circuito (senza questo file mostrano la classifica live) | **512 × 288** (16:9) |

**Generarli dal wordmark ufficiale**: `python3 scripts/kiosk/build_brand_assets.py percorso/wordmark-huawei.png` crea
`huawei-logo.png`, `banner-huawei.png` e `banner-combo.png` (questa cartella è nel `.gitignore`: gli asset di marca non
vengono committati né pubblicati). Sulla macchina di sviluppo sono stati generati, in via **provvisoria**, dal wordmark
HUAWEI pubblicato su Wikimedia Commons (`File:Huawei wordmark.svg`): sostituiscili con quello del brand kit ufficiale.
Il logo di Milan Games Week non è stato scaricato (il sito ufficiale blocca l'accesso automatico): `banner-mgw.png` e
`mgw-logo.png` vanno presi dal kit dell'organizzatore.

La livrea della monoposto usa `public/cars/f12026/liveries/huawei_mgw/decals.png` (2048 × 512, trasparente):
per l'artwork ufficiale sostituiscila tenendo ogni immagine nel suo rettangolo
(vedi `scripts/kiosk/build_event_livery.py` e `src/lib/kiosk/event-livery.ts`).

Testi, date e colori dei segnaposto: `src/lib/kiosk/event-brand.ts`.
