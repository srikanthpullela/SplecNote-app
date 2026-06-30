# Splec Note — Plugin API

Splec Note ships a small, conservative plugin system. A plugin is a JavaScript/
TypeScript module that contributes **commands**, **side panels**, **status‑bar
items**, and **text transforms** through a single, explicit host object. Plugins
get **no filesystem or network access** — the host API simply does not expose it.

This document describes the API, the loading/security model, and how to add a
plugin.

---

## 1. Loading model

Plugins are **first‑party ES modules** bundled with the app. They live in
[`src/plugins/`](./src/plugins):

```
src/plugins/
  api.ts            # the PluginHost / PluginModule contracts (this API)
  manager.ts        # the PluginManager: load, enable/disable, wire contributions
  builtins.ts       # the registry — the list of plugins the app loads
  samples/
    wordcount.ts    # sample: Word Count / reading‑time panel + status item
    jsontools.ts    # sample: JSON pretty‑print / sort‑keys / minify commands
```

On launch, `PluginManager` reads `builtins.ts`, and for every plugin that is
**enabled** (the default), calls its `activate(host)` once. Enable/disable state
persists via `tauri-plugin-store` (key `pluginStates`) and is editable from
**Preferences → Macros & Plugins → Manage plugins…**.

### Why bundled rather than dynamically loaded from disk?

Loading arbitrary `.js` files from a user folder and `eval`/dynamic‑importing
them is exactly the unrestricted‑escape risk Phase 6 is meant to avoid. Because
a plugin runs in the same webview realm as the app, true isolation of *untrusted*
third‑party code requires a Web Worker or sandboxed `<iframe>` with `postMessage`
— which can't directly render DOM panels. For Phase 6 we therefore load **vetted,
bundled** plugins and keep the hard security boundary at Tauri's capability
system (below). A vetted dynamic loader (Worker/iframe host + explicit capability
grants) is noted as future hardening.

---

## 2. Security model

There are two layers:

1. **Tauri capabilities (the hard boundary).** The webview can only invoke the
   Tauri commands the app's capability set allows (`src-tauri/capabilities/`).
   Plugins inherit **no additional capabilities** — they cannot read/write files
   or open sockets beyond what the app itself already permits, and the host API
   surfaces none of those primitives.
2. **The host API (the explicit surface).** A plugin receives only the `host`
   object. It exposes document text, selection, simple UI slots, namespaced
   storage, and notifications — and nothing else. No `fs`, no `fetch`, no
   `invoke`, no `window` handed in.

> Bundled samples are trusted code. The model above is what keeps a *misbehaving*
> plugin from escalating; it is not a guarantee against deliberately malicious
> same‑realm code, which is why third‑party loading is deferred (see above).

---

## 3. The host API

A plugin module implements `PluginModule`:

```ts
export interface PluginModule {
  id: string;            // unique, stable slug
  name: string;          // shown in the Plugins manager
  description: string;
  activate(host: PluginHost): void;
  deactivate?(): void;   // called when the plugin is disabled
}
```

`activate` receives a `PluginHost`:

```ts
interface PluginHost {
  // Contributions
  registerCommand(cmd: { id: string; title: string; run: () => void }): void;
  registerTransform(t: {
    id: string;
    title: string;
    scope?: "doc" | "selection";          // default "selection"
    transform: (text: string) => string;  // pure text → text
  }): void;
  addPanel(panel: {
    id: string;
    title: string;
    render: (container: HTMLElement) => void; // build your panel UI here
  }): PluginPanelHandle;
  addStatusBarItem(item: {
    id: string;
    text?: string;
    title?: string;
    onClick?: () => void;
  }): PluginStatusHandle;

  // Document access (no fs/network)
  getActiveText(): string;
  setActiveText(text: string): void;
  getSelection(): { from: number; to: number; text: string };
  replaceSelection(text: string): void;
  onDocChanged(cb: () => void): () => void;   // returns an unsubscribe fn

  // Misc
  notify(message: string): void;              // status‑bar message
  storage: {                                  // namespaced & persisted
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
}
```

### Contribution behaviour

- **Commands** appear in the **Command Palette** (`⇧⌘P`) and the **Plugins**
  section of the menu. Their act id is `plugincmd:<pluginId>:<commandId>`.
- **Transforms** are registered as commands that apply your pure function to the
  current selection (or the whole document when `scope: "doc"` or nothing is
  selected). Edits go through the normal editor pipeline, so undo/redo, autosave
  and session persistence all work.
- **Panels** are toggleable side panels (right dock). `addPanel` also registers a
  `Toggle <title>` command automatically. `render(container)` is called when the
  panel becomes visible; combine it with `onDocChanged` to keep it live.
- **Status‑bar items** render in the footer; disabling the plugin removes them.

Handles let you update or remove a contribution later:

```ts
interface PluginPanelHandle  { setTitle(t): void; refresh(): void; show(): void; remove(): void; }
interface PluginStatusHandle { setText(t): void; setTitle(t): void; remove(): void; }
```

---

## 4. Sample plugins

### Word Count (`samples/wordcount.ts`)
Adds a **side panel** (words, characters, lines, reading time) and a **status‑bar
item** showing the live word count. Demonstrates `addPanel`, `addStatusBarItem`
and `onDocChanged`.

### JSON Tools (`samples/jsontools.ts`)
Adds three **commands** — *JSON: Pretty‑Print*, *JSON: Sort Keys*, *JSON: Minify*
— that rewrite the whole buffer. Demonstrates `registerCommand`, `getActiveText`,
`setActiveText` and `notify` (it reports invalid JSON instead of corrupting the
document).

---

## 5. Adding a plugin

1. Create `src/plugins/samples/myplugin.ts`:

   ```ts
   import type { PluginModule, PluginHost } from "../api";

   export const myPlugin: PluginModule = {
     id: "myplugin",
     name: "My Plugin",
     description: "Does a useful thing.",
     activate(host: PluginHost) {
       host.registerCommand({
         id: "shout",
         title: "Shout selection",
         run: () => {
           const sel = host.getSelection();
           if (sel.text) host.replaceSelection(sel.text.toUpperCase() + "!");
         },
       });
     },
   };
   ```

2. Register it in `src/plugins/builtins.ts`:

   ```ts
   import { myPlugin } from "./samples/myplugin";
   export const builtinPlugins: PluginModule[] = [wordCountPlugin, jsonToolsPlugin, myPlugin];
   ```

3. Run the app — your command appears in the palette and the **Plugins** menu,
   and the plugin shows up in **Manage plugins…** with an enable/disable toggle.

---

## 6. Notes for Phase 7+

- Dynamic, vetted loading of third‑party plugins from a user folder (Worker/
  iframe sandbox + explicit per‑plugin capability grants).
- A richer panel lifecycle (visibility events, persisted active panel).
- Optional contribution points: editor decorations, language providers.
