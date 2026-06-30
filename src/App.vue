<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import GameScreen from './components/GameScreen.vue'
import { AiProvider, generateCustomPack } from './lib/ai-provider.js'
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from './lib/ai-providers.js'
import { parseDeckPackages, shareAllAiDeckPackages, shareDeckPackage } from './lib/deck-transfer.js'
import { deleteCustomPack, getCards, getPacks, getRounds, getSetting, getUnusedCards, resetAllPacks, resetPack, saveCustomPack, saveImportedTomlDeck, saveRound, saveSetting, syncBundledDecks } from './lib/database.js'
import { prepareEndCueAudio, setCueVolume } from './lib/end-cues.js'
import { setRoundOutcome, DEFAULT_TILT_SENSITIVITY, TILT_SENSITIVITY_MIN, TILT_SENSITIVITY_MAX } from './lib/game-engine.js'
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
const controlMode = ref('both')
const tiltSensitivity = ref(DEFAULT_TILT_SENSITIVITY)
const tiltSensitivityMin = TILT_SENSITIVITY_MIN
const tiltSensitivityMax = TILT_SENSITIVITY_MAX
const tiltSensitivityLabels = { 1: 'Very firm tip', 2: 'Firm tip', 3: 'Balanced', 4: 'Light tip', 5: 'Feather touch' }
const tiltEnabled = computed(() => controlMode.value !== 'buttons')
const startCountdown = ref(5)
const cueVolume = ref(100)
const endCueMode = ref('sound_haptics')
const settingsTab = ref('gameplay')
const settingsTabs = [
  { id: 'gameplay', label: 'Gameplay', icon: '🎮' },
  { id: 'decks', label: 'Decks & AI', icon: '✨' },
  { id: 'data', label: 'Data', icon: '🗂️' }
]
const gameScreen = ref(null)
const provider = new AiProvider()
const webBuild = !Capacitor.isNativePlatform()
const aiProviders = AI_PROVIDERS
const providerKeyState = ref(Object.fromEntries(AI_PROVIDERS.map((entry) => [entry.id, false])))
const activeProviderId = ref(DEFAULT_PROVIDER_ID)
const keyDrafts = ref(Object.fromEntries(AI_PROVIDERS.map((entry) => [entry.id, ''])))
const infoProviderId = ref(null)
const keyedProviders = computed(() => AI_PROVIDERS.filter((entry) => providerKeyState.value[entry.id]))
const hasAnyKey = computed(() => keyedProviders.value.length > 0)
const activeProvider = computed(() => getProvider(activeProviderId.value) || keyedProviders.value[0] || AI_PROVIDERS[0])
const infoProvider = computed(() => getProvider(infoProviderId.value))
const notice = ref('')
const loading = ref(true)
const creation = ref({ name: '', category: 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', cardCount: 100, spoilerSeries: '', specialPromptNote: '' })
const creating = ref(false)
const progress = ref(null)
const importInput = ref(null)
const selectedCategory = ref('all')
const deleteAiOnReset = ref(false)
const confirmDialog = ref(null)
let confirmDialogResolve = null

const packCounts = ref({})
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
function deckHighScore(packId) {
  if (!packId) return null
  const rounds = history.value.filter((round) => round.packId === packId)
  if (!rounds.length) return null
  return rounds
    .map((round) => ({ ...round, score: roundScore(round) }))
    .sort((left, right) => right.score - left.score || new Date(right.endedAt || right.startedAt) - new Date(left.endedAt || left.startedAt))[0]
}
function deckRecentRounds(packId) {
  if (!packId) return []
  return history.value
    .filter((round) => round.packId === packId)
    .map((round) => ({ ...round, score: roundScore(round) }))
}
const selectedPackHighScore = computed(() => selectedPack.value ? deckHighScore(selectedPack.value.id) : null)
const selectedPackRecentRounds = computed(() => selectedPack.value ? deckRecentRounds(selectedPack.value.id) : [])
const finishedRoundHighScore = computed(() => finishedRound.value ? deckHighScore(finishedRound.value.packId) : null)
const finishedRoundRecentRounds = computed(() => finishedRound.value ? deckRecentRounds(finishedRound.value.packId) : [])
const isNewDeckHighScore = computed(() => {
  if (!finishedRound.value || !finishedRoundHighScore.value) return false
  return finishedRoundHighScore.value.id === finishedRound.value.id
})
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
  Sports: '⚽',
  Nonsense: '🤪',
  'TV Shows': '📺',
  Music: '🎵',
  'Colleges and Universities': '🎓'
}
function categoryIcon(category) { return categoryIcons[category] || '✨' }

function cardStats(pack) {
  const packId = typeof pack === 'string' ? pack : pack?.id
  return packCounts.value[packId] || { fresh: 0, total: 0 }
}

function freshCount(pack) { return cardStats(pack).fresh }
function totalCount(pack) { return cardStats(pack).total }
function freshCardLabel(pack) {
  const stats = cardStats(pack)
  return `${stats.fresh} / ${stats.total} fresh`
}
function lowFreshCards(pack) {
  const stats = cardStats(pack)
  return stats.total > 0 && stats.fresh > 0 && stats.fresh <= Math.max(5, Math.ceil(stats.total * 0.15))
}
function emptyFreshCards(pack) {
  const stats = cardStats(pack)
  return stats.total > 0 && stats.fresh === 0
}
function needsFreshReset(pack) { return lowFreshCards(pack) || emptyFreshCards(pack) }

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
  const counts = await Promise.all(packs.value.map(async (pack) => {
    const [freshCards, allCards] = await Promise.all([getUnusedCards(pack.id, spoilerLimits.value), getCards(pack.id)])
    return [pack.id, { fresh: freshCards.length, total: allCards.length }]
  }))
  packCounts.value = Object.fromEntries(counts)
}

async function refreshHistory() { history.value = await getRounds() }

async function refreshKeys() {
  const entries = await Promise.all(AI_PROVIDERS.map(async (entry) => {
    try { return [entry.id, await provider.hasKey(entry.id)] } catch { return [entry.id, false] }
  }))
  providerKeyState.value = Object.fromEntries(entries)
  if (!providerKeyState.value[activeProviderId.value] && keyedProviders.value.length) {
    activeProviderId.value = keyedProviders.value[0].id
  }
}

function openPack(pack) {
  selectedPack.value = pack
  notice.value = ''
  screen.value = 'detail'
}

async function confirmLeaveGeneration() {
  if (!creating.value || screen.value !== 'create') return true
  return askForConfirmation({
    title: 'Leave while generating?',
    message: 'Your deck is still being created. Leaving this screen may interrupt generation and you could lose the new deck. Stay until it finishes.',
    confirmText: 'Leave anyway',
    cancelText: 'Keep waiting',
    tone: 'danger'
  })
}

async function goBack() {
  if (screen.value === 'game') {
    await gameScreen.value?.requestAbort()
    return
  }
  if (!(await confirmLeaveGeneration())) return
  screen.value = screen.value === 'results' && selectedPack.value ? 'detail' : 'library'
}

async function openSettings() {
  if (!(await confirmLeaveGeneration())) return
  screen.value = 'settings'
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
  if (tiltEnabled.value) {
    const motionAccess = await requestMotionPermission()
    if (!motionAccess.granted) {
      notice.value = motionAccess.error
        ? 'iOS could not start motion sensing. Close and reopen Forehead Frenzy, then start a round and allow motion access.'
        : 'Motion access was not granted. Start the round again and allow motion access so tilting can mark Correct and Pass.'
      return
    }
  }
  const cards = await getUnusedCards(selectedPack.value.id, spoilerLimits.value)
  if (!cards.length) { notice.value = 'This deck is out of fresh cards. Reset deck freshness to make every card available again.'; return }
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
  const total = totalCount(selectedPack.value)
  const confirmed = await askForConfirmation({
    title: 'Reset deck freshness?',
    message: `Reset “${selectedPack.value.title}”? This makes ${total ? `all ${total} cards` : 'every card'} in this deck fresh again. Saved scores stay in history.`,
    confirmText: 'Reset freshness',
    tone: 'normal'
  })
  if (!confirmed) return
  await resetPack(selectedPack.value.id)
  await refreshPacks()
  notice.value = 'Deck freshness reset. Every card in this deck is available again.'
}

async function confirmResetAll() {
  const aiNote = deleteAiOnReset.value ? ` It will also permanently delete ${aiPacks.value.length} AI-created pack${aiPacks.value.length === 1 ? '' : 's'} and their cards, but saved scores stay in history.` : ''
  const confirmed = await askForConfirmation({
    title: 'Reset all deck freshness?',
    message: `This makes every card in every deck fresh again. Saved scores stay in history.${aiNote}`,
    confirmText: 'Reset freshness',
    tone: deleteAiOnReset.value ? 'danger' : 'normal'
  })
  if (!confirmed) return
  try {
    const { deletedAiPackCount } = await resetAllPacks({ deleteAiGenerated: deleteAiOnReset.value })
    selectedPack.value = null
    await Promise.all([refreshPacks(), refreshHistory()])
    notice.value = deletedAiPackCount ? `All deck freshness reset. ${deletedAiPackCount} AI pack${deletedAiPackCount === 1 ? '' : 's'} deleted. Saved scores stayed.` : 'All deck freshness reset. Every card is fresh again, and saved scores stayed.'
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

async function saveProviderKey(providerId) {
  const meta = getProvider(providerId)
  const draft = (keyDrafts.value[providerId] || '').trim()
  if (draft.length < 16) { notice.value = `Paste a complete ${meta.label} API key.`; return }
  try {
    await provider.saveKey(providerId, draft)
    keyDrafts.value = { ...keyDrafts.value, [providerId]: '' }
    await refreshKeys()
    if (keyedProviders.value.length === 1) await selectProvider(providerId)
    notice.value = webBuild ? `${meta.label} key saved in this browser.` : `${meta.label} key saved in iOS Keychain.`
  } catch (error) { notice.value = error.message || `Could not save the ${meta.label} key.` }
}

async function removeProviderKey(providerId) {
  const meta = getProvider(providerId)
  const confirmed = await askForConfirmation({
    title: `Remove the ${meta.label} key?`,
    message: `Forget the saved ${meta.label} API key${webBuild ? ' from this browser' : ' from this iPhone'}? You can paste it again any time.`,
    confirmText: 'Remove key',
    tone: 'danger'
  })
  if (!confirmed) return
  try {
    await provider.removeKey(providerId)
    await refreshKeys()
    notice.value = `${meta.label} key removed.`
  } catch (error) { notice.value = error.message || `Could not remove the ${meta.label} key.` }
}

async function selectProvider(providerId) {
  activeProviderId.value = providerId
  await saveSetting('aiProvider', providerId)
  notice.value = `New decks will be generated with ${getProvider(providerId).label}.`
}

function openProviderInfo(providerId) { infoProviderId.value = providerId }
function closeProviderInfo() { infoProviderId.value = null }
function goToAiSettings() { notice.value = ''; settingsTab.value = 'decks'; screen.value = 'settings' }

async function updateSpoilerLimit(seriesId) {
  spoilerLimits.value = { ...spoilerLimits.value, [seriesId]: Number(spoilerLimits.value[seriesId]) }
  await saveSetting('spoilerLimits', spoilerLimits.value)
  await refreshPacks()
  const series = spoilerSeriesOptions.find((option) => option.id === seriesId)
  notice.value = `${series.label} packs now avoid spoilers after ${series.installments[spoilerLimits.value[seriesId] - 1]}.`
}

function spoilerLabel(pack) { return spoilerProgressLabel(pack, spoilerLimits.value) }

async function updateControlMode() {
  await saveSetting('controlMode', controlMode.value)
  notice.value = controlMode.value === 'tilt'
    ? 'Tilt-only control. Correct and Pass buttons are hidden during rounds.'
    : controlMode.value === 'buttons'
      ? 'Button-only control. Tilting will not score during rounds.'
      : 'Tilt and buttons are both active during rounds.'
}

async function updateTiltSensitivity() {
  tiltSensitivity.value = Number(tiltSensitivity.value)
  await saveSetting('tiltSensitivity', tiltSensitivity.value)
  notice.value = `Tilt sensitivity set to ${tiltSensitivityLabels[tiltSensitivity.value] || tiltSensitivity.value}.`
}

async function updateEndCueMode() {
  await saveSetting('endCueMode', endCueMode.value)
  notice.value = endCueMode.value === 'visual'
    ? 'Game cues are visual only.'
    : endCueMode.value === 'haptics'
      ? 'Game cues are visual and haptic.'
      : endCueMode.value === 'sound'
        ? 'Game sound cues are on.'
        : 'Game sound and haptic cues are on.'
}

async function updateStartCountdown() {
  startCountdown.value = Math.max(1, Math.min(12, Math.round(Number(startCountdown.value)) || 5))
  await saveSetting('startCountdown', startCountdown.value)
  notice.value = `Rounds start after a ${startCountdown.value}-second countdown.`
}

async function updateCueVolume() {
  cueVolume.value = Math.max(0, Math.min(100, Math.round(Number(cueVolume.value))))
  setCueVolume(cueVolume.value / 100)
  await saveSetting('cueVolume', cueVolume.value)
  notice.value = cueVolume.value === 0 ? 'Game beeps are muted.' : `Game beep volume set to ${cueVolume.value}%.`
}

async function createPack() {
  const name = creation.value.name.trim()
  if (name.length < 2) { notice.value = 'Give your deck a name.'; return }
  const category = creation.value.category === '__new__' ? creation.value.newCategory.trim() : creation.value.category.trim()
  if (category.length < 2) { notice.value = 'Choose or add a category.'; return }
  if (!hasAnyKey.value) { notice.value = 'Add an AI provider key in Settings before generating a pack.'; return }
  const providerId = activeProvider.value.id
  creating.value = true
  progress.value = { phase: 'generating', batch: 0, totalBatches: Math.ceil(creation.value.cardCount / 50), cardCount: 0, targetCardCount: creation.value.cardCount }
  notice.value = `Creating “${name}” with ${activeProvider.value.label}…`
  try {
    const result = await generateCustomPack(provider, { ...creation.value, name, category, providerId }, (next) => { progress.value = next })
    await saveCustomPack(result.pack, result.cards)
    await refreshPacks()
    selectedPack.value = packs.value.find((pack) => pack.id === result.pack.id) || result.pack
    creation.value = { name: '', category: categories.value[0] || 'Harry Potter', newCategory: '', audience: 'Family', difficulty: 'Easy', cardCount: 100, spoilerSeries: '', specialPromptNote: '' }
    screen.value = 'detail'
    notice.value = `“${result.pack.title}” is ready with ${result.cards.length} cards.`
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
  const savedControlMode = await getSetting('controlMode', null)
  controlMode.value = savedControlMode || (await getSetting('tiltOnly', false) ? 'tilt' : 'both')
  tiltSensitivity.value = Number(await getSetting('tiltSensitivity', DEFAULT_TILT_SENSITIVITY)) || DEFAULT_TILT_SENSITIVITY
  startCountdown.value = Math.max(1, Math.min(12, Number(await getSetting('startCountdown', 5)) || 5))
  cueVolume.value = Math.max(0, Math.min(100, Number(await getSetting('cueVolume', 100))))
  setCueVolume(cueVolume.value / 100)
  endCueMode.value = await getSetting('endCueMode', 'sound_haptics')
  activeProviderId.value = await getSetting('aiProvider', DEFAULT_PROVIDER_ID)
  await Promise.all([refreshPacks(), refreshHistory(), refreshKeys()])
  window.history.replaceState({ foreheadFrenzy: true }, '', window.location.href)
  window.history.pushState({ foreheadFrenzy: true }, '', window.location.href)
  window.addEventListener('popstate', keepBrowserInsideApp)
  loading.value = false
})

onBeforeUnmount(() => window.removeEventListener('popstate', keepBrowserInsideApp))
</script>

<template>
  <GameScreen v-if="screen === 'game'" ref="gameScreen" :pack="selectedPack" :cards="activeCards" :duration="duration" :control-mode="controlMode" :tilt-sensitivity="tiltSensitivity" :start-countdown="startCountdown" :end-cue-mode="endCueMode" :confirm-abort="confirmAbortGame" @finish="finishGame" @abort="abortGame" />
  <main v-else :class="['app-shell', { 'pack-detail-screen': screen === 'detail' }]">
    <header class="topbar">
      <button v-if="screen !== 'library'" class="icon-button" aria-label="Back" @click="goBack">‹</button><span v-else class="topbar-spacer"></span>
      <div><p class="eyebrow">PARTY PROMPT GAME</p><h1>Forehead Frenzy</h1></div>
      <button class="icon-button" aria-label="Settings" @click="openSettings">⚙</button>
    </header>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <section v-if="loading" class="empty-state"><strong>Loading your magic…</strong></section>

    <template v-else-if="screen === 'library'">
      <section class="hero"><p>Big cards. Loud clues. Zero setup.</p><h2>Pick a pack and get silly.</h2><button class="primary-button" @click="screen = 'create'">✨ Make a pack with AI</button><div class="deck-library-actions"><button @click="openImportPicker">Import TOML package</button><button v-if="aiPacks.length" @click="exportAllAiDecks">Export AI decks</button></div><input ref="importInput" class="visually-hidden" type="file" accept=".zip,application/zip" @change="importDecks" /></section>
      <section class="library-activity-actions"><button @click="screen = 'history'"><span class="activity-icon">◷</span><span><b>Recent rounds</b><small>{{ history.length }} played</small></span><em>›</em></button><button @click="screen = 'scores'"><span class="activity-icon">🏆</span><span><b>All-time high scores</b><small>{{ highScores.length ? `${highScores[0].score} best score` : 'No scores yet' }}</small></span><em>›</em></button></section>
      <section class="library-heading"><h2>Your packs</h2><span>{{ packs.length }} ready</span></section>
      <section class="library-heading"><h3>Categories</h3></section>
      <nav v-if="categories.length" class="category-filter" aria-label="Filter packs by category">
        <button :class="{ selected: selectedCategory === 'all' }" :aria-pressed="selectedCategory === 'all'" @click="selectedCategory = 'all'"><span class="category-filter-icon">✦</span><span>All packs</span><b>{{ packs.length }}</b></button>
        <button v-for="category in categories" :key="category" :class="{ selected: selectedCategory === category }" :aria-pressed="selectedCategory === category" @click="selectedCategory = category"><span class="category-filter-icon">{{ categoryIcon(category) }}</span><span>{{ category }}</span><b>{{ packs.filter((pack) => pack.category === category).length }}</b></button>
      </nav>
      <section v-if="categoryGroups.length" class="category-sections">
        <section v-for="group in categoryGroups" :key="group.category" class="category-section">
          <header class="category-heading"><span class="category-heading-icon" aria-hidden="true">{{ categoryIcon(group.category) }}</span><div><p>Category</p><h2>{{ group.category }}</h2></div><span>{{ group.packs.length }} pack{{ group.packs.length === 1 ? '' : 's' }}</span></header>
          <div class="pack-grid">
            <button v-for="pack in group.packs" :key="pack.id" :class="['pack-tile', { 'low-fresh': lowFreshCards(pack), 'out-of-fresh': emptyFreshCards(pack) }]" @click="openPack(pack)">
              <img v-if="pack.cover" :src="coverUrl(pack)" alt="" />
              <span class="pack-shade"></span>
              <span class="pack-meta"><small>{{ pack.difficulty }} · {{ pack.audience }}</small><strong>{{ pack.title }}</strong><em>{{ freshCardLabel(pack) }} cards</em></span>
            </button>
          </div>
        </section>
      </section>
      <p v-else class="empty-history">No packs in this category yet.</p>
  </template>

    <template v-else-if="screen === 'detail' && selectedPack">
      <section class="pack-detail-cover"><img v-if="selectedPack.cover" :src="coverUrl(selectedPack)" alt="" /><div><p>{{ selectedPack.category }} · {{ selectedPack.difficulty }}</p><h2>{{ selectedPack.title }}</h2><span>{{ freshCardLabel(selectedPack) }} cards{{ selectedPack.spoilerMode ? ` · spoiler-safe through ${spoilerLabel(selectedPack)}` : '' }}</span></div></section>
      <section v-if="needsFreshReset(selectedPack)" :class="['deck-status-card', { urgent: emptyFreshCards(selectedPack) }]"><h3>{{ emptyFreshCards(selectedPack) ? 'No fresh cards left' : 'Fresh cards running low' }}</h3><p>{{ emptyFreshCards(selectedPack) ? 'Reset deck freshness to make every card available again. Saved scores stay in history.' : `Only ${freshCount(selectedPack)} of ${totalCount(selectedPack)} cards are fresh. Reset when you want the full deck back in rotation; saved scores stay.` }}</p><button class="secondary-button wide" @click="confirmReset">Reset deck freshness</button></section>
      <section class="detail-card"><h3>Ready, set, forehead.</h3><p>Hold your phone screen-out to your forehead. Friends clue you in. {{ controlMode === 'buttons' ? 'Tap Correct or Pass on screen to score.' : controlMode === 'tilt' ? 'Tilt down for correct, up to pass.' : 'Tilt down for correct, up to pass, or use the on-screen buttons.' }}</p><div class="duration-picker"><button v-for="option in [30, 60, 90]" :key="option" :class="{ selected: duration === option }" @click="duration = option">{{ option }} sec</button></div><button class="primary-button wide" :disabled="!freshCount(selectedPack)" @click="beginGame">Start {{ duration }}-second round</button></section>
      <section v-if="selectedPackHighScore || selectedPackRecentRounds.length" class="deck-score-card">
        <div v-if="selectedPackHighScore" class="deck-high-score">
          <span class="activity-icon">🏆</span>
          <span><b>Deck high score</b><small>{{ selectedPackHighScore.score }} correct{{ roundPlayerLabel(selectedPackHighScore) }} · {{ new Date(selectedPackHighScore.endedAt || selectedPackHighScore.startedAt).toLocaleDateString() }} · {{ selectedPackHighScore.durationSeconds }} sec</small></span>
        </div>
        <template v-if="selectedPackRecentRounds.length">
          <h3>Recent rounds</h3>
          <section class="recent-rounds history-list compact"><button v-for="round in selectedPackRecentRounds" :key="round.id" @click="openHistoryRound(round)"><strong>{{ round.score }}</strong><span><b>{{ round.playerName || 'Anonymous' }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleString() }} · {{ round.durationSeconds }} seconds</small></span><em>View ›</em></button></section>
        </template>
      </section>
      <div class="manage-row"><button @click="confirmReset">Reset deck freshness</button><button v-if="selectedPack.isAiGenerated" @click="exportDeck(selectedPack)">Export TOML package</button><button v-if="selectedPack.source !== 'bundled_toml'" class="danger" @click="removePack">Delete deck</button></div>
    </template>

    <template v-else-if="screen === 'create'">
      <section v-if="!hasAnyKey" class="form-card connect-card">
        <p class="eyebrow">YOUR OWN DECK</p><h2>Connect an AI provider first.</h2>
        <p>Forehead Frenzy can build a custom deck with {{ aiProviders.map((entry) => entry.label).join(' or ') }}. Add an API key in Settings to turn it on — your key stays {{ webBuild ? 'in this browser' : 'on this iPhone' }}.</p>
        <button class="primary-button wide" @click="goToAiSettings">Add an API key in Settings</button>
      </section>
      <section v-else :class="['form-card', { generating: creating }]">
        <p class="eyebrow">YOUR OWN DECK</p><h2>Make a pack worth replaying.</h2><p>{{ activeProvider.label }} creates simple, 1–4 word cards and a cover image. Your pack stays {{ webBuild ? 'in this browser' : 'on this phone' }}.</p>
        <label v-if="keyedProviders.length > 1">AI provider<div class="segmented"><button v-for="entry in keyedProviders" :key="entry.id" :class="{ selected: activeProviderId === entry.id }" :disabled="creating" @click="selectProvider(entry.id)">{{ entry.short }}</button></div></label>
        <label>Deck name<input v-model="creation.name" maxlength="60" placeholder="e.g. Taylor Swift Songs" :disabled="creating" required /><small>Shown as the deck title and guides the cards the AI writes.</small></label>
        <label>Category<select v-model="creation.category" :disabled="creating"><option v-for="category in categories" :key="category" :value="category">{{ category }}</option><option value="__new__">Add a new category…</option></select></label><label v-if="creation.category === '__new__'">New category<input v-model="creation.newCategory" maxlength="60" placeholder="e.g. 90s movies" :disabled="creating" /></label><label>AI guidance (optional)<input v-model="creation.specialPromptNote" maxlength="180" placeholder="e.g. use movie titles only" :disabled="creating" /></label><label>Best for<select v-model="creation.audience" :disabled="creating"><option>Kids</option><option>Family</option><option>Teens+</option><option>Adults</option></select></label><label>Difficulty<div class="segmented"><button v-for="level in ['Easy', 'Medium', 'Hard']" :key="level" :class="{ selected: creation.difficulty === level }" :disabled="creating" @click="creation.difficulty = level">{{ level }}</button></div></label><label>Number of cards<select v-model.number="creation.cardCount" :disabled="creating"><option v-for="count in [50, 100, 150, 200, 250, 300, 350]" :key="count" :value="count">{{ count }} cards</option></select></label><label>Spoiler protection<select v-model="creation.spoilerSeries" :disabled="creating"><option value="">None</option><option v-for="series in spoilerSeriesOptions" :key="series.id" :value="series.id">{{ series.label }}</option></select><small>Tags each card with its first-revealed installment and follows the matching setting.</small></label><div v-if="progress" class="progress"><span>{{ progress.phase === 'reviewing' ? `Reviewing batch ${progress.chunk} of ${progress.chunkCount}` : `Batch ${progress.batch} of ${progress.totalBatches}` }}</span><strong>{{ progress.phase === 'reviewing' ? `${progress.reviewedCount} / ${progress.targetCardCount} checked` : `${progress.cardCount} / ${progress.targetCardCount} cards` }}</strong><i><b :style="{ width: `${((progress.phase === 'reviewing' ? progress.reviewedCount : progress.cardCount) / progress.targetCardCount) * 100}%` }"></b></i></div><p class="tiny-note generation-hint">Generating takes a minute or two. Keep this screen open until it finishes.{{ activeProvider.id === 'openai' ? ' OpenAI is usually slower than Gemini, so this may take a while.' : '' }}</p><button class="primary-button wide" :disabled="creating || creation.name.trim().length < 2" @click="createPack">{{ creating ? 'Creating your pack…' : `Generate ${creation.cardCount} cards with ${activeProvider.short}` }}</button>
        <div v-if="creating" class="generating-overlay" role="status" aria-live="polite">
          <span class="generating-spinner" aria-hidden="true"></span>
          <strong>Creating “{{ creation.name.trim() || 'your deck' }}”…</strong>
          <span v-if="progress" class="generating-progress">{{ progress.phase === 'reviewing' ? `Reviewing cards… ${progress.reviewedCount} / ${progress.targetCardCount} checked · batch ${progress.chunk} of ${progress.chunkCount}` : `${progress.cardCount} / ${progress.targetCardCount} cards${progress.totalBatches ? ` · batch ${progress.batch} of ${progress.totalBatches}` : ''}` }}</span>
          <span class="generating-warning">Please keep this screen open. Leaving may interrupt generation{{ activeProvider.id === 'openai' ? ' — OpenAI can be slow' : '' }}.</span>
        </div>
      </section>
    </template>

    <template v-else-if="screen === 'settings'">
      <nav class="settings-tabs" role="tablist" aria-label="Settings sections">
        <button v-for="tab in settingsTabs" :key="tab.id" type="button" role="tab" :id="`settings-tab-${tab.id}`" :aria-selected="settingsTab === tab.id" :aria-controls="`settings-panel-${tab.id}`" :class="{ selected: settingsTab === tab.id }" @click="settingsTab = tab.id"><span aria-hidden="true">{{ tab.icon }}</span>{{ tab.label }}</button>
      </nav>

      <section v-show="settingsTab === 'gameplay'" :id="`settings-panel-gameplay`" class="form-card" role="tabpanel" aria-labelledby="settings-tab-gameplay" tabindex="0">
        <p class="eyebrow">GAMEPLAY</p><h2>Controls &amp; cues</h2><p>Tune how rounds are scored and what feedback you get while playing.</p>
        <h3>Scoring controls</h3>
        <label>How to score<select v-model="controlMode" @change="updateControlMode"><option value="both">Tilt and buttons</option><option value="tilt">Tilt only</option><option value="buttons">Buttons only</option></select><small>Choose whether rounds are scored by tilting the phone, tapping Correct/Pass, or both.</small></label>
        <label v-if="controlMode !== 'buttons'">Tilt sensitivity<input v-model.number="tiltSensitivity" type="range" :min="tiltSensitivityMin" :max="tiltSensitivityMax" step="1" @change="updateTiltSensitivity" /><span class="range-scale" aria-hidden="true"><b>Firm tip</b><b>Feather touch</b></span><small>{{ tiltSensitivityLabels[tiltSensitivity] }} — lower needs a bigger, more deliberate tip so you stop passing by accident.</small></label>
        <label>Start countdown<select v-model.number="startCountdown" @change="updateStartCountdown"><option v-for="n in 12" :key="n" :value="n">{{ n }} second{{ n === 1 ? '' : 's' }}</option></select><small>How long the “hold the phone to your forehead” countdown lasts before each round.</small></label>
        <hr /><h3>Feedback cues</h3>
        <label>Game cues<select v-model="endCueMode" @change="updateEndCueMode"><option value="visual">Visual only</option><option value="haptics">Visual + haptics</option><option value="sound">Visual + sound</option><option value="sound_haptics">Visual + sound + haptics</option></select></label>
        <label v-if="endCueMode === 'sound' || endCueMode === 'sound_haptics'">Beep volume<input v-model.number="cueVolume" type="range" min="0" max="100" step="5" @change="updateCueVolume" /><span class="range-scale" aria-hidden="true"><b>Off</b><b>Loud</b></span><small>{{ cueVolume === 0 ? 'Beeps are muted.' : `Beeps play at ${cueVolume}%.` }}</small></label>
        <hr /><h3>How to play</h3><p>On the game card: tilt down for correct, tilt up to pass, or tap the on-screen buttons — depending on your control setting above. Browser and device back actions end the current round and show results instead of leaving the app.</p>
      </section>

      <section v-show="settingsTab === 'decks'" :id="`settings-panel-decks`" class="form-card" role="tabpanel" aria-labelledby="settings-tab-decks" tabindex="0">
        <p class="eyebrow">PRIVATE SETUP</p><h2>AI deck generation</h2><p v-if="webBuild">Add a key for any provider you want to use. Keys are stored only in this browser’s local storage — convenient for this local web app, but anyone with this browser profile can read them.</p><p v-else>Add a key for any provider you want to use. Keys are stored in iOS Keychain, never in the app bundle or this repository.</p>
        <div class="provider-list">
          <article v-for="entry in aiProviders" :key="entry.id" :class="['provider-card', { connected: providerKeyState[entry.id] }]">
            <header class="provider-card-head"><div><b>{{ entry.label }}</b><small>{{ entry.keyPrefixHint }}</small></div><div class="provider-card-tools"><span :class="['provider-badge', { connected: providerKeyState[entry.id] }]">{{ providerKeyState[entry.id] ? 'Connected' : 'Not connected' }}</span><button class="info-button" :aria-label="`How to get a ${entry.label} key`" @click="openProviderInfo(entry.id)">ⓘ</button></div></header>
            <template v-if="providerKeyState[entry.id]">
              <button v-if="keyedProviders.length > 1 && activeProviderId === entry.id" class="provider-active-pill" disabled>✓ Active for new decks</button>
              <button v-else-if="keyedProviders.length > 1" class="secondary-button wide" @click="selectProvider(entry.id)">Use for new decks</button>
              <button class="link-button danger" @click="removeProviderKey(entry.id)">Remove {{ entry.short }} key</button>
            </template>
            <template v-else>
              <label class="provider-key-field"><span class="visually-hidden">{{ entry.label }} API key</span><input v-model="keyDrafts[entry.id]" type="password" autocapitalize="off" autocomplete="off" spellcheck="false" :placeholder="`Paste your ${entry.label} key`" /></label>
              <button class="primary-button wide" @click="saveProviderKey(entry.id)">Save {{ entry.short }} key</button>
            </template>
          </article>
        </div>
        <hr /><h3>No-spoiler mode</h3><p>Protected packs only draw cards revealed on or before the installment selected for their franchise.</p><label v-for="series in spoilerSeriesOptions" :key="series.id">{{ series.label }} through<select v-model="spoilerLimits[series.id]" @change="updateSpoilerLimit(series.id)"><option v-for="(installment, index) in series.installments" :key="index" :value="index + 1">{{ installment }}</option></select></label>
      </section>

      <section v-show="settingsTab === 'data'" :id="`settings-panel-data`" class="form-card" role="tabpanel" aria-labelledby="settings-tab-data" tabindex="0">
        <p class="eyebrow">DATA</p><h2>Deck data</h2><p>Manage card freshness across every deck. Saved scores and round history are always kept.</p>
        <section class="reset-all-card"><h3>Reset all deck freshness</h3><p>Make every card in every deck fresh again. Saved scores and round history stay.</p><label class="checkbox-row"><input v-model="deleteAiOnReset" type="checkbox" /><span><b>Also delete AI-created packs</b><small>{{ aiPacks.length }} AI-created pack{{ aiPacks.length === 1 ? '' : 's' }} will be permanently deleted.</small></span></label><button class="secondary-button wide" @click="confirmResetAll">Reset all deck freshness</button></section>
      </section>
    </template>

    <template v-else-if="screen === 'results'">
      <section class="results-hero"><p>{{ finishedRound?.endedReason === 'cards_exhausted' ? 'DECK COMPLETE' : 'ROUND COMPLETE' }}</p><strong>{{ score }}</strong><h2>correct answers</h2><span>{{ finishedRound?.endedReason === 'cards_exhausted' ? 'You played every fresh card in this deck.' : `${results.filter((result) => result.result === 'passed').length} wrong / passed` }}</span><p v-if="isNewDeckHighScore" class="new-deck-record">🏆 New deck high score!</p><p v-else-if="finishedRoundHighScore" class="deck-record-note">Deck high score: {{ finishedRoundHighScore.score }}</p></section>
      <section v-if="finishedRoundRecentRounds.length > 1" class="deck-score-card">
        <h3>Recent rounds on this deck</h3>
        <section class="recent-rounds history-list compact"><button v-for="round in finishedRoundRecentRounds" :key="round.id" :class="{ current: round.id === finishedRound?.id }" @click="openHistoryRound(round)"><strong>{{ round.score }}</strong><span><b>{{ round.playerName || 'Anonymous' }}{{ round.id === finishedRound?.id ? ' · this round' : '' }}</b><small>{{ new Date(round.endedAt || round.startedAt).toLocaleString() }} · {{ round.durationSeconds }} seconds</small></span><em>View ›</em></button></section>
      </section>
      <section v-if="finishedRound?.endedReason === 'cards_exhausted' && selectedPack" class="deck-status-card urgent"><h3>That was the last fresh card</h3><p>Your score was saved. Reset deck freshness when you want to make every card available again; saved scores stay.</p><button class="secondary-button wide" @click="confirmReset">Reset deck freshness</button></section>
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
  <div v-if="infoProvider" class="modal-backdrop" @click.self="closeProviderInfo">
    <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title">
      <p class="eyebrow">API KEY HELP</p>
      <h2 id="info-modal-title">Get a {{ infoProvider.label }} key</h2>
      <ol class="info-steps"><li v-for="(step, index) in infoProvider.keyHelpSteps" :key="index">{{ step }}</li></ol>
      <div class="modal-actions">
        <button class="secondary-button" @click="closeProviderInfo">Close</button>
        <a class="primary-button info-open-link" :href="infoProvider.keyHelpUrl" target="_blank" rel="noopener noreferrer" @click="closeProviderInfo">Open {{ infoProvider.short }} site</a>
      </div>
    </section>
  </div>
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
