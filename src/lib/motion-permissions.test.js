import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestMotionPermission } from './motion-permissions.js'

describe('motion permissions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing when the platform does not require motion permission', async () => {
    vi.stubGlobal('DeviceMotionEvent', undefined)
    vi.stubGlobal('DeviceOrientationEvent', undefined)

    await expect(requestMotionPermission()).resolves.toEqual({ granted: true, required: false })
  })

  it('requests iOS motion and orientation permissions when available', async () => {
    const requestMotion = vi.fn().mockResolvedValue('granted')
    const requestOrientation = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion })
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation })

    await expect(requestMotionPermission()).resolves.toEqual({ granted: true, required: true })
    expect(requestMotion).toHaveBeenCalledOnce()
    expect(requestOrientation).toHaveBeenCalledOnce()
  })

  it('reports denied motion permission', async () => {
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: vi.fn().mockResolvedValue('denied') })
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: vi.fn().mockResolvedValue('granted') })

    await expect(requestMotionPermission()).resolves.toMatchObject({ granted: false, required: true, status: 'denied' })
  })
})
