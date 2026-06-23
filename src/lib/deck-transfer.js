import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { deckToToml, parseDeckToml } from './toml-decks.js'

function safeName(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck' }

async function coverBlob(pack) {
  if (!pack.cover) return null
  if (pack.cover.kind === 'blob') return pack.cover.value
  const response = await fetch(pack.cover.value)
  if (!response.ok) throw new Error('Could not read the deck cover for export.')
  return response.blob()
}

function dataToBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export async function buildDeckPackage(pack, cards) {
  const image = await coverBlob(pack)
  const extension = image?.type === 'image/jpeg' ? 'jpg' : image?.type === 'image/webp' ? 'webp' : 'png'
  const imageName = image ? `${safeName(pack.title)}-cover.${extension}` : null
  const toml = deckToToml(pack, cards, imageName)
  const entries = { 'deck.toml': strToU8(toml) }
  if (image) entries[imageName] = new Uint8Array(await image.arrayBuffer())
  return new Blob([zipSync(entries)], { type: 'application/zip' })
}

export async function shareDeckPackage(pack, cards) {
  const blob = await buildDeckPackage(pack, cards)
  const fileName = `${safeName(pack.title)}.zip`
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    return
  }
  const file = await Filesystem.writeFile({ path: fileName, data: dataToBase64(new Uint8Array(await blob.arrayBuffer())), directory: Directory.Cache, recursive: true })
  await Share.share({ title: pack.title, text: 'Forehead Frenzy deck', files: [file.uri] })
}

export async function shareAllAiDeckPackages(items) {
  const entries = {}
  for (const { pack, cards } of items) {
    const image = await coverBlob(pack)
    const folder = `${safeName(pack.title)}-${safeName(pack.id).slice(-8)}`
    const extension = image?.type === 'image/jpeg' ? 'jpg' : image?.type === 'image/webp' ? 'webp' : 'png'
    const imageName = image ? `cover.${extension}` : null
    entries[`${folder}/deck.toml`] = strToU8(deckToToml(pack, cards, imageName))
    if (image) entries[`${folder}/${imageName}`] = new Uint8Array(await image.arrayBuffer())
  }
  const blob = new Blob([zipSync(entries)], { type: 'application/zip' })
  const fileName = 'forehead-frenzy-ai-decks.zip'
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    return
  }
  const file = await Filesystem.writeFile({ path: fileName, data: dataToBase64(new Uint8Array(await blob.arrayBuffer())), directory: Directory.Cache, recursive: true })
  await Share.share({ title: 'Forehead Frenzy AI decks', files: [file.uri] })
}

export async function parseDeckPackages(file) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const tomlPaths = Object.keys(entries).filter((path) => path === 'deck.toml' || path.endsWith('/deck.toml'))
  if (!tomlPaths.length) throw new Error('The ZIP must contain deck.toml.')
  return tomlPaths.map((tomlPath) => {
    const deck = parseDeckToml(strFromU8(entries[tomlPath]))
    const folder = tomlPath === 'deck.toml' ? '' : tomlPath.slice(0, -'deck.toml'.length)
    const imageData = deck.photoFileName ? entries[`${folder}${deck.photoFileName}`] : null
    const cover = imageData ? { kind: 'blob', value: new Blob([imageData], { type: deck.photoFileName.endsWith('.jpg') || deck.photoFileName.endsWith('.jpeg') ? 'image/jpeg' : deck.photoFileName.endsWith('.webp') ? 'image/webp' : 'image/png' }) } : null
    return { deck, cover }
  })
}
