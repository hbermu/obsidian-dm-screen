import { App, Modal } from "obsidian";

export class RenameMonsterModal extends Modal {
  private currentName: string;
  private onSubmit: (name: string) => void;

  constructor(app: App, currentName: string, onSubmit: (name: string) => void) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.modalEl.addClass("dm-rename-modal");
    this.titleEl.setText("Rename monster");
    const { contentEl } = this;
    contentEl.empty();

    const row = contentEl.createDiv({ cls: "dm-rename-modal-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "dm-rename-modal-input",
      attr: { placeholder: "Display name" },
    }) as HTMLInputElement;
    input.value = this.currentName;
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submit(input.value);
      }
    });

    const buttons = contentEl.createDiv({ cls: "dm-rename-modal-buttons" });
    const cancelBtn = buttons.createEl("button", { text: "Cancel" }) as HTMLButtonElement;
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta",
    }) as HTMLButtonElement;
    saveBtn.addEventListener("click", () => this.submit(input.value));

    input.focus();
    input.select();
  }

  private submit(value: string): void {
    this.onSubmit(value.trim());
    this.close();
  }
}
