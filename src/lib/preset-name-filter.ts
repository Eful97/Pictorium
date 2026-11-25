/**
 * Community gallery name filter (publish + rename). Deliberately small: blocks
 * strong slurs/profanity (IT + EN) and link spam, tolerant to case, accents,
 * spacing/punctuation tricks and common leetspeak. Admin removal stays the
 * backstop; this only stops the obvious.
 *
 * Two lists to avoid the Scunthorpe problem: STRONG terms match anywhere in the
 * collapsed name; WORDS only match as a whole word ("nazi" vs "nazionale").
 */
const STRONG = [
  "fuck", "shit", "cunt", "bitch", "whore", "nigger", "nigga", "faggot", "retard", "hitler",
  "cazzo", "merda", "vaffanculo", "stronz", "puttana", "minchia", "porco dio", "porcodio", "mignotta",
]
const WORDS = ["troia", "figa", "nazi", "negro", "culo", "frocio", "froci", "ricchione", "rape", "cum", "dick", "cock", "pussy", "ass", "porn", "xxx"]

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" }
const URL_RE = /(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|ly|me|ru|xyz|it|co|tv|to|app)\b)/i

function fold(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c])
}

export function isPresetNameAllowed(name: string): boolean {
  if (URL_RE.test(name)) return false
  const folded = fold(name)
  const words = folded.split(/[^a-z]+/).filter(Boolean)
  if (words.some((word) => WORDS.includes(word))) return false
  const collapsed = folded.replace(/[^a-z]/g, "")
  return !STRONG.some((term) => collapsed.includes(term.replace(/ /g, "")))
}
