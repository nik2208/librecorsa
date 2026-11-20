import React from "react";
import type { HudPreviewDraw } from "../hud-preview";
import { Lines } from "../hud-preview";
import palette from "../../hud/styles/blocks.module.css";

const BLOCK = "var(--blk-block)";
const HEAD = "var(--blk-head)";
const INK = "var(--blk-ink)";

/** Blocks (C1XTZ): square black blocks, the leaderboard, sector bar and delta, session blocks, timing, essentials */
export const draw: HudPreviewDraw = () => (
  <g className={palette.palette}>
    {/* Leaderboard */}
    <rect x={4} y={4} width={36} height={3} fill={HEAD} />
    <rect x={4} y={7} width={36} height={24} fill={BLOCK} />
    <rect x={4} y={15} width={1} height={3} fill="var(--blk-player)" />
    <Lines x={6} y={9} w={32} n={8} gap={2.8} h={0.9} fill={INK} opacity={0.7} />
    {/* Sector bar and the delta */}
    <rect x={59} y={4} width={14} height={3.5} fill="var(--color-lc-best)" />
    <rect x={73} y={4} width={14} height={3.5} fill="var(--color-lc-gain)" />
    <rect x={87} y={4} width={14} height={3.5} fill={BLOCK} />
    <rect x={70} y={9} width={20} height={7} fill="var(--blk-soft)" />
    <Lines x={71.5} y={10.5} w={17} n={2} gap={2.6} h={0.9} fill={INK} opacity={0.75} ragged={false} />
    <rect x={70} y={16} width={20} height={1.6} fill="var(--blk-deep)" />
    <rect x={80} y={16} width={4} height={1.6} fill="var(--color-lc-gain)" />
    {/* Position, laps, session clock */}
    <rect x={119} y={4} width={11} height={8} fill={BLOCK} />
    <rect x={132} y={4} width={7} height={8} fill={BLOCK} />
    <rect x={141} y={4} width={15} height={8} fill={BLOCK} />
    <Lines x={120.5} y={8} w={8} n={1} h={2.4} fill={INK} opacity={0.9} ragged={false} />
    <Lines x={133.5} y={8} w={4} n={1} h={2.4} fill={INK} opacity={0.9} ragged={false} />
    <Lines x={142.5} y={8} w={12} n={1} h={2.4} fill={INK} opacity={0.9} ragged={false} />
    {/* Timing and the lap history */}
    <rect x={4} y={60} width={22} height={8} fill={BLOCK} />
    <Lines x={5.5} y={63.5} w={18} n={1} h={3} fill={INK} opacity={0.9} ragged={false} />
    <rect x={4} y={69} width={6} height={2.2} fill="var(--color-lc-best)" />
    <rect x={4} y={71.2} width={6} height={4.4} fill={HEAD} />
    <rect x={10} y={69} width={10} height={6.6} fill={BLOCK} />
    <rect x={4} y={79} width={40} height={2.2} fill={HEAD} />
    <rect x={4} y={81.2} width={40} height={4.4} fill={BLOCK} />
    {/* Essentials: the rpm bar over speed | gear | rpm */}
    <rect x={64} y={73} width={32} height={2} fill={BLOCK} />
    <rect x={64} y={73} width={22} height={2} fill={INK} />
    <rect x={64} y={75} width={32} height={11} fill={BLOCK} />
    <rect x={76} y={76.5} width={0.6} height={8} fill={INK} />
    <rect x={83.4} y={76.5} width={0.6} height={8} fill={INK} />
    <rect x={78.2} y={77} width={3.6} height={7} fill={INK} />
    <Lines x={67} y={79} w={7} n={1} h={2.2} fill={INK} opacity={0.9} ragged={false} />
    <Lines x={86} y={79} w={7} n={1} h={2.2} fill={INK} opacity={0.9} ragged={false} />
    {/* Inputs, fuel, tyres */}
    <rect x={112} y={70} width={20} height={16} fill={BLOCK} />
    <rect x={112} y={71} width={14} height={1.6} fill={INK} />
    <rect x={112} y={74} width={6} height={1.6} fill={INK} />
    <rect x={112} y={77} width={18} height={1.6} fill={INK} />
    <rect x={134} y={78} width={10} height={1.4} fill="var(--blk-active)" />
    <rect x={134} y={79.4} width={10} height={6.6} fill={BLOCK} />
    <rect x={146} y={70} width={10} height={16} fill={BLOCK} />
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={147.5 + (i % 2) * 4.5} y={71.5 + Math.floor(i / 2) * 7.5} width={2.6} height={5} fill="var(--color-lc-ideal)" />
    ))}
  </g>
);
