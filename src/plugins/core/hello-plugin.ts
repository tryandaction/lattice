import type { PluginModule } from '@/lib/plugins/types';

export const helloPlugin: PluginModule = {
  manifest: {
    id: 'core.hello',
    name: 'Hello Plugin',
    version: '0.1.0',
    description: 'Baseline example plugin for command registration.',
    author: 'Lattice',
    permissions: ['ui:commands'],
  },
  activate(ctx) {
    ctx.log('activated');
    ctx.registerCommand({
      id: 'core.hello.sayHello',
      title: 'Say Hello',
      run: () => ctx.log('hello from plugin'),
    });
  },
  deactivate() {
    // No-op for now
  },
};
