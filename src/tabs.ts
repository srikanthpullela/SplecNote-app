// Tab strip rendering with dirty indicator, close button, and drag-to-reorder.

import type { BufferStore } from "./buffers";

export interface TabHandlers {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRename: (id: string, title: string) => void;
}

export function renderTabs(
  container: HTMLElement,
  store: BufferStore,
  handlers: TabHandlers,
): void {
  container.replaceChildren();
  const activeId = store.activeIdValue();

  store.list().forEach((buf) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (buf.id === activeId ? " is-active" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(buf.id === activeId));
    tab.dataset.id = buf.id;
    tab.draggable = true;
    tab.title = buf.path ?? buf.title;

    const dot = document.createElement("span");
    dot.className = "tab-dot" + (buf.dirty ? " is-dirty" : "");
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = buf.title;

    // Double-click the label to rename the tab inline. Handy for turning an
    // "Untitled" scratch note into something meaningful without saving first.
    const beginRename = () => {
      if (tab.querySelector(".tab-rename")) return;
      const input = document.createElement("input");
      input.className = "tab-rename";
      input.type = "text";
      input.value = buf.title;
      input.spellcheck = false;
      input.draggable = false;
      input.addEventListener("mousedown", (e) => e.stopPropagation());
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("dblclick", (e) => e.stopPropagation());

      let done = false;
      const commit = (save: boolean) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        input.replaceWith(title);
        if (save && next && next !== buf.title) {
          handlers.onRename(buf.id, next);
        }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          commit(false);
        }
        e.stopPropagation();
      });
      input.addEventListener("blur", () => commit(true));

      title.replaceWith(input);
      input.focus();
      input.select();
    };
    title.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginRename();
    });

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.draggable = false;
    close.setAttribute("aria-label", `Close ${buf.title}`);
    close.textContent = "✕";
    // A draggable parent can otherwise swallow the click as a drag start, so
    // intercept pointer events on the close button and act on pointerdown.
    const doClose = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onClose(buf.id);
    };
    close.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    close.addEventListener("mousedown", (e) => e.stopPropagation());
    close.addEventListener("click", doClose);

    tab.append(dot, title, close);

    tab.addEventListener("mousedown", (e) => {
      // Middle-click closes, like most editors.
      if (e.button === 1) {
        e.preventDefault();
        handlers.onClose(buf.id);
      }
    });
    tab.addEventListener("click", () => handlers.onSelect(buf.id));

    // Drag-to-reorder.
    tab.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", buf.id);
      tab.classList.add("is-dragging");
    });
    tab.addEventListener("dragend", () => tab.classList.remove("is-dragging"));
    tab.addEventListener("dragover", (e) => {
      e.preventDefault();
      tab.classList.add("is-drop-target");
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("is-drop-target"));
    tab.addEventListener("drop", (e) => {
      e.preventDefault();
      tab.classList.remove("is-drop-target");
      const fromId = e.dataTransfer?.getData("text/plain");
      if (!fromId || fromId === buf.id) return;
      const fromIndex = store.indexOf(fromId);
      const toIndex = store.indexOf(buf.id);
      if (fromIndex >= 0 && toIndex >= 0) handlers.onReorder(fromIndex, toIndex);
    });

    container.append(tab);
  });
}
