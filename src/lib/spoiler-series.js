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
