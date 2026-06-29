function permissionRequesterFor(eventConstructor) {
  const requestPermission = eventConstructor?.requestPermission
  return typeof requestPermission === 'function' ? requestPermission.bind(eventConstructor) : null
}

export async function requestMotionPermission() {
  const requesters = [
    permissionRequesterFor(globalThis.DeviceMotionEvent),
    permissionRequesterFor(globalThis.DeviceOrientationEvent)
  ].filter(Boolean)
  const uniqueRequesters = [...new Set(requesters)]

  if (!uniqueRequesters.length) return { granted: true, required: false }

  for (const requestPermission of uniqueRequesters) {
    try {
      const status = await requestPermission()
      if (status !== 'granted') return { granted: false, required: true, status }
    } catch (error) {
      return { granted: false, required: true, error }
    }
  }

  return { granted: true, required: true }
}
