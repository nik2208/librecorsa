import { useSyncExternalStore } from "react";
import { isStoreBuild } from "./store-mode";

const noSubscribe = () => () => {};
const serverValue = () => false;

/** isStoreBuild (store-mode.ts) for components the server renders too: false there and while the page hydrates */
export function useStoreBuild(): boolean {
  return useSyncExternalStore(noSubscribe, isStoreBuild, serverValue);
}
