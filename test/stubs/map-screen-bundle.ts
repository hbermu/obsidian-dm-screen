// Real bundle is produced at esbuild time via a custom resolver plugin.
// vitest doesn't run that pipeline, so swap in an empty default export.
export default "";
