import React from "react";
import type { HudPreviewDraw } from "../hud-preview";
import { Lines, MiniTrack } from "../hud-preview";
import css from "@/components/hud/styles/retro.module.css";

/** A cut-corner box, the Retro UI's frame (x, y, width, height, cut) */
const cut = (x: number, y: number, w: number, h: number, c = 1.6) =>
  `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + h - c}L${x + w - c} ${y + h}H${x + c}L${x} ${y + h - c}V${y + c}Z`;

const PANEL = { fill: "var(--tp-panel)", stroke: "var(--tp-outline)", strokeWidth: 0.5 } as const;

/** Rev segments round the dial's arc, the first `lit` in cream */
const ARC = Array.from({ length: 22 }, (_, i) => {
  const a = ((-140 + (280 * (i + 0.5)) / 22) * Math.PI) / 180;
  return [80 + 14.5 * Math.sin(a), 72 - 14.5 * Math.cos(a)] as const;
});

/** Retro UI by toastbuilds: relative top-left, delta bar top-centre, map top-right, condition bottom-left, the round dial */
export const draw: HudPreviewDraw = () => (
  <g className={css.palette}>
    {/* Relative panel: two best-lap cells, the order, the player's row in amber */}
    <path d={cut(4, 4, 34, 32)} {...PANEL} stroke="var(--tp-metal)" />
    <path d={cut(6, 6, 14.5, 5, 1)} fill="var(--tp-void)" stroke="var(--tp-outline-soft)" strokeWidth={0.3} />
    <path d={cut(21.5, 6, 14.5, 5, 1)} fill="var(--tp-void)" stroke="var(--tp-outline-soft)" strokeWidth={0.3} />
    <rect x={7} y={7.5} width={0.6} height={2.5} fill="var(--color-lc-best)" />
    <rect x={22.5} y={7.5} width={0.6} height={2.5} fill="var(--color-lc-gain)" />
    <rect x={6} y={21.6} width={30} height={2.4} fill="var(--tp-amber-dim)" />
    <Lines x={8} y={14} w={26} n={6} gap={2.5} fill="var(--tp-primary)" opacity={0.75} h={0.8} />
    <g fill="var(--tp-void)" stroke="var(--tp-outline-dim)" strokeWidth={0.3}>
      <path d={cut(6, 30.5, 9, 3.5, 0.8)} />
      <path d={cut(16.5, 30.5, 9, 3.5, 0.8)} stroke="var(--tp-primary)" />
      <path d={cut(27, 30.5, 9, 3.5, 0.8)} />
    </g>
    {/* Delta bar */}
    <path d={cut(56, 4, 48, 14)} {...PANEL} />
    <rect x={58} y={6} width={44} height={3} fill="var(--tp-void)" stroke="var(--tp-outline-soft)" strokeWidth={0.3} />
    <rect x={79.9} y={6} width={0.5} height={3} fill="var(--tp-primary)" />
    <rect x={77.4} y={6.6} width={2.5} height={1.8} fill="var(--color-lc-loss)" fillOpacity={0.7} />
    <path d={cut(58, 10.5, 17, 6, 1)} fill="var(--tp-raised)" stroke="var(--tp-outline)" strokeWidth={0.3} />
    <rect x={61} y={12.6} width={11} height={1.6} rx={0.4} fill="var(--color-lc-loss)" />
    <Lines x={78} y={12} w={22} n={2} gap={2.6} fill="var(--tp-cyan)" opacity={0.7} h={0.7} />
    {/* Map */}
    <path d={cut(128, 4, 28, 22)} {...PANEL} />
    <MiniTrack x={130.5} y={6} s={0.95} stroke="var(--tp-primary)" width={1} />
    {/* Car condition: four tyre bars round the car */}
    <path d={cut(4, 64, 26, 22)} {...PANEL} />
    <rect x={14.5} y={67} width={5} height={16} fill="var(--tp-surface)" stroke="var(--tp-metal)" strokeWidth={0.3} />
    {[
      [9.5, 67],
      [22, 67],
      [9.5, 76],
      [22, 76],
    ].map(([x, y], i) => (
      <rect key={i} x={x} y={y + (i === 2 ? 1.5 : 0)} width={2} height={i === 2 ? 5.5 : 7} fill="var(--color-lc-ideal)" />
    ))}
    {/* The round dial */}
    <circle cx={80} cy={72} r={17} fill="var(--tp-void)" stroke="var(--tp-metal)" strokeWidth={0.6} />
    {ARC.map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={0.75} fill={i < 14 ? "var(--tp-primary)" : i >= 19 ? "var(--tp-red-dim)" : "var(--tp-inactive)"} />
    ))}
    <path d={cut(74.5, 66, 11, 10, 1.2)} fill="var(--tp-void)" stroke="var(--tp-cyan-dim)" strokeWidth={0.35} />
    <text x={80} y={74.3} textAnchor="middle" fontSize={8} fill="var(--tp-primary)">
      3
    </text>
    <rect x={77} y={62} width={6} height={1.4} rx={0.4} fill="var(--tp-primary)" fillOpacity={0.8} />
    <g fill="var(--tp-void)" stroke="var(--tp-outline-soft)" strokeWidth={0.3}>
      <path d={cut(72.5, 79, 4.5, 4, 0.8)} />
      <path d={cut(77.75, 79, 4.5, 4, 0.8)} />
      <path d={cut(83, 79, 4.5, 4, 0.8)} />
    </g>
  </g>
);
