import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PluginWorkerHost,type PluginWorkerHostOptions} from '@/lib/plugins/worker-host';

let fail:string|null=null;
class TestWorker {
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  terminate=vi.fn();
  postMessage(message:{type:string;requestId?:string}) {
    queueMicrotask(()=>this.onmessage?.({data:message.type===fail
      ?{type:'operationResult',requestId:message.requestId,ok:false,error:'worker failure'}
      :{type:'operationResult',requestId:message.requestId,ok:true}} as MessageEvent));
  }
}
describe('worker lifecycle acknowledgements',()=>{
  beforeEach(()=>{fail=null;vi.stubGlobal('Worker',TestWorker);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
  afterEach(()=>vi.unstubAllGlobals());
  const host=()=>new PluginWorkerHost({pluginId:'fixture',manifest:{id:'fixture',name:'Fixture',version:'1.0.0'},mainCode:'export function activate() {}',permissions:[],networkAllowlist:[],platform:'web',onRegisterCommand:vi.fn(),onRegisterPanel:vi.fn(),onLog:vi.fn(),onError:vi.fn(),onAudit:vi.fn(),onRequest:vi.fn()} as PluginWorkerHostOptions);
  it('rejects load failure rather than reporting the plugin active',async()=>{
    fail='load';const instance=host();await expect(instance.start()).rejects.toThrow('worker failure');await instance.stop();
  });
  it('rejects command execution failure rather than completing before acknowledgement',async()=>{
    const instance=host();await instance.start();fail='runCommand';await expect(instance.runCommand('fixture.run')).rejects.toThrow('worker failure');await instance.stop();
  });
  it('permits reload after a clean acknowledged stop',async()=>{
    const instance=host();await instance.start();await instance.stop();await instance.start();await instance.stop();
  });
});
