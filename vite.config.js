import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// OpenAI's JWKS has no CORS headers, so ChatGPT sign-in (local builds only,
// see docs/adr/0001-chatgpt-sign-in-provider.md) reads it through this proxy.
const openAiAuthProxy = {
  '/openai-auth/jwks.json': {
    target: 'https://auth.openai.com',
    changeOrigin: true,
    rewrite: () => '/.well-known/jwks.json'
  }
}

export default defineConfig({
  plugins: [vue()],
  server: { proxy: openAiAuthProxy },
  preview: { proxy: openAiAuthProxy },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js']
  }
})
