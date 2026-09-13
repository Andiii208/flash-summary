/**
 * A6 (plan 2026-09-13): the course avatar shows ONE glyph from the course
 * name as a fast discriminator in a catalog full of look-alike rows. Course
 * names often open with punctuation (Bilibili: «（中英字幕完结）斯坦福CS224N…»
 * rendered as a lone «（» before this) — skip anything that is not a
 * letter/digit (CJK counts as a letter) and fall back to the raw first
 * character when the name is all punctuation.
 */
export function courseAvatarChar(name: string): string {
  const meaningful = name.match(/\p{L}|\p{N}/u)
  if (meaningful != null) return meaningful[0]
  return name.slice(0, 1)
}
