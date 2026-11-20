/**
 * Simulation realism level (after Speed Dreams, which gates tyre wear and temperature effects by skill level):
 *
 *  - Casual:   no tyre wear, mild tyre-temperature grip effects, no fuel use, half-strength wet weather
 *  - Standard: tyre wear and fuel use on, softened tyre-temperature grip effects, wet weather at 3/4
 *  - Full:     the complete model (the default, and what every verify suite tests)
 */
export type SimRealism = 'casual' | 'standard' | 'full';
export const SIM_REALISM_LEVELS: readonly SimRealism[] = ['casual', 'standard', 'full'];

export interface SimRealismFlags {
  /** Multiplier on tread wear (and flat-spotting): 0 = off */
  tyreWearScale: number;
  /** Share of the tyre-temperature grip loss applied (1 = full, smaller = simplified) */
  thermalGripScale: number;
  /** Fuel is burnt (and the car gets lighter) */
  fuelUse: boolean;
  /** Strength of the wet-road grip loss (1 = full) */
  wetSeverity: number;
  /**
   * The energy store is kept full: neither a mode's deploy floor nor the per-lap limits ever bite (the kiosk's Guida
   * semplice, `simRealismFlagsFor`). Only the rigid-body engine reads it (F12026CarSim, on a car with an energy store).
   * The classic engine (f1-physics-2026.ts) leaves it out: the kiosk's car only runs there in a browser once opened with
   * ?vf26engine=classic (vf26-engine.ts keeps that choice), and it then drives without Guida semplice
   */
  unlimitedEnergy?: boolean;
  /** The driver's Straight Mode opens by itself on the autopilot's rule, and closes as ever (Guida semplice; same engine) */
  autoStraightMode?: boolean;
}

export const SIM_REALISM_FLAGS: Readonly<Record<SimRealism, Readonly<SimRealismFlags>>> = {
  casual: { tyreWearScale: 0, thermalGripScale: 0.25, fuelUse: false, wetSeverity: 0.5 },
  standard: { tyreWearScale: 1, thermalGripScale: 0.5, fuelUse: true, wetSeverity: 0.75 },
  full: { tyreWearScale: 1, thermalGripScale: 1, fuelUse: true, wetSeverity: 1 },
};

export const FULL_REALISM: Readonly<SimRealismFlags> = SIM_REALISM_FLAGS.full;

/**
 * The flags a drive runs with: its realism level's, plus, with the kiosk's Guida semplice (`simpleDrive`, which only
 * src/lib/kiosk/kiosk-settings.ts sets), the energy store always full and Straight Mode by itself. Without it, the
 * level's own object as the full game has always had it. A new object whenever the switch changes: the track
 * environment hands the flags to every car again when their object changes
 */
export function simRealismFlagsFor(settings: { realism: SimRealism; simpleDrive?: boolean }): Readonly<SimRealismFlags> {
  const flags = SIM_REALISM_FLAGS[settings.realism];
  return settings.simpleDrive === true ? { ...flags, unlimitedEnergy: true, autoStraightMode: true } : flags;
}

export const SIM_REALISM_LABELS: Record<SimRealism, { label: string; detail: string }> = {
  casual: { label: "Casual", detail: "No tyre wear or fuel use, forgiving tyre temperatures, milder rain" },
  standard: { label: "Standard", detail: "Wear and fuel on, softened tyre temperatures, most of the rain" },
  full: { label: "Full", detail: "Complete tyre, fuel and wet-weather model" },
};

/** Tyre-temperature grip with the realism level's share of the loss applied */
export function realismThermalGrip(thermal: number, flags: Readonly<SimRealismFlags>): number {
  return 1 - (1 - thermal) * flags.thermalGripScale;
}
