# LibreCorsa · modalità kiosk (Milan Games Week & Cartoomics 2026)

Branch `event/gaming-week-2026`. Il gioco gira in modalità kiosk per lo stand Huawei alla Milan Games Week &
Cartoomics (Fiera Milano Rho, 27–29 novembre 2026).

## Cosa c'è

| Pagina | Cosa fa |
| :-- | :-- |
| `/kiosk` | All'avvio: scelta tra **Gioca** e **Admin / Config** (PIN). `/` porta qui. |
| `/kiosk/play` | Il gioco: nome del giocatore (tastiera fisica o a schermo), **GIOCA**, conto alla rovescia, cronometro con il limite impostato in admin, risultato e classifica, poi il giocatore successivo. |
| `/kiosk/admin` | Limite della sessione in **giri** o **minuti**, circuito, difficoltà, opzioni avanzate; elenco risultati, eliminazione, azzeramento, export CSV. |
| `/kiosk/classifica` | Classifica pubblica per un secondo schermo (si aggiorna da sola). |
| `/play` | Il gioco completo: serve allo staff per impostare volante/pedaliera/controller e grafica. |

Classifica:
- sessione **a minuti** → vince il **miglior giro**;
- sessione **a giri** → vince il **tempo totale** dei giri (con un tempo massimo opzionale).
- I giri fuori dai limiti della pista prendono una penalità (default +5 s) oppure non contano (opzione admin).
- Per ogni nome resta in classifica il risultato migliore.

## Avvio rapido

Serve **Node ≥ 20.9** per compilare (Next 16); il server del kiosk gira anche su Node 18.

```bash
npm ci
npm run build                          # crea la build statica in out/
KIOSK_ADMIN_PIN=1234 npm run kiosk     # = node kiosk/server.mjs → http://localhost:8787
```

Variabili del server: `KIOSK_ADMIN_PIN` (default `2026`: **cambialo**), `PORT` (8787), `KIOSK_HOST` (0.0.0.0),
`KIOSK_DATA_DIR` (kiosk/data), `KIOSK_STATIC_DIR` (out), `KIOSK_HOME` (/kiosk).

I dati restano sulla macchina: `kiosk/data/config.json` e `kiosk/data/results.json` (scritture atomiche). L'azzeramento
della classifica salva prima una copia `results-<data>.json`. Fai un backup della cartella a fine giornata.

### Sviluppo

```bash
node kiosk/server.mjs                                         # API su :8787
echo "NEXT_PUBLIC_KIOSK_API=http://localhost:8787" >> .env.local
npm run dev                                                   # http://localhost:3000/kiosk
```

## Preparare la postazione

1. Avvia il server e apri `http://localhost:8787/play` **una volta** con volante/pedaliera collegati: segui la
   configurazione dei controlli (sterzo, pedali, force feedback) e scegli grafica e telecamera. Le impostazioni
   restano nel browser e il kiosk le usa (senza mai modificarle).
2. Apri `http://localhost:8787/kiosk/admin`, inserisci il PIN e imposta giri o minuti.
3. Avvia Chrome/Chromium a schermo intero sulla pagina iniziale, ad esempio:

```bash
chromium --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble \
  --disable-infobars --check-for-update-interval=31536000 http://localhost:8787/kiosk
```

`--autoplay-policy=no-user-gesture-required` fa partire l'audio anche quando il giocatore avvia con un pulsante del
volante (i pulsanti dei gamepad non contano come "gesto" per il browser).

### Durante l'evento

- **GIOCA**: tocco/clic sul pulsante, Invio, oppure un pulsante qualsiasi del volante/controller (con il nome inserito).
- **Pausa**: Esc o il pulsante pausa; il cronometro si ferma. Dalla pausa: *Riprendi* o *Termina sessione*.
- **Riavvio auto bloccata**: il tasto/pulsante *Restart* rimette l'auto in griglia (il giro in corso si perde).
- Disattivati per i visitatori: autopilota, mute, replay, restart lanciato, sterzo col mouse, menu di pausa e
  impostazioni.
- **Uscita staff**: 5 tocchi rapidi nell'angolo in alto a sinistra (o Ctrl+Maiusc+K) → PIN → pagina admin.
- Se il server non risponde il gioco continua: usa l'ultima config letta e mette in coda i risultati, che invia appena
  il server torna raggiungibile.

## API (`/api/kiosk`)

| Metodo | Percorso | PIN | Descrizione |
| :-- | :-- | :-: | :-- |
| GET | `/api/kiosk/leaderboard` | | Classifica JSON. Parametri: `mode=best\|total`, `track`, `laps`, `limit` (20), `unique=0` per tutti i risultati. Default: quelli della config attuale. |
| GET | `/api/kiosk/config` | | Config attuale |
| PUT | `/api/kiosk/config` | ✓ | Salva la config |
| POST | `/api/kiosk/results` | | Invia una sessione (la usa il gioco); risponde con posizione e top 10 |
| GET | `/api/kiosk/results` | ✓ | Tutti i risultati |
| DELETE | `/api/kiosk/results/:id` | ✓ | Elimina un risultato (es. nomi offensivi) |
| DELETE | `/api/kiosk/results` | ✓ | Azzera la classifica (con copia di sicurezza) |
| GET | `/api/kiosk/results.csv` | ✓ | Export CSV |
| POST | `/api/kiosk/auth` | ✓ | Verifica il PIN |
| GET | `/api/kiosk/health` | | Stato del server |

Il PIN va nell'header `X-Kiosk-Pin`. Esempio:

```bash
curl http://localhost:8787/api/kiosk/leaderboard?limit=10
curl -H "X-Kiosk-Pin: 1234" http://localhost:8787/api/kiosk/results.csv -o classifica.csv
```

Risposta di `/leaderboard`:

```json
{ "mode": "best", "trackId": "rwanda_official_short", "laps": null, "total": 42, "generatedAt": "…",
  "rows": [ { "rank": 1, "id": "…", "name": "MARIO", "bestLapMs": 101234, "bestLapPenalised": false,
              "totalTimeMs": null, "lapsCompleted": 3, "validLaps": 3, "createdAt": "…" } ] }
```

## Grafiche Huawei / Milan Games Week

Il circuito (RISE Motordrome) ha striscioni, maxischermi, portale di partenza, bandiere e cordoli con i colori e i nomi
dello sponsor e dell'evento; la monoposto ha la livrea "Milan Games Week #26". Sono **segnaposto testuali**: per i loghi
ufficiali vedi `public/kiosk/brand/README.md`. Testi, date e colori: `src/lib/kiosk/event-brand.ts`.
I maxischermi del circuito mostrano la classifica live del kiosk.

## Licenze e diritti (da verificare prima dell'evento)

- **Codice**: MIT, uso commerciale consentito.
- **Circuito RISE Motordrome**: CC BY-NC-SA 4.0, **non commerciale**. Uno stand sponsorizzato è uso commerciale e
  le grafiche dell'evento sono un adattamento: serve il permesso scritto dell'autore (Alp Yalay, LibreCorsa).
  I crediti richiesti sono già nelle schermate del kiosk.
- **Monoposto 2026 Prototype**: modello di Qvist Designs, CC BY 4.0 (con credito; il volante viene dall'AM26 di DeX,
  CC BY 4.0). **Suono del motore** (`public/cars/f12026/audio/`, e quello di riserva in `public/lc26/audio/`): da un
  "F1 2026 Sound Pack" e da un mod di Assetto Corsa EVO, autori e licenze non indicati (CREDITS.md).
- La livrea Oracle Red Bull resta selezionabile solo nel gioco completo (`/play`), mai nel kiosk: è un marchio di
  terzi non licenziato.
- **Marchi Huawei e Milan Games Week**: usare solo l'artwork fornito dai titolari.
