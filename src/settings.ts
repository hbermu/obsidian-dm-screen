import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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
  fogOfWarState: Record<string, FogRegion[]>; // map name → revealed regions
  // Persisted player screen state
  lastPlayerScreenWidth: number;
  lastPlayerScreenHeight: number;
  lastImageLayers: string; // JSON-serialized ImageLayer[] (without dataUrl to save space)
  lastBroadcastCache: Record<string, string>; // message type → JSON payload (for late joiners)
  // Hydrus integration
  hydrusEnabled: boolean;
  hydrusApiUrl: string;
  hydrusApiKey: string;
  hydrusTagService: string; // deprecated — kept for migration
  hydrusAvailableTagServices: { name: string; key: string }[];
  hydrusTagServices: string[]; // selected service keys
  hydrusCacheFolder: string;
  hydrusCacheTtlDays: number;
  hydrusDefaultLoop: boolean;
  hydrusDefaultMuted: boolean;
  hydrusIgnoredTagPatterns: string[];
}

export interface FogRegion {
  x: number;      // map coordinate
  y: number;      // map coordinate
  w: number;      // width in map coordinates
  h: number;      // height in map coordinates
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
  fogOfWarState: {},
  lastPlayerScreenWidth: 0,
  lastPlayerScreenHeight: 0,
  lastImageLayers: "[]",
  lastBroadcastCache: {},
  hydrusEnabled: false,
  hydrusApiUrl: "",
  hydrusApiKey: "",
  hydrusTagService: "",
  hydrusAvailableTagServices: [],
  hydrusTagServices: [],
  hydrusCacheFolder: ".hydrus-cache",
  hydrusCacheTtlDays: 30,
  hydrusDefaultLoop: true,
  hydrusDefaultMuted: true,
  hydrusIgnoredTagPatterns: [
    "wd eva02-large v3 tagger ai generated tags",
    "wd v1\\.4 vit v2 tagger ai generated tags",
    "rating:.*",
  ],
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

    containerEl.createEl("h3", { text: "Hydrus Library" });

    new Setting(containerEl)
      .setName("Enable Hydrus integration")
      .setDesc('Surfaces a "BG from Hydrus" button in the DM panel to browse the tagged library')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hydrusEnabled).onChange(async (value) => {
          this.plugin.settings.hydrusEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("API URL")
      .setDesc("Base URL of the Hydrus Client API (no trailing slash)")
      .addText((text) =>
        text
          .setPlaceholder("https://your-hydrus-host.example/")
          .setValue(this.plugin.settings.hydrusApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.hydrusApiUrl = value.replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("64-hex Hydrus-Client-API-Access-Key — kept locally, never sent to the player browser")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hydrusApiKey)
          .onChange(async (value) => {
            this.plugin.settings.hydrusApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Test connection")
          .setCta()
          .onClick(async () => {
            try {
              const { HydrusClient } = await import("./hydrus/client");
              const client = new HydrusClient({
                baseUrl: this.plugin.settings.hydrusApiUrl,
                apiKey: this.plugin.settings.hydrusApiKey,
              });
              const info = await client.verifyAccess();
              new Notice(`Hydrus OK: ${info.human_description ?? "access verified"}`, 5000);
            } catch (err) {
              new Notice(`Hydrus failed: ${(err as Error).message}`, 8000);
            }
          })
      );

    new Setting(containerEl)
      .setName("Tag services")
      .setDesc("Select which Hydrus tag services to search. Click Fetch to discover available services.")
      .addButton((btn) =>
        btn
          .setButtonText("Fetch services")
          .onClick(async () => {
            try {
              const { HydrusClient } = await import("./hydrus/client");
              const client = new HydrusClient({
                baseUrl: this.plugin.settings.hydrusApiUrl,
                apiKey: this.plugin.settings.hydrusApiKey,
              });
              const services = await client.getServices();
              const tagServices = services.filter((s) => s.type === 0 || s.type === 5);
              this.plugin.settings.hydrusAvailableTagServices = tagServices.map((s) => ({
                name: s.name,
                key: s.service_key,
              }));
              // Migrate old setting if needed
              if (this.plugin.settings.hydrusTagService && this.plugin.settings.hydrusTagServices.length === 0) {
                const match = tagServices.find((s) => s.name === this.plugin.settings.hydrusTagService);
                if (match) {
                  this.plugin.settings.hydrusTagServices = [match.service_key];
                }
                this.plugin.settings.hydrusTagService = "";
              }
              await this.plugin.saveSettings();
              new Notice(`Found ${tagServices.length} tag service(s)`);
              this.display();
            } catch (err) {
              new Notice(`Failed to fetch services: ${(err as Error).message}`, 6000);
            }
          })
      );

    if (this.plugin.settings.hydrusAvailableTagServices.length > 0) {
      const checkContainer = containerEl.createDiv({ cls: "dm-hydrus-service-checks" });
      for (const svc of this.plugin.settings.hydrusAvailableTagServices) {
        const row = checkContainer.createDiv({ cls: "dm-hydrus-service-row" });
        const checkbox = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = this.plugin.settings.hydrusTagServices.includes(svc.key);
        checkbox.id = `hydrus-svc-${svc.key.slice(0, 8)}`;
        row.createEl("label", { text: svc.name, attr: { for: checkbox.id } });
        checkbox.addEventListener("change", async () => {
          if (checkbox.checked) {
            if (!this.plugin.settings.hydrusTagServices.includes(svc.key)) {
              this.plugin.settings.hydrusTagServices.push(svc.key);
            }
          } else {
            this.plugin.settings.hydrusTagServices = this.plugin.settings.hydrusTagServices.filter(
              (k) => k !== svc.key
            );
          }
          await this.plugin.saveSettings();
        });
      }
    }

    new Setting(containerEl)
      .setName("Cache folder")
      .setDesc("Relative vault path where downloaded files are kept. Hidden by default.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hydrusCacheFolder)
          .onChange(async (value) => {
            const normalized = value.trim().replace(/^\/+|\/+$/g, "");
            if (normalized.includes("..")) {
              new Notice('Cache folder must be relative to the vault, no ".." segments', 6000);
              return;
            }
            this.plugin.settings.hydrusCacheFolder = normalized || ".hydrus-cache";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cache TTL (days)")
      .setDesc("Files unused for this many days are removed on plugin reload")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.hydrusCacheTtlDays))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            this.plugin.settings.hydrusCacheTtlDays = Number.isFinite(n) && n > 0 ? n : 30;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Loop background media")
      .setDesc("Default loop flag when setting media as player background")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hydrusDefaultLoop).onChange(async (value) => {
          this.plugin.settings.hydrusDefaultLoop = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Mute background media")
      .setDesc("Default mute flag when setting media as player background (videos autoplay only when muted)")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hydrusDefaultMuted).onChange(async (value) => {
          this.plugin.settings.hydrusDefaultMuted = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ignored tag patterns")
      .setDesc("Regex patterns (one per line, auto-anchored). Tags matching any pattern are hidden from the tile menu and excluded from Copy tags.")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.hydrusIgnoredTagPatterns.join("\n"))
          .setPlaceholder("rating:.*\nwd eva02-large v3 tagger ai generated tags")
          .onChange(async (value) => {
            this.plugin.settings.hydrusIgnoredTagPatterns = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Clear Hydrus cache")
      .setDesc("Deletes everything under the cache folder. Cannot be undone.")
      .addButton((btn) =>
        btn
          .setWarning()
          .setButtonText("Clear cache")
          .onClick(async () => {
            const cache = this.plugin.hydrusCache;
            if (!cache) {
              new Notice("Hydrus cache not initialised");
              return;
            }
            const removed = await cache.clear();
            new Notice(`Removed ${removed} cached files`);
          })
      );
  }
}
