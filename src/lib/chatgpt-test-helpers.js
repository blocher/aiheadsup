// Shared fixtures for the ChatGPT sign-in tests (not shipped in the app bundle;
// only *.test.js files import it).
import { base64UrlEncode } from './chatgpt-auth.js'

export class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, String(value)) }
  removeItem(key) { this.map.delete(key) }
  values() { return [...this.map.values()] }
}

export async function createSigningKey(kid = 'test-key') {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', publicKey)
  return { kid, privateKey, jwks: { keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' }] } }
}

function encodeSegment(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)))
}

export async function signIdToken({ kid, privateKey }, claims) {
  const signingInput = `${encodeSegment({ alg: 'RS256', typ: 'JWT', kid })}.${encodeSegment(claims)}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
