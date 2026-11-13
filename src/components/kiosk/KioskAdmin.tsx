"use client";

/** The kiosk's admin page (PIN): the session limit and the rest of the config, and the results on the leaderboard */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BrandHeader, KioskButton, KioskCredits, PinDialog } from "@/components/kiosk/kiosk-ui";
import { KioskLogosPanel } from "@/components/kiosk/KioskLogos";
import {
  checkPin,
  deleteResult,
  downloadResultsCsv,
  fetchNetworkInfo,
  kioskApiUrl,
  listResults,
  loadKioskConfig,
  rememberPin,
  resetResults,
  saveKioskConfig,
  storedPin,
  type KioskNetworkInfo,
} from "@/lib/kiosk/kiosk-api";
import { formatClock, formatLapTime } from "@/lib/kiosk/kiosk-score";
import { withBasePath } from "@/lib/base-path";
import {
  DEFAULT_KIOSK_CONFIG,
  KIOSK_CARS,
  KIOSK_DEVICES,
  KIOSK_DIFFICULTIES,
  KIOSK_GRAPHICS,
  KIOSK_TRACKS,
  difficultyLabel,
  listedKioskCars,
  listedKioskTracks,
  runnableCarId,
  runnableTrackId,
  sanitizeKioskConfig,
  type KioskConfig,
  type KioskResult,
} from "@/lib/kiosk/kiosk-types";

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1.5">
    <span className="font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/60">{label}</span>
    {children}
    {hint ? <span className="font-f1-italic text-xs text-white/45">{hint}</span> : null}
  </label>
);

const inputClass =
  "h-12 rounded-lg border border-white/15 bg-black/40 px-3 font-f1-mono text-lg text-white outline-none focus:border-[#C7000B] disabled:opacity-50";

const Segmented = <T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) => (
  <div className="flex overflow-hidden rounded-lg border border-white/15">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        onClick={() => onChange(o.id)}
        className={`h-12 flex-1 px-4 font-f1-display text-sm font-bold uppercase tracking-[0.1em] ${value === o.id ? "bg-[#C7000B] text-white" : "bg-black/30 text-white/70 hover:bg-white/10"}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const KioskAdmin: React.FC = () => {
  const [pin, setPin] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [config, setConfig] = useState<KioskConfig>(DEFAULT_KIOSK_CONFIG);
  const [saved, setSaved] = useState<KioskConfig | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [results, setResults] = useState<KioskResult[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState<KioskNetworkInfo | null>(null);
  const [networkError, setNetworkError] = useState(false);

  // A PIN remembered from earlier in this tab is checked again (the server may have restarted with another)
  useEffect(() => {
    const remembered = storedPin();
    if (!remembered) {
      setChecking(false);
      return;
    }
    void checkPin(remembered)
      .then((ok) => {
        if (ok) setPin(remembered);
        else rememberPin(null);
      })
      .catch(() => setNotice({ tone: "error", text: "Server del kiosk non raggiungibile" }))
      .finally(() => setChecking(false));
  }, []);

  const reload = useCallback(async (p: string) => {
    const { config: c, source } = await loadKioskConfig();
    setConfig(c);
    setSaved(c);
    if (source !== "server") setNotice({ tone: "error", text: "Server del kiosk non raggiungibile: mostro la config locale" });
    try {
      setResults((await listResults(p)).results);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Errore" });
    }
  }, []);
  useEffect(() => {
    if (pin) void reload(pin);
  }, [pin, reload]);
  // Where the leaderboard is reached from other screens and phones on the local network
  useEffect(() => {
    if (!pin) return;
    void fetchNetworkInfo()
      .then((info) => {
        setNetwork(info);
        setNetworkError(false);
      })
      .catch(() => setNetworkError(true));
  }, [pin]);

  const update = <K extends keyof KioskConfig>(key: K, value: KioskConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const dirty = saved !== null && JSON.stringify(sanitizeKioskConfig(config)) !== JSON.stringify(sanitizeKioskConfig(saved));

  const save = async () => {
    if (!pin) return;
    setBusy(true);
    try {
      const next = await saveKioskConfig(sanitizeKioskConfig(config), pin);
      setConfig(next);
      setSaved(next);
      setNotice({ tone: "ok", text: "Configurazione salvata: vale dal prossimo giocatore" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Salvataggio non riuscito" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!pin) return;
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    try {
      await deleteResult(id, pin);
      setResults((r) => r.filter((x) => x.id !== id));
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Eliminazione non riuscita" });
    }
  };

  const reset = async () => {
    if (!pin) return;
    setConfirmReset(false);
    try {
      const res = await resetResults(pin);
      setResults([]);
      setNotice({ tone: "ok", text: `Classifica azzerata${res.backup ? ` (copia di sicurezza: ${res.backup})` : ""}` });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Azzeramento non riuscito" });
    }
  };

  if (!pin) {
    return (
      <main className="kiosk-ui h-dvh overflow-y-auto bg-[#08090D] px-6 py-8 text-white">
        <BrandHeader compact />
        {checking ? null : (
          <PinDialog onSuccess={(p) => setPin(p)} onCancel={() => window.location.assign(withBasePath("/"))} />
        )}
        {notice ? <p className="mt-6 font-f1-italic text-[#FF6B60]">{notice.text}</p> : null}
      </main>
    );
  }

  const leaderboardUrl = typeof window !== "undefined" ? new URL(kioskApiUrl("/leaderboard"), window.location.href).toString() : kioskApiUrl("/leaderboard");
  // The LAN's addresses first; the virtual ones (Docker, VPN…) only when there is nothing else
  const lanUrls = network ? (network.urls.some((u) => !u.virtual) ? network.urls.filter((u) => !u.virtual) : network.urls) : [];

  return (
    // Its own scroll: the game's body never scrolls (globals.css), and the settings run well below one screen
    <main className="kiosk-ui h-dvh overflow-y-auto overscroll-contain bg-[#08090D] px-[max(1.25rem,env(safe-area-inset-left))] py-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandHeader compact />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.assign(withBasePath("/"))}
            className="rounded-lg bg-[#C7000B] px-4 py-2 font-f1-display text-sm font-bold uppercase tracking-[0.1em]"
          >
            Torna al gioco
          </button>
          <button
            type="button"
            onClick={() => {
              rememberPin(null);
              window.location.assign(withBasePath("/"));
            }}
            className="rounded-lg border border-white/20 px-4 py-2 font-f1-display text-sm font-bold uppercase tracking-[0.1em] text-white/60"
          >
            Esci
          </button>
        </div>
      </div>
      <h1 className="mt-6 font-f1-display text-3xl font-black uppercase tracking-[0.08em]">Impostazioni del kiosk</h1>
      {notice ? (
        <p className={`mt-3 rounded-lg px-4 py-2 font-f1-italic font-bold ${notice.tone === "ok" ? "bg-[#14532D]/60 text-[#86EFAC]" : "bg-[#7F1D1D]/60 text-[#FCA5A5]"}`}>{notice.text}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-f1-display text-lg font-bold uppercase tracking-[0.12em]">Sessione di gioco</h2>
          <Field label="Limite della sessione" hint="A giri: vince il tempo totale. A tempo: vince il miglior giro.">
            <Segmented
              value={config.limitMode}
              options={[
                { id: "time", label: "Minuti" },
                { id: "laps", label: "Giri" },
              ]}
              onChange={(v) => update("limitMode", v)}
            />
          </Field>
          {config.limitMode === "time" ? (
            <Field label="Minuti per giocatore" hint="Lascia il tempo per almeno 2 giri completi: il tratto dalla griglia al traguardo non è cronometrato.">
              <input type="number" min={0.5} max={60} step={0.5} value={config.minutes} onChange={(e) => update("minutes", Number(e.target.value))} className={inputClass} />
            </Field>
          ) : (
            <>
              <Field label="Giri per giocatore">
                <input type="number" min={1} max={20} step={1} value={config.laps} onChange={(e) => update("laps", Number(e.target.value))} className={inputClass} />
              </Field>
              <Field label="Tempo massimo (minuti, 0 = nessuno)" hint="La sessione finisce comunque dopo questo tempo (giri non completati: nessun tempo totale).">
                <input type="number" min={0} max={120} step={0.5} value={config.maxMinutes} onChange={(e) => update("maxMinutes", Number(e.target.value))} className={inputClass} />
              </Field>
            </>
          )}
          <Field
            label="Circuito"
            hint={
              runnableTrackId(config.trackId) !== config.trackId
                ? `${KIOSK_TRACKS.find((t) => t.id === config.trackId)?.label} non è in questa build: il kiosk usa RISE corto`
                : "Classifica separata per circuito."
            }
          >
            <Segmented value={config.trackId} options={listedKioskTracks()} onChange={(v) => update("trackId", v)} />
          </Field>
          {listedKioskCars().length > 1 || runnableCarId(config.carId) !== config.carId ? (
            <Field
              label="Auto"
              hint={
                runnableCarId(config.carId) !== config.carId
                  ? `${KIOSK_CARS.find((c) => c.id === config.carId)?.label} non è in questa build: il kiosk usa la monoposto Huawei`
                  : "Classifica separata per auto."
              }
            >
              <Segmented value={config.carId} options={listedKioskCars()} onChange={(v) => update("carId", v)} />
            </Field>
          ) : null}
          <Field label="Difficoltà proposta" hint="Ogni giocatore sceglie Facile, Medio o Difficile prima di partire: questa è quella già selezionata.">
            <Segmented value={config.difficulty} options={KIOSK_DIFFICULTIES} onChange={(v) => update("difficulty", v)} />
          </Field>
          <details className="rounded-lg border border-white/10 px-4 py-3">
            <summary className="cursor-pointer font-f1-italic text-sm font-bold uppercase tracking-[0.2em] text-white/70">Avanzate</summary>
            <div className="mt-4 flex flex-col gap-4">
              <Field label="Giri fuori dai limiti della pista">
                <Segmented
                  value={config.invalidLaps}
                  options={[
                    { id: "penalty", label: "Penalità" },
                    { id: "exclude", label: "Non contano" },
                  ]}
                  onChange={(v) => update("invalidLaps", v)}
                />
              </Field>
              {config.invalidLaps === "penalty" ? (
                <Field label="Penalità per giro non valido (secondi)">
                  <input type="number" min={0} max={60} step={0.5} value={config.penaltyS} onChange={(e) => update("penaltyS", Number(e.target.value))} className={inputClass} />
                </Field>
              ) : null}
              <Field label="Traiettoria ideale sull'asfalto">
                <Segmented
                  value={config.racingLine ? "on" : "off"}
                  options={[
                    { id: "on", label: "Visibile" },
                    { id: "off", label: "Nascosta" },
                  ]}
                  onChange={(v) => update("racingLine", v === "on")}
                />
              </Field>
              <Field label="Conto alla rovescia (secondi, 0 = nessuno)">
                <input type="number" min={0} max={10} step={1} value={config.countdownS} onChange={(e) => update("countdownS", Number(e.target.value))} className={inputClass} />
              </Field>
              <Field label="Durata della schermata risultati (secondi)">
                <input type="number" min={5} max={300} step={5} value={config.resultsHoldS} onChange={(e) => update("resultsHoldS", Number(e.target.value))} className={inputClass} />
              </Field>
            </div>
          </details>
          <h2 className="mt-2 font-f1-display text-lg font-bold uppercase tracking-[0.12em]">Controlli e grafica</h2>
          <Field label="Comandi dei giocatori" hint={KIOSK_DEVICES.find((d) => d.id === config.device)?.hint}>
            <Segmented value={config.device} options={KIOSK_DEVICES} onChange={(v) => update("device", v)} />
          </Field>
          {config.device === "wheel" ? (
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-4">
              <p className="font-f1-italic text-sm text-white/70">
                Il volante va abbinato una volta (sterzo, pedali, pulsanti) nel simulatore completo, su questo PC: il kiosk usa quella
                configurazione. Poi torna qui con il pulsante «Impostazioni kiosk» in basso a sinistra.
              </p>
              <Link href="/play" className="self-start rounded-lg border border-white/20 px-4 py-2 font-f1-display text-sm font-bold uppercase tracking-[0.1em] hover:bg-white/10">
                Configura volante
              </Link>
            </div>
          ) : null}
          <Field label="Qualità grafica" hint="Bassa o Media su un PC senza scheda video dedicata: la grafica Alta può bloccare il caricamento.">
            <Segmented value={config.graphics} options={KIOSK_GRAPHICS} onChange={(v) => update("graphics", v)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <KioskButton onClick={() => void save()} disabled={busy || !dirty}>
              Salva
            </KioskButton>
            {dirty ? (
              <button type="button" onClick={() => saved && setConfig(saved)} className="font-f1-italic text-sm uppercase tracking-[0.2em] text-white/60">
                Annulla modifiche
              </button>
            ) : (
              <span className="font-f1-italic text-sm text-white/50">{saved?.updatedAt ? `Salvata il ${new Date(saved.updatedAt).toLocaleString("it-IT")}` : "Valori predefiniti"}</span>
            )}
          </div>
        </section>
        {/* Saved at once, apart from the settings above: a logo shows on the boards while a race is on */}
        <KioskLogosPanel pin={pin} />
        </div>

        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-f1-display text-lg font-bold uppercase tracking-[0.12em]">Risultati ({results.length})</h2>
            <div className="flex flex-wrap gap-2">
              <KioskButton tone="ghost" onClick={() => pin && void reload(pin)}>
                Aggiorna
              </KioskButton>
              <KioskButton tone="ghost" onClick={() => pin && void downloadResultsCsv(pin).catch((err) => setNotice({ tone: "error", text: String(err?.message ?? err) }))}>
                Esporta CSV
              </KioskButton>
              <Link href="/kiosk/classifica" className="rounded-xl border border-white/20 px-5 py-3 font-f1-display text-base font-extrabold uppercase tracking-[0.12em] hover:bg-white/10">
                Classifica
              </Link>
              {confirmReset ? (
                <>
                  <KioskButton tone="danger" onClick={() => void reset()}>
                    Sì, azzera tutto
                  </KioskButton>
                  <KioskButton tone="ghost" onClick={() => setConfirmReset(false)}>
                    Annulla
                  </KioskButton>
                </>
              ) : (
                <KioskButton tone="danger" onClick={() => setConfirmReset(true)} disabled={results.length === 0}>
                  Azzera classifica
                </KioskButton>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left font-f1-italic text-sm">
              <thead className="text-xs uppercase tracking-[0.15em] text-white/50">
                <tr>
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Sessione</th>
                  <th className="py-2 pr-3">Difficoltà</th>
                  <th className="py-2 pr-3">Giri (validi)</th>
                  <th className="py-2 pr-3">Miglior giro</th>
                  <th className="py-2 pr-3">Totale</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="py-2 pr-3 font-f1-mono text-xs text-white/60">{new Date(r.createdAt).toLocaleString("it-IT")}</td>
                    <td className="py-2 pr-3 font-bold uppercase">{r.name}</td>
                    <td className="py-2 pr-3 text-white/70">
                      {r.limitMode === "laps" ? `${r.limitLaps} giri` : `${r.limitMinutes} min`} · {KIOSK_TRACKS.find((t) => t.id === r.trackId)?.label ?? r.trackId}
                      {` · ${KIOSK_CARS.find((c) => c.id === (r.carId ?? "vf26"))?.label ?? r.carId}`}
                    </td>
                    <td className="py-2 pr-3 text-white/70">{difficultyLabel(r.difficulty) ?? "—"}</td>
                    <td className="py-2 pr-3 font-f1-mono">
                      {r.laps.length} ({r.validLaps})
                    </td>
                    <td className="py-2 pr-3 font-f1-mono">
                      {formatLapTime(r.bestLapMs)}
                      {r.bestLapPenalised ? "*" : ""}
                    </td>
                    <td className="py-2 pr-3 font-f1-mono">{r.totalTimeMs !== null ? formatLapTime(r.totalTimeMs) : r.limitMode === "time" ? formatClock(r.drivenMs) : "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(r.id)}
                        className={`rounded-md px-3 py-1 text-xs font-bold uppercase ${confirmDelete === r.id ? "bg-[#C7000B] text-white" : "border border-white/20 text-white/70"}`}
                      >
                        {confirmDelete === r.id ? "Conferma" : "Elimina"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length === 0 ? <p className="py-6 text-center font-f1-italic text-white/50">Ancora nessun risultato.</p> : null}
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-[#C7000B]/40 bg-[#C7000B]/10 p-4">
            <p className="font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/70">Classifica in rete locale</p>
            {lanUrls.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {lanUrls.map((u) => (
                  <li key={u.url} className="flex flex-col">
                    <span className="break-all font-f1-mono text-2xl font-bold text-white">
                      {u.url}
                      {network?.paths.leaderboardPage}
                    </span>
                    <span className="font-f1-mono text-xs text-white/60">
                      JSON: {u.url}
                      {network?.paths.leaderboardApi} · rete {u.iface}
                      {u.virtual ? " (virtuale)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-f1-italic text-sm text-white/70">
                {networkError
                  ? "Server del kiosk non raggiungibile: avvialo con npm start sul PC del kiosk."
                  : network
                    ? "Nessun indirizzo di rete locale trovato: collega il PC alla rete (o imposta KIOSK_PUBLIC_URL)."
                    : "…"}
              </p>
            )}
            <p className="font-f1-italic text-xs text-white/55">
              Aprila da un altro schermo o da un telefono collegato alla stessa rete. Indirizzo usato da questo browser: {leaderboardUrl}
            </p>
            <p className="font-f1-mono text-[11px] text-white/45">JSON: ?mode=best|total · &amp;track=monza · &amp;car=sf26 · &amp;laps=3 · &amp;limit=20 · &amp;unique=0</p>
          </div>
          <KioskCredits className="mt-2" />
        </section>
      </div>
    </main>
  );
};
