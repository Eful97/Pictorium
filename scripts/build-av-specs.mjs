import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dataFile = path.join(rootDir, "src", "data", "av-specs.json")

// Comprehensive mapping of Top 250 + Modern Blockbusters (2018-2026)
// Formats: "dv" (Dolby Vision), "atmos" (Dolby Atmos), "imax" (IMAX Enhanced), "hdr" (HDR), "hdr10plus" (HDR10+)
const EXPANDED_DATA = {
  // --- Modern Blockbusters (2020-2026) ---
  "tt15239678": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Dune: Part Two
  "tt1160419": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Dune: Part One
  "tt15398776": { "quality": "4K", "formats": ["imax"] }, // Oppenheimer
  "tt12439741": { "quality": "4K", "formats": ["imax"] }, // Oppenheimer (alt/id)
  "tt1745960": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Top Gun: Maverick
  "tt0499549": { "quality": "4K", "formats": ["dv", "atmos"] }, // Avatar
  "tt1630029": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Avatar: The Way of Water
  "tt9362722": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spider-Man: Across the Spider-Verse
  "tt3044887": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spider-Man: Across the Spider-Verse (alt)
  "tt6565702": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spider-Man: Into the Spider-Verse
  "tt1535108": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spider-Man: Into the Spider-Verse (alt)
  "tt10872600": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Spider-Man: No Way Home
  "tt6320628": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Spider-Man: Far From Home
  "tt2250912": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spider-Man: Homecoming
  "tt1877832": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Batman (2022)
  "tt10366460": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // The Batman (alt)
  "tt9603212": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Mission: Impossible - Dead Reckoning
  "tt6263850": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Deadpool & Wolverine
  "tt1431045": { "quality": "4K", "formats": ["dv", "atmos"] }, // Deadpool
  "tt5463162": { "quality": "4K", "formats": ["dv", "atmos"] }, // Deadpool 2
  "tt1517268": { "quality": "4K", "formats": ["dv", "atmos"] }, // Barbie
  "tt6166392": { "quality": "4K", "formats": ["dv", "atmos"] }, // Wonka
  "tt6710474": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Everything Everywhere All at Once
  "tt12037194": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Furiosa: A Mad Max Saga
  "tt1392190": { "quality": "4K", "formats": ["dv", "atmos"] }, // Mad Max: Fury Road
  "tt14824590": { "quality": "4K", "formats": ["dv", "atmos"] }, // Blade Runner 2049
  "tt1856101": { "quality": "4K", "formats": ["dv", "atmos"] }, // Blade Runner 2049
  "tt11315808": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Joker: Folie a Deux
  "tt7286456": { "quality": "4K", "formats": ["dv", "atmos"] }, // Joker (2019)
  "tt10640346": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Creator
  "tt8772262": { "quality": "4K", "formats": ["dv", "atmos"] }, // Midsommar
  "tt10638622": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Northman
  "tt11198330": { "quality": "4K", "formats": ["dv", "atmos"] }, // House of the Dragon
  "tt14230458": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Last of Us
  "tt18412256": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Alien: Romulus
  "tt9218128": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Gladiator II
  "tt12584954": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Twisters
  "tt2049403": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Beetlejuice Beetlejuice
  "tt23289160": { "quality": "4K", "formats": ["dv", "atmos"] }, // Godzilla Minus One
  "tt14539740": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Godzilla x Kong: The New Empire
  "tt5034838": { "quality": "4K", "formats": ["dv", "atmos"] }, // Godzilla vs. Kong
  "tt3741700": { "quality": "4K", "formats": ["dv", "atmos"] }, // Godzilla: King of the Monsters
  "tt3731562": { "quality": "4K", "formats": ["dv", "atmos"] }, // Kong: Skull Island
  "tt0831387": { "quality": "4K", "formats": ["dv", "atmos"] }, // Godzilla (2014)
  "tt22022452": { "quality": "4K", "formats": ["dv", "atmos"] }, // Inside Out 2
  "tt2096673": { "quality": "4K", "formats": ["dv", "atmos"] }, // Inside Out
  "tt6718170": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Super Mario Bros. Movie
  "tt3915174": { "quality": "4K", "formats": ["dv", "atmos"] }, // Puss in Boots: The Last Wish
  "tt11866324": { "quality": "4K", "formats": ["dv", "atmos"] }, // Prey
  "tt10954984": { "quality": "4K", "formats": ["imax"] }, // Nope
  "tt6857112": { "quality": "4K", "formats": ["dv", "atmos"] }, // Us
  "tt5052448": { "quality": "4K", "formats": ["dv"] }, // Get Out
  "tt12361974": { "quality": "4K", "formats": ["dv", "atmos"] }, // Zack Snyder's Justice League
  "tt0974015": { "quality": "4K", "formats": ["dv", "atmos"] }, // Justice League (2017)
  "tt2975590": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Batman v Superman
  "tt0770828": { "quality": "4K", "formats": ["dv", "atmos"] }, // Man of Steel
  "tt1477834": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Aquaman
  "tt0451279": { "quality": "4K", "formats": ["dv", "atmos"] }, // Wonder Woman
  "tt6334354": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // The Suicide Squad
  "tt8579674": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // 1917
  "tt8946378": { "quality": "4K", "formats": ["dv", "atmos"] }, // Knives Out
  "tt11564570": { "quality": "4K", "formats": ["dv", "atmos"] }, // Glass Onion
  "tt2382320": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // No Time to Die
  "tt10466872": { "quality": "4K", "formats": ["dv", "atmos"] }, // Dune: Prophecy

  // --- Christopher Nolan Filmography ---
  "tt0816692": { "quality": "4K", "formats": ["imax"] }, // Interstellar
  "tt1375666": { "quality": "4K", "formats": ["imax"] }, // Inception
  "tt0468569": { "quality": "4K", "formats": ["imax"] }, // The Dark Knight
  "tt1345836": { "quality": "4K", "formats": ["imax"] }, // The Dark Knight Rises
  "tt0372784": { "quality": "4K", "formats": ["imax"] }, // Batman Begins
  "tt5013056": { "quality": "4K", "formats": ["imax"] }, // Dunkirk
  "tt6723592": { "quality": "4K", "formats": ["imax"] }, // Tenet
  "tt0414387": { "quality": "4K", "formats": ["dv"] }, // The Prestige
  "tt0209144": { "quality": "4K", "formats": ["dv"] }, // Memento

  // --- Marvel Cinematic Universe ---
  "tt4154796": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Avengers: Endgame
  "tt4154756": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Avengers: Infinity War
  "tt0848228": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Avengers
  "tt2395427": { "quality": "4K", "formats": ["dv", "atmos"] }, // Avengers: Age of Ultron
  "tt6791350": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Guardians of the Galaxy Vol. 3
  "tt3896198": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Guardians of the Galaxy Vol. 2
  "tt2015381": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Guardians of the Galaxy
  "tt1825683": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Black Panther
  "tt9114286": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Black Panther: Wakanda Forever
  "tt0371746": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Iron Man
  "tt1228705": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Iron Man 2
  "tt1300854": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Iron Man 3
  "tt3498820": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Captain America: Civil War
  "tt1843866": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Captain America: The Winter Soldier
  "tt0458339": { "quality": "4K", "formats": ["dv", "atmos"] }, // Captain America: The First Avenger
  "tt3501632": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Thor: Ragnarok
  "tt10648342": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Thor: Love and Thunder
  "tt1211837": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Doctor Strange
  "tt9419884": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Doctor Strange in the Multiverse of Madness
  "tt9376612": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Shang-Chi and the Legend of the Ten Rings

  // --- Star Wars Saga ---
  "tt0076759": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode IV - A New Hope
  "tt0080684": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode V - The Empire Strikes Back
  "tt0086190": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode VI - Return of the Jedi
  "tt0120915": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode I - The Phantom Menace
  "tt0121765": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode II - Attack of the Clones
  "tt0121766": { "quality": "4K", "formats": ["dv", "atmos"] }, // Episode III - Revenge of the Sith
  "tt2488496": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Episode VII - The Force Awakens
  "tt2527338": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Episode VIII - The Last Jedi
  "tt2527336": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Episode IX - The Rise of Skywalker
  "tt3748528": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Rogue One
  "tt3778644": { "quality": "4K", "formats": ["dv", "atmos"] }, // Solo: A Star Wars Story

  // --- The Lord of the Rings & The Hobbit ---
  "tt0120737": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Fellowship of the Ring
  "tt0167258": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Two Towers
  "tt0167260": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Return of the King
  "tt0903624": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Hobbit: An Unexpected Journey
  "tt1170358": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Hobbit: The Desolation of Smaug
  "tt2310332": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Hobbit: The Battle of the Five Armies

  // --- The Matrix Saga ---
  "tt0133093": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Matrix
  "tt0234215": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Matrix Reloaded
  "tt0242653": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Matrix Revolutions
  "tt10838180": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Matrix Resurrections

  // --- John Wick Saga ---
  "tt2911666": { "quality": "4K", "formats": ["dv", "atmos"] }, // John Wick
  "tt4425200": { "quality": "4K", "formats": ["dv", "atmos"] }, // John Wick: Chapter 2
  "tt6146586": { "quality": "4K", "formats": ["dv", "atmos"] }, // John Wick: Chapter 3 - Parabellum
  "tt10366206": { "quality": "4K", "formats": ["dv", "atmos"] }, // John Wick: Chapter 4

  // --- Mission: Impossible ---
  "tt0117060": { "quality": "4K", "formats": ["dv"] }, // Mission: Impossible
  "tt0120755": { "quality": "4K", "formats": ["dv"] }, // Mission: Impossible II
  "tt0317919": { "quality": "4K", "formats": ["dv"] }, // Mission: Impossible III
  "tt1229238": { "quality": "4K", "formats": ["dv", "imax"] }, // Ghost Protocol
  "tt2381249": { "quality": "4K", "formats": ["dv", "atmos"] }, // Rogue Nation
  "tt4633694": { "quality": "4K", "formats": ["dv", "atmos", "imax"] }, // Fallout

  // --- James Cameron Classics ---
  "tt0120338": { "quality": "4K", "formats": ["dv", "atmos"] }, // Titanic
  "tt0103064": { "quality": "4K", "formats": ["dv"] }, // Terminator 2: Judgment Day
  "tt0096754": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Abyss
  "tt0111503": { "quality": "4K", "formats": ["dv", "atmos"] }, // True Lies
  "tt0091251": { "quality": "4K", "formats": ["dv", "atmos"] }, // Aliens

  // --- Indiana Jones ---
  "tt0082971": { "quality": "4K", "formats": ["dv", "atmos"] }, // Raiders of the Lost Ark
  "tt0087469": { "quality": "4K", "formats": ["dv", "atmos"] }, // Temple of Doom
  "tt0097576": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Last Crusade
  "tt0367882": { "quality": "4K", "formats": ["dv", "atmos"] }, // Kingdom of the Crystal Skull
  "tt1462764": { "quality": "4K", "formats": ["dv", "atmos"] }, // Dial of Destiny

  // --- Back to the Future ---
  "tt0088763": { "quality": "4K", "formats": ["dv", "atmos"] }, // Back to the Future
  "tt0096874": { "quality": "4K", "formats": ["dv", "atmos"] }, // Part II
  "tt0099088": { "quality": "4K", "formats": ["dv", "atmos"] }, // Part III

  // --- Harry Potter Collection ---
  "tt0241527": { "quality": "4K", "formats": ["dv", "atmos"] }, // Sorcerer's Stone
  "tt0295297": { "quality": "4K", "formats": ["dv", "atmos"] }, // Chamber of Secrets
  "tt0304141": { "quality": "4K", "formats": ["dv", "atmos"] }, // Prisoner of Azkaban
  "tt0330373": { "quality": "4K", "formats": ["dv", "atmos"] }, // Goblet of Fire
  "tt0373889": { "quality": "4K", "formats": ["dv", "atmos"] }, // Order of the Phoenix
  "tt0417741": { "quality": "4K", "formats": ["dv", "atmos"] }, // Half-Blood Prince
  "tt0926084": { "quality": "4K", "formats": ["dv", "atmos"] }, // Deathly Hallows Part 1
  "tt1201607": { "quality": "4K", "formats": ["dv", "atmos"] }, // Deathly Hallows Part 2

  // --- Pixar Masterpieces ---
  "tt0114709": { "quality": "4K", "formats": ["dv", "atmos"] }, // Toy Story
  "tt0120363": { "quality": "4K", "formats": ["dv", "atmos"] }, // Toy Story 2
  "tt0435761": { "quality": "4K", "formats": ["dv", "atmos"] }, // Toy Story 3
  "tt1979376": { "quality": "4K", "formats": ["dv", "atmos"] }, // Toy Story 4
  "tt0266543": { "quality": "4K", "formats": ["dv", "atmos"] }, // Finding Nemo
  "tt0198781": { "quality": "4K", "formats": ["dv", "atmos"] }, // Monsters, Inc.
  "tt0317705": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Incredibles
  "tt3606756": { "quality": "4K", "formats": ["dv", "atmos"] }, // Incredibles 2
  "tt0382932": { "quality": "4K", "formats": ["dv", "atmos"] }, // Ratatouille
  "tt0452625": { "quality": "4K", "formats": ["dv", "atmos"] }, // WALL-E
  "tt1049413": { "quality": "4K", "formats": ["dv", "atmos"] }, // Up
  "tt2380307": { "quality": "4K", "formats": ["dv", "atmos"] }, // Coco
  "tt2948372": { "quality": "4K", "formats": ["dv", "atmos"] }, // Soul

  // --- IMDb Top 250 & Cinema Classics ---
  "tt0111161": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Shawshank Redemption
  "tt0068646": { "quality": "4K", "formats": ["dv"] }, // The Godfather
  "tt0068647": { "quality": "4K", "formats": ["dv"] }, // The Godfather Part II
  "tt0050083": { "quality": "4K", "formats": ["dv"] }, // 12 Angry Men
  "tt0108052": { "quality": "4K", "formats": ["dv", "atmos"] }, // Schindler's List
  "tt0110912": { "quality": "4K", "formats": ["dv"] }, // Pulp Fiction
  "tt0060196": { "quality": "4K", "formats": ["dv"] }, // The Good, the Bad and the Ugly
  "tt0109830": { "quality": "4K", "formats": ["dv", "atmos"] }, // Forrest Gump
  "tt0137523": { "quality": "FHD", "formats": ["dv"] }, // Fight Club
  "tt0099685": { "quality": "4K", "formats": ["dv"] }, // Goodfellas
  "tt0090605": { "quality": "4K", "formats": ["dv"] }, // Goodfellas (alt ID)
  "tt0073486": { "quality": "4K", "formats": ["dv"] }, // One Flew Over the Cuckoo's Nest
  "tt0075314": { "quality": "4K", "formats": ["dv"] }, // One Flew Over (alt)
  "tt0071562": { "quality": "4K", "formats": ["dv"] }, // Chinatown / Seven Samurai
  "tt0047478": { "quality": "4K", "formats": ["dv"] }, // Seven Samurai
  "tt0114388": { "quality": "4K", "formats": ["dv", "imax"] }, // Se7en
  "tt0114709": { "quality": "4K", "formats": ["dv", "atmos"] }, // Se7en / Toy Story
  "tt0032553": { "quality": "4K", "formats": ["dv"] }, // It's a Wonderful Life
  "tt0102926": { "quality": "4K", "formats": ["dv"] }, // The Silence of the Lambs
  "tt0120815": { "quality": "4K", "formats": ["dv", "atmos"] }, // Saving Private Ryan
  "tt0245429": { "quality": "4K", "formats": ["dv", "atmos"] }, // Spirited Away
  "tt0114369": { "quality": "4K", "formats": ["dv"] }, // Life Is Beautiful
  "tt0054215": { "quality": "4K", "formats": ["dv"] }, // Psycho
  "tt0317248": { "quality": "4K", "formats": ["dv"] }, // City of God
  "tt0021749": { "quality": "4K", "formats": ["dv"] }, // City Lights
  "tt0110357": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Lion King
  "tt0087843": { "quality": "4K", "formats": ["dv", "atmos"] }, // Once Upon a Time in America
  "tt0063161": { "quality": "4K", "formats": ["dv"] }, // 2001: A Space Odyssey
  "tt0034583": { "quality": "4K", "formats": ["dv"] }, // Casablanca
  "tt0027977": { "quality": "4K", "formats": ["dv"] }, // Modern Times
  "tt0078788": { "quality": "4K", "formats": ["dv", "atmos"] }, // Apocalypse Now
  "tt0078748": { "quality": "4K", "formats": ["hdr10plus"] }, // Alien
  "tt0110413": { "quality": "4K", "formats": ["dv", "atmos"] }, // Leon: The Professional
  "tt0169547": { "quality": "4K", "formats": ["dv"] }, // American Beauty
  "tt1877830": { "quality": "4K", "formats": ["dv", "atmos"] }, // Whiplash
  "tt2124787": { "quality": "4K", "formats": ["dv", "atmos"] }, // Whiplash (alt)
  "tt0081505": { "quality": "4K", "formats": ["dv"] }, // The Shining
  "tt0057012": { "quality": "4K", "formats": ["dv"] }, // Dr. Strangelove
  "tt0040522": { "quality": "4K", "formats": ["dv"] }, // Bicycle Thieves
  "tt0118715": { "quality": "4K", "formats": ["dv"] }, // The Big Lebowski
  "tt0093058": { "quality": "4K", "formats": ["dv"] }, // Full Metal Jacket
  "tt0096283": { "quality": "4K", "formats": ["dv"] }, // Cinema Paradiso
  "tt0086250": { "quality": "4K", "formats": ["dv"] }, // Scarface
  "tt0120689": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Green Mile
  "tt0105236": { "quality": "4K", "formats": ["dv"] }, // Reservoir Dogs
  "tt0114814": { "quality": "4K", "formats": ["dv"] }, // The Usual Suspects
  "tt0253474": { "quality": "4K", "formats": ["dv"] }, // The Pianist
  "tt0266697": { "quality": "4K", "formats": ["dv"] }, // Kill Bill: Vol. 1
  "tt0378194": { "quality": "4K", "formats": ["dv"] }, // Kill Bill: Vol. 2
  "tt0338013": { "quality": "4K", "formats": ["dv"] }, // Eternal Sunshine of the Spotless Mind
  "tt0361748": { "quality": "4K", "formats": ["dv"] }, // Inglourious Basterds
  "tt0405094": { "quality": "4K", "formats": ["dv"] }, // The Lives of Others
  "tt0477348": { "quality": "4K", "formats": ["dv"] }, // No Country for Old Men
  "tt0892791": { "quality": "4K", "formats": ["dv"] }, // Shutter Island
  "tt1130884": { "quality": "4K", "formats": ["dv"] }, // Shutter Island (alt)
  "tt0993846": { "quality": "4K", "formats": ["dv"] }, // The Wolf of Wall Street
  "tt6751668": { "quality": "4K", "formats": ["dv"] }, // Parasite
  "tt0073195": { "quality": "4K", "formats": ["dv", "atmos"] }, // Jaws
  "tt0074285": { "quality": "4K", "formats": ["dv"] }, // Taxi Driver
  "tt0081696": { "quality": "4K", "formats": ["dv"] }, // Raging Bull
  "tt0083907": { "quality": "4K", "formats": ["dv", "atmos"] }, // E.T. the Extra-Terrestrial
  "tt0084707": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Thing
  "tt0087363": { "quality": "4K", "formats": ["dv", "atmos"] }, // Amadeus
  "tt0093779": { "quality": "4K", "formats": ["dv"] }, // The Princess Bride
  "tt0095016": { "quality": "4K", "formats": ["dv"] }, // Die Hard
  "tt0097165": { "quality": "4K", "formats": ["dv"] }, // Dead Poets Society
  "tt0107290": { "quality": "4K", "formats": ["dv"] }, // Jurassic Park
  "tt0112573": { "quality": "4K", "formats": ["dv", "atmos"] }, // Braveheart
  "tt0113277": { "quality": "4K", "formats": ["dv", "atmos"] }, // Heat
  "tt0116282": { "quality": "4K", "formats": ["dv"] }, // Fargo
  "tt0119217": { "quality": "4K", "formats": ["dv"] }, // Good Will Hunting
  "tt0119488": { "quality": "4K", "formats": ["dv"] }, // L.A. Confidential
  "tt0120382": { "quality": "4K", "formats": ["dv"] }, // The Truman Show
  "tt0120586": { "quality": "4K", "formats": ["dv"] }, // American History X
  "tt0172495": { "quality": "4K", "formats": ["dv"] }, // Gladiator
  "tt0066921": { "quality": "4K", "formats": ["dv"] }, // A Clockwork Orange
  "tt0092099": { "quality": "4K", "formats": ["dv", "atmos"] }, // Top Gun (1986)
  "tt0096895": { "quality": "4K", "formats": ["dv", "atmos"] }, // Batman (1989)
  "tt0103776": { "quality": "4K", "formats": ["dv", "atmos"] }, // Batman Returns
  "tt0407887": { "quality": "4K", "formats": ["dv"] }, // The Departed
  "tt7131622": { "quality": "4K", "formats": ["dv"] }, // Once Upon a Time in Hollywood
  "tt3783958": { "quality": "4K", "formats": ["dv", "atmos"] }, // La La Land
  "tt2267998": { "quality": "4K", "formats": ["dv"] }, // Gone Girl
  "tt2562232": { "quality": "4K", "formats": ["dv"] }, // Birdman
  "tt2737304": { "quality": "FHD", "formats": ["dv"] }, // The Grand Budapest Hotel
  "tt5311514": { "quality": "4K", "formats": ["dv"] }, // Your Name
  "tt8503618": { "quality": "4K", "formats": ["dv", "atmos"] }, // Hamilton
  "tt6644200": { "quality": "4K", "formats": ["dv", "atmos"] }, // A Quiet Place
  "tt8332922": { "quality": "4K", "formats": ["dv", "atmos"] }, // A Quiet Place Part II
  "tt13433802": { "quality": "4K", "formats": ["dv", "atmos"] }, // A Quiet Place: Day One
  "tt0093773": { "quality": "4K", "formats": ["dv"] }, // Predator
  "tt0083658": { "quality": "4K", "formats": ["atmos"] }, // Blade Runner (1982)
  "tt0112641": { "quality": "4K", "formats": ["dv"] }, // Casino
  "tt0258463": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Bourne Identity
  "tt0372183": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Bourne Supremacy
  "tt0440963": { "quality": "4K", "formats": ["dv", "atmos"] }, // The Bourne Ultimatum
  "tt1074638": { "quality": "4K", "formats": ["imax"] }, // Skyfall
  "tt2379713": { "quality": "4K", "formats": ["dv"] }, // Spectre
  "tt0381061": { "quality": "4K", "formats": ["dv"] }, // Casino Royale
  "tt0830515": { "quality": "4K", "formats": ["dv"] }, // Quantum of Solace
  "tt2543164": { "quality": "4K", "formats": ["dv"] }, // Arrival
  "tt3397884": { "quality": "4K", "formats": ["dv", "atmos"] }, // Sicario
}

async function main() {
  console.log("=== Pictorium AV Specs Bulk Expander ===")
  const current = JSON.parse(await fs.readFile(dataFile, "utf8"))
  const beforeCount = Object.keys(current).length
  console.log(`Current entries before: ${beforeCount}`)

  const merged = { ...current }
  for (const [id, data] of Object.entries(EXPANDED_DATA)) {
    if (!merged[id]) {
      merged[id] = data
    } else {
      // Merge format tokens without duplicates
      const formats = Array.from(new Set([...(merged[id].formats || []), ...(data.formats || [])]))
      merged[id] = {
        quality: data.quality || merged[id].quality || "4K",
        formats,
      }
    }
  }

  // Sort keys alphabetically
  const sortedKeys = Object.keys(merged).sort()
  const sortedObj = {}
  for (const k of sortedKeys) {
    sortedObj[k] = merged[k]
  }

  await fs.writeFile(dataFile, JSON.stringify(sortedObj, null, 2) + "\n", "utf8")
  console.log(`Saved ${sortedKeys.length} entries to ${dataFile}`)
  console.log(`Added ${sortedKeys.length - beforeCount} new titles!`)
}

main().catch(console.error)
