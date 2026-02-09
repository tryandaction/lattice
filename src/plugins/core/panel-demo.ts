import type { PluginModule } from '@/lib/plugins/types';

export const panelDemoPlugin: PluginModule = {
  manifest: {
    id: 'core.panel-demo',
    name: 'Panel Demo',
    version: '0.1.0',
    description: 'Demonstrates plugin panels with schema rendering.',
    author: 'Lattice',
    permissions: ['ui:commands', 'ui:panels'],
    ui: {
      panels: [
        {
          id: 'core.panel-demo.overview',
          title: 'Panel Overview',
          schema: {
            type: 'markdown',
            title: 'Plugin Panel',
            description: 'Rendered from manifest schema',
            props: {
              content: 'This is a **plugin panel** rendered by Lattice.\n\n- Manifest-defined panel\n- Safe schema rendering\n- Action buttons via commands',
            },
          },
          actions: [
            { id: 'core.panel-demo.sayHello', title: 'Say Hello' },
          ],
        },
      ],
    },
  },
  activate(ctx) {
    ctx.registerCommand({
      id: 'core.panel-demo.sayHello',
      title: 'Panel Demo: Say Hello',
      run: () => ctx.log('Hello from panel demo'),
    });
  },
};

