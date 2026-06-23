<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import GameScreen from './components/GameScreen.vue'
import { GeminiProvider, generateCustomPack } from './lib/ai-provider.js'
import { parseDeckPackages, shareAllAiDeckPackages, shareDeckPackage } from './lib/deck-transfer.js'
import { deleteCustomPack, getCards, getPacks, getRounds, getSetting, getUnusedCards, resetPack, saveCustomPack, saveImportedTomlDeck, saveRound, saveSetting, syncBundledDecks } from './lib/database.js'

const screen = ref('library')
const packs = ref([])
const selectedPack = ref(null)
const duration = ref(60)
const activeCards = ref([])
const finishedRound = ref(null)
const history = ref([])
const maxSpoilerBook = ref(7)
const tiltOnly = ref(false)
const gameScreen = ref(null)
const provider = new GeminiProvider()
const webBuild = !Capacitor.isNativePlatform()
const hasKey = ref(false)
const notice = ref('')
const loading = ref(true)
const keyDraft = ref('')
const creation = ref({ category: 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', harryPotterMode: false, specialPromptNote: '' })
const creating = ref(false)
const progress = ref(null)
const importInput = ref(null)

const remaining = ref({})
const results = computed(() => {
  if (!finishedRound.value) return []
  const cards = new Map(finishedRound.value.cards.map((card) => [card.id, card]))
  return finishedRound.value.outcomes.map((outcome) => ({ ...outcome, prompt: cards.get(outcome.cardId)?.prompt ?? 'Unknown card' }))
})
const score = computed(() => results.value.filter((result) => result.result === 'correct').length)
const categories = computed(() => [...new Set(packs.value.map((pack) => pack.category).filter(Boolean))].sort())
const aiPacks = computed(() => packs.value.filter((pack) => pack.isAiGenerated))

const coverUrls = new Map()
function coverUrl(pack) {
  if (!pack?.cover) return ''
  if (pack.cover.kind === 'asset' || pack.cover.kind === 'svg') return pack.cover.value
  if (!coverUrls.has(pack.id)) coverUrls.set(pack.id, URL.createObjectURL(pack.cover.value))
  return coverUrls.get(pack.id)
}

async function refreshPacks() {
  packs.value = await getPacks()
  const counts = await Promise.all(packs.value.map(async (pack) => [pack.id, (await getUnusedCards(pack.id, maxSpoilerBook.value)).length]))
  remaining.value = Object.fromEntries(counts)
}

async function refreshHistory() { history.value = await getRounds() }

async function checkKey() {
  try { hasKey.value = await provider.hasKey() } catch { hasKey.value = false }
}

function openPack(pack) {
  selectedPack.value = pack
  notice.value = ''
  screen.value = 'detail'
}

function goBack() {
  if (screen.value === 'game') {
    gameScreen.value?.endRound()
    return
  }
  screen.value = screen.value === 'results' && selectedPack.value ? 'detail' : 'library'
}

function keepBrowserInsideApp() {
  goBack()
  window.history.pushState({ foreheadFrenzy: true }, '', window.location.href)
}

async function beginGame() {
  const cards = await getUnusedCards(selectedPack.value.id, maxSpoilerBook.value)
  if (!cards.length) { notice.value = 'This pack is out of fresh cards. Reset it to play again.'; return }
  activeCards.value = cards
  screen.value = 'game'
}

async function finishGame(round) {
  finishedRound.value = round
  screen.value = 'results'
  try {
    await saveRound(round)
    await Promise.all([refreshPacks(), refreshHistory()])
  } catch (error) {
    notice.value = 'Round finished, but its history could not be saved.'
  }
}

function openHistoryRound(round) {
  finishedRound.value = round
  selectedPack.value = packs.value.find((pack) => pack.id === round.packId) ?? null
  screen.value = 'results'
}

async function confirmReset() {
  if (!window.confirm(`Reset “${selectedPack.value.title}”? It will make every card available again and erase this pack’s round history.`)) return
  await resetPack(selectedPack.value.id)
  await refreshPacks()
  notice.value = 'Pack reset. Every card is fresh again.'
}

async function removePack() {
  if (!window.confirm(`Delete “${selectedPack.value.title}” and its cards?`)) return
  await deleteCustomPack(selectedPack.value.id)
  selectedPack.value = null
  await refreshPacks()
  screen.value = 'library'
}

async function saveKey() {
  if (keyDraft.value.trim().length < 16) { notice.value = 'Paste a complete Gemini API key.'; return }
  try {
    await provider.saveKey(keyDraft.value.trim())
    keyDraft.value = ''
    hasKey.value = true
    notice.value = webBuild ? 'Key saved in this browser’s local storage.' : 'Key saved in iOS Keychain. It is never added to this project.'
  } catch (error) { notice.value = error.message || 'Could not save the Gemini key.' }
}

async function removeKey() {
  try { await provider.removeKey(); hasKey.value = false; notice.value = 'Gemini key removed.' } catch (error) { notice.value = error.message }
}

async function updateSpoilerBook() {
  maxSpoilerBook.value = Number(maxSpoilerBook.value)
  await saveSetting('maxSpoilerBook', maxSpoilerBook.value)
  await refreshPacks()
  notice.value = `Harry Potter packs now avoid spoilers after Book ${maxSpoilerBook.value}.`
}

async function updateTiltOnly() {
  await saveSetting('tiltOnly', tiltOnly.value)
  notice.value = tiltOnly.value ? 'Tilt-only mode is on. Correct and Pass buttons are hidden during rounds.' : 'Tap controls are back on for rounds.'
}

async function createPack() {
  const category = creation.value.category === '__new__' ? creation.value.newCategory.trim() : creation.value.category.trim()
  if (category.length < 2) { notice.value = 'Choose or add a category.'; return }
  if (!hasKey.value) { notice.value = 'Add a Gemini key in Settings before generating a pack.'; return }
  creating.value = true
  progress.value = { batch: 0, totalBatches: 7, cardCount: 0 }
  notice.value = 'Creating your 350-card library…'
  try {
    const result = await generateCustomPack(provider, { ...creation.value, category }, (next) => { progress.value = next })
    await saveCustomPack(result.pack, result.cards)
    await refreshPacks()
    selectedPack.value = packs.value.find((pack) => pack.id === result.pack.id)
    creation.value = { category: categories.value[0] || 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', harryPotterMode: false, specialPromptNote: '' }
    screen.value = 'detail'
    notice.value = 'Your new pack is ready.'
  } catch (error) { notice.value = error.message || 'The pack was not saved. Please try again.' }
  finally { creating.value = false; progress.value = null }
}

function openImportPicker() { importInput.value?.click() }

async function importDecks(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const decks = await parseDeckPackages(file)
    await Promise.all(decks.map(({ deck, cover }) => saveImportedTomlDeck(deck, cover)))
    await refreshPacks()
    notice.value = `${decks.length} TOML deck${decks.length === 1 ? '' : 's'} imported.`
  } catch (error) { notice.value = error.message || 'Could not import that deck package.' }
}

async function exportDeck(pack) {
  try {
    await shareDeckPackage(pack, await getCards(pack.id))
    notice.value = webBuild ? 'Deck downloaded as a TOML package.' : 'Choose where to share or save the deck package.'
  } catch (error) { notice.value = error.message || 'Could not export this deck.' }
}

async function exportAllAiDecks() {
  try {
    await shareAllAiDeckPackages(await Promise.all(aiPacks.value.map(async (pack) => ({ pack, cards: await getCards(pack.id) }))))
    notice.value = webBuild ? 'All AI decks downloaded as one package.' : 'Choose where to share or save the AI deck package.'
  } catch (error) { notice.value = error.message || 'Could not export AI decks.' }
}

onMounted(async () => {
  await syncBundledDecks()
  maxSpoilerBook.value = await getSetting('maxSpoilerBook', 7)
  tiltOnly.value = await getSetting('tiltOnly', false)
  await Promise.all([refreshPacks(), refreshHistory(), checkKey()])
  window.history.replaceState({ foreheadFrenzy: true }, '', window.location.href)
  window.history.pushState({ foreheadFrenzy: true }, '', window.location.href)
  window.addEventListener('popstate', keepBrowserInsideApp)
  loading.value = false
})

onBeforeUnmount(() => window.removeEventListener('popstate', keepBrowserInsideApp))
</script>

<template>
  <GameScreen v-if="screen === 'game'" ref="gameScreen" :pack="selectedPack" :cards="activeCards" :duration="duration" :show-manual-controls="!tiltOnly" @finish="finishGame" />
  <main v-else class="app-shell">
    <header class="topbar">
      <button v-if="screen !== 'library'" class="icon-button" aria-label="Back" @click="goBack">‹</button><span v-else class="topbar-spacer"></span>
      <div><p class="eyebrow">PARTY PROMPT GAME</p><h1>Forehead Frenzy</h1></div>
      <button class="icon-button" aria-label="Settings" @click="screen = 'settings'">⚙</button>
    </header>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <section v-if="loading" class="empty-state"><strong>Loading your magic…</strong></section>

    <template v-else-if="screen === 'library'">
      <section class="hero"><p>Big cards. Loud clues. Zero setup.</p><h2>Pick a pack and get silly.</h2><button class="primary-button" @click="screen = 'create'">✨ Make a pack with AI</button><div class="deck-library-actions"><button @click="openImportPicker">Import TOML package</button><button v-if="aiPacks.length" @click="exportAllAiDecks">Export AI decks</button></div><input ref="importInput" class="visually-hidden" type="file" accept=".zip,application/zip" @change="importDecks" /></section>
      <section class="library-heading"><h2>Your packs</h2><span>{{ packs.length }} ready</span></section>
      <section class="pack-grid">
        <button v-for="pack in packs" :key="pack.id" class="pack-tile" @click="openPack(pack)">
          <img v-if="pack.cover" :src="coverUrl(pack)" alt="" />
          <span class="pack-shade"></span>
          <span class="pack-meta"><small>{{ pack.category }} · {{ pack.difficulty }}</small><strong>{{ pack.title }}</strong><em>{{ remaining[pack.id] }} fresh cards</em></span>
        </button>
      </section>
      <section class="library-heading history-heading"><h2>Recent rounds</h2><button v-if="history.length" @click="screen = 'history'">View history</button></section>
      <section v-if="history.length" class="recent-rounds"><button v-for="round in history.slice(0, 3)" :key="round.id" @click="openHistoryRound(round)"><strong>{{ round.outcomes.filter((outcome) => outcome.result === 'correct').length }}</strong><span><b>{{ packs.find((pack) => pack.id === round.packId)?.title || 'Deleted pack' }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleDateString() }}</small></span><em>View ›</em></button></section>
      <p v-else class="empty-history">Your finished rounds will appear here.</p>
    </template>

    <template v-else-if="screen === 'detail' && selectedPack">
      <section class="pack-detail-cover"><img v-if="selectedPack.cover" :src="coverUrl(selectedPack)" alt="" /><div><p>{{ selectedPack.category }} · {{ selectedPack.difficulty }}</p><h2>{{ selectedPack.title }}</h2><span>{{ remaining[selectedPack.id] }} {{ selectedPack.spoilerMode ? `spoiler-safe through Book ${maxSpoilerBook}` : 'fresh' }} cards left</span></div></section>
      <section class="detail-card"><h3>Ready, set, forehead.</h3><p>Hold your phone screen-out to your forehead. Friends clue you in. Tilt down for correct, up to pass{{ tiltOnly ? '. Tilt-only mode is on.' : ', or use the on-screen buttons.' }}</p><div class="duration-picker"><button v-for="option in [30, 60, 90]" :key="option" :class="{ selected: duration === option }" @click="duration = option">{{ option }} sec</button></div><button class="primary-button wide" :disabled="!remaining[selectedPack.id]" @click="beginGame">Start {{ duration }}-second round</button></section>
      <div class="manage-row"><button @click="confirmReset">Reset card history</button><button v-if="selectedPack.isAiGenerated" @click="exportDeck(selectedPack)">Export TOML package</button><button v-if="selectedPack.source !== 'bundled_toml'" class="danger" @click="removePack">Delete deck</button></div>
    </template>

    <template v-else-if="screen === 'create'">
      <section class="form-card"><p class="eyebrow">YOUR OWN DECK</p><h2>Make a pack worth replaying.</h2><p>Gemini will create 350 simple, 1–4 word cards and a cover image. Your pack stays on this phone.</p><label>Category<select v-model="creation.category" :disabled="creating"><option v-for="category in categories" :key="category" :value="category">{{ category }}</option><option value="__new__">Add a new category…</option></select></label><label v-if="creation.category === '__new__'">New category<input v-model="creation.newCategory" maxlength="60" placeholder="e.g. 90s movies" :disabled="creating" /></label><label>AI guidance (optional)<input v-model="creation.specialPromptNote" maxlength="180" placeholder="e.g. use movie titles only" :disabled="creating" /></label><label>Best for<select v-model="creation.audience" :disabled="creating"><option>Kids</option><option>Family</option><option>Teens+</option><option>Adults</option></select></label><label>Difficulty<div class="segmented"><button v-for="level in ['Easy', 'Medium', 'Hard']" :key="level" :class="{ selected: creation.difficulty === level }" :disabled="creating" @click="creation.difficulty = level">{{ level }}</button></div></label><label class="checkbox-row"><input v-model="creation.harryPotterMode" type="checkbox" :disabled="creating" /><span><b>Harry Potter spoiler mode</b><small>Tag every card with its first-revealed book and respect your spoiler setting.</small></span></label><div v-if="progress" class="progress"><span>Batch {{ progress.batch }} of {{ progress.totalBatches }}</span><strong>{{ progress.cardCount }} / 350 cards</strong><i><b :style="{ width: `${(progress.cardCount / 350) * 100}%` }"></b></i></div><button class="primary-button wide" :disabled="creating" @click="createPack">{{ creating ? 'Creating your pack…' : 'Generate 350 cards' }}</button><p v-if="!hasKey" class="tiny-note">Add your Gemini key in Settings first. The key stays in iOS Keychain.</p></section>
    </template>

    <template v-else-if="screen === 'settings'">
      <section class="form-card"><p class="eyebrow">PRIVATE SETUP</p><h2>Gemini connection</h2><p v-if="webBuild">Your key is stored only in this browser’s local storage. It is convenient for this local web app, but anyone with this browser profile can read it.</p><p v-else>Your key is stored in iOS Keychain, never in the app bundle or this repository.</p><template v-if="hasKey"><div class="key-status">✓ A Gemini key is saved {{ webBuild ? 'in this browser' : 'on this iPhone' }}.</div><button class="secondary-button danger" @click="removeKey">Remove key</button></template><template v-else><label>Gemini API key<input v-model="keyDraft" type="password" autocapitalize="off" autocomplete="off" placeholder="Paste your key" /></label><button class="primary-button wide" @click="saveKey">{{ webBuild ? 'Save key in this browser' : 'Save key to Keychain' }}</button></template><hr /><h3>No-spoiler mode</h3><p>Harry Potter packs only draw cards revealed on or before this story.</p><label>Maximum spoiler book<select v-model="maxSpoilerBook" @change="updateSpoilerBook"><option v-for="book in [1, 2, 3, 4, 5, 6, 7, 8]" :key="book" :value="book">Book {{ book }}{{ book === 8 ? ' — Cursed Child / all stories' : '' }}</option></select></label><hr /><h3>Game controls</h3><label class="checkbox-row"><input v-model="tiltOnly" type="checkbox" @change="updateTiltOnly" /><span><b>Tilt-only mode</b><small>Hide Correct and Pass buttons during a round so they cannot be bumped.</small></span></label><hr /><h3>How to play</h3><p>On the game card: tilt down for correct, tilt up to pass. Browser and device back actions end the current round and show results instead of leaving the app.</p></section>
    </template>

    <template v-else-if="screen === 'results'">
      <section class="results-hero"><p>ROUND COMPLETE</p><strong>{{ score }}</strong><h2>correct answers</h2><span>{{ results.filter((result) => result.result === 'passed').length }} passed</span></section>
      <section class="result-list"><div v-for="result in results" :key="result.cardId" :class="result.result"><span>{{ result.result === 'correct' ? '✓' : '→' }}</span>{{ result.prompt }}</div></section>
      <button class="primary-button wide" @click="screen = 'detail'">Play this pack again</button><button class="secondary-button wide" @click="screen = 'library'">Choose another pack</button>
    </template>

    <template v-else-if="screen === 'history'">
      <section class="library-heading"><h2>Game history</h2><span>{{ history.length }} rounds</span></section>
      <section class="recent-rounds history-list"><button v-for="round in history" :key="round.id" @click="openHistoryRound(round)"><strong>{{ round.outcomes.filter((outcome) => outcome.result === 'correct').length }}</strong><span><b>{{ packs.find((pack) => pack.id === round.packId)?.title || 'Deleted pack' }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleString() }} · {{ round.durationSeconds }} seconds</small></span><em>View ›</em></button></section>
    </template>
  </main>
</template>
