// Sample plugin: Word Count / reading-time. Demonstrates a side panel that
// updates live, plus a status-bar item. Uses only the host API (no fs/network).

import type { PluginModule, PluginHost, PluginStatusHandle, PluginPanelHandle } from "../api";

function stats(text: string): { words: number; chars: number; lines: number; minutes: number } {
  const words = (text.match(/\S+/g) ?? []).length;
  const chars = text.length;
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  const minutes = Math.max(words === 0 ? 0 : 1, Math.ceil(words / 200)); // ~200 wpm
  return { words, chars, lines, minutes };
}

export const wordCountPlugin: PluginModule = {
  id: "wordcount",
  name: "Word Count",
  description: "Live word, character and line counts with an estimated reading time.",
  activate(host: PluginHost) {
    let status: PluginStatusHandle | null = null;
    let panel: PluginPanelHandle | null = null;
    let body: HTMLElement | null = null;

    const render = () => {
      const s = stats(host.getActiveText());
      if (status) status.setText(`${s.words} words`);
      if (body) {
        body.replaceChildren();
        const rows: Array<[string, string]> = [
          ["Words", String(s.words)],
          ["Characters", String(s.chars)],
          ["Lines", String(s.lines)],
          ["Reading time", `${s.minutes} min`],
        ];
        for (const [label, value] of rows) {
          const row = document.createElement("div");
          row.className = "wc-row";
          const l = document.createElement("span");
          l.className = "wc-label";
          l.textContent = label;
          const v = document.createElement("span");
          v.className = "wc-value";
          v.textContent = value;
          row.append(l, v);
          body.append(row);
        }
      }
    };

    status = host.addStatusBarItem({
      id: "wc-status",
      text: "0 words",
      title: "Word Count — click to open panel",
      onClick: () => panel?.show(),
    });

    panel = host.addPanel({
      id: "wc-panel",
      title: "Word Count",
      render: (container) => {
        body = container;
        body.className = "wc-body";
        render();
      },
    });

    host.onDocChanged(render);
    render();
  },
};
