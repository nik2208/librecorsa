# Huawei Racing Challenge · gioco kiosk (Milan Games Week & Cartoomics 2026)

Branch `event/gaming-week-2026` del fork di LibreCorsa. Il sito si apre **direttamente sul kiosk** per lo stand Huawei
alla Milan Games Week & Cartoomics (Fiera Milano Rho, 27–29 novembre 2026). Non serve digitare indirizzi: tutto si
raggiunge con i pulsanti a schermo, il controller o il touch.

## Il flusso

1. **Caricamento**: schermata dell'evento con la percentuale. Se il caricamento fallisce o si blocca, la pagina riprova
   da sola.
2. **Menu**: grande pulsante **GIOCA**, classifica, **Impostazioni** (PIN). Auto e circuito sono già impostati:
   **Ferrari SF-26 a Monza**.
3. **Chi guida?**: nome del giocatore (tastiera a schermo o fisica) e difficoltà **Facile / Medio / Difficile**, poi
   **Via!**. Con il controller: frecce per la difficoltà, A per partire, B per tornare al menu. Dopo 90 s senza
   nessuno torna al menu.
4. **Gara**: conto alla rovescia e cronometro con il limite delle impostazioni, in **minuti** o in **giri completati**.
5. **Risultato**: tempi, posizione e classifica. Il risultato viene registrato sul server, poi si torna al **menu**
   (pulsante o in automatico).

Classifica:
- sessione **a minuti** → vince il **miglior giro**;
- sessione **a giri** → vince il **tempo totale** dei giri (con un tempo massimo opzionale);
- i giri fuori dai limiti della pista prendono una penalità (default +5 s) oppure non contano (impostazione);
- per ogni nome resta il risultato migliore, con la difficoltà scelta (F/M/D accanto al nome);
- una classifica per ogni combinazione di circuito e auto.

| Pagina | Cosa fa |
| :-- | :-- |
| `/` | **Il kiosk** (anche `/kiosk` e `/kiosk/play`, per i vecchi link). |
| `/kiosk/admin` | Impostazioni (PIN, dal pulsante *Impostazioni* del menu): giri o minuti, circuito, auto, difficoltà proposta, comandi (controller USB / volante / tastiera), qualità grafica; risultati, eliminazione, azzeramento, export CSV; **indirizzo della classifica in rete locale**. |
| `/kiosk/classifica` | Classifica pubblica per un secondo schermo o un telefono sulla stessa rete (si aggiorna da sola). |
| `/play` | Il simulatore completo: serve solo allo staff per abbinare un volante (da *Impostazioni* → *Configura volante*). |

## Avvio

Serve **Node ≥ 20.9** per compilare (Next 16); il server del kiosk gira anche su Node 18.

```bash
npm ci
npm run build                      # build statica in out/
KIOSK_ADMIN_PIN=1234 npm start     # = node kiosk/server.mjs → http://localhost:8787 (il kiosk è la pagina iniziale)
```

`npm start` avvia il server del kiosk: serve il gioco, salva configurazione e risultati e risponde alla classifica
(`/api/kiosk/…`). Senza questo server (per esempio con un hosting solo statico) il gioco funziona, ma la classifica
non viene registrata.

Variabili del server:

| Variabile | Default | |
| :-- | :-- | :-- |
| `KIOSK_ADMIN_PIN` | `2026` | **Cambialo** per l'evento |
| `PORT` | `8787` | |
| `KIOSK_HOST` | `0.0.0.0` | In ascolto su tutta la rete locale (la classifica si apre da altri dispositivi) |
| `KIOSK_PUBLIC_URL` | | Indirizzo da mostrare nelle impostazioni se il server sta dietro Docker o un proxy (es. `http://192.168.1.50:8787`) |
| `KIOSK_DATA_DIR` | `kiosk/data` | |
| `KIOSK_STATIC_DIR` | `out` | |
| `KIOSK_HOME` | | Pagina su cui reindirizzare `/` (vuoto: `/` è il kiosk) |

All'avvio il server scrive nel log anche gli indirizzi della classifica in rete locale, per esempio
`leaderboard on the network: http://192.168.1.50:8787/kiosk/classifica`. Gli stessi indirizzi sono in
**Impostazioni → Classifica in rete locale**.

I dati restano sulla macchina: `kiosk/data/config.json` e `kiosk/data/results.json` (scritture atomiche).
L'azzeramento della classifica salva prima una copia `results-<data>.json`. Fai un backup della cartella a fine
giornata.

### Sviluppo

```bash
node kiosk/server.mjs                                         # API su :8787
echo "NEXT_PUBLIC_KIOSK_API=http://localhost:8787" >> .env.local
npm run dev                                                   # http://localhost:3000
```

## Preparare la postazione

1. Collega il **controller USB** (gamepad standard, Xbox o PlayStation): è già impostato, non serve configurarlo.
   RT accelera, LT frena, la levetta sinistra sterza.
2. Avvia il server e apri il kiosk. Dal menu: **Impostazioni** → PIN → imposta minuti o giri.
   - Su un PC senza scheda video dedicata lascia la qualità grafica su *Media* o *Bassa*: con *Alta* il caricamento
     può bloccarsi.
   - Con un volante: in *Comandi dei giocatori* scegli *Volante*, poi *Configura volante*. Abbina sterzo e pedali nel
     simulatore e torna con il pulsante *Impostazioni kiosk* in basso a sinistra.
3. Avvia Chrome/Chromium a schermo intero sulla pagina iniziale, per esempio:

```bash
chromium --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble \
  --disable-infobars --check-for-update-interval=31536000 http://localhost:8787/
```

`--autoplay-policy=no-user-gesture-required` fa partire l'audio anche quando il giocatore avvia con un pulsante del
controller (per il browser i pulsanti dei gamepad non contano come "gesto").

### Durante l'evento

- **Pausa**: Esc o il pulsante pausa; il cronometro si ferma. Dalla pausa: *Riprendi* o *Termina sessione*.
- **Auto bloccata**: il tasto o pulsante *Restart* rimette l'auto in griglia (il giro in corso si perde).
- Disattivati per i visitatori: autopilota, mute, replay, restart lanciato, sterzo col mouse, menu di pausa e
  impostazioni del simulatore.
- **Staff**: pulsante *Impostazioni* nel menu, oppure, durante una gara, 5 tocchi rapidi nell'angolo in alto a sinistra
  (o Ctrl+Maiusc+K) → PIN.
- Se il server non risponde, il gioco continua con l'ultima configurazione letta e mette in coda i risultati, che invia
  appena il server torna raggiungibile.

## API (`/api/kiosk`)

| Metodo | Percorso | PIN | Descrizione |
| :-- | :-- | :-: | :-- |
| GET | `/api/kiosk/leaderboard` | | Classifica JSON. Parametri: `mode=best\|total`, `track`, `car`, `laps`, `limit` (20), `unique=0` per tutti i risultati. Default: quelli della configurazione attuale. |
| GET | `/api/kiosk/network` | | Indirizzi del server in rete locale (pagina e API della classifica) |
| GET | `/api/kiosk/config` | | Configurazione attuale |
| PUT | `/api/kiosk/config` | ✓ | Salva la configurazione (i campi omessi restano invariati) |
| POST | `/api/kiosk/results` | | Invia una sessione (la usa il gioco); risponde con posizione e top 10 |
| GET | `/api/kiosk/results` | ✓ | Tutti i risultati |
| DELETE | `/api/kiosk/results/:id` | ✓ | Elimina un risultato (es. nomi offensivi) |
| DELETE | `/api/kiosk/results` | ✓ | Azzera la classifica (con copia di sicurezza) |
| GET | `/api/kiosk/results.csv` | ✓ | Export CSV (con la difficoltà) |
| POST | `/api/kiosk/auth` | ✓ | Verifica il PIN |
| GET | `/api/kiosk/health` | | Stato del server |

Il PIN va nell'header `X-Kiosk-Pin`. Esempio:

```bash
curl http://192.168.1.50:8787/api/kiosk/leaderboard?limit=10
curl -H "X-Kiosk-Pin: 1234" http://localhost:8787/api/kiosk/results.csv -o classifica.csv
```

Risposta di `/leaderboard`:

```json
{ "mode": "best", "trackId": "monza", "carId": "sf26", "laps": null, "total": 42, "generatedAt": "…",
  "rows": [ { "rank": 1, "id": "…", "name": "MARIO", "difficulty": "assisted", "bestLapMs": 101234,
              "bestLapPenalised": false, "totalTimeMs": null, "lapsCompleted": 3, "validLaps": 3, "createdAt": "…" } ] }
```

`difficulty`: `assisted` (facile), `semi_pro` (medio), `pro` (difficile).

## Grafiche Huawei / Milan Games Week

Nessuna schermata dei visitatori mostra LibreCorsa: caricamento, menu e HUD hanno il marchio dell'evento, e il titolo
della pagina è "HUAWEI RACING CHALLENGE · MILAN GAMES WEEK 2026". I crediti sono nelle impostazioni (staff).

Su Monza il gioco aggiunge cartelloni con le grafiche dell'evento lungo i rettilinei, oltre le barriere. Su RISE
Motordrome cambia i suoi striscioni, maxischermi, portale, bandiere e cordoli.

**Loghi e striscioni si generano all'avvio del server** (`kiosk/brand.mjs`, nella build servita), dai loghi sorgente:

- **wordmark HUAWEI**: scaricato automaticamente la prima volta (Wikimedia Commons) e tenuto in cache in
  `kiosk/data/brand-src/`; per quello ufficiale del brand kit: `kiosk/brand/sponsor-logo.svg`;
- **logo Milan Games Week 2026**: il sito ufficiale rifiuta i download automatici, quindi va salvato **una volta** da un
  browser come `kiosk/brand/event-logo.svg` (indirizzo: `https://www.milangamesweek.it/content/dam/mgw/loghi/2026/`
  "Logo bianco scritta bianca no sfondo.svg").

`kiosk/brand/` è nel `.gitignore`: gli asset di marca restano sulla macchina. Dettagli e opzioni (`KIOSK_BRAND=0`,
`npm run kiosk:brand -- --force`): `kiosk/brand/README.md`. Testi, date e colori: `src/lib/kiosk/event-brand.ts`.

## Ferrari SF-26 e Monza

Sono nel repository su questo branch (`public/cars/sf26/`, `public/tracks/monza/`), recuperati dalla storia di
LibreCorsa (commit `7b009d9`) su richiesta del proprietario del fork, e sono auto e circuito predefiniti del kiosk.
Upstream li ha rimossi il 12/11/2026 per motivi di diritti:

- la carrozzeria della SF-26 è estratta da un videogioco di F1 e ha la livrea originale, con i marchi Ferrari e degli
  sponsor reali (tra cui HP, IBM, AWS);
- il modello di Monza viene da una conversione di Assetto Corsa e contiene uno striscione "Kunos Simulazioni".

Le impostazioni permettono di tornare a RISE Motordrome e alla monoposto 2026 in livrea Huawei. Una build con
`NEXT_PUBLIC_EXTRA_CONTENT=""` li esclude del tutto.

## Licenze e diritti

- **Codice**: LibreCorsa, MIT (uso commerciale consentito).
- **Ferrari SF-26 e Monza**: senza licenza (vedi sopra).
- **Circuito RISE Motordrome** (alternativo): CC BY-NC-SA 4.0, non commerciale; serve il permesso dell'autore
  (Alp Yalay, LibreCorsa).
- **Monoposto 2026 Prototype** (alternativa): Qvist Designs, CC BY 4.0. I suoni dei motori hanno autori e licenze non
  indicati (CREDITS.md).
- **Marchi Huawei e Milan Games Week**: usare solo l'artwork fornito dai titolari.
