import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DmScreenPlugin from "./main";

export interface DmScreenSettings {
  serverPort: number;
  autoStartServer: boolean;
  tvWidth: number;
  tvHeight: number;
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
  cacheBaseFolder: string;
  hydrusCacheTtlDays: number;
  hydrusDefaultLoop: boolean;
  hydrusDefaultMuted: boolean;
  hydrusIgnoredTagPatterns: string[];
  hydrusDefaultSearchTags: string;
  // D&D Beyond integration
  ddbEnabled: boolean;
  ddbCobaltSession: string;
  ddbInspirationPulse: boolean;
  // Combat tracker
  combatTrackerScale: number;
  // Server limits
  maxClients: number;
  // Waiting screen (player-side)
  waitingTitle: string;
  waitingSubtitle: string;
  // Debug
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: DmScreenSettings = {
  serverPort: 3000,
  autoStartServer: false,
  tvWidth: 1920,
  tvHeight: 1080,
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
  cacheBaseFolder: ".dm-screen",
  hydrusCacheTtlDays: 30,
  hydrusDefaultLoop: true,
  hydrusDefaultMuted: true,
  hydrusIgnoredTagPatterns: [
    "wd eva02-large v3 tagger ai generated tags",
    "wd v1\\.4 vit v2 tagger ai generated tags",
    "rating:.*",
  ],
  hydrusDefaultSearchTags: "",
  ddbEnabled: false,
  ddbCobaltSession: "",
  ddbInspirationPulse: true,
  combatTrackerScale: 1,
  maxClients: 10,
  waitingTitle: "Player Screen",
  waitingSubtitle: "Waiting for DM to push content...",
  debugMode: false,
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
            this.plugin.settings.serverPort = parseInt(value, 10) || 3000;
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

    new Setting(containerEl)
      .setName("Max connected clients")
      .setDesc("Maximum number of player screens that can connect simultaneously")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxClients))
          .onChange(async (value) => {
            this.plugin.settings.maxClients = parseInt(value, 10) || 10;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Waiting screen title")
      .setDesc("Big text shown on the player screen while nothing is being broadcast. Leave empty to hide.")
      .addText((text) =>
        text
          .setPlaceholder("Player Screen")
          .setValue(this.plugin.settings.waitingTitle)
          .onChange(async (value) => {
            this.plugin.settings.waitingTitle = value;
            await this.plugin.saveSettings();
            this.plugin.broadcastWaitingScreen();
          })
      );

    new Setting(containerEl)
      .setName("Waiting screen subtitle")
      .setDesc("Smaller text below the title. Leave empty to hide.")
      .addText((text) =>
        text
          .setPlaceholder("Waiting for DM to push content...")
          .setValue(this.plugin.settings.waitingSubtitle)
          .onChange(async (value) => {
            this.plugin.settings.waitingSubtitle = value;
            await this.plugin.saveSettings();
            this.plugin.broadcastWaitingScreen();
          })
      );

    containerEl.createEl("h3", { text: "Hydrus Library" });

    new Setting(containerEl)
      .setName("Enable Hydrus integration")
      .setDesc('Surfaces an "Image from Hydrus" button in the DM panel to browse the tagged library')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hydrusEnabled).onChange(async (value) => {
          this.plugin.settings.hydrusEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.initHydrusCache();
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

    const validServices = this.plugin.settings.hydrusAvailableTagServices.filter(
      (s) => s.key && s.name
    );
    if (validServices.length > 0) {
      const checkContainer = containerEl.createDiv({ cls: "dm-hydrus-service-checks" });
      for (const svc of validServices) {
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
      .setName("Cache base folder")
      .setDesc(
        "Relative vault path under which the plugin keeps cached files. Hydrus downloads land in <folder>/hydrus/ and D&D Beyond avatars in <folder>/beyond/."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.cacheBaseFolder)
          .onChange(async (value) => {
            const normalized = value.trim().replace(/^\/+|\/+$/g, "");
            if (normalized.includes("..")) {
              new Notice('Cache folder must be relative to the vault, no ".." segments', 6000);
              return;
            }
            this.plugin.settings.cacheBaseFolder = normalized || ".dm-screen";
            await this.plugin.saveSettings();
            this.plugin.initHydrusCache();
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
            this.plugin.initHydrusCache();
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
      .setName("Default search tags")
      .setDesc(
        'Tags pre-filled in the search box when opening the Hydrus Explorer (comma-separated, e.g. "landscape, no humans"). Leave empty to start with a blank search.'
      )
      .addText((text) =>
        text
          .setPlaceholder("landscape, no humans")
          .setValue(this.plugin.settings.hydrusDefaultSearchTags)
          .onChange(async (value) => {
            this.plugin.settings.hydrusDefaultSearchTags = value;
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

    // ─── D&D Beyond ───
    containerEl.createEl("h3", { text: "D&D Beyond" });

    new Setting(containerEl)
      .setName("Enable D&D Beyond integration")
      .setDesc("Adds a D&D Beyond tab in combat mode to sync encounters and initiative")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ddbEnabled).onChange(async (value) => {
          this.plugin.settings.ddbEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("CobaltSession cookie")
      .setDesc("Paste your CobaltSession cookie from dndbeyond.com (DevTools → Application → Cookies)")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Paste CobaltSession value here")
          .setValue(this.plugin.settings.ddbCobaltSession)
          .onChange(async (value) => {
            this.plugin.settings.ddbCobaltSession = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const ddbBtnRow = new Setting(containerEl)
      .setName("Connection")
      .setDesc("Open D&D Beyond to log in, then test your session");

    ddbBtnRow.addButton((btn) =>
      btn.setButtonText("Open D&D Beyond").onClick(() => {
        window.open("https://www.dndbeyond.com");
      })
    );

    ddbBtnRow.addButton((btn) =>
      btn
        .setButtonText("Test connection")
        .setCta()
        .onClick(async () => {
          const session = this.plugin.settings.ddbCobaltSession;
          if (!session) {
            new Notice("Paste a CobaltSession cookie first", 4000);
            return;
          }
          try {
            const { DdbClient } = await import("./dndbeyond/client");
            const client = new DdbClient(session);
            const valid = await client.validateSession();
            if (valid) {
              new Notice("D&D Beyond session is valid ✓", 5000);
            } else {
              new Notice("D&D Beyond session is invalid or expired", 6000);
            }
          } catch (err) {
            new Notice(`D&D Beyond test failed: ${(err as Error).message}`, 6000);
          }
        })
    );

    new Setting(containerEl)
      .setName("Pulse on inspired PC rows")
      .setDesc("Animate the red glow around D&D Beyond PCs that have Heroic Inspiration. Turn off for a static glow only.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ddbInspirationPulse).onChange(async (value) => {
          this.plugin.settings.ddbInspirationPulse = value;
          await this.plugin.saveSettings();
          this.plugin.broadcastInspirationStyle();
          this.plugin.refreshOpenDmPanels();
        })
      );

    // ─── Advanced ───
    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Log detailed information to the developer console (Ctrl+Shift+I)")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
