/** Fixture condivise per i test Top 250 (nessun test qui dentro). */

export function chartIds250(start = 1000000): string[] {
  return Array.from({ length: 250 }, (_, i) => `tt${start + i}`)
}

export function nextDataHtml(ids: string[]): string {
  const edges = ids.map((id) => ({ node: { id } }))
  const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } })
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`
}
