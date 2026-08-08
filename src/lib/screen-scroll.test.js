import { describe, expect, it } from 'vitest'
import { planScreenScroll } from './screen-scroll.js'

describe('planScreenScroll', () => {
  it('saves library scroll when opening a deck and restores it on back', () => {
    const afterOpen = planScreenScroll({
      from: 'library',
      to: 'detail',
      currentY: 842,
      savedLibraryY: 0
    })
    expect(afterOpen).toEqual({ savedLibraryY: 842, scrollTop: 0 })

    const afterBack = planScreenScroll({
      from: 'detail',
      to: 'library',
      currentY: 0,
      savedLibraryY: afterOpen.savedLibraryY
    })
    expect(afterBack).toEqual({ savedLibraryY: 842, scrollTop: 842 })
  })

  it('scrolls to top when leaving the library for any non-library screen', () => {
    expect(planScreenScroll({
      from: 'library',
      to: 'settings',
      currentY: 400,
      savedLibraryY: 0
    })).toEqual({ savedLibraryY: 400, scrollTop: 0 })
  })

  it('keeps a prior library scroll across non-library hops then restores it', () => {
    let saved = 600
    saved = planScreenScroll({ from: 'detail', to: 'settings', currentY: 12, savedLibraryY: saved }).savedLibraryY
    const back = planScreenScroll({ from: 'settings', to: 'library', currentY: 0, savedLibraryY: saved })
    expect(back).toEqual({ savedLibraryY: 600, scrollTop: 600 })
  })

  it('treats missing scroll values as zero', () => {
    expect(planScreenScroll({ from: 'detail', to: 'library', currentY: undefined, savedLibraryY: undefined }))
      .toEqual({ savedLibraryY: 0, scrollTop: 0 })
  })
})
