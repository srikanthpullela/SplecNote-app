// Macro engine (Notepad++-style record/playback). Records a sequence of
// high-level editor commands plus typed input and deletes, then replays them
// from the current caret. Named macros + a digit shortcut persist via
// tauri-plugin-store (localStorage fallback for plain Vite dev).
//
// Robustness against the session-persistence autosave: autosave only reads the
// editor state and writes backup files — it never dispatches editor
// transactions — so it produces no recordable events. We additionally suppress
// capture while a command or a playback is running so nothing is double-recorded.

import { load, type Store } from "@tauri-apps/plugin-store";
import { deleteCharBackward, deleteCharForward } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { UserEdit } from "./editorHost";

const STORE_FILE = "splec-settings.json";
const MACROS_KEY = "macros";

export type MacroStep =
  | { t: "cmd"; act: string }
  | { t: "insert"; text: string }
  | { t: "delete"; dir: "back" | "forward"; n: number };

export interface SavedMacro {
  id: string;
  name: string;
  /** Digit "1"–"9" bound to Cmd/Ctrl+Shift+<digit>, or "" for none. */
  shortcut: string;
  steps: MacroStep[];
}

/** App hooks the engine needs to record/replay without importing main.ts. */
export interface MacroDeps {
  runCommand: (act: string) => void;
  getView: () => EditorView;
  focus: () => void;
  notify: (msg: string) => void;
}

// Commands that are non-deterministic, open dialogs, or are macro/plugin meta:
// recording or replaying them adds no value and would disrupt playback.
const NON_RECORDABLE = new Set<string>([
  "open",
  "save",
  "saveAs",
  "close",
  "newWindow",
  "prefs",
  "find",
  "replace",
  "findInFiles",
  "gotoLine",
  "commandPalette",
]);

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `macro-${Date.now()}`
  );
}

export class MacroEngine {
  private deps: MacroDeps;
  private macros: SavedMacro[] = [];
  private storePromise: Promise<Store> | null = null;

  private recording = false;
  private current: MacroStep[] = [];
  private lastPlayedSteps: MacroStep[] | null = null;
  /** While true, captured edits/commands are ignored (command exec or playback). */
  private suppress = false;
  /** Notify the app when recording state changes so the UI can update. */
  onStateChange: (() => void) | null = null;

  constructor(deps: MacroDeps) {
    this.deps = deps;
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

  private sanitize(raw: any): SavedMacro | null {
    if (!raw || typeof raw !== "object") return null;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return null;
    const steps: MacroStep[] = Array.isArray(raw.steps)
      ? raw.steps
          .map((s: any): MacroStep | null => {
            if (!s || typeof s !== "object") return null;
            if (s.t === "cmd" && typeof s.act === "string") return { t: "cmd", act: s.act };
            if (s.t === "insert" && typeof s.text === "string")
              return { t: "insert", text: s.text };
            if (s.t === "delete" && (s.dir === "back" || s.dir === "forward"))
              return { t: "delete", dir: s.dir, n: Math.max(1, Number(s.n) || 1) };
            return null;
          })
          .filter((s: MacroStep | null): s is MacroStep => !!s)
      : [];
    const shortcut =
      typeof raw.shortcut === "string" && /^[1-9]$/.test(raw.shortcut) ? raw.shortcut : "";
    return { id: typeof raw.id === "string" && raw.id ? raw.id : slug(name), name, shortcut, steps };
  }

  async loadAll(): Promise<void> {
    try {
      const store = await this.getStore();
      let raw: unknown = null;
      if (store) raw = await store.get(MACROS_KEY);
      else if (typeof localStorage !== "undefined") {
        const s = localStorage.getItem(MACROS_KEY);
        raw = s ? JSON.parse(s) : null;
      }
      this.macros = Array.isArray(raw)
        ? raw.map((r) => this.sanitize(r)).filter((m): m is SavedMacro => !!m)
        : [];
    } catch {
      this.macros = [];
    }
  }

  private async persist(): Promise<void> {
    try {
      const store = await this.getStore();
      if (store) {
        await store.set(MACROS_KEY, this.macros);
        await store.save();
        return;
      }
    } catch {
      /* fall through */
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MACROS_KEY, JSON.stringify(this.macros));
    }
  }

  // ---- Recording -----------------------------------------------------------

  isRecording(): boolean {
    return this.recording;
  }

  hasRecording(): boolean {
    return this.current.length > 0;
  }

  startRecording(): void {
    this.recording = true;
    this.current = [];
    this.onStateChange?.();
  }

  stopRecording(): void {
    this.recording = false;
    if (this.current.length > 0) this.lastPlayedSteps = this.current.slice();
    this.onStateChange?.();
  }

  /** Discard the in-progress / just-finished recording. */
  clearRecording(): void {
    this.current = [];
    this.onStateChange?.();
  }

  /** Called from runMenuAction; records the command if recordable. */
  recordCommand(act: string): void {
    if (!this.recording || this.suppress) return;
    if (NON_RECORDABLE.has(act) || act.startsWith("macro") || act.startsWith("plugin")) return;
    this.current.push({ t: "cmd", act });
  }

  /** Called from the editor host update listener. */
  recordEdit(edit: UserEdit): void {
    if (!this.recording || this.suppress) return;
    if (edit.kind === "insert") this.current.push({ t: "insert", text: edit.text });
    else this.current.push({ t: "delete", dir: edit.dir, n: edit.n });
  }

  /** Run `fn` (e.g. a recordable command) without capturing its editor edits. */
  duringCommand<T>(fn: () => T): T {
    const prev = this.suppress;
    this.suppress = true;
    try {
      return fn();
    } finally {
      this.suppress = prev;
    }
  }

  // ---- Playback ------------------------------------------------------------

  private playSteps(steps: MacroStep[]): void {
    const prev = this.suppress;
    this.suppress = true;
    try {
      for (const step of steps) {
        if (step.t === "cmd") {
          this.deps.runCommand(step.act);
        } else if (step.t === "insert") {
          const view = this.deps.getView();
          view.dispatch(view.state.replaceSelection(step.text), {
            userEvent: "input.type",
            scrollIntoView: true,
          });
        } else {
          const view = this.deps.getView();
          const cmd = step.dir === "forward" ? deleteCharForward : deleteCharBackward;
          for (let i = 0; i < step.n; i++) cmd(view);
        }
      }
    } finally {
      this.suppress = prev;
      this.deps.focus();
    }
  }

  /** Play the last recorded (or last played) macro once. */
  playLast(times = 1): void {
    const steps = this.current.length > 0 ? this.current : this.lastPlayedSteps;
    if (!steps || steps.length === 0) {
      this.deps.notify("No macro to play — record one first.");
      return;
    }
    this.lastPlayedSteps = steps.slice();
    for (let i = 0; i < Math.max(1, times); i++) this.playSteps(steps);
  }

  playMacro(id: string, times = 1): void {
    const m = this.macros.find((x) => x.id === id);
    if (!m) return;
    this.lastPlayedSteps = m.steps.slice();
    for (let i = 0; i < Math.max(1, times); i++) this.playSteps(m.steps);
    this.deps.notify(`Played macro “${m.name}”${times > 1 ? ` ×${times}` : ""}`);
  }

  /** Replay the last/given macro until the caret stops advancing (end of file). */
  playToEnd(id?: string): void {
    const steps = id
      ? this.macros.find((x) => x.id === id)?.steps
      : this.current.length > 0
        ? this.current
        : this.lastPlayedSteps;
    if (!steps || steps.length === 0) {
      this.deps.notify("No macro to play.");
      return;
    }
    const view = this.deps.getView();
    let guard = 0;
    let prevPos = -1;
    while (guard++ < 10000) {
      const pos = view.state.selection.main.head;
      if (pos >= view.state.doc.length || pos === prevPos) break;
      prevPos = pos;
      this.playSteps(steps);
    }
  }

  // ---- Saved macros --------------------------------------------------------

  list(): SavedMacro[] {
    return this.macros.map((m) => ({ ...m, steps: m.steps.slice() }));
  }

  /** Save the in-progress recording (or last recording) under a name. */
  async saveCurrent(name: string): Promise<SavedMacro | null> {
    const steps = this.current.length > 0 ? this.current : this.lastPlayedSteps;
    if (!steps || steps.length === 0) return null;
    const clean = name.trim();
    if (!clean) return null;
    const macro: SavedMacro = { id: slug(clean), name: clean, shortcut: "", steps: steps.slice() };
    this.macros = [...this.macros.filter((m) => m.id !== macro.id), macro];
    await this.persist();
    return macro;
  }

  async remove(id: string): Promise<void> {
    this.macros = this.macros.filter((m) => m.id !== id);
    await this.persist();
  }

  async assignShortcut(id: string, shortcut: string): Promise<void> {
    const digit = /^[1-9]$/.test(shortcut) ? shortcut : "";
    // A digit can map to only one macro at a time.
    this.macros = this.macros.map((m) => {
      if (m.id === id) return { ...m, shortcut: digit };
      if (digit && m.shortcut === digit) return { ...m, shortcut: "" };
      return m;
    });
    await this.persist();
  }

  /** Find a macro bound to the given digit shortcut. */
  byShortcut(digit: string): SavedMacro | undefined {
    return this.macros.find((m) => m.shortcut === digit);
  }
}
