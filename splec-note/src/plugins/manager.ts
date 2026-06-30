// Plugin manager: loads bundled (first-party) plugin modules, enforces an
// enable/disable lifecycle, and wires each plugin's contributions (commands,
// side panels, status-bar items, text transforms) into the app. The host API
// object handed to a plugin is the only thing it receives — it exposes no fs or
// network. Enable state + per-plugin storage persist via tauri-plugin-store.

import { load, type Store } from "@tauri-apps/plugin-store";
import type {
  PluginModule,
  PluginHost,
  PluginContributions,
  PluginPanelHandle,
  PluginStatusHandle,
  SelectionInfo,
} from "./api";

const STORE_FILE = "splec-settings.json";
const STATES_KEY = "pluginStates";
const STORAGE_KEY = "pluginStorage";

export const PLUGIN_CMD_PREFIX = "plugincmd:";

/** App-side primitives the manager needs, implemented by main.ts. */
export interface AppBridge {
  getActiveText(): string;
  setActiveText(text: string): void;
  getSelection(): SelectionInfo;
  replaceSelection(text: string): void;
  notify(msg: string): void;
  subscribeDocChanged(cb: () => void): () => void;
  /** Tell the app to rebuild palette/menu after contributions change. */
  onContributionsChanged(): void;
}

interface DockEls {
  dock: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
}

interface RegisteredCommand {
  pluginId: string;
  id: string;
  fullAct: string;
  title: string;
  run: () => void;
}

interface RegisteredPanel {
  pluginId: string;
  id: string;
  title: string;
  render: (container: HTMLElement) => void;
  tabBtn?: HTMLButtonElement;
}

interface PluginContext {
  module: PluginModule;
  commands: RegisteredCommand[];
  panels: RegisteredPanel[];
  statusEls: HTMLElement[];
  unsubs: Array<() => void>;
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export class PluginManager {
  private bridge!: AppBridge;
  private els!: DockEls;
  private modules: PluginModule[];
  private contexts = new Map<string, PluginContext>();
  private states: Record<string, boolean> = {};
  private storageData: Record<string, Record<string, unknown>> = {};
  private storePromise: Promise<Store> | null = null;
  private activePanelKey: string | null = null;

  constructor(modules: PluginModule[]) {
    this.modules = modules;
  }

  // ---- Persistence ---------------------------------------------------------

  private async getStore(): Promise<Store | null> {
    if (!isTauri()) return null;
    if (!this.storePromise) {
      this.storePromise = load(STORE_FILE, { defaults: {}, autoSave: true });
    }
    try {
      return await this.storePromise;
    } catch {
      return null;
    }
  }

  private async loadPersisted(): Promise<void> {
    try {
      const store = await this.getStore();
      if (store) {
        this.states = ((await store.get(STATES_KEY)) as Record<string, boolean>) ?? {};
        this.storageData =
          ((await store.get(STORAGE_KEY)) as Record<string, Record<string, unknown>>) ?? {};
      } else if (typeof localStorage !== "undefined") {
        this.states = JSON.parse(localStorage.getItem(STATES_KEY) ?? "{}");
        this.storageData = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      }
    } catch {
      this.states = {};
      this.storageData = {};
    }
  }

  private async persistStates(): Promise<void> {
    try {
      const store = await this.getStore();
      if (store) {
        await store.set(STATES_KEY, this.states);
        await store.save();
        return;
      }
    } catch {
      /* fall through */
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STATES_KEY, JSON.stringify(this.states));
    }
  }

  private async persistStorage(): Promise<void> {
    try {
      const store = await this.getStore();
      if (store) {
        await store.set(STORAGE_KEY, this.storageData);
        await store.save();
        return;
      }
    } catch {
      /* fall through */
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.storageData));
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  async init(bridge: AppBridge, els: DockEls): Promise<void> {
    this.bridge = bridge;
    this.els = els;
    await this.loadPersisted();
    for (const mod of this.modules) {
      if (this.isEnabled(mod.id)) this.activate(mod);
    }
    this.refreshDock();
  }

  isEnabled(id: string): boolean {
    return this.states[id] !== false; // default on
  }

  private buildHost(mod: PluginModule, ctx: PluginContext): PluginHost {
    const self = this;
    return {
      registerCommand(cmd) {
        const fullAct = `${PLUGIN_CMD_PREFIX}${mod.id}:${cmd.id}`;
        ctx.commands.push({ pluginId: mod.id, id: cmd.id, fullAct, title: cmd.title, run: cmd.run });
      },
      registerTransform(t) {
        const fullAct = `${PLUGIN_CMD_PREFIX}${mod.id}:${t.id}`;
        const run = () => {
          const scope = t.scope ?? "selection";
          if (scope === "doc") {
            self.bridge.setActiveText(t.transform(self.bridge.getActiveText()));
          } else {
            const sel = self.bridge.getSelection();
            if (sel.text) self.bridge.replaceSelection(t.transform(sel.text));
            else self.bridge.setActiveText(t.transform(self.bridge.getActiveText()));
          }
        };
        ctx.commands.push({ pluginId: mod.id, id: t.id, fullAct, title: t.title, run });
      },
      addPanel(panel) {
        const reg: RegisteredPanel = {
          pluginId: mod.id,
          id: panel.id,
          title: panel.title,
          render: panel.render,
        };
        ctx.panels.push(reg);
        const handle: PluginPanelHandle = {
          setTitle: (title) => {
            reg.title = title;
            if (reg.tabBtn) reg.tabBtn.textContent = title;
          },
          refresh: () => self.refreshPanelIfActive(mod.id, panel.id),
          show: () => self.showPanel(mod.id, panel.id),
          remove: () => {
            ctx.panels = ctx.panels.filter((p) => p !== reg);
            self.refreshDock();
          },
        };
        // Auto-register a toggle command so the panel reaches palette + menu.
        const fullAct = `${PLUGIN_CMD_PREFIX}${mod.id}:panel:${panel.id}`;
        ctx.commands.push({
          pluginId: mod.id,
          id: `panel:${panel.id}`,
          fullAct,
          title: `Toggle ${panel.title}`,
          run: () => self.togglePanel(mod.id, panel.id),
        });
        return handle;
      },
      addStatusBarItem(item) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "plugin-status-item";
        el.textContent = item.text ?? "";
        if (item.title) el.title = item.title;
        if (item.onClick) el.addEventListener("click", item.onClick);
        else el.disabled = true;
        self.els.status.append(el);
        ctx.statusEls.push(el);
        const handle: PluginStatusHandle = {
          setText: (text) => {
            el.textContent = text;
          },
          setTitle: (title) => {
            el.title = title;
          },
          remove: () => {
            el.remove();
            ctx.statusEls = ctx.statusEls.filter((e) => e !== el);
          },
        };
        return handle;
      },
      getActiveText: () => self.bridge.getActiveText(),
      setActiveText: (text) => self.bridge.setActiveText(text),
      getSelection: () => self.bridge.getSelection(),
      replaceSelection: (text) => self.bridge.replaceSelection(text),
      onDocChanged: (cb) => {
        const unsub = self.bridge.subscribeDocChanged(cb);
        ctx.unsubs.push(unsub);
        return unsub;
      },
      notify: (msg) => self.bridge.notify(msg),
      storage: {
        get: <T = unknown>(key: string): T | undefined =>
          (self.storageData[mod.id]?.[key] as T | undefined),
        set: (key: string, value: unknown) => {
          (self.storageData[mod.id] ??= {})[key] = value;
          void self.persistStorage();
        },
      },
    };
  }

  private activate(mod: PluginModule): void {
    if (this.contexts.has(mod.id)) return;
    const ctx: PluginContext = {
      module: mod,
      commands: [],
      panels: [],
      statusEls: [],
      unsubs: [],
    };
    this.contexts.set(mod.id, ctx);
    try {
      mod.activate(this.buildHost(mod, ctx));
    } catch (err) {
      this.bridge.notify(`Plugin “${mod.name}” failed to load: ${String(err)}`);
    }
  }

  private deactivate(id: string): void {
    const ctx = this.contexts.get(id);
    if (!ctx) return;
    for (const unsub of ctx.unsubs) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    for (const el of ctx.statusEls) el.remove();
    try {
      ctx.module.deactivate?.();
    } catch {
      /* ignore */
    }
    this.contexts.delete(id);
    if (this.activePanelKey?.startsWith(`${id}:`)) this.activePanelKey = null;
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    this.states[id] = on;
    await this.persistStates();
    if (on) {
      const mod = this.modules.find((m) => m.id === id);
      if (mod) this.activate(mod);
    } else {
      this.deactivate(id);
    }
    this.refreshDock();
    this.bridge.onContributionsChanged();
  }

  // ---- Command access ------------------------------------------------------

  /** Palette/menu entries for all active plugin commands. */
  commandEntries(): Array<{ act: string; title: string }> {
    const out: Array<{ act: string; title: string }> = [];
    for (const ctx of this.contexts.values()) {
      for (const c of ctx.commands) out.push({ act: c.fullAct, title: c.title });
    }
    return out;
  }

  /** Run a plugin command by its full act id (returns false if not found). */
  runCommand(fullAct: string): boolean {
    for (const ctx of this.contexts.values()) {
      const c = ctx.commands.find((x) => x.fullAct === fullAct);
      if (c) {
        try {
          c.run();
        } catch (err) {
          this.bridge.notify(`Plugin command failed: ${String(err)}`);
        }
        return true;
      }
    }
    return false;
  }

  // ---- Manager UI data -----------------------------------------------------

  list(): Array<{
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    contributions: PluginContributions;
  }> {
    return this.modules.map((mod) => {
      const ctx = this.contexts.get(mod.id);
      const contributions: PluginContributions = {
        commands: ctx
          ? ctx.commands.filter((c) => !c.id.startsWith("panel:")).map((c) => ({ id: c.id, title: c.title }))
          : [],
        panels: ctx ? ctx.panels.map((p) => ({ id: p.id, title: p.title })) : [],
        statusItems: ctx ? ctx.statusEls.map((_, i) => `item ${i + 1}`) : [],
      };
      return {
        id: mod.id,
        name: mod.name,
        description: mod.description,
        enabled: this.isEnabled(mod.id),
        contributions,
      };
    });
  }

  // ---- Panel dock ----------------------------------------------------------

  private allPanels(): RegisteredPanel[] {
    const out: RegisteredPanel[] = [];
    for (const ctx of this.contexts.values()) out.push(...ctx.panels);
    return out;
  }

  private panelKey(pluginId: string, id: string): string {
    return `${pluginId}:${id}`;
  }

  togglePanel(pluginId: string, id: string): void {
    const key = this.panelKey(pluginId, id);
    if (this.activePanelKey === key) {
      this.activePanelKey = null;
    } else {
      this.activePanelKey = key;
    }
    this.refreshDock();
  }

  showPanel(pluginId: string, id: string): void {
    this.activePanelKey = this.panelKey(pluginId, id);
    this.refreshDock();
  }

  private refreshPanelIfActive(pluginId: string, id: string): void {
    if (this.activePanelKey === this.panelKey(pluginId, id)) this.renderActivePanel();
  }

  private renderActivePanel(): void {
    const panels = this.allPanels();
    const active = panels.find((p) => this.panelKey(p.pluginId, p.id) === this.activePanelKey);
    this.els.body.replaceChildren();
    if (active) active.render(this.els.body);
  }

  private refreshDock(): void {
    const panels = this.allPanels();
    if (panels.length === 0) {
      this.els.dock.hidden = true;
      this.activePanelKey = null;
      this.els.tabs.replaceChildren();
      this.els.body.replaceChildren();
      return;
    }
    // Keep a valid active panel selection.
    if (!panels.some((p) => this.panelKey(p.pluginId, p.id) === this.activePanelKey)) {
      this.activePanelKey = null;
    }
    if (!this.activePanelKey) {
      this.els.dock.hidden = true;
    } else {
      this.els.dock.hidden = false;
    }
    // Rebuild tab bar.
    this.els.tabs.replaceChildren();
    for (const p of panels) {
      const key = this.panelKey(p.pluginId, p.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plugin-dock-tab";
      btn.textContent = p.title;
      btn.classList.toggle("is-active", key === this.activePanelKey);
      btn.addEventListener("click", () => this.showPanel(p.pluginId, p.id));
      p.tabBtn = btn;
      this.els.tabs.append(btn);
    }
    this.renderActivePanel();
  }
}
