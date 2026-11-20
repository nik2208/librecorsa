/*
 * What a lap on a board was driven with, as a small icon beside the driver's name: keyboard, controller, wheel or
 * touch. Its name shows on hover and is read out; a lap stored before the boards kept it shows nothing.
 */
import React from "react";
import { Icon } from "@/components/ui/icons/Icon";
import type { IconName } from "@/components/ui/icons/registry";
import type { LapInput } from "@/lib/sim/lap-types";

const INPUTS: Record<LapInput, { icon: IconName; label: string }> = {
  keyboard: { icon: "keyboard", label: "Keyboard" },
  controller: { icon: "controller", label: "Controller" },
  wheel: { icon: "wheel", label: "Wheel" },
  touch: { icon: "touch", label: "Touch screen" },
};

export const InputIcon: React.FC<{ input: LapInput | undefined; className?: string }> = ({ input, className = "" }) => {
  if (!input) return null;
  const { icon, label } = INPUTS[input];
  return (
    <span className={`inline-flex shrink-0 ${className}`} title={`Driven with: ${label}`}>
      <Icon name={icon} size="xs" />
      <span className="sr-only">Driven with: {label}</span>
    </span>
  );
};
