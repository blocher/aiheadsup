import { openDB } from 'idb'
import { seedPacks } from './seed-data.js'

const database = openDB('forehead-frenzy', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const packs = db.createObjectStore('packs', { keyPath: 'id' })
      packs.createIndex('source', 'source')
      const cards = db.createObjectStore('cards', { keyPath: 'id' })
      cards.createIndex('packId', 'packId')
      cards.createIndex('packId_firstShownAt', ['packId', 'firstShownAt'])
      const rounds = db.createObjectStore('rounds', { keyPath: 'id' })
      rounds.createIndex('packId', 'packId')
    }
    if (oldVersion < 2) db.createObjectStore('settings', { keyPath: 'key' })
  }
})

async function db() { return database }

export async function seedDatabase() {
  const store = await db()
  const tx = store.transaction(['packs', 'cards'], 'readwrite')
  for (const seed of seedPacks) {
    const { cards, ...pack } = seed
    const existing = await tx.objectStore('packs').get(seed.id)
    if (existing) {
      if (existing.seedVersion !== pack.seedVersion) {
        await tx.objectStore('packs').put({ ...existing, ...pack })
        const oldCards = await tx.objectStore('cards').index('packId').getAll(pack.id)
        await Promise.all(oldCards.map((card) => tx.objectStore('cards').delete(card.id)))
        await Promise.all(cards.map((card) => tx.objectStore('cards').put({ ...card, packId: pack.id })))
      }
      continue
    }
    await tx.objectStore('packs').put(pack)
    for (const card of cards) await tx.objectStore('cards').put({ ...card, packId: pack.id })
  }
  await tx.done
  await navigator.storage?.persist?.()
}

export async function getPacks() {
  return (await db()).getAll('packs')
}

export async function getPack(packId) {
  return (await db()).get('packs', packId)
}

export async function getCards(packId) {
  return (await db()).getAllFromIndex('cards', 'packId', packId)
}

export async function getUnusedCards(packId, maxSpoilerBook = 7) {
  const pack = await getPack(packId)
  return (await getCards(packId)).filter((card) => !card.firstShownAt && (!pack?.spoilerMode || !card.earliestBook || card.earliestBook <= maxSpoilerBook))
}

export async function markCardShown(cardId) {
  const store = await db()
  const card = await store.get('cards', cardId)
  if (!card || card.firstShownAt) return card
  const updated = { ...card, firstShownAt: new Date().toISOString() }
  await store.put('cards', updated)
  return updated
}

export async function saveRound(round) { await (await db()).put('rounds', round) }

export async function getRounds() {
  return (await (await db()).getAll('rounds')).sort((a, b) => new Date(b.endedAt || b.startedAt) - new Date(a.endedAt || a.startedAt))
}

export async function getSetting(key, fallback = null) {
  return (await (await db()).get('settings', key))?.value ?? fallback
}

export async function saveSetting(key, value) {
  await (await db()).put('settings', { key, value })
}

export async function resetPack(packId) {
  const store = await db()
  const tx = store.transaction(['cards', 'rounds'], 'readwrite')
  const cards = await tx.objectStore('cards').index('packId').getAll(packId)
  await Promise.all(cards.map((card) => tx.objectStore('cards').put({ ...card, firstShownAt: null })))
  const rounds = await tx.objectStore('rounds').index('packId').getAll(packId)
  await Promise.all(rounds.map((round) => tx.objectStore('rounds').delete(round.id)))
  await tx.done
}

export async function saveCustomPack(pack, cards) {
  const store = await db()
  const tx = store.transaction(['packs', 'cards'], 'readwrite')
  await tx.objectStore('packs').put(pack)
  await Promise.all(cards.map((card) => tx.objectStore('cards').put({ ...card, packId: pack.id })))
  await tx.done
}

export async function deleteCustomPack(packId) {
  const store = await db()
  const pack = await store.get('packs', packId)
  if (!pack || pack.source !== 'custom') throw new Error('Only custom packs can be deleted.')
  const tx = store.transaction(['packs', 'cards', 'rounds'], 'readwrite')
  await tx.objectStore('packs').delete(packId)
  const [cards, rounds] = await Promise.all([
    tx.objectStore('cards').index('packId').getAll(packId),
    tx.objectStore('rounds').index('packId').getAll(packId)
  ])
  await Promise.all([...cards.map((card) => tx.objectStore('cards').delete(card.id)), ...rounds.map((round) => tx.objectStore('rounds').delete(round.id))])
  await tx.done
}
