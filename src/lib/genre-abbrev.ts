// Etichette genere abbreviate per il badge (toggle `gs`). Solo testo mostrato:
// il nome intero resta la chiave per GENRE_FALLBACK (colore accent) e cache.
// Forme brevi neutre rispetto alla lingua, in case "naturale" (lo stile
// editoriale maiuscola da solo). Nome non in tabella → invariato.

const SHORT_BY_KEY: Record<string, string> = {}

function add(short: string, ...names: string[]) {
  for (const n of names) SHORT_BY_KEY[n.toLowerCase()] = short
}

add("Sci-Fi",
  "Science Fiction", "Science-Fiction", "Sciencefiction", "Fantascienza",
  "Ciencia ficción", "Ficção científica", "Științifico-fantastic",
  "Khoa học viễn tưởng", "Bilim-Kurgu", "Bilim Kurgu", "מדע בדיוני", "خيال علمي")
add("Docu",
  "Documentary", "Documentario", "Documental", "Documentaire", "Dokumentarfilm",
  "Documentário", "Dokumentalny", "Documentar", "Dokumentární", "Dokumentär",
  "Belgesel", "Tài liệu", "תיעודי", "وثائقي")
add("Hist",
  "History", "Storia", "Storico", "Historia", "Histoire", "Historie", "História",
  "Geschiedenis", "Historisch", "Historyczny", "Istoric", "Historický", "Historisk",
  "Lịch sử", "Tarih", "היסטוריה", "تاريخ")
add("Bio", "Biography", "Biopic", "Biografia", "Biographie", "Biografie", "Biyografi")
add("TV", "TV Movie", "TV Film", "TV film", "TV-film")

export function abbreviateGenreName(name: string): string {
  return SHORT_BY_KEY[name.trim().toLowerCase()] ?? name
}
