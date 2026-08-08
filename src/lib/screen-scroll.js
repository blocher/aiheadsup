/**
 * Decide where to scroll after a screen change, while remembering the library
 * list position so returning from a deck (or other screen) restores it.
 */
export function planScreenScroll({ from, to, currentY, savedLibraryY = 0 }) {
  const nextSaved = from === 'library' ? Math.max(0, currentY || 0) : Math.max(0, savedLibraryY || 0)
  return {
    savedLibraryY: nextSaved,
    scrollTop: to === 'library' ? nextSaved : 0
  }
}
