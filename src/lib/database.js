import { openDB } from 'idb'
import { bundledDeckRecord, bundledTomlDecks } from './toml-decks.js'
import { spoilerLimitFor } from './spoiler-series.js'

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

async function replaceDeckCards(tx, deck, previousCards = []) {
  const seenAt = new Map(previousCards.map((card) => [card.normalizedPrompt, card.firstShownAt]))
  await Promise.all(previousCards.map((card) => tx.objectStore('cards').delete(card.id)))
  await Promise.all(deck.cards.map((card) => tx.objectStore('cards').put({ ...card, packId: deck.id, firstShownAt: seenAt.get(card.normalizedPrompt) ?? null })))
}

async function deleteDeck(tx, pack) {
  await tx.objectStore('packs').delete(pack.id)
  const cards = await tx.objectStore('cards').index('packId').getAll(pack.id)
  await Promise.all(cards.map((card) => tx.objectStore('cards').delete(card.id)))
}

export async function syncBundledDecks() {
  const store = await db()
  const tx = store.transaction(['packs', 'cards'], 'readwrite')
  const bundledIds = new Set(bundledTomlDecks.map((deck) => deck.id))
  for (const deck of bundledTomlDecks) {
    const pack = bundledDeckRecord(deck)
    const existing = await tx.objectStore('packs').get(deck.id)
    if (existing) {
      if (existing.source !== 'bundled_toml' || existing.bundledContentSignature !== pack.bundledContentSignature) {
        const oldCards = await tx.objectStore('cards').index('packId').getAll(pack.id)
        await tx.objectStore('packs').put({ ...existing, ...pack })
        await replaceDeckCards(tx, deck, oldCards)
      }
      continue
    }
    await tx.objectStore('packs').put(pack)
    await replaceDeckCards(tx, deck)
  }
  const allPacks = await tx.objectStore('packs').getAll()
  for (const pack of allPacks) {
    if (pack.source === 'custom' && !pack.isAiGenerated) {
      await tx.objectStore('packs').put({ ...pack, source: 'ai', isAiGenerated: true })
      continue
    }
    const isSupportedLocalDeck = ['bundled_toml', 'imported_toml', 'ai'].includes(pack.source)
    if (!isSupportedLocalDeck || (pack.source === 'bundled_toml' && !bundledIds.has(pack.id))) await deleteDeck(tx, pack)
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

export async function getUnusedCards(packId, spoilerLimits) {
  const pack = await getPack(packId)
  const limit = spoilerLimitFor(pack, spoilerLimits)
  return (await getCards(packId)).filter((card) => {
    const earliestInstallment = card.earliestInstallment ?? card.earliestBook
    return !card.firstShownAt && (!pack?.spoilerMode || !earliestInstallment || earliestInstallment <= limit)
  })
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

export async function resetAllPacks({ deleteAiGenerated = false } = {}) {
  const store = await db()
  const tx = store.transaction(['packs', 'cards', 'rounds'], 'readwrite')
  const [packs, cards] = await Promise.all([tx.objectStore('packs').getAll(), tx.objectStore('cards').getAll()])
  const deletedPackIds = new Set(deleteAiGenerated ? packs.filter((pack) => pack.isAiGenerated || pack.source === 'ai').map((pack) => pack.id) : [])
  await Promise.all(cards.map((card) => deletedPackIds.has(card.packId)
    ? tx.objectStore('cards').delete(card.id)
    : tx.objectStore('cards').put({ ...card, firstShownAt: null })))
  await Promise.all([...deletedPackIds].map((packId) => tx.objectStore('packs').delete(packId)))
  await tx.objectStore('rounds').clear()
  await tx.done
  return { deletedAiPackCount: deletedPackIds.size }
}

export async function saveCustomPack(pack, cards) {
  const store = await db()
  const tx = store.transaction(['packs', 'cards'], 'readwrite')
  await tx.objectStore('packs').put(pack)
  await Promise.all(cards.map((card) => tx.objectStore('cards').put({ ...card, packId: pack.id })))
  await tx.done
}

export async function saveImportedTomlDeck(deck, cover) {
  const store = await db()
  const tx = store.transaction(['packs', 'cards'], 'readwrite')
  const existing = await tx.objectStore('packs').get(deck.id)
  const existingCards = existing ? await tx.objectStore('cards').index('packId').getAll(deck.id) : []
  const pack = {
    ...existing,
    ...bundledDeckRecord(deck),
    source: 'imported_toml',
    isAiGenerated: false,
    cover: cover || existing?.cover || null,
    createdAt: existing?.createdAt || new Date().toISOString()
  }
  await tx.objectStore('packs').put(pack)
  await replaceDeckCards(tx, deck, existingCards)
  await tx.done
  return pack
}

export async function deleteCustomPack(packId) {
  const store = await db()
  const pack = await store.get('packs', packId)
  if (!pack || !['ai', 'imported_toml', 'custom'].includes(pack.source)) throw new Error('Only AI-created or imported packs can be deleted.')
  const tx = store.transaction(['packs', 'cards', 'rounds'], 'readwrite')
  await tx.objectStore('packs').delete(packId)
  const [cards, rounds] = await Promise.all([
    tx.objectStore('cards').index('packId').getAll(packId),
    tx.objectStore('rounds').index('packId').getAll(packId)
  ])
  await Promise.all([...cards.map((card) => tx.objectStore('cards').delete(card.id)), ...rounds.map((round) => tx.objectStore('rounds').delete(round.id))])
  await tx.done
}
