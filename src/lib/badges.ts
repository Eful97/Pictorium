export function bottomGradientSVG(pw: number, ph: number, color = "#000000", opacity = 0.8, pct = 30, fade = 30, fadeWidth = 50, accentColor?: string): { svg: string; top: number; height: number } {
  const gh = Math.max(Math.round(ph * pct / 100), 100)
  const top = ph - gh
  const hex = color.replace("#", "")
  const r = parseInt(hex.substring(0, 2), 16) || 0
  const g = parseInt(hex.substring(2, 4), 16) || 0
  const b = parseInt(hex.substring(4, 6), 16) || 0

  let accentStop = ""
  if (accentColor && accentColor !== "#555555" && accentColor.startsWith("#") && accentColor.length === 7) {
    const ar = parseInt(accentColor.substring(1, 3), 16) || 0
    const ag = parseInt(accentColor.substring(3, 5), 16) || 0
    const ab = parseInt(accentColor.substring(5, 7), 16) || 0
    accentStop = `<stop offset="40%" stop-color="rgba(${ar},${ag},${ab},0.22)"/>`
  }

  const cappedFade = Math.min(fade, 100)
  const svgSolidPct = 100 - cappedFade
  const svgFadeEnd = Math.max(100 - Math.min(cappedFade + fadeWidth, 100), 0)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${gh}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(${r},${g},${b},0)"/>
      <stop offset="${svgFadeEnd}%" stop-color="rgba(${r},${g},${b},0)"/>
      ${accentStop}
      <stop offset="${svgSolidPct}%" stop-color="rgba(${r},${g},${b},${opacity})"/>
      <stop offset="100%" stop-color="rgba(${r},${g},${b},${opacity})"/>
    </linearGradient>
  </defs>
  <rect width="${pw}" height="${gh}" fill="url(#g)"/>
</svg>`
  return { svg, top, height: gh }
}

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
 * Colore d'accento per nome di genere. La chiave è il nome COME LO RESTITUISCE
 * TMDB nella lingua richiesta, quindi ogni lingua supportata va elencata: una
 * chiave mancante non è un errore visibile, degrada a #555555 (grigio) sia sul
 * badge genere sia sull'accento del poster quando la locandina è piatta.
 * Le voci ebraiche vengono da /genre/{movie,tv}/list?language=he-IL.
 */
export const GENRE_FALLBACK: Record<string, string> = {
  Action: '#D4A574', Azione: '#D4A574', 'אקשן': '#D4A574',
  Horror: '#8B0000', Horreur: '#8B0000', 'אימה': '#8B0000',
  Comedy: '#F4D03F', Commedia: '#F4D03F', Comédie: '#F4D03F', 'קומדיה': '#F4D03F',
  Drama: '#5D6D7E', Dramma: '#5D6D7E', Drame: '#5D6D7E', 'דרמה': '#5D6D7E',
  Thriller: '#4A4A4A', 'מותחן': '#4A4A4A',
  Adventure: '#2E86AB', Avventura: '#2E86AB', Aventure: '#2E86AB', 'הרפתקאות': '#2E86AB',
  Animation: '#E67E22', Animazione: '#E67E22', 'אנימציה': '#E67E22',
  'Science Fiction': '#3498DB', 'Science-Fiction': '#3498DB', Fantascienza: '#3498DB', 'מדע בדיוני': '#3498DB',
  Romance: '#E74C3C', Romantico: '#E74C3C', 'רומנטיקה': '#E74C3C',
  Documentary: '#7F8C8D', Documentario: '#7F8C8D', 'תיעודי': '#7F8C8D',
  Mystery: '#6C3483', Mistero: '#6C3483', 'מסתורין': '#6C3483',
  Fantasy: '#8E44AD', Fantasia: '#8E44AD', 'פנטזיה': '#8E44AD',
  War: '#6B4226', Guerra: '#6B4226', 'מלחמה': '#6B4226',
  Western: '#A0522D', 'מערבון': '#A0522D',
  Music: '#1ABC9C', Musica: '#1ABC9C', 'מוזיקה': '#1ABC9C',
  Family: '#2ECC71', Famiglia: '#2ECC71', 'משפחה': '#2ECC71',
  History: '#A67B5B', Storico: '#A67B5B', Storia: '#A67B5B', 'היסטוריה': '#A67B5B',
  Crime: '#2C3E50', Crimine: '#2C3E50', 'פשע': '#2C3E50',
}
