import { browser, expect } from "@wdio/globals";
import { openPanel, startServer, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder, WsMessage } from "../helpers/ws";

interface Combatant {
  name: string;
  hp: number;
  initiative: number;
  active?: boolean;
}

function combatants(m: WsMessage): Combatant[] {
  return m.payload.combatants as Combatant[];
}

async function addCombatant(name: string, init: number, hp: number): Promise<void> {
  const row = browser.$(".dm-control-panel .dm-add-combatant");
  await row.$('input[placeholder="Name"]').setValue(name);
  await row.$('input[placeholder="Init"]').setValue(String(init));
  await row.$('input[placeholder="HP"]').setValue(String(hp));
  await row.$("button=+").click();
}

describe("manual combat tracker", function () {
  let rec: WsRecorder;

  // The combatants are added BEFORE the recorder connects: a client connection
  // triggers a deferred panel re-render that recreates the add-form inputs and
  // can swallow a click typed mid-render. The recorder then receives the
  // cached initiative-update as a late joiner, which is asserted in test 1.
  before(async function () {
    await openPanel();
    await startServer();
    await addCombatant("Goblin", 10, 8);
    await addCombatant("Wolf", 5, 11);
    await addCombatant("Alice", 20, 30);
    await browser.waitUntil(() =>
      browser.executeObsidian(() => document.querySelectorAll(".dm-combatant-row").length === 3),
    );
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");
  });

  after(function () {
    rec.close();
  });

  it("added combatants render sorted rows and replay visible and inactive to a late joiner", async function () {
    const firstRow = await browser.executeObsidian(
      () => document.querySelector(".dm-combatant-row")?.textContent ?? "",
    );
    expect(firstRow).toContain("Alice");

    const update = await rec.waitFor("initiative-update", {
      where: (m) => combatants(m).length === 3,
    });
    expect(combatants(update).map((c) => c.name)).toEqual(["Alice", "Goblin", "Wolf"]);
    expect(combatants(update).some((c) => c.active)).toBe(false);
  });

  it("Next Turn activates the next combatant and round 1 conceals those after it", async function () {
    let seen = rec.count("initiative-update");
    await browser.$(".dm-turn-controls").$("button=Next Turn").click();
    const first = await rec.waitFor("initiative-update", { skip: seen });
    expect(combatants(first).find((c) => c.active)?.name).toBe("Goblin");
    expect(combatants(first).map((c) => c.name)).toEqual(["Alice", "Goblin"]);

    seen = rec.count("initiative-update");
    await browser.$(".dm-turn-controls").$("button=Next Turn").click();
    const second = await rec.waitFor("initiative-update", {
      skip: seen,
      where: (m) => combatants(m).length === 3,
    });
    expect(combatants(second).find((c) => c.active)?.name).toBe("Wolf");
  });

  it("wrapping past the last combatant advances the round and reveals everyone", async function () {
    const seen = rec.count("initiative-update");
    await browser.$(".dm-turn-controls").$("button=Next Turn").click();
    const wrapped = await rec.waitFor("initiative-update", {
      skip: seen,
      where: (m) => (m.payload.round as number) === 2,
    });
    expect(combatants(wrapped).length).toBe(3);
    expect(combatants(wrapped).find((c) => c.active)?.name).toBe("Alice");
  });

  it("the scale buttons broadcast combat-scale", async function () {
    const seen = rec.count("combat-scale");
    await browser.$(".dm-tracker-scale-buttons").$("button=+").click();
    const up = await rec.waitFor("combat-scale", { skip: seen });
    expect(up.payload.scale as number).toBeGreaterThan(1);

    await browser.$(".dm-tracker-scale-buttons").$("button=1×").click();
    await rec.waitFor("combat-scale", {
      skip: seen + 1,
      where: (m) => m.payload.scale === 1,
    });
  });

  it("Clear All empties the tracker and resets to round 1", async function () {
    const seen = rec.count("initiative-update");
    await browser.$(".dm-turn-controls").$("button=Clear All").click();
    await rec.waitFor("initiative-update", {
      skip: seen,
      where: (m) => combatants(m).length === 0 && m.payload.round === 1,
    });
    await browser.waitUntil(() =>
      browser.executeObsidian(() => document.querySelectorAll(".dm-combatant-row").length === 0),
    );
  });
});
