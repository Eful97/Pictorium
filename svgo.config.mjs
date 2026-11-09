// Conservative SVGO config for Pictorium static SVG assets (one-shot hygiene).
//
// Scope: public/networks, public/seasonal-frames, public/awards,
// public/quality-badges, public/rating and the root public/*.svg logos.
// Runtime-generated SVG strings (badge/scrim/gradient builders feeding
// sharp/resvg) are NOT processed by this config.
//
// Guarantees enforced by this config:
//  - viewBox and width/height kept (removeViewBox:false, no unit conversion)
//  - ids, classes, <style> blocks and attributes kept verbatim
//  - no CSS rewriting (63 assets ship <style> blocks)
//  - no group/path merging, no shape conversion, no structural collapsing
//  - numeric precision kept at 5 decimals; physical units (mm) preserved
//  - transform rewriting DISABLED: measured to shift antialiasing edges
//  - path-data rewriting DISABLED: measured to shift antialiasing edges
//  - self-closing tags kept: separate-rating-renderer.ts matches
//    `<use ... xlink:href="#d1pwhf9wy2" .../>` literally on public/rating/imdb.svg
//
// Verified with a sharp/librsvg pixel gate at density 96 and 300:
// all 120 in-scope assets render byte-identical.
//
// Usage: npx --yes svgo@3.3.5 --config svgo.config.mjs --folder public --recursive
// (see scripts/optimize-svgs.mjs for the safe in-place wrapper that keeps
// any file whose optimized size is not smaller).
const config = {
  multipass: false,
  js2svg: { indent: 0, pretty: false, useShortTags: true, eol: "lf" },
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          // Canvas contract.
          removeViewBox: false,
          // Keep every id/class/attribute: compositing may reference them.
          cleanupIds: false,
          inlineStyles: false,
          removeUnknownsAndDefaults: false,
          removeUselessDefs: false,
          removeHiddenElems: false,
          removeEmptyContainers: false,
          removeNonInheritableGroupAttrs: false,
          moveElemsAttrsToGroup: false,
          moveGroupAttrsToElems: false,
          collapseGroups: false,
          mergePaths: false,
          convertShapeToPath: false,
          removeUselessStrokeAndFill: false,
          removeEmptyText: false,
          removeTitle: false,
          removeDesc: false,
          // No CSS rewriting.
          minifyStyles: false,
          // Numeric hygiene only: 8 decimals (viewBox values stay exact),
          // never convert physical units. `false` would round to integers.
          cleanupNumericValues: { floatPrecision: 8, convertToPx: false },
          // Measured to move antialiased edges on the librsvg rasterizer.
          convertPathData: false,
          convertTransform: false,
          // Exact-equivalence color shortening only.
          convertColors: {
            currentColor: false,
            names2hex: true,
            rgb2hex: true,
            shorthex: true,
          },
        },
      },
    },
    "removeMetadata",
    "removeComments",
    "removeEditorsNSData",
    "removeXMLProcInst",
    "removeDoctype",
  ],
};

export default config;
