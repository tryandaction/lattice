import { useSettingsStore } from "@/stores/settings-store";

export function isVSCodeCompatEnabled(): boolean {
  return useSettingsStore.getState().settings.vscodeCompatEnabled === true;
}
