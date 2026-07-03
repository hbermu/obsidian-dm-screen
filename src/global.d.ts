// Virtual modules produced by the esbuild build (see esbuild.config.mjs).
// The browser-side player/map bundles are inlined at build time as strings.
declare module "player-screen-bundle" {
  const playerJs: string;
  export default playerJs;
}

declare module "map-screen-bundle" {
  const mapJs: string;
  export default mapJs;
}
