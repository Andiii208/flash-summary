#!/usr/bin/env node
/**
 * Release gate: verify the packaged app.asar contains exactly the current
 * build output (v0.1.0 incident prevention, see CHANGELOG 0.1.1).
 *
 * Usage: node scripts/verify-asar.mjs <path-to-app.asar> <build-out-dir>
 * Exits non-zero on any mismatch (missing, extra, or hash-differing file).
 */
import asar from '@electron/asar'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, acc)
    else acc.push(relative(base, full).split(sep).join('/'))
  }
  return acc
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

const [asarPath, outDir] = process.argv.slice(2)
if (asarPath == null || outDir == null) {
  console.error('usage: node scripts/verify-asar.mjs <app.asar> <out-dir>')
  process.exit(2)
}

const diskFiles = walk(outDir).filter((f) => !f.endsWith('.map'))
const expected = new Set(diskFiles)

const archiveFiles = asar.listPackage(asarPath).map((f) => {
  // asar paths come as "/main/index.cjs" style strings.
  return f.replace(/\\/g, '/').replace(/^\//, '')
})

const problems = []
for (const file of diskFiles) {
  const diskBuf = readFileSync(join(outDir, file))
  let archiveBuf
  try {
    archiveBuf = asar.extractFile(asarPath, file)
  } catch {
    problems.push(`MISSING in asar: ${file}`)
    continue
  }
  if (sha256(diskBuf) !== sha256(archiveBuf)) {
    problems.push(`HASH MISMATCH: ${file}`)
  }
}
for (const file of archiveFiles) {
  if (!expected.has(file)) problems.push(`EXTRA in asar: ${file}`)
}

if (problems.length > 0) {
  console.error(`asar verification FAILED (${problems.length} problem(s)):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`asar verification OK: ${diskFiles.length} files match the current build (sha256).`)
