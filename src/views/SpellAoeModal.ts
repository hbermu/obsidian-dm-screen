import { App, FuzzySuggestModal } from "obsidian";
import { SPELL_AOES, type SpellAoe } from "../map/spellAoes";

export class SpellAoeModal extends FuzzySuggestModal<SpellAoe> {
  constructor(app: App, private onPick: (spell: SpellAoe) => void) {
    super(app);
    this.setPlaceholder("Search a spell's area of effect…");
  }

  getItems(): SpellAoe[] {
    return SPELL_AOES;
  }

  getItemText(spell: SpellAoe): string {
    const dims = spell.shape === "line" ? `${spell.sizeFt}×${spell.widthFt} ft` : `${spell.sizeFt} ft`;
    return `${spell.name} — ${spell.shape} ${dims}`;
  }

  onChooseItem(spell: SpellAoe): void {
    this.onPick(spell);
  }
}
