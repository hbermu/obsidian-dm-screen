import { App, Modal, Setting } from "obsidian";
import type DmScreenPlugin from "../main";
import { cssPixelsPerInch, profileKey, FALLBACK_PPI } from "../map/transform";
import type { ScreenProfile } from "../map/types";

export class MapCalibrationModal extends Modal {
  private overlayShown = false;

  constructor(
    app: App,
    private plugin: DmScreenPlugin,
    private client: { width: number; height: number; devicePixelRatio: number },
    private onDone?: () => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const key = profileKey(this.client.width, this.client.height, this.client.devicePixelRatio);
    const existing = this.plugin.settings.mapScreenProfiles[key];
    const profile: ScreenProfile = existing ? { ...existing } : { diagonalInches: 0, fineTune: 1 };

    contentEl.createEl("h3", { text: `Calibrate ${this.client.width}×${this.client.height} screen` });
    contentEl.createEl("p", {
      text: "Enter the screen's physical diagonal, then verify with the test pattern and a real ruler; use fine-tune until the on-screen inch matches.",
      cls: "setting-item-description",
    });

    const ppiLine = contentEl.createEl("p");
    const refreshPpi = () => {
      const ppi =
        profile.diagonalInches > 0
          ? cssPixelsPerInch(this.client.width, this.client.height, profile)
          : FALLBACK_PPI;
      ppiLine.setText(
        `Effective density: ${ppi.toFixed(1)} px/inch` +
          (profile.diagonalInches > 0 ? "" : ` (no diagonal set — fallback ${FALLBACK_PPI})`)
      );
    };
    refreshPpi();

    const apply = () => {
      if (profile.diagonalInches > 0) {
        this.plugin.settings.mapScreenProfiles[key] = { ...profile };
      } else {
        delete this.plugin.settings.mapScreenProfiles[key];
      }
      void this.plugin.saveSettings();
      this.plugin.broadcastMapCalibration();
      refreshPpi();
    };

    new Setting(contentEl)
      .setName("Screen diagonal (inches)")
      .setDesc("The physical diagonal of the display, e.g. 43 for a 43″ TV.")
      .addText((text) =>
        text.setValue(profile.diagonalInches > 0 ? String(profile.diagonalInches) : "").onChange((value) => {
          profile.diagonalInches = parseFloat(value) || 0;
          apply();
        })
      );

    new Setting(contentEl)
      .setName("Fine-tune")
      .setDesc("Multiplier applied on top of the computed density (1.00 = no correction).")
      .addSlider((slider) =>
        slider
          .setLimits(0.9, 1.1, 0.005)
          .setValue(profile.fineTune)
          .setDynamicTooltip()
          .onChange((value) => {
            profile.fineTune = value;
            apply();
          })
      );

    new Setting(contentEl)
      .setName("Show test pattern on the map screen")
      .setDesc("Displays a 6-inch ruler and a 1-inch square to measure against.")
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          this.overlayShown = value;
          this.plugin.server?.broadcast({ type: "map-calibration-overlay", payload: { show: value } });
        })
      );
  }

  onClose() {
    if (this.overlayShown) {
      this.plugin.server?.broadcast({ type: "map-calibration-overlay", payload: { show: false } });
    }
    this.contentEl.empty();
    this.onDone?.();
  }
}
