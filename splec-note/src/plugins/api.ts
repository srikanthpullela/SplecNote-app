// Plugin host API — the *only* surface a plugin may use. It deliberately
// exposes NO filesystem or network access: the hard enforcement boundary is
// Tauri's capability system (plugins inherit no extra capabilities), and this
// API simply offers document/UI primitives. See PLUGINS.md for the full model.

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
}

export interface PluginCommand {
  id: string;
  title: string;
  run: () => void;
}

export interface PluginTransform {
  id: string;
  title: string;
  /** Whole document ("doc") or current selection ("selection", default). */
  scope?: "doc" | "selection";
  transform: (text: string) => string;
}

export interface PluginPanelSpec {
  id: string;
  title: string;
  /** Called with the panel body element when the panel is first shown. */
  render: (container: HTMLElement) => void;
}

export interface PluginPanelHandle {
  setTitle(title: string): void;
  /** Re-render the panel body (calls render again). */
  refresh(): void;
  show(): void;
  remove(): void;
}

export interface PluginStatusSpec {
  id: string;
  text?: string;
  title?: string;
  onClick?: () => void;
}

export interface PluginStatusHandle {
  setText(text: string): void;
  setTitle(title: string): void;
  remove(): void;
}

/** Minimal, explicit per-plugin storage (namespaced, persisted by the host). */
export interface PluginStorage {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export interface PluginHost {
  registerCommand(cmd: PluginCommand): void;
  registerTransform(t: PluginTransform): void;
  addPanel(panel: PluginPanelSpec): PluginPanelHandle;
  addStatusBarItem(item: PluginStatusSpec): PluginStatusHandle;

  getActiveText(): string;
  setActiveText(text: string): void;
  getSelection(): SelectionInfo;
  replaceSelection(text: string): void;
  /** Subscribe to active-document changes; returns an unsubscribe function. */
  onDocChanged(cb: () => void): () => void;
  notify(message: string): void;
  storage: PluginStorage;
}

export interface PluginModule {
  id: string;
  name: string;
  description: string;
  activate(host: PluginHost): void;
  deactivate?(): void;
}

/** A description of what an active plugin contributes (for the manager UI). */
export interface PluginContributions {
  commands: Array<{ id: string; title: string }>;
  panels: Array<{ id: string; title: string }>;
  statusItems: string[];
}
