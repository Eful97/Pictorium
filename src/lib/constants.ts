export const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
export const TOP_LIGHT_LUMINANCE = 0.60


export const CHAR_WIDTH_FACTOR = 0.62










// Canvas poster (browser-safe: questo modulo non importa sharp né Node API,
// quindi è importabile dai componenti client).
// Portrait standard 500×750 vive in image-utils.ts (server, con sharp);
// qui solo le dimensioni landscape 16:9, necessarie anche al client
// (slider logo, preview) senza trascinare sharp nel bundle browser.
export const LAND_W = 768
export const LAND_H = 432
