"use client";

/** Event branch: back from the full simulator (/play, opened from the kiosk's settings) to the kiosk's settings */

import React from "react";
import { withBasePath } from "@/lib/base-path";

export const KioskReturnButton: React.FC = () => (
  <button
    type="button"
    onClick={() => window.location.assign(withBasePath("/kiosk/admin"))}
    className="fixed bottom-3 left-3 z-[120] rounded-full border border-white/25 bg-black/75 px-4 py-2 font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/85 backdrop-blur hover:bg-black/90"
  >
    ← Impostazioni kiosk
  </button>
);
