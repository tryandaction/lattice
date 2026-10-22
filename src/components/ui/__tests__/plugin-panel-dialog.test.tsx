/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginPanelDialog } from "../plugin-panel-dialog";
import { PluginPanelDock } from "../plugin-panel-dock";
import type {PluginPanel} from '@/lib/plugins/types';
import {setLocale} from '@/lib/i18n';
import {useSettingsStore} from '@/stores/settings-store';
const registry=vi.hoisted(()=>({panels:[] as PluginPanel[],props:{}}));

vi.mock("@/lib/plugins/runtime", () => ({
  getRegisteredCommands: () => [],
  getRegisteredPanels: () => registry.panels,
  subscribePluginRegistry: () => () => {},
  getPanelProps: () => registry.props,
  subscribePanelProps: () => () => {},
  isPanelAssetImageUrlAllowed: () => false,
  getPluginSetting: () => undefined,
  subscribePluginSetting: () => () => {},
  runPluginCommand: vi.fn(),
}));

afterEach(cleanup);

describe("PluginPanelDialog", () => {
  beforeEach(()=>{setLocale('zh-CN');useSettingsStore.setState(state=>({isInitialized:true,settings:{...state.settings,language:'zh-CN'}}));registry.panels=[];});
  it("exposes an accessible dialog and closes with Escape even without registered panels", () => {
    const onClose = vi.fn();
    render(<PluginPanelDialog isOpen onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "插件面板" }).getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it.each(['dialog','dock'])('localizes built-in metadata in the %s',async(mode)=>{
    registry.panels=[{id:'formula-extractor.results',pluginId:'formula-extractor',title:'Formula Extractor',schema:{type:'markdown',description:'Formulas detected in the active document.',props:{content:'Synthetic formula results'}}} as PluginPanel];
    if(mode==='dialog')render(<PluginPanelDialog isOpen onClose={()=>{}} />);
    else render(<PluginPanelDock onClose={()=>{}} />);
    expect((await screen.findAllByText('公式提取')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Formulas detected in the active document.')).toBeNull();
  });
  it('preserves third-party metadata',async()=>{
    registry.panels=[{id:'external.results',title:'User custom title',schema:{type:'markdown',description:'External description',props:{content:'Synthetic external results'}}}];
    render(<PluginPanelDialog isOpen onClose={()=>{}} />);
    expect((await screen.findAllByText('User custom title')).length).toBeGreaterThan(0);
    expect(screen.getByText('External description')).toBeTruthy();
  });
});
