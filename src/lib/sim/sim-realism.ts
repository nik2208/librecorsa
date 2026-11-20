/**
 * Simulation realism level (after Speed Dreams, which gates tyre wear and temperature effects by skill level):
 *
 *  - Casual:   no tyre wear, mild tyre-temperature grip effects, half-strength wet weather
 *  - Standard: tyre wear on, softened tyre-temperature grip effects, wet weather at 3/4
 *  - Full:     the complete model (the default, and what every verify suite tests), with cold starts from the garage
 *
 * The races are sprints: every car carries a fixed fuel load as ballast and burns none, at every level.
 */
export type SimRealism = 'casual' | 'standard' | 'full';
export const SIM_REALISM_LEVELS: readonly SimRealism[] = ['casual', 'standard', 'full'];

export interface SimRealismFlags {
  /** Multiplier on tread wear (and flat-spotting): 0 = off */
  tyreWearScale: number;
  /** Share of the tyre-temperature grip loss applied (1 = full, smaller = simplified) */
  thermalGripScale: number;
  /** Fuel is burnt (and the car gets lighter). Off at every level: sprint races on a fixed fuel ballast */
  fuelUse: boolean;
  /**
   * A car whose data says it races without tyre blankets leaves the garage on cold tyres and cold brakes (a race's grid
   * and a rolling start come after a formation lap, warm). Off: such a car's tyres and brakes start warm
   */
  coldGarageStart: boolean;
  /** Strength of the wet-road grip loss (1 = full) */
  wetSeverity: number;
  /**
   * The kiosk's simple driving («Guida semplice», `simRealismFlagsFor`) with `autoStraightMode`; off at every level. On
   * a car with an energy store: the store is kept full and the lap's deploy and harvest totals cleared before every
   * step, so neither the ERS mode's floor nor the per-lap allowance ever stops the motor (the override works as
   * before). With nothing to store the braking harvest stops, and the rear calipers take its share.
   * Both flags are the rigid-body engine's (F12026CarSim): the classic engine the LC26 can still be switched to
   * (f1-physics-2026.ts: ?lc26engine=classic, which that browser then keeps; the kiosk never asks for it) is left as it
   * was and ignores them
   */
  unlimitedEnergy?: boolean;
  /**
   * The driver's Straight Mode (DRS on a car of that era) opens by itself where it may, on the throttle, as the
   * autopilot's does, and closes as ever on the brake, a lift or the stretch's end; the flap button still works
   */
  autoStraightMode?: boolean;
}

export const SIM_REALISM_FLAGS: Readonly<Record<SimRealism, Readonly<SimRealismFlags>>> = {
  casual: { tyreWearScale: 0, thermalGripScale: 0.25, fuelUse: false, wetSeverity: 0.5, coldGarageStart: false },
  standard: { tyreWearScale: 1, thermalGripScale: 0.5, fuelUse: false, wetSeverity: 0.75, coldGarageStart: false },
  full: { tyreWearScale: 1, thermalGripScale: 1, fuelUse: false, wetSeverity: 1, coldGarageStart: true },
};

export const FULL_REALISM: Readonly<SimRealismFlags> = SIM_REALISM_FLAGS.full;

const withSimpleDrive = (flags: Readonly<SimRealismFlags>): Readonly<SimRealismFlags> => ({ ...flags, unlimitedEnergy: true, autoStraightMode: true });
/** Each level with the kiosk's simple driving: made once, as the cars are handed the flags again on a new object */
const SIMPLE_DRIVE_FLAGS: Readonly<Record<SimRealism, Readonly<SimRealismFlags>>> = {
  casual: withSimpleDrive(SIM_REALISM_FLAGS.casual),
  standard: withSimpleDrive(SIM_REALISM_FLAGS.standard),
  full: withSimpleDrive(SIM_REALISM_FLAGS.full),
};

/** The flags a session drives on: the level's, with the kiosk's simple driving when it is on (`PlayerSettings.simpleDrive`) */
export function simRealismFlagsFor(level: SimRealism, simpleDrive = false): Readonly<SimRealismFlags> {
  return (simpleDrive ? SIMPLE_DRIVE_FLAGS : SIM_REALISM_FLAGS)[level];
}

export const SIM_REALISM_LABELS: Record<SimRealism, { label: string; detail: string }> = {
  casual: { label: "Casual", detail: "No tyre wear, forgiving tyre temperatures, milder rain" },
  standard: { label: "Standard", detail: "Tyre wear on, softened tyre temperatures, most of the rain" },
  full: { label: "Full", detail: "Complete tyre and wet-weather model, cold tyres and brakes out of the garage" },
};

/** Tyre-temperature grip with the realism level's share of the loss applied */
export function realismThermalGrip(thermal: number, flags: Readonly<SimRealismFlags>): number {
  return 1 - (1 - thermal) * flags.thermalGripScale;
}
