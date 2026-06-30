// Sample plugin: JSON Tools. Demonstrates registering commands that transform
// the active document. Pretty-print and sort-keys operate on the whole buffer.

import type { PluginModule, PluginHost } from "../api";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export const jsonToolsPlugin: PluginModule = {
  id: "jsontools",
  name: "JSON Tools",
  description: "Pretty-print and sort the keys of the current JSON document.",
  activate(host: PluginHost) {
    const apply = (label: string, fn: (parsed: unknown) => unknown) => {
      const text = host.getActiveText();
      try {
        const parsed = JSON.parse(text);
        host.setActiveText(JSON.stringify(fn(parsed), null, 2) + "\n");
        host.notify(`${label} applied`);
      } catch (err) {
        host.notify(`JSON Tools: not valid JSON (${String(err)})`);
      }
    };

    host.registerCommand({
      id: "pretty",
      title: "JSON: Pretty-Print",
      run: () => apply("JSON pretty-print", (p) => p),
    });
    host.registerCommand({
      id: "sortKeys",
      title: "JSON: Sort Keys",
      run: () => apply("JSON sort-keys", sortKeysDeep),
    });
    host.registerCommand({
      id: "minify",
      title: "JSON: Minify",
      run: () => {
        const text = host.getActiveText();
        try {
          host.setActiveText(JSON.stringify(JSON.parse(text)));
          host.notify("JSON minified");
        } catch (err) {
          host.notify(`JSON Tools: not valid JSON (${String(err)})`);
        }
      },
    });
  },
};
