import { describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  prepareChatGptCallback: vi.fn(),
  openChatGptAuthorization: vi.fn()
}))
vi.mock('./secure-ai.js', () => ({ SecureAi: plugin }))

const { signInNatively } = await import('./chatgpt-platform.js')

describe('native ChatGPT sign-in', () => {
  it('builds the authorize URL for the native listener port and finishes with its callback', async () => {
    plugin.prepareChatGptCallback.mockResolvedValue({ redirectUri: 'http://127.0.0.1:61234/auth/callback' })
    plugin.openChatGptAuthorization.mockResolvedValue({ callbackUrl: 'http://127.0.0.1:61234/auth/callback?code=c&state=s' })
    const session = {
      beginSignIn: vi.fn().mockResolvedValue('https://auth.openai.com/api/accounts/authorize?state=s'),
      completeSignIn: vi.fn().mockResolvedValue({ signedIn: true, planUsage: true })
    }
    await expect(signInNatively(session, { forceConsent: true })).resolves.toEqual({ signedIn: true, planUsage: true })
    expect(session.beginSignIn).toHaveBeenCalledWith({ redirectUri: 'http://127.0.0.1:61234/auth/callback', forceConsent: true })
    expect(plugin.openChatGptAuthorization).toHaveBeenCalledWith({ url: 'https://auth.openai.com/api/accounts/authorize?state=s' })
    expect(session.completeSignIn).toHaveBeenCalledWith('http://127.0.0.1:61234/auth/callback?code=c&state=s')
  })

  it('reports a closed sign-in sheet as cancelled without finishing', async () => {
    plugin.prepareChatGptCallback.mockResolvedValue({ redirectUri: 'http://127.0.0.1:1/auth/callback' })
    plugin.openChatGptAuthorization.mockRejectedValue(Object.assign(new Error('ChatGPT sign-in was cancelled.'), { code: 'cancelled' }))
    const session = { beginSignIn: vi.fn().mockResolvedValue('https://auth.openai.com/x'), completeSignIn: vi.fn() }
    await expect(signInNatively(session)).rejects.toMatchObject({ code: 'cancelled' })
    expect(session.completeSignIn).not.toHaveBeenCalled()
  })
})
