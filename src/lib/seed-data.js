const bookTerms = {
  2: ['Ginny Weasley', 'Dobby', 'Fawkes', 'The Chamber of Secrets', 'The Hogwarts school song', 'The school ghosts', 'The sword of Gryffindor', 'The Slytherin common room', 'The Hufflepuff basement', 'Expelliarmus', 'Petrificus Totalus', 'Polyjuice Potion', 'Mandrake', 'A basilisk', 'A three-headed dog', 'A giant spider', 'Floo powder', 'Tom Riddle', 'A secret diary', 'The flying car', 'Professor Lockhart', 'Lucius Malfoy', 'A house-elf', 'A Cornish pixie', 'A magical fireplace'],
  3: ['Sirius Black', 'Remus Lupin', 'The Knight Bus', 'The Whomping Willow', 'The Divination classroom', 'Divination', 'Professor Trelawney', 'Care of Magical Creatures', 'Ancient Runes', 'Arithmancy', 'A hippogriff', 'A dementor', 'A boggart', 'A werewolf', 'A grindylow', 'Expecto Patronum', 'Riddikulus', 'The Firebolt', 'A time-turner', 'A marauder map', 'A howler', 'Wolfsbane Potion', 'Butterbeer', 'Hogsmeade', 'Honeydukes', 'Zonko joke shop', 'The Three Broomsticks', 'The Shrieking Shack', 'The Prisoner of Azkaban escape', 'Peter Pettigrew', 'The Fidelius Charm', 'A secret keeper', 'The Marauders', 'Moony', 'Wormtail', 'Padfoot', 'Prongs', 'The Dementor kiss'],
  4: ['Cedric Diggory', 'Fleur Delacour', 'Charlie Weasley', 'Cho Chang', 'Mad-Eye Moody', 'A dragon', 'A blast-ended skrewt', 'A merperson', 'Accio', 'Stupefy', 'A Pensieve', 'Veritaserum', 'Firewhisky', 'The prefects bathroom', 'The kitchens', 'The Quidditch pitch', 'The World Cup', 'The Triwizard Tournament', 'The Goblet of Fire', 'The first task', 'The dragon challenge', 'The Black Lake task', 'The maze task', 'The Yule Ball', 'The Bulgarian team', 'The Irish team', 'A portkey', 'The graveyard duel', 'A Death Eater', 'The Dark Mark', 'Avada Kedavra', 'Crucio', 'Imperio', 'A magical tournament', 'A magical radio', 'A Pensieve memory', 'Nagini', 'A dragon egg'],
  5: ['Luna Lovegood', 'Nymphadora Tonks', 'Aberforth Dumbledore', 'The Ravenclaw tower', 'The Room of Requirement', 'The Department of Mysteries', 'The Veil', 'The prophecy shelves', 'Thestral', 'A thestral', 'Dolores Umbridge', 'Professor Umbridge', 'The Order of the Phoenix', 'The Ministry battle', 'A prophecy', 'The prophecy reveal', 'The Headmaster office', 'The Quibbler', 'A secret follower', 'Bellatrix Lestrange', 'A bowtruckle', 'A niffler', 'A blood pact'],
  6: ['Horcrux', 'A Horcrux', 'The Half-Blood Prince', 'Professor Slughorn', 'Horace Slughorn', 'The cave journey', 'The tower betrayal', 'Felix Felicis', 'Amortentia', 'Sectumsempra', 'The Gaunt ring', 'The Locket of Slytherin', 'The Cup of Hufflepuff', 'The Diadem of Ravenclaw', 'The Hufflepuff cup', 'The Ravenclaw diadem', 'The secret prince', 'The hidden locket', 'The cursed necklace', 'A cursed object', 'A dangerous potion', 'Draco Malfoy', 'Fenrir Greyback', 'The Half-Blood Prince mystery', 'The forbidden memory', 'A soul fragment'],
  7: ['The Deathly Hallows', 'The Elder Wand', 'The Resurrection Stone', 'The Black family tapestry', 'The silver doe', 'The Gringotts escape', 'The dragon flight', 'The final duel', 'The Great Hall reunion', 'The epilogue', 'The last horcrux', 'The final victory', 'The seven Potters', 'The wedding attack', 'The visit to Godric Hollow', 'The Room of Requirement battle', 'The missing diadem', 'A vanishing cabinet', 'A cursed vault', 'A magical oath', 'The tale of three brothers', 'The kings cross vision']
}

function earliestBook(term) {
  for (const [book, terms] of Object.entries(bookTerms)) if (terms.includes(term)) return Number(book)
  return 1
}

function makeCards(packId, terms) {
  return terms
    .filter((term) => term.trim().split(/\s+/).length <= 4)
    .map((term) => ({
      id: `${packId}_${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      prompt: term,
      normalizedPrompt: term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      earliestBook: earliestBook(term),
      firstShownAt: null
    }))
}

const coverThemes = {
  heroes: ['#202b70', '#fcbd3f', '✦'], houses: ['#743f71', '#e85c80', '◆'], spells: ['#30246e', '#13b9c5', '✧'], creatures: ['#156363', '#a9db78', '☾'],
  classes: ['#2c4b77', '#eda55b', '◌'], quidditch: ['#a63d58', '#f1b63b', '◉'], life: ['#74405a', '#ed8060', '✦'], dark: ['#272246', '#a95791', '◈'], lore: ['#1e4666', '#b7d4e3', '△'], moments: ['#552a82', '#ff8a69', '✷']
}

function seedCover(id) {
  const [dark, bright, symbol] = coverThemes[id]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${bright}"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="630" cy="180" r="170" fill="#ffe877" opacity=".88"/><circle cx="110" cy="875" r="260" fill="#10152d" opacity=".25"/><path d="M120 710Q400 385 680 710" fill="none" stroke="#fff" stroke-width="24" opacity=".6"/><path d="M280 700l120-300 120 300z" fill="#10152d" opacity=".38"/><text x="400" y="510" text-anchor="middle" font-size="230" font-family="Arial, sans-serif" fill="white">${symbol}</text><circle cx="160" cy="170" r="11" fill="white"/><circle cx="224" cy="240" r="7" fill="white"/><circle cx="595" cy="520" r="8" fill="white"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const decks = [
  ['heroes', 'Wizarding Heroes & Friends', 'Easy', 'heroes-friends.png', [
    'Harry Potter', 'Hermione Granger', 'Ron Weasley', 'Ginny Weasley', 'Neville Longbottom', 'Luna Lovegood', 'Fred Weasley', 'George Weasley', 'Sirius Black', 'Remus Lupin', 'Rubeus Hagrid', 'Albus Dumbledore', 'Minerva McGonagall', 'Molly Weasley', 'Arthur Weasley', 'Bill Weasley', 'Charlie Weasley', 'Dobby', 'Hedwig', 'Fawkes', 'James Potter', 'Lily Potter', 'Nymphadora Tonks', 'Aberforth Dumbledore', 'Fleur Delacour', 'Cedric Diggory', 'Cho Chang', 'Dean Thomas', 'Seamus Finnigan', 'Lee Jordan', 'Angelina Johnson', 'Katie Bell', 'Oliver Wood', 'Colin Creevey', 'Lavender Brown'
  ]],
  ['houses', 'Hogwarts Houses & Students', 'Easy', 'houses-students.png', [
    'Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin', 'The Sorting Hat', 'The Gryffindor common room', 'The Slytherin common room', 'The Ravenclaw tower', 'The Hufflepuff basement', 'The House Cup', 'The Prefects', 'The Head Boy', 'The Head Girl', 'The first-year boat ride', 'The Great Hall', 'The House points hourglasses', 'The four House tables', 'The Hogwarts school song', 'The school uniform', 'The Hogwarts Express', 'Platform Nine and Three-Quarters', 'The welcome feast', 'The Sorting ceremony', 'The student dormitories', 'The Quidditch house teams', 'The Hogwarts library', 'The moving staircases', 'The school ghosts', 'Nearly Headless Nick', 'The Fat Lady', 'The Grey Lady', 'The Bloody Baron', 'The Hufflepuff cup', 'The Ravenclaw diadem', 'The Gryffindor sword'
  ]],
  ['spells', 'Spells, Potions & Magical Objects', 'Easy', 'spells-potions.png', [
    'Expelliarmus', 'Lumos', 'Nox', 'Wingardium Leviosa', 'Alohomora', 'Accio', 'Expecto Patronum', 'Stupefy', 'Protego', 'Petrificus Totalus', 'Riddikulus', 'Obliviate', 'Finite Incantatem', 'Reparo', 'Sectumsempra', 'Polyjuice Potion', 'Felix Felicis', 'Veritaserum', 'Amortentia', 'Wolfsbane Potion', 'Butterbeer', 'Firewhisky', 'A wand', 'A cauldron', 'A broomstick', 'A time-turner', 'A Pensieve', 'A remembrall', 'An invisibility cloak', 'A marauder map', 'A howler', 'A portkey', 'A chocolate frog', 'A spellbook', 'A magical quill'
  ]],
  ['creatures', 'Magical Creatures', 'Easy', 'magical-creatures.png', [
    'A hippogriff', 'A phoenix', 'A house-elf', 'A dragon', 'A unicorn', 'A centaur', 'A thestral', 'A niffler', 'A bowtruckle', 'A kneazle', 'An acromantula', 'A basilisk', 'A troll', 'A werewolf', 'A dementor', 'A boggart', 'A grindylow', 'A merperson', 'A goblin', 'An owl', 'A rat', 'A toad', 'A cat', 'A three-headed dog', 'A giant squid', 'A Cornish pixie', 'A blast-ended skrewt', 'A flobberworm', 'A mandrake', 'A unicorn hair', 'A dragon egg', 'A werewolf full moon', 'A giant spider', 'A magical serpent', 'A forest giant'
  ]],
  ['classes', 'Hogwarts Classes, Teachers & Places', 'Medium', 'classes-places.png', [
    'Defense Against the Dark Arts', 'Transfiguration', 'Charms', 'Potions', 'Herbology', 'Astronomy', 'Divination', 'Care of Magical Creatures', 'History of Magic', 'Flying lessons', 'Ancient Runes', 'Arithmancy', 'Professor Snape', 'Professor Flitwick', 'Professor Sprout', 'Professor Trelawney', 'Professor Binns', 'Mad-Eye Moody', 'Professor Lockhart', 'Professor Umbridge', 'The Astronomy Tower', 'The Forbidden Forest', 'The Room of Requirement', 'The Chamber of Secrets', 'The Black Lake', 'The Whomping Willow', 'The Owlery', 'The Hospital Wing', 'The kitchens', 'The greenhouses', 'The prefects bathroom', 'The Headmaster office', 'The clock tower', 'The Forbidden Corridor', 'The secret passageways'
  ]],
  ['quidditch', 'Quidditch & Wizarding Games', 'Medium', 'quidditch-games.png', [
    'Quidditch', 'A seeker', 'A keeper', 'A chaser', 'A beater', 'The Golden Snitch', 'A bludger', 'A quaffle', 'The Quidditch pitch', 'The three goal hoops', 'The World Cup', 'The Triwizard Tournament', 'The Goblet of Fire', 'The first task', 'The dragon challenge', 'The Black Lake task', 'The maze task', 'The Yule Ball', 'Wizard chess', 'Exploding Snap', 'Gobstones', 'Broom racing', 'The Firebolt', 'The Nimbus Two Thousand', 'The Nimbus Two Thousand One', 'A flying broom', 'A Quidditch captain', 'A House match', 'A penalty shot', 'The commentator booth', 'The Quidditch Cup', 'The Bulgarian team', 'The Irish team', 'A broomstick shop', 'A magical tournament'
  ]],
  ['life', 'Hogsmeade, Diagon Alley & Wizarding Life', 'Medium', 'wizarding-life.png', [
    'Diagon Alley', 'Hogsmeade', 'The Leaky Cauldron', 'Gringotts', 'Ollivanders', 'Flourish and Blotts', 'Quality Quidditch Supplies', 'Weasleys Wizard Wheezes', 'Honeydukes', 'Zonko joke shop', 'The Three Broomsticks', 'The Hog Head', 'Madam Puddifoot tea shop', 'The Knight Bus', 'The Hogwarts Express', 'A wizarding newspaper', 'The Daily Prophet', 'A magical radio', 'An enchanted mirror', 'A wizarding bank vault', 'A wand shop', 'A robe shop', 'A magical pet shop', 'A chocolate frog card', 'Bertie Bott beans', 'Pumpkin juice', 'Cauldron cakes', 'Treacle tart', 'A school trunk', 'An owl post', 'A magical fireplace', 'Floo powder', 'A wizarding family', 'A magical village', 'A secret platform'
  ]],
  ['dark', 'The Dark Side', 'Medium', 'dark-side.png', [
    'Lord Voldemort', 'Tom Riddle', 'Bellatrix Lestrange', 'Lucius Malfoy', 'Draco Malfoy', 'Peter Pettigrew', 'Dolores Umbridge', 'Fenrir Greyback', 'A Death Eater', 'The Dark Mark', 'A Horcrux', 'A soul fragment', 'A cursed necklace', 'A dark wizard', 'A secret diary', 'A snake familiar', 'A forbidden spell', 'Avada Kedavra', 'Crucio', 'Imperio', 'A dark artifact', 'A cursed object', 'A secret prison', 'A Dementor kiss', 'A prophecy', 'A graveyard duel', 'A dark forest', 'A masked wizard', 'A magical curse', 'A hidden enemy', 'A secret follower', 'A betrayal', 'A shadowy tower', 'A forbidden book', 'A dangerous potion'
  ]],
  ['lore', 'Magical Artifacts & Deep Lore', 'Hard', 'artifacts-lore.png', [
    'The Deathly Hallows', 'The Elder Wand', 'The Resurrection Stone', 'The Invisibility Cloak', 'The Philosopher Stone', 'The Mirror of Erised', 'The Sword of Gryffindor', 'The Cup of Hufflepuff', 'The Locket of Slytherin', 'The Diadem of Ravenclaw', 'Nagini', 'The Gaunt ring', 'The Black family tapestry', 'The Marauders', 'Moony', 'Wormtail', 'Padfoot', 'Prongs', 'The Order of the Phoenix', 'The Ministry of Magic', 'The Department of Mysteries', 'The Veil', 'The prophecy shelves', 'A Pensieve memory', 'A magical oath', 'The Fidelius Charm', 'A secret keeper', 'A blood pact', 'A vanishing cabinet', 'The Hand of Glory', 'A cursed vault', 'A magical portrait', 'A spell trace', 'A magical map', 'A lost heirloom'
  ]],
  ['moments', 'Story Moments, Quotes & Big Reveals', 'Hard', 'story-moments.png', [
    'The lightning scar', 'The first Hogwarts letter', 'The platform barrier', 'The Sorting Hat song', 'The troll in the dungeon', 'The midnight duel', 'The hidden trapdoor', 'The basilisk battle', 'The flying car', 'The Prisoner of Azkaban escape', 'The Patronus by the lake', 'The name from the Goblet', 'The graveyard return', 'The Ministry battle', 'The Half-Blood Prince mystery', 'The cave journey', 'The tower betrayal', 'The seven Potters', 'The wedding attack', 'The visit to Godric Hollow', 'The silver doe', 'The Gringotts escape', 'The dragon flight', 'The Room of Requirement battle', 'The final duel', 'The Great Hall reunion', 'The epilogue', 'The secret prince', 'The hidden locket', 'The missing diadem', 'The prophecy reveal', 'The kings cross vision', 'The forbidden memory', 'The last horcrux', 'The final victory'
  ]]
]

export const seedPacks = decks.map(([id, title, difficulty, coverFile, terms]) => ({
  id: `seed_${id}`,
  title,
  audience: 'Family',
  difficulty,
  source: 'seed',
  spoilerMode: true,
  cover: { kind: 'asset', value: `/covers/${id === 'heroes' ? 'heroes-friends-v2.png' : coverFile}` },
  seedVersion: 5,
  createdAt: '2026-06-21T00:00:00.000Z',
  cards: makeCards(`seed_${id}`, terms)
}))
