import { Star } from "lucide-react"

const RATING_ICON_FILES: Record<string, string> = {
  imdb: "/rating/imdb.svg",
  tmdb: "/rating/tmdb.svg",
  mdblist: "/rating/mdblist.svg",
  tomatoes: "/rating/tomatoes.svg",
  popcorntime: "/rating/popcorntime.svg",
  letterboxd: "/rating/letterboxd.svg",
  metacritic: "/rating/metacritic.svg",
  metacriticuser: "/rating/metacritic.svg",
  trakt: "/rating/trakt.svg",
  simkl: "/rating/simkl.svg",
  tvdb: "/rating/tvdb.svg",
  fanart: "/rating/art.svg",
  mal: "/rating/mal.svg",
  anilist: "/rating/anilist.svg",
  kitsu: "/rating/kitsu.svg",
  filmweb: "/rating/filmweb.svg",
  filmwebcritics: "/rating/filmweb.svg",
  rogerebert: "/rating/rogerebert.svg",
  tvmaze: "/rating/tvmaze.svg",
}

export function RatingSourceIcon({ id, className = "w-3 h-3" }: { id: string; className?: string }) {
  const iconPath = RATING_ICON_FILES[id]
  if (iconPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconPath}
        alt={id}
        className={`${className} object-contain inline-block shrink-0`}
        loading="lazy"
        draggable={false}
      />
    )
  }

  return <Star className={className} />
}
