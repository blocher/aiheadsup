export const spoilerSeries = {
  harry_potter: {
    label: 'Harry Potter',
    defaultLimit: 7,
    installments: [
      'Book 1 — Sorcerer’s Stone',
      'Book 2 — Chamber of Secrets',
      'Book 3 — Prisoner of Azkaban',
      'Book 4 — Goblet of Fire',
      'Book 5 — Order of the Phoenix',
      'Book 6 — Half-Blood Prince',
      'Book 7 — Deathly Hallows',
      'Book 8 — Cursed Child / all stories'
    ]
  },
  indiana_jones: {
    label: 'Indiana Jones',
    defaultLimit: 5,
    installments: [
      'Movie 1 — Raiders of the Lost Ark',
      'Movie 2 — Temple of Doom',
      'Movie 3 — Last Crusade',
      'Movie 4 — Kingdom of the Crystal Skull',
      'Movie 5 — Dial of Destiny'
    ]
  },
  star_wars: {
    label: 'Star Wars',
    defaultLimit: 13,
    installments: [
      'Release 1 — Episode IV: A New Hope',
      'Release 2 — Episode V: The Empire Strikes Back',
      'Release 3 — Episode VI: Return of the Jedi',
      'Release 4 — Episode I: The Phantom Menace',
      'Release 5 — Episode II: Attack of the Clones',
      'Release 6 — Episode III: Revenge of the Sith',
      'Release 7 — Episode VII: The Force Awakens',
      'Release 8 — Rogue One',
      'Release 9 — Episode VIII: The Last Jedi',
      'Release 10 — Solo',
      'Release 11 — Episode IX: The Rise of Skywalker',
      'Release 12 — The Mandalorian',
      'Release 13 — General lore / all included stories'
    ]
  },
  jurassic_park: {
    label: 'Jurassic Park',
    defaultLimit: 7,
    installments: [
      'Movie 1 — Jurassic Park',
      'Movie 2 — The Lost World: Jurassic Park',
      'Movie 3 — Jurassic Park III',
      'Movie 4 — Jurassic World',
      'Movie 5 — Jurassic World: Fallen Kingdom',
      'Movie 6 — Jurassic World Dominion',
      'Movie 7 — Jurassic World Rebirth'
    ]
  },
  lord_of_the_rings: {
    label: 'Lord of the Rings',
    defaultLimit: 4,
    installments: [
      'Book 1 — The Hobbit',
      'Book 2 — The Fellowship of the Ring',
      'Book 3 — The Two Towers',
      'Book 4 — The Return of the King'
    ]
  },
  a_series_of_unfortunate_events: {
    label: 'A Series of Unfortunate Events',
    defaultLimit: 13,
    installments: [
      'Book 1 — The Bad Beginning',
      'Book 2 — The Reptile Room',
      'Book 3 — The Wide Window',
      'Book 4 — The Miserable Mill',
      'Book 5 — The Austere Academy',
      'Book 6 — The Ersatz Elevator',
      'Book 7 — The Vile Village',
      'Book 8 — The Hostile Hospital',
      'Book 9 — The Carnivorous Carnival',
      'Book 10 — The Slippery Slope',
      'Book 11 — The Grim Grotto',
      'Book 12 — The Penultimate Peril',
      'Book 13 — The End'
    ]
  }
}

export const spoilerSeriesOptions = Object.entries(spoilerSeries).map(([id, series]) => ({ id, ...series }))

export function getSpoilerSeries(id) { return spoilerSeries[id] || null }

export function defaultSpoilerLimits() {
  return Object.fromEntries(spoilerSeriesOptions.map(({ id, defaultLimit }) => [id, defaultLimit]))
}

export function spoilerLimitFor(pack, limits = defaultSpoilerLimits()) {
  const seriesId = pack?.spoilerSeries || (pack?.spoilerMode ? 'harry_potter' : null)
  const series = getSpoilerSeries(seriesId)
  return Number(limits?.[seriesId]) || series?.defaultLimit || Infinity
}

export function spoilerProgressLabel(pack, limits) {
  const seriesId = pack?.spoilerSeries || (pack?.spoilerMode ? 'harry_potter' : null)
  const series = getSpoilerSeries(seriesId)
  const limit = spoilerLimitFor(pack, limits)
  return series?.installments[limit - 1] || 'all included stories'
}
