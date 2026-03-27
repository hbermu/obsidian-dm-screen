import { App, PluginSettingTab, Setting } from "obsidian";
import type DmScreenPlugin from "./main";

export interface DmScreenSettings {
  serverPort: number;
  autoStartServer: boolean;
  gridColor: string;
  gridOpacity: number;
  tvWidth: number;
  tvHeight: number;
  factionZoneOpacity: number;
  showFactionZonesByDefault: boolean;
  encounterBattlemaps: Record<string, string>; // encounter name → battlemap vault path
}

export const DEFAULT_SETTINGS: DmScreenSettings = {
  serverPort: 3000,
  autoStartServer: false,
  gridColor: "#ffffff",
  gridOpacity: 0.3,
  tvWidth: 1920,
  tvHeight: 1080,
  factionZoneOpacity: 0.2,
  showFactionZonesByDefault: true,
  encounterBattlemaps: {},
};

export class DmScreenSettingTab extends PluginSettingTab {
  plugin: DmScreenPlugin;

  constructor(app: App, plugin: DmScreenPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "DM Screen Settings" });

    new Setting(containerEl)
      .setName("Server Port")
      .setDesc("Port for the Player Screen web server")
      .addText((text) =>
        text
          .setPlaceholder("3000")
          .setValue(String(this.plugin.settings.serverPort))
          .onChange(async (value) => {
            this.plugin.settings.serverPort = parseInt(value) || 3000;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-start Server")
      .setDesc("Automatically start the Player Screen server when Obsidian opens")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStartServer).onChange(async (value) => {
          this.plugin.settings.autoStartServer = value;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Combat Grid" });

    new Setting(containerEl)
      .setName("Grid Color")
      .setDesc("Color of the grid overlay on battlemaps")
      .addText((text) =>
        text.setValue(this.plugin.settings.gridColor).onChange(async (value) => {
          this.plugin.settings.gridColor = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Grid Opacity")
      .setDesc("Opacity of the grid overlay (0-1)")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.gridOpacity))
          .onChange(async (value) => {
            this.plugin.settings.gridOpacity = parseFloat(value) || 0.3;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "TV/Screen Dimensions" });

    new Setting(containerEl)
      .setName("TV Width (px)")
      .setDesc("Width of the player screen display in pixels")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tvWidth))
          .onChange(async (value) => {
            this.plugin.settings.tvWidth = parseInt(value) || 1920;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("TV Height (px)")
      .setDesc("Height of the player screen display in pixels")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tvHeight))
          .onChange(async (value) => {
            this.plugin.settings.tvHeight = parseInt(value) || 1080;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Faction Zones" });

    new Setting(containerEl)
      .setName("Zone Opacity")
      .setDesc("Fill opacity of faction zone overlays (0-1)")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.factionZoneOpacity))
          .onChange(async (value) => {
            this.plugin.settings.factionZoneOpacity = parseFloat(value) || 0.2;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show Faction Zones by Default")
      .setDesc("Whether faction zones are visible when a map first loads")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showFactionZonesByDefault).onChange(async (value) => {
          this.plugin.settings.showFactionZonesByDefault = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
