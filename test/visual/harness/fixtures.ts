import {
  gridPng,
  solidPng,
  pngToDataUrl,
  fogFullPng,
  fogCircleRevealPng,
  fogRectRevealPng,
  fogFreehandRevealPng,
} from "./pngEncoder";

const LAYER_W = 512;
const LAYER_H = 384;
const BG_W = 1024;
const BG_H = 576;

export const backgroundImageDataUrl = pngToDataUrl(
  gridPng(BG_W, BG_H, 128, [40, 40, 60, 255], [80, 80, 110, 255]),
);

export const layerADataUrl = pngToDataUrl(
  gridPng(LAYER_W, LAYER_H, 64, [200, 40, 40, 255], [240, 220, 60, 255]),
);

export const layerBDataUrl = pngToDataUrl(
  gridPng(LAYER_W, LAYER_H, 64, [40, 120, 200, 255], [60, 220, 160, 255]),
);

export const fogFullDataUrl = pngToDataUrl(fogFullPng(LAYER_W, LAYER_H));
export const fogCircleDataUrl = pngToDataUrl(fogCircleRevealPng(LAYER_W, LAYER_H));
export const fogRectDataUrl = pngToDataUrl(fogRectRevealPng(LAYER_W, LAYER_H));
export const fogFreehandDataUrl = pngToDataUrl(fogFreehandRevealPng(LAYER_W, LAYER_H));

interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active?: boolean;
  friendly?: boolean;
  isPlayer?: boolean;
  hidden?: boolean;
  hideHp?: boolean;
  statuses?: string[];
  inspired?: boolean;
}

export interface ImageLayerFixture {
  id: string;
  label: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  visible: boolean;
  fogEnabled: boolean;
  fogDataUrl: string;
  bordered?: boolean;
}

export function makeLayer(overrides: Partial<ImageLayerFixture> & { id: string }): ImageLayerFixture {
  return {
    label: overrides.id,
    dataUrl: layerADataUrl,
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    zIndex: 1,
    rotation: 0,
    visible: true,
    fogEnabled: false,
    fogDataUrl: "",
    bordered: true,
    ...overrides,
  };
}

export const twoLayersBase: ImageLayerFixture[] = [
  makeLayer({
    id: "layer-a",
    dataUrl: layerADataUrl,
    x: 5,
    y: 10,
    width: 45,
    height: 60,
    zIndex: 1,
  }),
  makeLayer({
    id: "layer-b",
    dataUrl: layerBDataUrl,
    x: 50,
    y: 30,
    width: 45,
    height: 60,
    zIndex: 2,
  }),
];

export function layersWithFog(fogDataUrl: string): ImageLayerFixture[] {
  return twoLayersBase.map((l) => ({ ...l, fogEnabled: true, fogDataUrl }));
}

export const initiativeCombatants: Combatant[] = [
  {
    name: "Aria the Bold",
    hp: 42,
    maxHp: 48,
    initiative: 22,
    isPlayer: true,
    friendly: true,
    active: true,
    inspired: true,
    statuses: ["blessed"],
  },
  {
    name: "Kael",
    hp: 30,
    maxHp: 35,
    initiative: 18,
    isPlayer: true,
    friendly: true,
    statuses: ["concentrating", "poisoned"],
  },
  {
    name: "Goblin Brute",
    hp: 14,
    maxHp: 22,
    initiative: 15,
    statuses: ["frightened"],
    hideHp: true,
  },
  {
    name: "Goblin Sneak",
    hp: 8,
    maxHp: 18,
    initiative: 12,
    statuses: ["prone", "exhaustion-2"],
    hideHp: true,
  },
  {
    name: "Cultist Adept",
    hp: 11,
    maxHp: 20,
    initiative: 9,
    hidden: true,
    hideHp: true,
  },
];

export const initiativePayload = {
  combatants: initiativeCombatants.filter((c) => !c.hidden),
  round: 3,
};
