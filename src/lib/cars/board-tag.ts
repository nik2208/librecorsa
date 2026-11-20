/**
 * A car on the online board of every car: its short name (the badge it wears in the menus) in its class colour. Plain
 * data, so the home page's server render and the game's menus draw it the same way.
 */
import type { VehicleModelId } from "@/types/f1";
import type { PaletteColor } from "@/components/ui/Badge";
import { CLASS_COLORS, type CarClassCode } from "@/components/ui/badges/class-colors";
import { anyCarForVehicle, type CarClassId } from "./car-registry";

const CLASS_CODE: Record<CarClassId, CarClassCode> = { f1: "openWheel", gt3: "gt3", proto: "proto", classic: "classic", road: "road" };

/** The rigid-body model's board holds the ported F1 team cars, which have no car of their own */
export function carBoardTag(vehicle: VehicleModelId): { label: string; color: PaletteColor } {
  const car = vehicle === "f12026-car" ? undefined : anyCarForVehicle(vehicle);
  if (!car) return { label: vehicle === "f12026-car" ? "F1 teams" : vehicle, color: CLASS_COLORS.openWheel.color };
  return { label: car.badge, color: CLASS_COLORS[CLASS_CODE[car.classId] ?? "road"].color };
}
