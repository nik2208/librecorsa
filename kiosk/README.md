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
| `/kiosk/admin` | Impostazioni (PIN, dal pulsante *Impostazioni* del menu): giri o minuti, circuito, auto, difficoltà proposta, comandi (controller USB / volante / tastiera), qualità grafica; **loghi** (quali mostrare, ordine, caricarne di nuovi); risultati, eliminazione, azzeramento, export CSV; **indirizzo della classifica in rete locale**. |
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
KIOSK_STATIC_DIR=public node kiosk/server.mjs                 # API su :8787; loghi e cartelloni generati in public/
echo "NEXT_PUBLIC_KIOSK_API=http://localhost:8787" >> .env.local
npm run dev                                                   # http://localhost:3000
```

Con `KIOSK_STATIC_DIR=public` il server genera le immagini dei loghi predefiniti in `public/kiosk/brand/`, che `next dev`
serve, e le indica al gioco (senza, i loghi compaiono come testo).

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

## Loghi

In **Impostazioni → Loghi** lo staff sceglie quali loghi far vedere e in che ordine. I loghi visibili compaiono:

- nell'intestazione di tutte le schermate del kiosk (caricamento, menu, nome, risultato, classifica);
- sui cartelloni a bordo pista: lungo i rettilinei di Monza, un logo per cartellone a rotazione, e sugli striscioni di
  RISE Motordrome;
- nel titolo dei maxischermi del circuito.

I loghi predefiniti sono tre: **HUAWEI**, **Milan Games Week** e **WINDTRE**. Si possono nascondere ma non eliminare.

**Aggiungere un logo a kiosk acceso**: *Aggiungi un logo* → scegli il file (SVG, PNG, JPG, WebP o GIF, fino a 10 MB) →
nome → *Carica e mostra*. Il server ne ricava l'immagine per le schermate e il cartellone (1024 × 128), e il gioco lo
mostra **entro circa 5 secondi, anche a gara in corso**, senza riavvii.
- Un logo con sfondo trasparente va su un cartellone chiaro se i suoi colori sono scuri, su uno nero se sono chiari
  (*Sfondo del cartellone*: Auto, Chiaro o Scuro).
- Un'immagine senza trasparenza (JPG) tiene il suo sfondo.
- Un logo quasi quadrato viene ripetuto lungo il cartellone.
- Si arriva alle impostazioni anche da un telefono o un portatile sulla stessa rete: `http://<indirizzo>:8787/kiosk/admin`.

Ogni modifica (visibile/nascosto, ordine, sfondo, eliminazione) vale subito, senza *Salva*. Con più di 12 loghi
visibili i cartelloni di Monza (3 per RISE) li alternano ogni 20 secondi. Senza nessun logo visibile i cartelloni di
Monza spariscono e RISE torna ai suoi striscioni originali.

Con il logo HUAWEI nascosto la sfida si chiama "RACING CHALLENGE" invece di "HUAWEI RACING CHALLENGE"; con quello Milan
Games Week nascosto spariscono anche date e luogo dell'evento.

Un logo appena caricato (o rimesso visibile) compare subito sui cartelloni, al suo posto nell'ordine. Un logo caricato è
l'ultimo: a Monza, con i tre predefiniti visibili, va sul 4°, l'8°, il 12° cartellone e così via. Per averlo sul primo,
spostalo in cima all'ordine. Quando i loghi sono più dei cartelloni e si alternano, quello appena acceso va subito sul
primo (a RISE, il portale di partenza).

Non cambiano con i loghi il titolo della pagina del gioco (non visibile a schermo intero) e la monoposto alternativa
("Monoposto 2026 Huawei", con la sua livrea).

I loghi caricati restano sul PC del kiosk (`kiosk/data/logos.json` e `kiosk/data/logos/`). Il server serve solo le
immagini PNG che ha disegnato, mai il file caricato. SVG con tavole da disegno grandi vanno bene; le immagini dentro un SVG
contano nel limite di 64 megapixel.

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
| GET | `/api/kiosk/logos` | | I loghi, nell'ordine scelto, con `enabled` e gli indirizzi delle immagini (il gioco li rilegge ogni 5 s) |
| PUT | `/api/kiosk/logos` | ✓ | `{"logos":[{"id":"mgw","enabled":false}]}` mostra o nasconde (per i caricati anche `groundMode`: `auto`/`light`/`dark`); `{"order":["windtre","huawei"]}` cambia l'ordine (gli altri seguono) |
| POST | `/api/kiosk/logos?name=…` | ✓ | Carica un logo: il file nel corpo della richiesta (SVG, PNG, JPG, WebP, GIF; massimo 10 MB) |
| DELETE | `/api/kiosk/logos/:id` | ✓ | Elimina un logo caricato (quelli predefiniti si possono solo nascondere) |
| POST | `/api/kiosk/auth` | ✓ | Verifica il PIN |
| GET | `/api/kiosk/health` | | Stato del server |

Il PIN va nell'header `X-Kiosk-Pin`. Esempio:

```bash
curl http://192.168.1.50:8787/api/kiosk/leaderboard?limit=10
curl -H "X-Kiosk-Pin: 1234" http://localhost:8787/api/kiosk/results.csv -o classifica.csv
curl -H "X-Kiosk-Pin: 1234" --data-binary @partner.png "http://localhost:8787/api/kiosk/logos?name=Partner"
curl -X PUT -H "X-Kiosk-Pin: 1234" -H "Content-Type: application/json" -d '{"logos":[{"id":"mgw","enabled":false}]}' http://localhost:8787/api/kiosk/logos
```

Risposta di `/leaderboard`:

```json
{ "mode": "best", "trackId": "monza", "carId": "sf26", "laps": null, "total": 42, "generatedAt": "…",
  "rows": [ { "rank": 1, "id": "…", "name": "MARIO", "difficulty": "assisted", "bestLapMs": 101234,
              "bestLapPenalised": false, "totalTimeMs": null, "lapsCompleted": 3, "validLaps": 3, "createdAt": "…" } ] }
```

`difficulty`: `assisted` (facile), `semi_pro` (medio), `pro` (difficile).

## Grafiche Huawei / Milan Games Week / WINDTRE

Nessuna schermata dei visitatori mostra LibreCorsa: caricamento, menu e HUD hanno il marchio dell'evento, e il titolo
della pagina è "HUAWEI RACING CHALLENGE · MILAN GAMES WEEK 2026". I crediti sono nelle impostazioni (staff).

Su Monza il gioco aggiunge cartelloni con i loghi visibili lungo i rettilinei, oltre le barriere. Su RISE Motordrome
cambia i suoi striscioni, maxischermi, portale, bandiere e cordoli. Quali loghi: vedi [Loghi](#loghi).

**I loghi predefiniti e i loro cartelloni si generano all'avvio del server** (`kiosk/brand.mjs`, nella build servita),
dai loghi sorgente:

- **wordmark HUAWEI**: scaricato automaticamente la prima volta (Wikimedia Commons) e tenuto in cache in
  `kiosk/data/brand-src/`; per quello ufficiale del brand kit: `kiosk/brand/sponsor-logo.svg`;
- **logo WINDTRE** (quello del 2020, con il marchio arancione): scaricato automaticamente la prima volta (Wikimedia
  Commons) e tenuto in cache come quello HUAWEI; per quello ufficiale del brand kit: `kiosk/brand/windtre.svg`. Sulle
  schermate scure la scritta grigia diventa bianca; il cartellone è bianco con bande arancioni;
- **logo Milan Games Week 2026**: il sito ufficiale rifiuta i download automatici, quindi va salvato **una volta** da un
  browser come `kiosk/brand/event-logo.svg` (indirizzo: `https://www.milangamesweek.it/content/dam/mgw/loghi/2026/`
  "Logo bianco scritta bianca no sfondo.svg").

Il PC del kiosk deve essere collegato a internet al primo avvio per scaricare i loghi HUAWEI e WINDTRE; dopo restano
in cache. Senza un'immagine il gioco scrive il nome del marchio nei suoi colori.

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
- **Marchi Huawei, WINDTRE e Milan Games Week**: usare solo l'artwork fornito dai titolari. I file scaricati da
  Wikimedia Commons sono loghi di solo testo, di pubblico dominio come immagini, ma restano marchi registrati (WINDTRE è
  di Wind Tre S.p.A.). Lo stesso vale per i loghi caricati dallo staff.
