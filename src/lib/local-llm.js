import { Capacitor } from '@capacitor/core'
import { LocalLLM } from '@capacitor/local-llm'

let cachedStatus = null
let cachedAt = 0
let checkInFlight = null
const STATUS_CACHE_MS = 5000
const CHECK_TIMEOUT_MS = 4000
const NOTREADY_POLL_MS = 1500
const NOTREADY_MAX_POLLS = 3
const IMAGE_TIMEOUT_MS = 20000

const REASON_HINTS = {
  LOCAL_LLM_NOT_ENABLED: 'Apple Intelligence is not enabled in the simulator. Open the Settings app inside the simulator and turn on Apple Intelligence.',
  LOCAL_LLM_UNSUPPORTED_PLATFORM: 'This build needs an iOS 26+ simulator runtime. Confirm Xcode is using an iOS 26 simulator, not an older runtime.',
  LOCAL_LLM_NOT_READY: 'Apple Intelligence is still loading on your Mac. Wait a minute, then tap Check again.',
  LOCAL_LLM_UNAVAILABLE: 'Apple Intelligence is unavailable right now. Confirm it is enabled on your Mac and in the simulator Settings app.',
  LOCAL_LLM_WEB_NOT_SUPPORTED: 'On-device AI only works in the native iPhone/Android app.',
  UNIMPLEMENTED: 'The Local LLM plugin is missing from this iOS build. Run `npx cap sync ios`, clean build in Xcode, and run again.'
}

function getLocalLLM() {
  if (!Capacitor.isNativePlatform()) return null
  return LocalLLM
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeStatus(status) {
  if (status === 'available' || status === 'notready' || status === 'downloadable') return status
  return 'unavailable'
}

function pluginErrorCode(error) {
  return error?.code || error?.errorMessage || null
}

function pluginErrorMessage(error) {
  return error?.message || error?.errorMessage || 'Could not reach on-device AI'
}

async function readSystemAvailability(timeoutMs = CHECK_TIMEOUT_MS) {
  const plugin = getLocalLLM()
  if (!plugin) throw new Error('Local LLM plugin unavailable')
  const raw = await withTimeout(
    plugin.systemAvailability(),
    timeoutMs,
    'On-device AI availability check'
  )
  return normalizeStatus(raw?.status)
}

async function probeDeviceAiReason(timeoutMs = CHECK_TIMEOUT_MS) {
  try {
    const plugin = getLocalLLM()
    if (!plugin) return { code: 'LOCAL_LLM_UNAVAILABLE', message: 'Local LLM plugin unavailable' }
    await withTimeout(
      plugin.warmup({ sessionId: 'forehead-frenzy-probe', promptPrefix: 'You generate short party game cards.' }),
      timeoutMs,
      'On-device AI warmup probe'
    )
    return null
  } catch (error) {
    const code = pluginErrorCode(error)
    if (code === 'UNIMPLEMENTED' || /not implemented/i.test(pluginErrorMessage(error))) {
      return { code: 'UNIMPLEMENTED', message: pluginErrorMessage(error) }
    }
    return { code: code || 'LOCAL_LLM_UNAVAILABLE', message: pluginErrorMessage(error) }
  }
}

async function doGetDeviceAiStatus({ timeoutMs = CHECK_TIMEOUT_MS, useCache = true, pollNotReady = false, probeReason = false } = {}) {
  if (!Capacitor.isNativePlatform()) return { status: 'unavailable', platform: 'web' }
  if (useCache && cachedStatus && !cachedStatus.error && Date.now() - cachedAt < STATUS_CACHE_MS) {
    return cachedStatus
  }

  const platform = Capacitor.getPlatform()

  try {
    let status = await readSystemAvailability(timeoutMs)
    let polls = 0
    while (pollNotReady && status === 'notready' && polls < NOTREADY_MAX_POLLS) {
      polls += 1
      await sleep(NOTREADY_POLL_MS)
      status = await readSystemAvailability(timeoutMs)
    }

    let reason = null
    if (probeReason && status !== 'available') {
      reason = await probeDeviceAiReason(timeoutMs)
      if (reason?.code === 'LOCAL_LLM_NOT_READY') status = 'notready'
    }

    const result = { status, platform, reason: reason?.code || null, reasonMessage: reason?.message || null }
    cachedStatus = result
    cachedAt = Date.now()
    return result
  } catch (error) {
    const code = pluginErrorCode(error)
    const message = pluginErrorMessage(error)
    const reason = code || (/timed out/i.test(message) ? 'TIMEOUT' : 'LOCAL_LLM_UNAVAILABLE')
    const result = {
      status: 'unavailable',
      platform,
      error: message,
      reason,
      reasonMessage: message
    }
    cachedAt = Date.now()
    return result
  }
}

export function isNativeDeviceAiPlatform() {
  return Capacitor.isNativePlatform()
}

export function getDeviceBatchSize() {
  return Capacitor.getPlatform() === 'android' ? 6 : 10
}

export function getDeviceReviewBatchSize() {
  return Capacitor.getPlatform() === 'android' ? 8 : 20
}

export function getDeviceMaxOutputTokens() {
  // A tight cap keeps each on-device call fast. Batches are at most ~10 short
  // 1-4 word cards, so a large budget only invites the model to ramble and
  // slows every generation round without adding usable cards.
  return Capacitor.getPlatform() === 'android' ? 256 : 700
}

export function deviceBadgeLabel(status, { webBuild = !Capacitor.isNativePlatform() } = {}) {
  if (webBuild) return 'Browser'
  if (status === 'available') return 'Ready'
  if (status === 'notready') return 'Loading'
  if (status === 'downloadable') return 'Download'
  return 'Unavailable'
}

export async function getDeviceAiStatus(options = {}) {
  if (!checkInFlight) {
    checkInFlight = doGetDeviceAiStatus(options).finally(() => {
      checkInFlight = null
    })
  }
  return checkInFlight
}

export function startDeviceAiAvailabilityWatch(onChange) {
  if (!Capacitor.isNativePlatform()) return () => {}

  let stopped = false
  let listenerHandle = null

  const emit = (result) => {
    if (!stopped) onChange(result)
  }

  void (async () => {
    try {
      const plugin = getLocalLLM()
      if (!plugin || stopped) return
      listenerHandle = await plugin.addListener('systemAvailabilityChange', ({ status }) => {
        cachedStatus = { status: normalizeStatus(status), platform: Capacitor.getPlatform() }
        cachedAt = Date.now()
        emit(cachedStatus)
      })
      const result = await doGetDeviceAiStatus({ useCache: false, pollNotReady: true, probeReason: false })
      emit(result)
    } catch (error) {
      emit({
        status: 'unavailable',
        platform: Capacitor.getPlatform(),
        error: pluginErrorMessage(error),
        reason: pluginErrorCode(error) || 'LOCAL_LLM_UNAVAILABLE'
      })
    }
  })()

  return () => {
    stopped = true
    void listenerHandle?.remove()
    getLocalLLM()?.removeAllListeners()
  }
}

export class DeviceAiError extends Error {
  constructor(message, { kind = 'generation', cause = null } = {}) {
    super(message)
    this.name = 'DeviceAiError'
    this.kind = kind
    this.cause = cause
  }
}

function describeDeviceGenerationError(error) {
  const raw = `${error?.message || ''} ${JSON.stringify(error || {})}`
  // ModelManagerError 1026 / GenerationError -1: model assets can't load. In the
  // iOS Simulator this happens even when availability reports "available", because
  // Foundation Models inference does not actually run in the simulator sandbox.
  if (/1026|ModelManager|GenerationError|-1/.test(raw)) {
    return new DeviceAiError(
      'On-device Apple Intelligence could not run generation here. The iOS Simulator reports Apple Intelligence as ready but cannot actually run on-device models — test on a physical iPhone (15 Pro or newer, iOS 26+), or add a Gemini/OpenAI key in Settings to generate with cloud AI.',
      { kind: 'model-unavailable', cause: error }
    )
  }
  if (/guardrail|safety/i.test(raw)) {
    return new DeviceAiError('On-device Apple Intelligence blocked this request for safety. Try a different deck topic, or use a cloud AI key.', { kind: 'guardrail', cause: error })
  }
  if (/context|token|exceeded/i.test(raw)) {
    return new DeviceAiError('The deck request was too large for on-device Apple Intelligence. Try fewer cards, or use a cloud AI key.', { kind: 'context', cause: error })
  }
  return new DeviceAiError(error?.message || 'On-device Apple Intelligence generation failed. Add a Gemini or OpenAI key in Settings to use cloud AI instead.', { kind: 'generation', cause: error })
}

export async function downloadDeviceAiModel() {
  const plugin = getLocalLLM()
  if (!plugin) throw new Error('On-device AI is only available in the iPhone and Android apps.')
  await plugin.download()
}

export async function warmupDeviceSession({ sessionId, promptPrefix } = {}) {
  const plugin = getLocalLLM()
  if (!plugin || !sessionId) return false
  try {
    await plugin.warmup({ sessionId, promptPrefix })
    return true
  } catch {
    return false
  }
}

export async function promptDevice({ sessionId, instructions, prompt, maximumOutputTokens = getDeviceMaxOutputTokens() }) {
  const plugin = getLocalLLM()
  if (!plugin) {
    throw new Error('On-device AI is not available in the browser. Add a Gemini or OpenAI key in Settings, or use the iPhone/Android app on a supported device.')
  }
  let text
  try {
    ({ text } = await plugin.prompt({
      sessionId,
      instructions,
      prompt,
      options: { temperature: 0.6, maximumOutputTokens }
    }))
  } catch (error) {
    throw describeDeviceGenerationError(error)
  }
  if (!text?.trim()) throw new DeviceAiError('On-device Apple Intelligence returned an empty response. Try again, or use a cloud AI key.', { kind: 'generation' })
  return text
}

export async function generateDeviceImage(prompt, { timeoutMs = IMAGE_TIMEOUT_MS } = {}) {
  const plugin = getLocalLLM()
  if (!plugin) throw new Error('On-device image generation is not available here.')
  try {
    // Image Playground can hang or take a long time; cap it so a slow or stuck
    // request can't stall deck generation. The caller falls back to a
    // generated cover on failure.
    const { pngBase64Images } = await withTimeout(
      plugin.generateImage({ prompt, count: 1 }),
      timeoutMs,
      'On-device image generation'
    )
    const base64 = pngBase64Images?.[0]
    if (!base64) throw new DeviceAiError('On-device AI did not return an image.', { kind: 'generation' })
    return { base64, mimeType: 'image/png' }
  } catch (error) {
    if (error instanceof DeviceAiError) throw error
    throw describeDeviceGenerationError(error)
  }
}

export function deviceStatusLabel(status, { platform = Capacitor.getPlatform(), webBuild = !Capacitor.isNativePlatform() } = {}) {
  if (webBuild) return 'Use cloud keys in browser'
  if (status === 'available') return platform === 'ios' ? 'Apple Intelligence ready' : 'Gemini Nano ready'
  if (status === 'downloadable') return 'Download required'
  if (status === 'notready') return 'Getting ready…'
  if (platform === 'ios') return 'Requires iOS 26+ with Apple Intelligence'
  return 'Not available on this device'
}

export function deviceStatusHint(status, {
  platform = Capacitor.getPlatform(),
  webBuild = !Capacitor.isNativePlatform(),
  checkError = null,
  reason = null
} = {}) {
  if (webBuild) {
    return 'Safari and desktop browsers cannot use Apple Intelligence or Gemini Nano. Add a Gemini or OpenAI key below — or open Forehead Frenzy on a supported iPhone or Android phone.'
  }
  if (status === 'available') {
    return platform === 'ios'
      ? 'Cards are generated privately on your iPhone with Apple Intelligence. No API key needed.'
      : 'Cards are generated privately on your phone with Gemini Nano. No API key needed.'
  }
  if (status === 'downloadable') {
    return 'Gemini Nano needs a one-time download from Google Play. Tap Download below, then try again.'
  }
  if (status === 'notready') {
    return 'Apple Intelligence is still loading on this device. This usually clears in a few seconds — the status will update automatically.'
  }
  if (reason && REASON_HINTS[reason]) return REASON_HINTS[reason]
  if (checkError) {
    if (/timed out/i.test(checkError)) {
      return 'The on-device AI check timed out. Rebuild the app (`npx cap sync ios`), then tap Check again. If the plugin is linked, also enable Apple Intelligence in the simulator Settings app.'
    }
    return `Could not check on-device AI (${checkError}). Rebuild the app after installing @capacitor/local-llm, then tap Check again.`
  }
  if (platform === 'ios') {
    return 'In the iOS Simulator, Apple Intelligence runs on your Mac. Use an iOS 26+ simulator, enable Apple Intelligence on your Mac, and turn it on in the Simulator Settings app. On a physical iPhone, enable Apple Intelligence in Settings. You can also add a Gemini or OpenAI key below.'
  }
  return 'This phone may not support on-device AI yet. Add a Gemini or OpenAI key below for cloud generation.'
}
