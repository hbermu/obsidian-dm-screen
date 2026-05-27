import { activeSegment, applySuggestion } from "../hydrus/tagInput";

export interface TagSuggesterDeps {
  inputEl: HTMLInputElement;
  fetchSuggestions: (prefix: string) => Promise<string[]>;
  onSubmit: (rawQuery: string) => void;
}

const DEBOUNCE_MS = 120;
const BLUR_CLOSE_MS = 150;
const MAX_ROWS = 50;

export class TagSuggester {
  private deps: TagSuggesterDeps;
  private dropdown: HTMLDivElement;
  private items: string[] = [];
  private activeIndex = -1;
  private fetchToken = 0;
  private debounceTimer: number | null = null;
  private blurTimer: number | null = null;
  private listeners: Array<() => void> = [];

  constructor(deps: TagSuggesterDeps) {
    this.deps = deps;

    this.dropdown = document.createElement("div");
    this.dropdown.className = "dm-hydrus-suggest";
    const parent = deps.inputEl.parentElement;
    if (parent) parent.appendChild(this.dropdown);

    const onInput = () => this.scheduleFetch();
    const onFocus = () => this.scheduleFetch();
    const onKey = (e: KeyboardEvent) => this.handleKey(e);
    const onBlur = () => this.scheduleClose();
    const onMouseDownDropdown = (e: MouseEvent) => {
      // Prevent the input from blurring before the click handler runs.
      e.preventDefault();
    };

    deps.inputEl.addEventListener("input", onInput);
    deps.inputEl.addEventListener("focus", onFocus);
    deps.inputEl.addEventListener("keydown", onKey);
    deps.inputEl.addEventListener("blur", onBlur);
    this.dropdown.addEventListener("mousedown", onMouseDownDropdown);

    this.listeners.push(
      () => deps.inputEl.removeEventListener("input", onInput),
      () => deps.inputEl.removeEventListener("focus", onFocus),
      () => deps.inputEl.removeEventListener("keydown", onKey),
      () => deps.inputEl.removeEventListener("blur", onBlur),
      () => this.dropdown.removeEventListener("mousedown", onMouseDownDropdown)
    );
  }

  destroy() {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    if (this.blurTimer !== null) window.clearTimeout(this.blurTimer);
    for (const off of this.listeners) off();
    this.listeners = [];
    this.dropdown.remove();
  }

  private scheduleFetch() {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.runFetch();
    }, DEBOUNCE_MS);
  }

  private scheduleClose() {
    if (this.blurTimer !== null) window.clearTimeout(this.blurTimer);
    this.blurTimer = window.setTimeout(() => {
      this.blurTimer = null;
      this.close();
    }, BLUR_CLOSE_MS);
  }

  private cancelClose() {
    if (this.blurTimer !== null) {
      window.clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  private async runFetch() {
    const segment = this.currentSegment();
    const token = ++this.fetchToken;
    this.cancelClose();
    let suggestions: string[] = [];
    try {
      suggestions = await this.deps.fetchSuggestions(segment.text);
    } catch {
      suggestions = [];
    }
    if (token !== this.fetchToken) return;
    this.render(suggestions.slice(0, MAX_ROWS));
  }

  private currentSegment() {
    const value = this.deps.inputEl.value;
    const caret = this.deps.inputEl.selectionStart ?? value.length;
    return activeSegment(value, caret);
  }

  private render(items: string[]) {
    this.items = items;
    this.activeIndex = items.length > 0 ? 0 : -1;
    this.dropdown.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dm-hydrus-suggest-empty";
      empty.textContent = "No matching tags";
      this.dropdown.appendChild(empty);
      this.open();
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const row = document.createElement("div");
      row.className = "dm-hydrus-suggest-item";
      if (i === this.activeIndex) row.classList.add("is-active");
      row.tabIndex = -1;
      const label = document.createElement("span");
      label.textContent = items[i];
      row.appendChild(label);
      row.addEventListener("click", () => this.acceptSuggestion(items[i]));
      this.dropdown.appendChild(row);
    }
    this.open();
  }

  private open() {
    this.dropdown.classList.add("is-open");
  }

  private close() {
    this.dropdown.classList.remove("is-open");
    this.activeIndex = -1;
  }

  private handleKey(e: KeyboardEvent) {
    if (!this.dropdown.classList.contains("is-open")) {
      if (e.key === "Enter") {
        this.deps.onSubmit(this.deps.inputEl.value);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (this.items.length === 0) return;
      this.activeIndex = (this.activeIndex + 1) % this.items.length;
      this.refreshActiveRow();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      if (this.items.length === 0) return;
      this.activeIndex =
        this.activeIndex <= 0 ? this.items.length - 1 : this.activeIndex - 1;
      this.refreshActiveRow();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (this.activeIndex >= 0 && this.items[this.activeIndex]) {
        this.acceptSuggestion(this.items[this.activeIndex]);
      } else {
        this.deps.onSubmit(this.deps.inputEl.value);
      }
      e.preventDefault();
    } else if (e.key === "Tab") {
      if (this.activeIndex >= 0 && this.items[this.activeIndex]) {
        this.acceptSuggestion(this.items[this.activeIndex]);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      this.close();
      e.preventDefault();
    }
  }

  private refreshActiveRow() {
    const rows = this.dropdown.querySelectorAll(".dm-hydrus-suggest-item");
    rows.forEach((row, i) => {
      if (i === this.activeIndex) {
        row.classList.add("is-active");
        (row as HTMLElement).scrollIntoView({ block: "nearest" });
      } else {
        row.classList.remove("is-active");
      }
    });
  }

  private acceptSuggestion(value: string) {
    const input = this.deps.inputEl;
    const caret = input.selectionStart ?? input.value.length;
    const result = applySuggestion(input.value, caret, value);
    input.value = result.value;
    input.setSelectionRange(result.caret, result.caret);
    input.focus();
    this.cancelClose();
    this.scheduleFetch();
  }
}
