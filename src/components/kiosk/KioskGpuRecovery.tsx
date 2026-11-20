"use client";

/**
 * Kiosk mode: a lost graphics context (the driver reset or crashed) is not left for a visitor to answer. Upstream's
 * GpuLostNotice asks, in English, to retry or switch to Low and waits for a press; on the stand the page loads again by
 * itself, back on the kiosk's menu (the run under way is lost). After three reloads within ten minutes the next one
 * waits a minute, so a driver that keeps failing doesn't reload the page in a loop.
 */

import React, { useEffect, useState } from "react";

const RELOADS_KEY = "kiosk.gpu.reloads";
const WINDOW_MS = 10 * 60_000;
const QUICK_S = 4;
const SLOW_S = 60;

export const KioskGpuRecovery: React.FC = () => {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    let recent: number[] = [];
    try {
      const raw = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? "[]") as unknown;
      recent = Array.isArray(raw) ? raw.filter((t): t is number => typeof t === "number" && now - t < WINDOW_MS) : [];
    } catch {
      recent = [];
    }
    const waitS = recent.length >= 3 ? SLOW_S : QUICK_S;
    setLeft(waitS);
    const id = window.setInterval(() => {
      const remaining = Math.max(0, waitS - Math.floor((Date.now() - now) / 1000));
      setLeft(remaining);
      if (remaining > 0) return;
      window.clearInterval(id);
      try {
        sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, Date.now()]));
      } catch {
        // No storage: the reload still happens, only the back-off is lost
      }
      window.location.reload();
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="alert" className="kiosk-ui fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center text-white">
      <p className="font-f1-display text-4xl font-black uppercase tracking-[0.08em]">Un attimo…</p>
      <p className="font-f1-italic text-xl text-white/80">
        La grafica si è bloccata: il gioco riparte da solo{left !== null ? ` tra ${left} s` : ""}.
      </p>
    </div>
  );
};
