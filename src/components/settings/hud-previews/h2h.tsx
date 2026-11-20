import React from "react";
import type { HudPreviewDraw } from "../hud-preview";
import { Lines, RevRow } from "../hud-preview";
import palette from "@/components/hud/styles/h2h.module.css";

/**
 * Head to Head in miniature: the stack of cards top-left (the car ahead, the player's navy band with its yellow gaps,
 * the car behind) and the car's cells round the gear low in the centre (red ABS, blue TC, white bias, yellow fuel)
 */
export const draw: HudPreviewDraw = () => (
  <g className={palette.palette}>
    {/* Car ahead */}
    <rect x={4} y={4} width={60} height={10} fill="var(--tp-card)" fillOpacity={0.95} />
    <Lines x={6} y={6.5} w={14} n={2} gap={4} h={1.4} fill="var(--tp-white)" opacity={0.8} />
    <Lines x={36} y={7} w={10} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.85} />
    <Lines x={50} y={7} w={11} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.85} />
    {/* The player's band: gap row, driver row, gap row */}
    <rect x={4} y={14} width={60} height={21} fill="var(--tp-player)" stroke="var(--tp-border-player)" strokeWidth={0.5} />
    <rect x={38} y={16} width={8} height={1.8} rx={0.4} fill="var(--tp-yellow)" />
    <rect x={51} y={16} width={8} height={1.8} rx={0.4} fill="var(--color-lc-loss)" />
    <Lines x={6} y={21.5} w={14} n={2} gap={4} h={1.4} fill="var(--tp-white)" opacity={0.85} />
    <Lines x={36} y={22} w={10} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.9} />
    <Lines x={50} y={22} w={11} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.9} />
    <rect x={38} y={30.5} width={8} height={1.8} rx={0.4} fill="var(--tp-yellow)" />
    <rect x={51} y={30.5} width={8} height={1.8} rx={0.4} fill="var(--color-lc-gain)" />
    {/* Car behind */}
    <rect x={4} y={35} width={60} height={10} fill="var(--tp-card)" fillOpacity={0.95} />
    <Lines x={6} y={37.5} w={14} n={2} gap={4} h={1.4} fill="var(--tp-white)" opacity={0.8} />
    <Lines x={36} y={38} w={10} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.85} />
    <Lines x={50} y={38} w={11} n={1} h={1.6} ragged={false} fill="var(--tp-white)" opacity={0.85} />

    {/* The car's cells round the gear */}
    <rect x={56} y={62} width={48} height={25} fill="var(--tp-bg)" fillOpacity={0.95} stroke="var(--tp-border)" strokeWidth={0.5} />
    <RevRow x={58} y={63.5} w={44} n={15} lit={10} h={0.9} off="var(--tp-border)" />
    <g stroke="var(--tp-border)" strokeWidth={0.5} fill="none">
      <rect x={57} y={66} width={15} height={10} />
      <rect x={57} y={76} width={15} height={10} />
      <rect x={72} y={66} width={16} height={20} />
      <rect x={88} y={66} width={15} height={10} />
      <rect x={88} y={76} width={15} height={10} />
    </g>
    <rect x={60} y={68.5} width={9} height={1.4} rx={0.4} fill="var(--tp-red)" />
    <rect x={62} y={71.5} width={5} height={2.2} rx={0.4} fill="var(--tp-red)" />
    <rect x={60} y={78.5} width={9} height={1.4} rx={0.4} fill="var(--tp-white)" fillOpacity={0.85} />
    <rect x={61} y={81.5} width={7} height={2.2} rx={0.4} fill="var(--tp-white)" fillOpacity={0.85} />
    <rect x={91} y={68.5} width={9} height={1.4} rx={0.4} fill="var(--tp-blue)" />
    <rect x={93} y={71.5} width={5} height={2.2} rx={0.4} fill="var(--tp-blue)" />
    <rect x={91} y={78.5} width={9} height={1.4} rx={0.4} fill="var(--tp-yellow)" />
    <rect x={92} y={81.5} width={7} height={2.2} rx={0.4} fill="var(--tp-yellow)" />
    <rect x={76} y={69} width={8} height={10} rx={0.8} fill="var(--tp-white)" fillOpacity={0.92} />
    <rect x={75.5} y={81} width={9} height={1.8} rx={0.4} fill="var(--tp-white)" fillOpacity={0.7} />
  </g>
);
