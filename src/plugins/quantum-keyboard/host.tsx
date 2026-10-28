"use client";
import dynamic from "next/dynamic";
import { useQuantumPluginRuntime } from "./runtime";
const QuantumKeyboardProvider = dynamic(() => import("./provider").then(module => module.HUDProvider), { ssr: false });
/** The app shell mounts only this bridge. The plugin owns UI and listeners. */
export function QuantumKeyboardPluginHost({ children }: { children: React.ReactNode }) {
  const active = useQuantumPluginRuntime(state => state.active);
  return <>{children}{active && <QuantumKeyboardProvider />}</>;
}
