<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import GameScreen from './components/GameScreen.vue'
import { GeminiProvider, generateCustomPack } from './lib/ai-provider.js'
import { parseDeckPackages, shareAllAiDeckPackages, shareDeckPackage } from './lib/deck-transfer.js'
import { deleteCustomPack, getCards, getPacks, getRounds, getSetting, getUnusedCards, resetAllPacks, resetPack, saveCustomPack, saveImportedTomlDeck, saveRound, saveSetting, syncBundledDecks } from './lib/database.js'
import { prepareEndCueAudio } from './lib/end-cues.js'
import { setRoundOutcome } from './lib/game-engine.js'
import { requestMotionPermission } from './lib/motion-permissions.js'
import { defaultSpoilerLimits, spoilerProgressLabel, spoilerSeriesOptions } from './lib/spoiler-series.js'

const screen = ref('library')
const packs = ref([])
const selectedPack = ref(null)
const duration = ref(60)
const activeCards = ref([])
const finishedRound = ref(null)
const playerNameDraft = ref('')
const history = ref([])
const spoilerLimits = ref(defaultSpoilerLimits())
const tiltOnly = ref(false)
const endCueMode = ref('sound_haptics')
const gameScreen = ref(null)
const provider = new GeminiProvider()
const webBuild = !Capacitor.isNativePlatform()
const hasKey = ref(false)
const notice = ref('')
const loading = ref(true)
const keyDraft = ref('')
const creation = ref({ category: 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', cardCount: 100, spoilerSeries: '', specialPromptNote: '' })
const creating = ref(false)
const progress = ref(null)
const importInput = ref(null)
const selectedCategory = ref('all')
const deleteAiOnReset = ref(false)
const confirmDialog = ref(null)
let confirmDialogResolve = null

const remaining = ref({})
const results = computed(() => {
  if (!finishedRound.value) return []
  const roundCards = finishedRound.value.cards || []
  const cards = new Map(roundCards.map((card) => [card.id, card]))
  const items = (finishedRound.value.outcomes || []).map((outcome) => ({ ...outcome, prompt: cards.get(outcome.cardId)?.prompt ?? 'Unknown card' }))
  const outcomeIds = new Set(items.map((item) => item.cardId))
  const finalCardId = finishedRound.value.finalCardId
  if (finalCardId && !outcomeIds.has(finalCardId)) {
    items.push({ cardId: finalCardId, result: 'unmarked', prompt: cards.get(finalCardId)?.prompt ?? 'Unknown card', isFinalUnmarked: true })
  }
  return items
})
const score = computed(() => results.value.filter((result) => result.result === 'correct').length)
function roundScore(round) { return (round.outcomes || []).filter((outcome) => outcome.result === 'correct').length }
function roundPlayerLabel(round) { return round.playerName ? ` · ${round.playerName}` : '' }
const highScores = computed(() => history.value
  .map((round) => ({ ...round, score: roundScore(round) }))
  .sort((left, right) => right.score - left.score || new Date(right.endedAt || right.startedAt) - new Date(left.endedAt || left.startedAt)))
const categories = computed(() => [...new Set(packs.value.map((pack) => pack.category).filter(Boolean))].sort())
const aiPacks = computed(() => packs.value.filter((pack) => pack.isAiGenerated))
const categoryGroups = computed(() => categories.value
  .filter((category) => selectedCategory.value === 'all' || selectedCategory.value === category)
  .map((category) => ({
    category,
    packs: packs.value.filter((pack) => pack.category === category).sort((left, right) => left.title.localeCompare(right.title))
  }))
  .filter((group) => group.packs.length))

const categoryIcons = {
  'Harry Potter': '⚡',
  'Indiana Jones': '🤠',
  'Star Wars': '🚀',
  Cities: '🏙️',
  'Western PA Themeparks': '🎢',
  Science: '🧪',
  'Religion and Mythology': '🏛️',
  History: '📜',
  Kids: '🧸',
  Movies: '🎬',
  Food: '🍕',
  Games: '🎲',
  'Pittsburgh Sports': '🏆',
  Sports: '⚽'
}
function categoryIcon(category) { return categoryIcons[category] || '✨' }

const coverUrls = new Map()
function coverUrl(pack) {
  if (!pack?.cover) return ''
  if (pack.cover.kind === 'asset' || pack.cover.kind === 'svg') return pack.cover.value
  if (!coverUrls.has(pack.id)) coverUrls.set(pack.id, URL.createObjectURL(pack.cover.value))
  return coverUrls.get(pack.id)
}

async function refreshPacks() {
  packs.value = await getPacks()
  if (selectedCategory.value !== 'all' && !packs.value.some((pack) => pack.category === selectedCategory.value)) selectedCategory.value = 'all'
  const counts = await Promise.all(packs.value.map(async (pack) => [pack.id, (await getUnusedCards(pack.id, spoilerLimits.value)).length]))
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

async function goBack() {
  if (screen.value === 'game') {
    await gameScreen.value?.requestAbort()
    return
  }
  screen.value = screen.value === 'results' && selectedPack.value ? 'detail' : 'library'
}

function keepBrowserInsideApp() {
  goBack()
  window.history.pushState({ foreheadFrenzy: true }, '', window.location.href)
}

function askForConfirmation({ title, message, confirmText = 'Continue', cancelText = 'Cancel', tone = 'normal' }) {
  if (confirmDialogResolve) confirmDialogResolve(false)
  return new Promise((resolve) => {
    confirmDialogResolve = resolve
    confirmDialog.value = { title, message, confirmText, cancelText, tone }
  })
}

function closeConfirmDialog(confirmed) {
  const resolve = confirmDialogResolve
  confirmDialogResolve = null
  confirmDialog.value = null
  resolve?.(confirmed)
}

async function confirmAbortGame() {
  return askForConfirmation({
    title: 'Quit this round?',
    message: 'This will stop the round now and discard this game’s score. You can start a new round right away.',
    confirmText: 'Quit round',
    tone: 'danger'
  })
}

async function beginGame() {
  prepareEndCueAudio(endCueMode.value)
  const motionAccess = await requestMotionPermission()
  if (!motionAccess.granted) {
    notice.value = motionAccess.error
      ? 'iOS could not start motion sensing. Close and reopen Forehead Frenzy, then start a round and allow motion access.'
      : 'Motion access was not granted. Start the round again and allow motion access so tilting can mark Correct and Pass.'
    return
  }
  const cards = await getUnusedCards(selectedPack.value.id, spoilerLimits.value)
  if (!cards.length) { notice.value = 'This pack is out of fresh cards. Reset it to play again.'; return }
  activeCards.value = cards
  screen.value = 'game'
}

async function finishGame(round) {
  finishedRound.value = round
  playerNameDraft.value = round.playerName || ''
  screen.value = 'results'
  try {
    await saveRound(round)
    await Promise.all([refreshPacks(), refreshHistory()])
  } catch (error) {
    notice.value = 'Round finished, but its history could not be saved.'
  }
}

async function abortGame() {
  await refreshPacks()
  screen.value = selectedPack.value ? 'detail' : 'library'
  notice.value = 'Round quit. No score was saved.'
}

function openHistoryRound(round) {
  finishedRound.value = round
  playerNameDraft.value = round.playerName || ''
  selectedPack.value = packs.value.find((pack) => pack.id === round.packId) ?? null
  screen.value = 'results'
}

function resultIcon(result) {
  if (result === 'correct') return '✓'
  if (result === 'passed') return '×'
  return '?'
}

function resultLabel(result) {
  if (result === 'correct') return 'Correct'
  if (result === 'passed') return 'Wrong / pass'
  return 'Not marked'
}

async function changeResult(cardId, nextResult) {
  if (!finishedRound.value) return false
  const result = results.value.find((item) => item.cardId === cardId)
  const currentLabel = result?.result && result.result !== 'unmarked' ? resultLabel(result.result) : 'not marked'
  const nextLabel = resultLabel(nextResult)
  const confirmed = await askForConfirmation({
    title: 'Change card status?',
    message: `Change “${result?.prompt || 'this card'}” from ${currentLabel} to ${nextLabel}?`,
    confirmText: 'Change status'
  })
  if (!confirmed) return false
  finishedRound.value = setRoundOutcome(finishedRound.value, cardId, nextResult)
  try {
    await saveRound(finishedRound.value)
    await refreshHistory()
    notice.value = `Updated “${result?.prompt || 'card'}” to ${nextLabel}.`
    return true
  } catch (error) {
    notice.value = 'That score change could not be saved.'
    return false
  }
}

async function changeResultFromControl(result, event) {
  const nextResult = event.target.value
  if (!['correct', 'passed'].includes(nextResult) || nextResult === result.result) return
  const changed = await changeResult(result.cardId, nextResult)
  if (!changed) event.target.value = result.result
}

async function savePlayerName() {
  if (!finishedRound.value) return
  const playerName = playerNameDraft.value.trim()
  finishedRound.value = { ...finishedRound.value, playerName }
  try {
    await saveRound(finishedRound.value)
    await refreshHistory()
    notice.value = playerName ? `Saved ${playerName} with this round.` : 'Player name cleared for this round.'
  } catch (error) {
    notice.value = 'Player name could not be saved.'
  }
}

async function confirmReset() {
  const confirmed = await askForConfirmation({
    title: 'Reset this pack?',
    message: `Reset “${selectedPack.value.title}”? It will make every card available again and erase this pack’s round history.`,
    confirmText: 'Reset pack',
    tone: 'danger'
  })
  if (!confirmed) return
  await resetPack(selectedPack.value.id)
  await refreshPacks()
  notice.value = 'Pack reset. Every card is fresh again.'
}

async function confirmResetAll() {
  const aiNote = deleteAiOnReset.value ? ` It will also permanently delete ${aiPacks.value.length} AI-created pack${aiPacks.value.length === 1 ? '' : 's'} and their cards.` : ''
  const confirmed = await askForConfirmation({
    title: 'Reset all pack history?',
    message: `This clears every used-card history and deletes all ${history.value.length} recorded round${history.value.length === 1 ? '' : 's'}.${aiNote} This cannot be undone.`,
    confirmText: 'Reset everything',
    tone: 'danger'
  })
  if (!confirmed) return
  try {
    const { deletedAiPackCount } = await resetAllPacks({ deleteAiGenerated: deleteAiOnReset.value })
    selectedPack.value = null
    await Promise.all([refreshPacks(), refreshHistory()])
    notice.value = deletedAiPackCount ? `All pack history reset. ${deletedAiPackCount} AI pack${deletedAiPackCount === 1 ? '' : 's'} deleted.` : 'All pack history reset. Every remaining card is fresh again.'
  } catch (error) { notice.value = error.message || 'Could not reset all packs.' }
}

async function removePack() {
  const confirmed = await askForConfirmation({
    title: 'Delete this deck?',
    message: `Delete “${selectedPack.value.title}” and its cards? This cannot be undone.`,
    confirmText: 'Delete deck',
    tone: 'danger'
  })
  if (!confirmed) return
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

async function updateSpoilerLimit(seriesId) {
  spoilerLimits.value = { ...spoilerLimits.value, [seriesId]: Number(spoilerLimits.value[seriesId]) }
  await saveSetting('spoilerLimits', spoilerLimits.value)
  await refreshPacks()
  const series = spoilerSeriesOptions.find((option) => option.id === seriesId)
  notice.value = `${series.label} packs now avoid spoilers after ${series.installments[spoilerLimits.value[seriesId] - 1]}.`
}

function spoilerLabel(pack) { return spoilerProgressLabel(pack, spoilerLimits.value) }

async function updateTiltOnly() {
  await saveSetting('tiltOnly', tiltOnly.value)
  notice.value = tiltOnly.value ? 'Tilt-only mode is on. Correct and Pass buttons are hidden during rounds.' : 'Tap controls are back on for rounds.'
}

async function updateEndCueMode() {
  await saveSetting('endCueMode', endCueMode.value)
  notice.value = endCueMode.value === 'visual' ? 'End-of-round visual countdown only.' : endCueMode.value === 'sound' ? 'End-of-round sound cues are on.' : 'End-of-round sound and haptic cues are on.'
}

async function createPack() {
  const category = creation.value.category === '__new__' ? creation.value.newCategory.trim() : creation.value.category.trim()
  if (category.length < 2) { notice.value = 'Choose or add a category.'; return }
  if (!hasKey.value) { notice.value = 'Add a Gemini key in Settings before generating a pack.'; return }
  creating.value = true
  progress.value = { batch: 0, totalBatches: Math.ceil(creation.value.cardCount / 50), cardCount: 0, targetCardCount: creation.value.cardCount }
  notice.value = `Creating your ${creation.value.cardCount}-card library…`
  try {
    const result = await generateCustomPack(provider, { ...creation.value, category }, (next) => { progress.value = next })
    await saveCustomPack(result.pack, result.cards)
    await refreshPacks()
    selectedPack.value = packs.value.find((pack) => pack.id === result.pack.id)
    creation.value = { category: categories.value[0] || 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', cardCount: 100, spoilerSeries: '', specialPromptNote: '' }
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
  const savedSpoilerLimits = await getSetting('spoilerLimits', null)
  spoilerLimits.value = { ...defaultSpoilerLimits(), ...(savedSpoilerLimits || {}), ...(!savedSpoilerLimits ? { harry_potter: await getSetting('maxSpoilerBook', 7) } : {}) }
  tiltOnly.value = await getSetting('tiltOnly', false)
  endCueMode.value = await getSetting('endCueMode', 'sound_haptics')
  await Promise.all([refreshPacks(), refreshHistory(), checkKey()])
  window.history.replaceState({ foreheadFrenzy: true }, '', window.location.href)
  window.history.pushState({ foreheadFrenzy: true }, '', window.location.href)
  window.addEventListener('popstate', keepBrowserInsideApp)
  loading.value = false
})

onBeforeUnmount(() => window.removeEventListener('popstate', keepBrowserInsideApp))
</script>

<template>
  <GameScreen v-if="screen === 'game'" ref="gameScreen" :pack="selectedPack" :cards="activeCards" :duration="duration" :show-manual-controls="!tiltOnly" :end-cue-mode="endCueMode" :confirm-abort="confirmAbortGame" @finish="finishGame" @abort="abortGame" />
  <main v-else :class="['app-shell', { 'pack-detail-screen': screen === 'detail' }]">
    <header class="topbar">
      <button v-if="screen !== 'library'" class="icon-button" aria-label="Back" @click="goBack">‹</button><span v-else class="topbar-spacer"></span>
      <div><p class="eyebrow">PARTY PROMPT GAME</p><h1>Forehead Frenzy</h1></div>
      <button class="icon-button" aria-label="Settings" @click="screen = 'settings'">⚙</button>
    </header>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <section v-if="loading" class="empty-state"><strong>Loading your magic…</strong></section>

    <template v-else-if="screen === 'library'">
      <section class="hero"><p>Big cards. Loud clues. Zero setup.</p><h2>Pick a pack and get silly.</h2><button class="primary-button" @click="screen = 'create'">✨ Make a pack with AI</button><div class="deck-library-actions"><button @click="openImportPicker">Import TOML package</button><button v-if="aiPacks.length" @click="exportAllAiDecks">Export AI decks</button></div><input ref="importInput" class="visually-hidden" type="file" accept=".zip,application/zip" @change="importDecks" /></section>
      <section class="library-activity-actions"><button @click="screen = 'history'"><span class="activity-icon">◷</span><span><b>Recent rounds</b><small>{{ history.length }} played</small></span><em>›</em></button><button @click="screen = 'scores'"><span class="activity-icon">🏆</span><span><b>All-time high scores</b><small>{{ highScores.length ? `${highScores[0].score} best score` : 'No scores yet' }}</small></span><em>›</em></button></section>
      <section class="library-heading"><h2>Your packs</h2><span>{{ packs.length }} ready</span></section>
      <nav v-if="categories.length" class="category-filter" aria-label="Filter packs by category">
        <button :class="{ selected: selectedCategory === 'all' }" :aria-pressed="selectedCategory === 'all'" @click="selectedCategory = 'all'"><span class="category-filter-icon">✦</span><span>All packs</span><b>{{ packs.length }}</b></button>
        <button v-for="category in categories" :key="category" :class="{ selected: selectedCategory === category }" :aria-pressed="selectedCategory === category" @click="selectedCategory = category"><span class="category-filter-icon">{{ categoryIcon(category) }}</span><span>{{ category }}</span><b>{{ packs.filter((pack) => pack.category === category).length }}</b></button>
      </nav>
      <section v-if="categoryGroups.length" class="category-sections">
        <section v-for="group in categoryGroups" :key="group.category" class="category-section">
          <header class="category-heading"><span class="category-heading-icon" aria-hidden="true">{{ categoryIcon(group.category) }}</span><div><p>Category</p><h2>{{ group.category }}</h2></div><span>{{ group.packs.length }} pack{{ group.packs.length === 1 ? '' : 's' }}</span></header>
          <div class="pack-grid">
            <button v-for="pack in group.packs" :key="pack.id" class="pack-tile" @click="openPack(pack)">
              <img v-if="pack.cover" :src="coverUrl(pack)" alt="" />
              <span class="pack-shade"></span>
              <span class="pack-meta"><small>{{ pack.difficulty }} · {{ pack.audience }}</small><strong>{{ pack.title }}</strong><em>{{ remaining[pack.id] }} fresh cards</em></span>
            </button>
          </div>
        </section>
      </section>
      <p v-else class="empty-history">No packs in this category yet.</p>
    </template>

    <template v-else-if="screen === 'detail' && selectedPack">
      <section class="pack-detail-cover"><img v-if="selectedPack.cover" :src="coverUrl(selectedPack)" alt="" /><div><p>{{ selectedPack.category }} · {{ selectedPack.difficulty }}</p><h2>{{ selectedPack.title }}</h2><span>{{ remaining[selectedPack.id] }} {{ selectedPack.spoilerMode ? `spoiler-safe through ${spoilerLabel(selectedPack)}` : 'fresh' }} cards left</span></div></section>
      <section class="detail-card"><h3>Ready, set, forehead.</h3><p>Hold your phone screen-out to your forehead. Friends clue you in. Tilt down for correct, up to pass{{ tiltOnly ? '. Tilt-only mode is on.' : ', or use the on-screen buttons.' }}</p><div class="duration-picker"><button v-for="option in [30, 60, 90]" :key="option" :class="{ selected: duration === option }" @click="duration = option">{{ option }} sec</button></div><button class="primary-button wide" :disabled="!remaining[selectedPack.id]" @click="beginGame">Start {{ duration }}-second round</button></section>
      <div class="manage-row"><button @click="confirmReset">Reset card history</button><button v-if="selectedPack.isAiGenerated" @click="exportDeck(selectedPack)">Export TOML package</button><button v-if="selectedPack.source !== 'bundled_toml'" class="danger" @click="removePack">Delete deck</button></div>
    </template>

    <template v-else-if="screen === 'create'">
      <section class="form-card"><p class="eyebrow">YOUR OWN DECK</p><h2>Make a pack worth replaying.</h2><p>Gemini creates simple, 1–4 word cards and a cover image. Your pack stays on this phone.</p><label>Category<select v-model="creation.category" :disabled="creating"><option v-for="category in categories" :key="category" :value="category">{{ category }}</option><option value="__new__">Add a new category…</option></select></label><label v-if="creation.category === '__new__'">New category<input v-model="creation.newCategory" maxlength="60" placeholder="e.g. 90s movies" :disabled="creating" /></label><label>AI guidance (optional)<input v-model="creation.specialPromptNote" maxlength="180" placeholder="e.g. use movie titles only" :disabled="creating" /></label><label>Best for<select v-model="creation.audience" :disabled="creating"><option>Kids</option><option>Family</option><option>Teens+</option><option>Adults</option></select></label><label>Difficulty<div class="segmented"><button v-for="level in ['Easy', 'Medium', 'Hard']" :key="level" :class="{ selected: creation.difficulty === level }" :disabled="creating" @click="creation.difficulty = level">{{ level }}</button></div></label><label>Number of cards<select v-model.number="creation.cardCount" :disabled="creating"><option v-for="count in [50, 100, 150, 200, 250, 300, 350]" :key="count" :value="count">{{ count }} cards</option></select></label><label>Spoiler protection<select v-model="creation.spoilerSeries" :disabled="creating"><option value="">None</option><option v-for="series in spoilerSeriesOptions" :key="series.id" :value="series.id">{{ series.label }}</option></select><small>Tags each card with its first-revealed installment and follows the matching setting.</small></label><div v-if="progress" class="progress"><span>Batch {{ progress.batch }} of {{ progress.totalBatches }}</span><strong>{{ progress.cardCount }} / {{ progress.targetCardCount }} cards</strong><i><b :style="{ width: `${(progress.cardCount / progress.targetCardCount) * 100}%` }"></b></i></div><button class="primary-button wide" :disabled="creating" @click="createPack">{{ creating ? 'Creating your pack…' : `Generate ${creation.cardCount} cards` }}</button><p v-if="!hasKey" class="tiny-note">Add your Gemini key in Settings first. The key stays in iOS Keychain.</p></section>
    </template>

    <template v-else-if="screen === 'settings'">
      <section class="form-card"><p class="eyebrow">PRIVATE SETUP</p><h2>Gemini connection</h2><p v-if="webBuild">Your key is stored only in this browser’s local storage. It is convenient for this local web app, but anyone with this browser profile can read it.</p><p v-else>Your key is stored in iOS Keychain, never in the app bundle or this repository.</p><template v-if="hasKey"><div class="key-status">✓ A Gemini key is saved {{ webBuild ? 'in this browser' : 'on this iPhone' }}.</div><button class="secondary-button danger" @click="removeKey">Remove key</button></template><template v-else><label>Gemini API key<input v-model="keyDraft" type="password" autocapitalize="off" autocomplete="off" placeholder="Paste your key" /></label><button class="primary-button wide" @click="saveKey">{{ webBuild ? 'Save key in this browser' : 'Save key to Keychain' }}</button></template><hr /><h3>No-spoiler mode</h3><p>Protected packs only draw cards revealed on or before the installment selected for their franchise.</p><label v-for="series in spoilerSeriesOptions" :key="series.id">{{ series.label }} through<select v-model="spoilerLimits[series.id]" @change="updateSpoilerLimit(series.id)"><option v-for="(installment, index) in series.installments" :key="index" :value="index + 1">{{ installment }}</option></select></label><hr /><h3>Game controls</h3><label class="checkbox-row"><input v-model="tiltOnly" type="checkbox" @change="updateTiltOnly" /><span><b>Tilt-only mode</b><small>Hide Correct and Pass buttons during a round so they cannot be bumped.</small></span></label><label>End-of-round cues<select v-model="endCueMode" @change="updateEndCueMode"><option value="visual">Visual countdown only</option><option value="sound">Visual + sound</option><option value="sound_haptics">Visual + sound + haptics</option></select></label><hr /><section class="reset-all-card"><h3>Reset all packs</h3><p>Clear every viewed card and every recorded round across your library.</p><label class="checkbox-row"><input v-model="deleteAiOnReset" type="checkbox" /><span><b>Also delete AI-created packs</b><small>{{ aiPacks.length }} AI-created pack{{ aiPacks.length === 1 ? '' : 's' }} will be permanently deleted.</small></span></label><button class="secondary-button danger wide" @click="confirmResetAll">Reset all pack history</button></section><hr /><h3>How to play</h3><p>On the game card: tilt down for correct, tilt up to pass. Browser and device back actions end the current round and show results instead of leaving the app.</p></section>
    </template>

    <template v-else-if="screen === 'results'">
      <section class="results-hero"><p>ROUND COMPLETE</p><strong>{{ score }}</strong><h2>correct answers</h2><span>{{ results.filter((result) => result.result === 'passed').length }} wrong / passed</span></section>
      <section class="player-name-card"><label>Who played? <input v-model="playerNameDraft" maxlength="40" placeholder="Optional name" /></label><button class="secondary-button" @click="savePlayerName">Save player name</button></section>
      <section class="result-list"><div v-for="result in results" :key="result.cardId" :class="result.result"><span>{{ resultIcon(result.result) }}</span><b>{{ result.prompt }}</b><select class="result-status-select" :value="result.result" aria-label="Change card status" @change="changeResultFromControl(result, $event)"><option v-if="result.result === 'unmarked'" value="unmarked" disabled>Not marked</option><option value="correct">Correct</option><option value="passed">Wrong</option></select></div></section>
      <button class="primary-button wide" @click="screen = 'detail'">Play this pack again</button><button class="secondary-button wide" @click="screen = 'library'">Choose another pack</button>
    </template>

    <template v-else-if="screen === 'history'">
      <section class="library-heading"><h2>Recent rounds</h2><span>{{ history.length }} played</span></section>
      <section v-if="history.length" class="recent-rounds history-list"><button v-for="round in history" :key="round.id" @click="openHistoryRound(round)"><strong>{{ roundScore(round) }}</strong><span><b>{{ packs.find((pack) => pack.id === round.packId)?.title || 'Deleted pack' }}{{ roundPlayerLabel(round) }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleString() }} · {{ round.durationSeconds }} seconds</small></span><em>View ›</em></button></section>
      <p v-else class="empty-history">Your finished rounds will appear here.</p>
    </template>

    <template v-else-if="screen === 'scores'">
      <section class="library-heading"><h2>All-time high scores</h2><span>{{ highScores.length }} rounds</span></section>
      <section v-if="highScores.length" class="recent-rounds history-list"><button v-for="(round, index) in highScores" :key="round.id" @click="openHistoryRound(round)"><strong>{{ round.score }}</strong><span><b>#{{ index + 1 }} · {{ packs.find((pack) => pack.id === round.packId)?.title || 'Deleted pack' }}{{ roundPlayerLabel(round) }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleDateString() }} · {{ round.durationSeconds }} seconds</small></span><em>View ›</em></button></section>
      <p v-else class="empty-history">Finish a round to start the leaderboard.</p>
    </template>

  </main>
  <div v-if="confirmDialog" class="modal-backdrop" @click.self="closeConfirmDialog(false)">
    <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <p class="eyebrow">{{ confirmDialog.tone === 'danger' ? 'PLEASE CONFIRM' : 'QUICK CHECK' }}</p>
      <h2 id="confirm-modal-title">{{ confirmDialog.title }}</h2>
      <p>{{ confirmDialog.message }}</p>
      <div class="modal-actions">
        <button class="secondary-button" @click="closeConfirmDialog(false)">{{ confirmDialog.cancelText }}</button>
        <button :class="['primary-button', { 'danger-confirm': confirmDialog.tone === 'danger' }]" @click="closeConfirmDialog(true)">{{ confirmDialog.confirmText }}</button>
      </div>
    </section>
  </div>
</template>
