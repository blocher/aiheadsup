const GENERIC_CATEGORY_THEMES = {
  'Harry Potter': 'a whimsical magical boarding-school adventure with enchanted castles, spell books, glowing candles, owls, potion bottles, and cozy fantasy landscapes',
  'Star Wars': 'a family-friendly galactic adventure with space explorers, imaginative spacecraft, alien worlds, and dramatic cosmic landscapes',
  'Indiana Jones': 'an original archaeological adventure with ancient ruins, desert trails, treasure maps, rope bridges, and exploration gear',
  'Movies': 'classic cinema motifs such as film reels, theater masks, popcorn, spotlights, velvet curtains, and playful movie-night energy',
  'TV Shows': 'television-inspired motifs such as a cozy living-room screen glow, retro dials, antennas, popcorn, and colorful broadcast shapes',
  'Music': 'musical motifs such as instruments, sound waves, stage lights, vinyl records, and rhythmic abstract shapes',
  'Kids': 'playful childhood motifs such as toys, crayons, blocks, balloons, playgrounds, and bright cheerful shapes',
  'Sports': 'energetic sports motifs such as balls, fields, courts, stadium lights, team colors, and action-filled abstract motion',
  'Pittsburgh Sports': 'regional sports pride with stadium lights, rivers, bridges, black-and-gold accents, and energetic game-day shapes',
  'Games': 'game-night motifs such as dice, cards, controllers, boards, tokens, and playful tabletop energy',
  'Food': 'delicious food motifs such as ingredients, plates, utensils, steam, and colorful mealtime shapes',
  'Cities': 'city-life motifs such as skylines, landmarks, streets, transit, rivers, and neighborhood landmarks in an original stylized way',
  'Colleges and Universities': 'campus-life motifs such as libraries, quads, bells, autumn trees, school banners, and academic charm',
  'Western PA Themeparks': 'amusement-park motifs such as roller coasters, ferris wheels, carousel lights, funnel cake stands, and summer fun',
  'Science': 'science motifs such as planets, microscopes, beakers, atoms, dinosaurs, weather, and discovery-filled landscapes',
  'Religion and Mythology': 'reverent historical and mythic motifs such as ancient temples, stained glass, scrolls, columns, and symbolic landscapes',
  'History': 'historical motifs such as maps, monuments, documents, timelines, artifacts, and educational adventure scenes'
}

const COPYRIGHT_ERROR_PATTERN = /copyright|intellectual property|trademark|branded|likeness|policy|blocked|prohibited|safety|owned|franchise|brand|celebrity|actor|studio|permission|infring/i

export function isCopyrightRelatedImageError(error) {
  return COPYRIGHT_ERROR_PATTERN.test(String(error?.message || error || ''))
}

function audienceLabel(audience) {
  return audience || 'Family'
}

function difficultyLabel(difficulty) {
  return difficulty || 'Medium'
}

function sharedCoverRules({ originalityRule = '' } = {}) {
  return `Make it bold, joyful, high-contrast, and readable at small tile size. Use a full-bleed composition that fills the entire image edge to edge. Do not include text, lettering, logos, watermarks, banners, title areas, frames, or empty space at the top. ${originalityRule}No copyrighted characters, actor likenesses, branded symbols, franchise logos, or recognizable story-specific people, costumes, vehicles, or locations.`
}

const DEVICE_COVER_KEYWORDS = {
  'Harry Potter': 'a magical castle, spell books, glowing candles, and owls',
  'Star Wars': 'space explorers, starships, and a colorful alien world',
  'Indiana Jones': 'ancient ruins, treasure maps, and desert adventure gear',
  Movies: 'film reels, popcorn, theater masks, and spotlights',
  'TV Shows': 'a glowing retro television, antennas, and popcorn',
  Music: 'instruments, sound waves, vinyl records, and stage lights',
  Kids: 'toys, crayons, blocks, balloons, and cheerful shapes',
  Sports: 'balls, fields, stadium lights, and action motion',
  'Pittsburgh Sports': 'stadium lights, rivers, bridges, and black-and-gold accents',
  Games: 'dice, cards, game controllers, and tabletop tokens',
  Food: 'colorful ingredients, plates, utensils, and steam',
  Cities: 'a stylized skyline, landmarks, and city streets',
  'Colleges and Universities': 'a library, campus quad, banners, and autumn trees',
  'Western PA Themeparks': 'roller coasters, a ferris wheel, and carnival lights',
  Science: 'planets, beakers, atoms, and a microscope',
  'Religion and Mythology': 'ancient temples, stained glass, scrolls, and columns',
  History: 'old maps, monuments, documents, and artifacts',
  Nonsense: 'silly abstract shapes, squiggles, and confetti'
}

// Image Playground (ImageCreator) works from short concept phrases, not long
// instruction paragraphs. Keep this concise and free of franchise names,
// people, or negative constraints — long prompts and named IP cause failures.
export function deviceCoverConcept({ category, name } = {}) {
  const keywords = DEVICE_COVER_KEYWORDS[category]
    || `a fun ${String(name || category || 'party game').toLowerCase()} theme`
  return `A bright, playful, colorful illustration of ${keywords}`
}

export function genericCoverPrompt({ category, audience, difficulty }) {
  const theme = GENERIC_CATEGORY_THEMES[category]
    || `the general mood and ideas associated with ${String(category || 'party games').toLowerCase()}`
  return `Create an original vertical 4:5 illustrated party-game deck cover inspired by ${theme}. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}. ${sharedCoverRules({ originalityRule: 'Use only original, generic visuals that suggest the category without referencing any specific copyrighted work. ' })}`
}

const PROTECTED_DECK_NAME_THEMES = [
  {
    match: /mickey mouse|clubhouse/i,
    theme: 'a cheerful cartoon clubhouse adventure with friendly original cartoon animal pals, a bright playful clubhouse, whimsical helper gadgets, and cheerful primary-colored shapes',
    extra: 'with no recognizable franchise-specific characters, mascots, ears, symbols, logos, or story elements'
  }
]

function protectedDeckNamePrompt({ name, audience, difficulty }) {
  const matched = PROTECTED_DECK_NAME_THEMES.find((entry) => entry.match.test(String(name || '')))
  if (!matched) return null
  return `Create an original vertical 4:5 illustrated party-game deck cover themed around ${matched.theme}. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}. Show this scene ${matched.extra}. ${sharedCoverRules()}`
}

export function coverPromptForDeck({ name, category, audience, difficulty, specialInstructions, generic = false }) {
  if (generic) return genericCoverPrompt({ category, audience, difficulty })

  const protectedByName = protectedDeckNamePrompt({ name, audience, difficulty })
  if (protectedByName) return protectedByName

  if (category === 'Star Wars') {
    return `Create an original vertical 4:5 illustrated party-game deck cover themed around a family-friendly galactic adventure. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}. Show an original ensemble of space explorers, a lively alien world, imaginative spacecraft, and a dramatic cosmic landscape, with no recognizable franchise-specific people, costumes, vehicles, symbols, locations, or story elements. ${sharedCoverRules()}`
  }

  if (category === 'Harry Potter') {
    return `Create an original vertical 4:5 illustrated party-game deck cover themed around a whimsical magical boarding-school adventure. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}. Show enchanted castles, spell books, glowing candles, owls, potion bottles, and cozy fantasy landscapes with no recognizable franchise-specific people, costumes, symbols, locations, or story elements. ${sharedCoverRules()}`
  }

  if (category === 'Indiana Jones') {
    return `Create an original vertical 4:5 illustrated party-game deck cover themed around a family-friendly archaeological adventure. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}. Show ancient ruins, desert trails, treasure maps, rope bridges, and exploration gear with no recognizable franchise-specific people, costumes, symbols, locations, or story elements. ${sharedCoverRules()}`
  }

  const subject = `"${name || category}" in the "${category}" category`
  const detail = specialInstructions ? ` Reflect these deck details in original, non-branded terms: ${specialInstructions}` : ' Use the deck name and category as inspiration only through generic visual motifs.'
  return `Create an original vertical 4:5 illustrated party-game deck cover for ${subject}. Audience: ${audienceLabel(audience)}. Difficulty: ${difficultyLabel(difficulty)}.${detail} ${sharedCoverRules()}`
}

export async function generateCoverWithFallback({ getPromptInput, requestImage, maxAttempts = 4, onRetry }) {
  let useGeneric = false
  let lastError = new Error('Cover generation failed.')

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = coverPromptForDeck({ ...getPromptInput(), generic: useGeneric })
    try {
      return await requestImage(prompt)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (!useGeneric && isCopyrightRelatedImageError(lastError)) {
        useGeneric = true
        onRetry?.({ attempt: attempt + 1, generic: true, error: lastError })
        continue
      }
      if (attempt < maxAttempts - 1) {
        onRetry?.({ attempt: attempt + 1, generic: useGeneric, error: lastError })
        continue
      }
    }
  }

  throw lastError
}
