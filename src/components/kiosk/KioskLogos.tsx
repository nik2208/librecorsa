"use client";

/**
 * The admin page's logos: which ones the kiosk shows (its screens and the trackside boards), in what order, and the
 * staff's own, uploaded from here while the kiosk runs. Every change is saved at once and reaches the game within a
 * few seconds, in the middle of a race too (src/lib/kiosk/kiosk-logos.ts).
 */

import React, { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import { KioskButton, LogoMark, useKioskLogos } from "@/components/kiosk/kiosk-ui";
import { deleteLogo, logoAssetUrl, updateLogos, uploadLogo, type KioskLogo, type LogoGroundMode } from "@/lib/kiosk/kiosk-logos";

const GROUNDS: readonly { id: LogoGroundMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Chiaro" },
  { id: "dark", label: "Scuro" },
];
const ACCEPT = "image/svg+xml,image/png,image/jpeg,image/webp,image/gif,.svg,.png,.jpg,.jpeg,.webp,.gif";
/** As kiosk/logos.mjs MAX_UPLOAD_BYTES */
const MAX_BYTES = 10 * 1024 * 1024;

type Notice = { tone: "ok" | "error"; text: string };

const NoticeLine: React.FC<{ notice: Notice | null }> = ({ notice }) =>
  notice ? (
    <p role="status" className={`rounded-lg px-3 py-2 font-f1-italic text-sm font-bold ${notice.tone === "ok" ? "bg-[#14532D]/60 text-[#86EFAC]" : "bg-[#7F1D1D]/60 text-[#FCA5A5]"}`}>
      {notice.text}
    </p>
  ) : null;

/** A logo's trackside board as the circuit shows it (its name in the brand's colours while there is no picture) */
const BoardPreview: React.FC<{ logo: KioskLogo }> = ({ logo }) => {
  const [failed, setFailed] = useState<string | null>(null);
  const src = logo.banner ? logoAssetUrl(logo.banner) : null;
  if (src && failed !== src) {
    // eslint-disable-next-line @next/next/no-img-element -- a static export with no image optimiser
    return <img src={src} alt={`Cartellone ${logo.name}`} onError={() => setFailed(src)} className="aspect-[8/1] w-full rounded-md object-cover" draggable={false} />;
  }
  return (
    <div className="flex aspect-[8/1] w-full items-center justify-center rounded-md border border-dashed border-white/20 bg-black/40 font-f1-display text-sm font-bold uppercase tracking-[0.15em] text-white/60">
      {logo.name} · testo
    </div>
  );
};

export const KioskLogosPanel: React.FC<{ pin: string }> = ({ pin }) => {
  const logos = useKioskLogos();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Shown where the staff are working (the page's own notice is a screen above): a change to a logo in its row (at the
  // panel's top once the row is gone: a logo deleted), the upload's next to its button
  const [listNotice, setListNotice] = useState<(Notice & { id: string }) | null>(null);
  const [uploadNotice, setUploadNotice] = useState<Notice | null>(null);
  const rowNotice = (id: string) => (n: Notice | null) => setListNotice(n ? { ...n, id } : null);

  const run = async (key: string, action: () => Promise<unknown>, show: (n: Notice | null) => void, done?: string) => {
    setBusy(key);
    try {
      await action();
      // A success replaces an earlier error
      show(done ? { tone: "ok", text: done } : null);
    } catch (err) {
      show({ tone: "error", text: err instanceof Error ? err.message : "Operazione non riuscita" });
    } finally {
      setBusy(null);
    }
  };

  const list = logos ?? [];
  const shown = list.filter((l) => l.enabled).length;
  const move = (index: number, by: -1 | 1) => {
    const order = list.map((l) => l.id);
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to], order[index]];
    void run(list[index].id, () => updateLogos(pin, { order }), rowNotice(list[index].id));
  };

  const pick = (chosen: File | null) => {
    setFile(chosen);
    setUploadNotice(null);
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) setUploadNotice({ tone: "error", text: "File troppo grande: massimo 10 MB" });
    // The file's name, without its extension, until the staff write their own
    setName(chosen.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 40));
  };

  const upload = () => {
    if (!file) return;
    void run(
      "upload",
      async () => {
        const { added } = await uploadLogo(pin, file, name.trim() || file.name);
        setFile(null);
        setName("");
        return added;
      },
      setUploadNotice,
      "Logo aggiunto: compare subito nelle schermate e sui cartelloni in pista"
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-f1-display text-lg font-bold uppercase tracking-[0.12em]">Loghi</h2>
        <p className="font-f1-italic text-sm text-white/60">
          I loghi visibili compaiono nelle schermate del kiosk e sui cartelloni a bordo pista, in quest&apos;ordine. Ogni modifica vale subito,
          anche durante una gara (entro qualche secondo).
        </p>
      </div>
      {listNotice && !list.some((l) => l.id === listNotice.id) ? <NoticeLine notice={listNotice} /> : null}
      {logos === null ? (
        <p className="font-f1-italic text-sm text-white/50">…</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {list.map((logo, index) => (
            <li key={logo.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${logo.enabled ? "border-white/15 bg-black/30" : "border-white/5 bg-black/10"}`}>
              <div className={logo.enabled ? "" : "opacity-35 grayscale"}>
                <BoardPreview logo={logo} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* A real width of its own, so on a phone the buttons wrap to the next line instead of sliding under the
                    mark; clipped, so a wide wordmark never covers them */}
                <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-3 overflow-hidden">
                  <span className={`flex h-10 min-w-0 max-w-[9rem] items-center overflow-hidden [&_img]:max-w-full ${logo.enabled ? "" : "opacity-35"}`}>
                    <LogoMark logo={logo} compact />
                  </span>
                  <span className="min-w-0 truncate font-f1-italic text-xs uppercase tracking-[0.15em] text-white/50">
                    {logo.builtin ? "predefinito" : "caricato"}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-pressed={logo.enabled}
                  onClick={() => void run(logo.id, () => updateLogos(pin, { logos: [{ id: logo.id, enabled: !logo.enabled }] }), rowNotice(logo.id))}
                  className={`flex h-10 items-center gap-2 rounded-lg px-3 font-f1-display text-xs font-bold uppercase tracking-[0.1em] disabled:opacity-50 ${logo.enabled ? "bg-[#C7000B] text-white" : "border border-white/20 text-white/60 hover:bg-white/10"}`}
                >
                  {logo.enabled ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                  {logo.enabled ? "Visibile" : "Nascosto"}
                </button>
                <div className="flex">
                  <button
                    type="button"
                    aria-label={`Sposta ${logo.name} prima`}
                    disabled={busy !== null || index === 0}
                    onClick={() => move(index, -1)}
                    className="flex h-10 w-10 items-center justify-center rounded-l-lg border border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Sposta ${logo.name} dopo`}
                    disabled={busy !== null || index === list.length - 1}
                    onClick={() => move(index, 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-r-lg border border-l-0 border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              {!logo.builtin ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/50">Sfondo del cartellone</span>
                  <div className="flex overflow-hidden rounded-lg border border-white/15">
                    {GROUNDS.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => g.id !== logo.groundMode && void run(logo.id, () => updateLogos(pin, { logos: [{ id: logo.id, groundMode: g.id }] }), rowNotice(logo.id))}
                        className={`h-9 px-3 font-f1-display text-xs font-bold uppercase tracking-[0.1em] disabled:opacity-50 ${logo.groundMode === g.id ? "bg-white/20 text-white" : "bg-black/30 text-white/60 hover:bg-white/10"}`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (confirmDelete !== logo.id) return setConfirmDelete(logo.id);
                      setConfirmDelete(null);
                      void run(logo.id, () => deleteLogo(pin, logo.id), rowNotice(logo.id), `Logo «${logo.name}» eliminato`);
                    }}
                    className={`ml-auto flex h-9 items-center gap-2 rounded-lg px-3 font-f1-display text-xs font-bold uppercase tracking-[0.1em] disabled:opacity-50 ${confirmDelete === logo.id ? "bg-[#C7000B] text-white" : "border border-[#FF3B30]/50 text-[#FF6B60] hover:bg-[#FF3B30]/15"}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {confirmDelete === logo.id ? "Conferma" : "Elimina"}
                  </button>
                </div>
              ) : null}
              {listNotice?.id === logo.id ? <NoticeLine notice={listNotice} /> : null}
            </li>
          ))}
        </ol>
      )}
      {logos !== null && shown === 0 ? (
        <p className="rounded-lg bg-[#7F1D1D]/50 px-3 py-2 font-f1-italic text-sm text-[#FCA5A5]">
          Nessun logo visibile: le schermate restano senza loghi e i cartelloni in pista spariscono.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/60">Aggiungi un logo</p>
        {/* Emptied once read, so the same file can be picked again (a refused one, changed and saved again) */}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.currentTarget.files?.[0] ?? null);
            e.currentTarget.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <KioskButton tone="ghost" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            <span className="flex items-center gap-2">
              <Upload className="h-4 w-4" aria-hidden />
              Scegli il file
            </span>
          </KioskButton>
          <span className="min-w-0 flex-1 truncate font-f1-mono text-sm text-white/60">{file ? file.name : "Nessun file scelto"}</span>
        </div>
        {file ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/60">Nome</span>
              <input
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="h-12 rounded-lg border border-white/15 bg-black/40 px-3 font-f1-mono text-lg text-white outline-none focus:border-[#C7000B]"
              />
            </label>
            <KioskButton onClick={upload} disabled={busy !== null || file.size > MAX_BYTES}>
              {busy === "upload" ? "Caricamento…" : "Carica e mostra"}
            </KioskButton>
          </>
        ) : null}
        <NoticeLine notice={uploadNotice} />
        <p className="font-f1-italic text-xs text-white/45">
          SVG, PNG, JPG, WebP o GIF, fino a 10 MB. Meglio un logo con sfondo trasparente: il cartellone sceglie da solo uno sfondo chiaro o scuro
          (lo puoi cambiare dopo). Un logo quasi quadrato viene ripetuto lungo il cartellone.
        </p>
      </div>
    </section>
  );
};
