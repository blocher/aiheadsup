/**
 * Capture App Store screenshots from the local Vite preview.
 * Usage: node scripts/capture-app-store-screenshots.mjs [baseUrl]
 *
 * Writes:
 *   store/ios/screenshots/raw/          — iPhone 6.9" class (1290×2796 / 2796×1290)
 *   store/ios/screenshots/raw/ipad/     — iPad 13" class (2048×2732 / 2732×2048)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outRaw = path.join(root, 'store/ios/screenshots/raw')
const outIpad = path.join(outRaw, 'ipad')
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173/'
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForLibrary(page) {
  await page.waitForFunction(() => {
    const loading = document.body.innerText.includes('Loading your magic')
    const packs = document.querySelectorAll('.pack-tile').length
    return !loading && packs > 0
  }, { timeout: 180000 })
}

async function dismissTutorial(page) {
  const skipped = await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Skip')
    if (skip) {
      skip.click()
      return true
    }
    return false
  })
  if (skipped) await sleep(400)
}

async function shot(page, dir, name) {
  const file = path.join(dir, name)
  await page.screenshot({ path: file, type: 'png' })
  console.log('wrote', file)
}

async function openBreakfastPack(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.pack-tile')].find((b) => /Breakfast Foods|Animals and Habitats|Kids Movies|Fast Food/i.test(b.textContent || ''))
      || document.querySelector('.pack-tile')
    btn?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('Start') && document.body.innerText.includes('sec'), { timeout: 15000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(250)
  await page.evaluate(() => document.querySelector('.notice')?.remove())
}

async function startRound(page) {
  await page.evaluate(() => {
    const start = [...document.querySelectorAll('button')].find((b) => /Start .*round/i.test(b.textContent || ''))
    start?.click()
  })
}

async function quitRound(page) {
  await page.evaluate(() => {
    const quit = document.querySelector('button[aria-label="Quit round"]')
    quit?.click()
  })
  await sleep(200)
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Quit round')
    confirm?.click()
  })
  await sleep(400)
}

async function goLibrary(page) {
  // Keep hitting Back until library chrome is visible
  for (let i = 0; i < 4; i++) {
    const onLibrary = await page.evaluate(() => document.body.innerText.includes('Your packs') && document.body.innerText.includes('Make a pack with'))
    if (onLibrary) return
    await page.evaluate(() => document.querySelector('button[aria-label="Back"]')?.click())
    await sleep(250)
  }
}

async function prepareAiCreate(page) {
  await page.evaluate(() => {
    const create = [...document.querySelectorAll('button')].find((b) => /Make a pack with/i.test(b.textContent || ''))
    create?.click()
  })
  await sleep(400)
  await page.evaluate(() => {
    document.querySelector('.notice')?.remove()
    const card = document.querySelector('.form-card')
    if (!card) return
    const h2 = card.querySelector('h2')
    const p = card.querySelector('p:not(.eyebrow)')
    if (h2) h2.textContent = 'Make a pack worth replaying.'
    if (p) {
      p.textContent = 'On iPhone, cards can be generated privately on-device when supported. Or add your own Gemini or OpenAI key — keys stay in Keychain; packs stay on your phone.'
    }
    const btn = card.querySelector('button')
    if (btn) btn.textContent = 'Continue in Settings'
  })
}

async function openTutorialAiSlide(page) {
  await page.evaluate(() => document.querySelector('button[aria-label="Back"]')?.click())
  await sleep(300)
  await page.evaluate(() => document.querySelector('button[aria-label="How to play"]')?.click())
  await sleep(300)
  await page.evaluate(() => {
    const slide = [...document.querySelectorAll('button')].find((b) => /Make your own deck/i.test(b.getAttribute('aria-label') || ''))
    slide?.click()
  })
  await sleep(300)
}

async function captureFlow(page, dir, { portrait, landscape }) {
  await page.setViewport({ ...portrait, isMobile: true, hasTouch: true })
  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 120000 })
  await waitForLibrary(page)

  const hasTutorial = await page.evaluate(() => document.body.innerText.includes('Welcome to Forehead Frenzy'))
  if (hasTutorial) {
    await shot(page, dir, '01-tutorial.png')
    await dismissTutorial(page)
  }

  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(300)
  await page.evaluate(() => document.querySelector('.notice')?.remove())
  await shot(page, dir, '02-library.png')

  await openBreakfastPack(page)
  await shot(page, dir, '03-pack-detail.png')

  await startRound(page)
  await page.setViewport({ ...landscape, isMobile: true, hasTouch: true })
  await page.waitForFunction(() => /CORRECT/i.test(document.body.innerText) && /PASS/i.test(document.body.innerText), { timeout: 20000 })
  await sleep(400)
  await shot(page, dir, '04-gameplay.png')
  await quitRound(page)

  await page.setViewport({ ...portrait, isMobile: true, hasTouch: true })
  await goLibrary(page)
  await prepareAiCreate(page)
  await shot(page, dir, '05-ai-create.png')

  await openTutorialAiSlide(page)
  await shot(page, dir, '06-tutorial-ai.png')
}

async function main() {
  await fs.mkdir(outRaw, { recursive: true })
  await fs.mkdir(outIpad, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: null,
    args: ['--hide-scrollbars', '--disable-font-subpixel-positioning']
  })

  console.log('—— iPhone 6.9" ——')
  {
    const page = await browser.newPage()
    await page.emulateTimezone('America/New_York')
    await captureFlow(page, outRaw, {
      portrait: { width: 430, height: 932, deviceScaleFactor: 3 },
      landscape: { width: 932, height: 430, deviceScaleFactor: 3 }
    })
    await page.close()
  }

  console.log('—— iPad 13" ——')
  // Fresh context so IndexedDB tutorial flag from iPhone capture does not skip the welcome slide.
  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.emulateTimezone('America/New_York')
    await captureFlow(page, outIpad, {
      portrait: { width: 1024, height: 1366, deviceScaleFactor: 2 },
      landscape: { width: 1366, height: 1024, deviceScaleFactor: 2 }
    })
    await context.close()
  }

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
