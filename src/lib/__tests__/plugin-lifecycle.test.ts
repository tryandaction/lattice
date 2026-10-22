import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type {PluginContext,PluginModule} from '@/lib/plugins/types';
const fixtures=vi.hoisted(()=>({modules:new Map<string,PluginModule>(),load:vi.fn(async()=>null as unknown),resource:vi.fn()}));
vi.mock('@/lib/plugins/registry',()=>({getPluginModule:(id:string)=>fixtures.modules.get(id)??null}));
vi.mock('@/lib/plugins/repository',()=>({loadStoredPlugin:fixtures.load,loadStoredPluginResource:fixtures.resource}));
import {syncPlugins,getRegisteredCommands,getPluginHealthSnapshot,emitFileOpen,isPanelAssetImageUrlAllowed} from '@/lib/plugins/runtime';
describe('plugin runtime lifecycle failures',()=>{
  beforeEach(()=>{fixtures.modules.clear();fixtures.load.mockReset().mockResolvedValue(null);fixtures.resource.mockReset();});
  afterEach(async()=>{await syncPlugins({pluginsEnabled:false,enabledPluginIds:[]}).catch(()=>{});vi.unstubAllGlobals();});
  function plugin(id:string,activate:(ctx:PluginContext)=>void|Promise<void>,deactivate?:()=>void|Promise<void>){
    fixtures.modules.set(id,{manifest:{id,name:id,version:'1.0.0',permissions:['ui:commands','ui:panels','themes']},activate,deactivate});
  }
  it('allows only live image assets owned by the panel and revokes them on unload',async()=>{
    let sequence=0,image='',text='';
    const revoke=vi.fn();
    vi.stubGlobal('URL',class extends URL {
      static createObjectURL(){return `blob:http://localhost/asset-${++sequence}`;}
      static revokeObjectURL=revoke;
    });
    fixtures.resource.mockImplementation(async(_id:string,asset:string)=>({bytes:new Uint8Array([1]),mimeType:asset.endsWith('.svg')?'image/svg+xml':'text/plain'}));
    plugin('images',async ctx=>{
      ctx.panels.register({id:'images.panel',title:'Images',schema:{type:'markdown'}});
      image=await ctx.assets.getUrl('assets/logo.svg');text=await ctx.assets.getUrl('assets/readme.txt');
    });
    plugin('other',ctx=>ctx.panels.register({id:'other.panel',title:'Other',schema:{type:'markdown'}}));
    await syncPlugins({pluginsEnabled:true,enabledPluginIds:['images','other']});
    expect(isPanelAssetImageUrlAllowed('images.panel',image)).toBe(true);
    expect(isPanelAssetImageUrlAllowed('other.panel',image)).toBe(false);
    expect(isPanelAssetImageUrlAllowed('images.panel',text)).toBe(false);
    expect(isPanelAssetImageUrlAllowed('missing.panel',image)).toBe(false);
    expect(isPanelAssetImageUrlAllowed('images.panel','blob:http://localhost/unknown')).toBe(false);
    await syncPlugins({pluginsEnabled:false,enabledPluginIds:[]});
    expect(isPanelAssetImageUrlAllowed('images.panel',image)).toBe(false);
    expect(revoke).toHaveBeenCalledWith(image);expect(revoke).toHaveBeenCalledWith(text);
  });
  it('serializes overlapping sync calls so an async activation runs once',async()=>{
    const activate=vi.fn(async(ctx:PluginContext)=>{await new Promise(r=>setTimeout(r,15));ctx.commands.register({id:'demo.run',title:'Run',run:()=>{}});});
    plugin('demo',activate);
    await Promise.all([syncPlugins({pluginsEnabled:true,enabledPluginIds:['demo']}),syncPlugins({pluginsEnabled:true,enabledPluginIds:['demo']})]);
    expect(activate).toHaveBeenCalledTimes(1);expect(getRegisteredCommands().filter(c=>c.id==='demo.run')).toHaveLength(1);
  });
  it('rolls back events and commands registered before activation throws',async()=>{
    const listener=vi.fn();
    plugin('broken',ctx=>{ctx.events.onFileOpen(listener);ctx.commands.register({id:'broken.run',title:'Run',run:()=>{}});throw new Error('activate failed');});
    await syncPlugins({pluginsEnabled:true,enabledPluginIds:['broken']});emitFileOpen('fixture.md');
    expect(listener).not.toHaveBeenCalled();expect(getRegisteredCommands().some(c=>c.id==='broken.run')).toBe(false);
    expect(getPluginHealthSnapshot().broken.status).toBe('error');
  });
  it('cleans themes and events even when deactivate throws, then permits re-enable',async()=>{
    const listener=vi.fn();
    plugin('theme',ctx=>{ctx.events.onFileOpen(listener);ctx.themes.register('test',':root { --test: 1; }');ctx.themes.setActive('test');},()=>{throw new Error('deactivate failed');});
    await syncPlugins({pluginsEnabled:true,enabledPluginIds:['theme']});
    await expect(syncPlugins({pluginsEnabled:false,enabledPluginIds:[]})).resolves.toBeUndefined();
    emitFileOpen('fixture.md');expect(listener).not.toHaveBeenCalled();expect(document.querySelector('[data-theme-id="theme:test"]')).toBeNull();
    await syncPlugins({pluginsEnabled:true,enabledPluginIds:['theme']});expect(getPluginHealthSnapshot().theme.status).toBe('active');
  });
});
