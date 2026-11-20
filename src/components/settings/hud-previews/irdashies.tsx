import React from "react";
import { Lines, MiniTrack, type HudPreviewDraw } from "../hud-preview";
import palette from "@/components/hud/styles/irdashies.module.css";

/** Team colours of the miniature's rows: the layout's class bars */
const TEAMS = ["var(--color-lc-amber)", "var(--color-lc-cyan)", "var(--color-lc-pink)", "var(--color-lc-green)", "var(--color-lc-azure)", "var(--color-lc-crimson)"];

/**
 * irDashies in miniature: the slate standings with the player's amber row top-left, the white frameless map top-right,
 * the shift-light pill and the input widget (trace, pedal bars, gear, wheel) at the bottom centre
 */
export const draw: HudPreviewDraw = () => (
  <g className={palette.palette}>
    {/* Standings */}
    <rect x={4} y={4} width={36} height={36} rx={1.2} fill="var(--tp-panel)" />
    <rect x={5.5} y={5.5} width={33} height={3.6} rx={0.6} fill="var(--tp-bar)" />
    <Lines x={7} y={6.8} w={26} n={1} h={0.9} ragged={false} fill="var(--tp-text-soft)" opacity={0.7} />
    {TEAMS.map((c, i) => (
      <g key={i}>
        <rect x={5.5} y={10.5 + i * 4.6} width={33} height={4.2} fill={i === 3 ? "var(--tp-player-bg)" : i % 2 ? "var(--tp-row-b)" : "var(--tp-row-a)"} />
        <rect x={9} y={10.5 + i * 4.6} width={0.9} height={4.2} fill={c} />
        <rect x={10.2} y={10.9 + i * 4.6} width={6} height={3.4} fill={c} fillOpacity={0.45} />
        <rect x={20} y={12.2 + i * 4.6} width={16} height={0.9} rx={0.45} fill={i === 3 ? "var(--tp-player)" : "var(--tp-text)"} fillOpacity={0.7} />
      </g>
    ))}
    {/* Track map: a white line, no panel */}
    <MiniTrack x={130} y={5} s={1.05} stroke="var(--tp-text)" width={1.4} />
    {/* Shift lights and the RPM box */}
    <rect x={57} y={59} width={34} height={6} rx={3} fill="var(--tp-panel)" />
    {Array.from({ length: 10 }, (_, i) => (
      <circle key={i} cx={60 + i * 3.1} cy={62} r={1.15} fill={i < 7 ? (i < 4 ? "var(--color-lc-green)" : "var(--color-lc-amber)") : "var(--tp-led-off)"} />
    ))}
    <rect x={93} y={59} width={12} height={6} rx={1.2} fill="var(--tp-panel)" />
    <Lines x={95} y={61.5} w={8} n={1} h={1} ragged={false} fill="var(--tp-text)" opacity={0.8} />
    {/* Inputs: trace, pedal bars, gear and speed, the wheel */}
    <rect x={44} y={67} width={72} height={19} rx={1.2} fill="var(--tp-panel)" />
    <path d="M47 76 L52 71 L57 74 L62 70 L67 72" stroke="var(--color-lc-green)" strokeWidth={0.7} fill="none" />
    <path d="M47 82 L54 82 L57 77 L61 82 L67 82" stroke="var(--color-lc-crimson)" strokeWidth={0.7} fill="none" />
    <rect x={70} y={72} width={2} height={12} fill="var(--tp-cell)" />
    <rect x={70} y={79} width={2} height={5} fill="var(--tp-clutch)" />
    <rect x={73} y={72} width={2} height={12} fill="var(--tp-cell)" />
    <rect x={76} y={72} width={2} height={12} fill="var(--tp-cell)" />
    <rect x={76} y={74} width={2} height={10} fill="var(--color-lc-green)" />
    <rect x={81} y={70} width={6} height={8} rx={1} fill="var(--tp-text)" fillOpacity={0.9} />
    <Lines x={81} y={80.5} w={6} n={1} h={1.1} ragged={false} fill="var(--tp-text)" opacity={0.7} />
    <circle cx={96} cy={76.5} r={5.2} fill="none" stroke="var(--tp-text)" strokeWidth={1.2} />
    <rect x={95.4} y={70.6} width={1.2} height={1.8} fill="var(--tp-marker)" />
    <rect x={104} y={70} width={10} height={3} rx={0.6} fill="var(--tp-cell)" />
    <rect x={104} y={74.5} width={10} height={3} rx={0.6} fill="var(--tp-cell)" />
    <rect x={104} y={79} width={10} height={3} rx={0.6} fill="var(--tp-cell)" />
  </g>
);
