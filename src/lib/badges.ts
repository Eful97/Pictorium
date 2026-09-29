export function cinematicVignetteSVG(pw: number, ph: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">
  <defs>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
    </radialGradient>
  </defs>
  <rect width="${pw}" height="${ph}" fill="url(#vig)"/>
</svg>`
}

/**
 * Ombra lineare superiore (top scrim, opt-in `ts=0..100`, default 0 = spento).
 * Gradiente nero dal bordo alto al 25% del canvas, poi trasparente: incornicia
 * il poster e fa risaltare badge/testi superiori (look di riferimento). A 0
 * non cambia un pixel (il chiamante salta il composite); a 100 il bordo alto
 * è velato al 75% come il riferimento. Sotto logo e badge (restano luminosi).
 */
export function topShadeSVG(pw: number, ph: number, strength: number): string {
  const s = Math.min(Math.max(Math.round(strength), 0), 100)
  const sh = Math.max(1, Math.round(ph * 0.25))
  const a = ((0.75 * s) / 100).toFixed(3)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">
  <defs>
    <linearGradient id="tsh" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="${a}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${pw}" height="${sh}" fill="url(#tsh)"/>
</svg>`
}

/**
 * Scrim d'angolo per il layout landscape "Cinematic Left": gradiente radiale
 * concentrato in basso a sinistra (logo + metadati), destra limpida.
 * Sostituisce la fascia blur/gradiente bassa quando non esplicitata.
 */
export function cinematicCornerGradientSVG(pw: number, ph: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">
  <defs>
    <radialGradient id="cornerGrad" cx="0%" cy="100%" r="85%" fx="0%" fy="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.82"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="75%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${pw}" height="${ph}" fill="url(#cornerGrad)"/>
</svg>`
}

/**
 * Colore d'accento per nome di genere. La chiave è il nome COME LO RESTITUISCE
 * TMDB nella lingua richiesta, quindi ogni lingua supportata va elencata: una
 * chiave mancante non è un errore visibile, degrada a #555555 (grigio) sia sul
 * badge genere sia sull'accento del poster quando la locandina è piatta.
 * Le voci ebraiche vengono da /genre/{movie,tv}/list?language=he-IL, quelle
 * arabe da ...?language=ar (verificate su TMDB ar-SA il 2026-09-29).
 */
export const GENRE_FALLBACK: Record<string, string> = {
  Action: '#D4A574', Azione: '#D4A574', 'אקשן': '#D4A574', 'حركة': '#D4A574',
  Horror: '#8B0000', Horreur: '#8B0000', 'אימה': '#8B0000', 'رعب': '#8B0000',
  Comedy: '#F4D03F', Commedia: '#F4D03F', Comédie: '#F4D03F', 'קומדיה': '#F4D03F', 'كوميديا': '#F4D03F',
  Drama: '#5D6D7E', Dramma: '#5D6D7E', Drame: '#5D6D7E', 'דרמה': '#5D6D7E', 'دراما': '#5D6D7E',
  Thriller: '#4A4A4A', 'מותחן': '#4A4A4A', 'إثارة': '#4A4A4A',
  Adventure: '#2E86AB', Avventura: '#2E86AB', Aventure: '#2E86AB', 'הרפתקאות': '#2E86AB', 'مغامرة': '#2E86AB',
  Animation: '#E67E22', Animazione: '#E67E22', 'אנימציה': '#E67E22', 'رسوم متحركة': '#E67E22',
  'Science Fiction': '#3498DB', 'Science-Fiction': '#3498DB', Fantascienza: '#3498DB', 'Sci-Fi': '#3498DB', 'מדע בדיוני': '#3498DB', 'خيال علمي': '#3498DB',
  Romance: '#E74C3C', Romantico: '#E74C3C', 'רומנטיקה': '#E74C3C', 'رومنسية': '#E74C3C',
  Documentary: '#7F8C8D', Documentario: '#7F8C8D', 'תיעודי': '#7F8C8D', 'وثائقي': '#7F8C8D',
  Mystery: '#6C3483', Mistero: '#6C3483', 'מסתורין': '#6C3483', 'غموض': '#6C3483',
  Fantasy: '#8E44AD', Fantasia: '#8E44AD', 'פנטזיה': '#8E44AD', 'فانتازيا': '#8E44AD',
  War: '#6B4226', Guerra: '#6B4226', 'מלחמה': '#6B4226', 'حرب': '#6B4226',
  Western: '#A0522D', 'מערבון': '#A0522D', 'غربي': '#A0522D',
  Music: '#1ABC9C', Musica: '#1ABC9C', 'מוזיקה': '#1ABC9C', 'موسيقى': '#1ABC9C',
  Family: '#2ECC71', Famiglia: '#2ECC71', 'משפחה': '#2ECC71', 'عائلي': '#2ECC71',
  History: '#A67B5B', Storico: '#A67B5B', Storia: '#A67B5B', 'היסטוריה': '#A67B5B', 'تاريخ': '#A67B5B',
  Crime: '#2C3E50', Crimine: '#2C3E50', 'פשע': '#2C3E50', 'جريمة': '#2C3E50',
  // Generi composti TV grezzi (sicurezza: il badge normalizza a monte, ma un
  // valore grezzo da mapping storici/cache non deve mai degradare a grigio).
  'Sci-Fi & Fantasy': '#3498DB', 'Action & Adventure': '#D4A574', 'War & Politics': '#6B4226', 'حركة ومغامرة': '#D4A574', 'خيال علمي وفانتازيا': '#3498DB', 'حرب وسياسة': '#6B4226',
  'فيلم تلفازي': '#5D6D7E', 'أطفال': '#2ECC71', 'أخبار': '#7F8C8D', 'واقع': '#7F8C8D', 'حوار': '#7F8C8D', 'أوبرا صابونية': '#5D6D7E',
}
