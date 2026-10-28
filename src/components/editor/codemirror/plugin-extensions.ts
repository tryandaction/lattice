import { Compartment, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { getPluginEditorExtensions, subscribeEditorExtensions } from '@/lib/plugins/runtime';

/** Each editor owns its compartment and registry subscription. */
export function createPluginEditorExtensions(): Extension {
  const compartment = new Compartment();
  const readExtensions = () => Array.from(getPluginEditorExtensions().values()) as Extension[];
  return [
    compartment.of(readExtensions()),
    ViewPlugin.define(view => {
      const unsubscribe = subscribeEditorExtensions(() => {
        view.dispatch({ effects: compartment.reconfigure(readExtensions()) });
      });
      return { destroy: unsubscribe };
    }),
  ];
}
