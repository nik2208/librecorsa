import React from "react";
import type { HudPreviewDraw } from "../hud-preview";
import { Lines, RevRow } from "../hud-preview";
import palette from "../../hud/styles/racevision.module.css";

/** One table row: white position box, team stripe, a name and times as bars */
const Row: React.FC<{ x: number; y: number; w: number; stripe: string; user?: boolean; shade?: boolean }> = ({ x, y, w, stripe, user, shade }) => (
  <g>
    {shade ? <rect x={x} y={y} width={w} height={2.8} rx={1} fill="var(--tp-row)" /> : null}
    <rect x={x} y={y} width={3.2} height={2.8} rx={0.8} fill={user ? "var(--tp-user)" : "var(--tp-box)"} />
    <rect x={x + 3.4} y={y} width={0.9} height={2.8} fill={stripe} />
    <rect x={x + w * 0.3} y={y + 0.9} width={w * 0.28} height={1} rx={0.5} fill={user ? "var(--tp-user)" : "var(--tp-text)"} fillOpacity={0.85} />
    <rect x={x + w * 0.7} y={y + 0.9} width={w * 0.26} height={1} rx={0.5} fill="var(--tp-text)" fillOpacity={0.6} />
  </g>
);

const TEAMS = ["var(--color-lc-cyan)", "var(--color-lc-amber)", "var(--color-lc-crimson)", "var(--color-lc-volt)", "var(--color-lc-azure)", "var(--color-lc-pink)", "var(--color-lc-green)"];

/** RaceVision: standings top-left, the inputs pill top-centre, the input graph bottom-left, the relative bottom-right */
export const draw: HudPreviewDraw = () => (
  <g className={palette.palette}>
    {/* Standings */}
    <rect x={4} y={4} width={40} height={32} fill="var(--tp-panel)" />
    <Lines x={6} y={6} w={18} n={1} h={1.2} ragged={false} fill="var(--tp-text)" opacity={0.9} />
    <path d="M6 9 L17 9 L18 11.6 L6 11.6 Z" fill="var(--tp-class)" />
    {TEAMS.map((c, i) => (
      <Row key={i} x={6} y={13.2 + i * 3.2} w={36} stripe={c} user={i === 4} />
    ))}
    {/* Inputs pill */}
    <rect x={58} y={4} width={44} height={11} rx={5.5} fill="var(--tp-panel)" />
    <circle cx={63.5} cy={9.5} r={4.2} fill="var(--tp-gear)" stroke="var(--tp-gear-ring)" strokeWidth={0.9} />
    <RevRow x={69.5} y={6.2} w={20} n={10} lit={6} h={1.2} dots off="var(--tp-light-off)" />
    <Lines x={70} y={10.5} w={18} n={1} h={1} ragged={false} fill="var(--tp-text)" opacity={0.8} />
    <circle cx={96} cy={9.5} r={2.6} fill="none" stroke="var(--tp-text)" strokeWidth={0.6} />
    {/* Input graph */}
    <rect x={4} y={70} width={40} height={16} fill="var(--tp-panel)" />
    <path d="M5 85 L5 80 L10 74 L16 74 L19 84 L28 84 L31 75 L43 75 L43 85 Z" fill="var(--color-lc-green)" fillOpacity={0.35} stroke="var(--color-lc-green)" strokeWidth={0.5} />
    <path d="M17 85 L19 77 L23 78 L28 85 Z" fill="var(--color-lc-crimson)" fillOpacity={0.35} stroke="var(--color-lc-crimson)" strokeWidth={0.5} />
    {/* Relative */}
    <rect x={114} y={58} width={42} height={28} fill="var(--tp-panel)" />
    {TEAMS.slice(0, 7).map((c, i) => (
      <Row key={i} x={116} y={60 + i * 3.6} w={38} stripe={c} user={i === 3} shade={i % 2 === 1} />
    ))}
  </g>
);
