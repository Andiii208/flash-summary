#!/usr/bin/env node
/**
 * Release gate: verify the packaged app.asar contains exactly the current
 * build output (v0.1.0 incident prevention, see CHANGELOG 0.1.1).
 *
 * Scope: every file under out/ on disk must exist inside the asar with an
 * identical sha256 (read straight from the archive via the header offsets —
 * @electron/asar 4.x extractFile mishandles '/'-separated paths on Windows),
 * and the asar's out/ tree must contain nothing extra.
 *
 * Usage: node scripts/verify-asar.mjs <path-to-app.asar> <build-out-dir> [prefix=out]
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { openSync, readSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

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

const [asarPath, outDir, prefixArg] = process.argv.slice(2)
if (asarPath == null || outDir == null) {
  console.error('usage: node scripts/verify-asar.mjs <app.asar> <out-dir> [prefix]')
  process.exit(2)
}
const prefix = (prefixArg ?? 'out').replace(/\/+$/, '')

const diskFiles = walk(outDir)
const diskSet = new Set(diskFiles)

// Parse the asar header tree and read file bytes directly by offset.
const fd = openSync(asarPath, 'r')
try {
  const sizes = Buffer.alloc(8)
  readSync(fd, sizes, 0, 8, 0)
  const dataOffset = 8 + sizes.readUInt32LE(4)
  const { header } = asar.getRawHeader(asarPath)

  const entries = []
  function collect(node, prefixPath) {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefixPath === '' ? name : `${prefixPath}/${name}`
      if (child.files != null) collect(child, path)
      else if (child.offset != null) entries.push([path, child])
    }
  }
  collect(header, '')

  const archiveFiles = entries.filter(([p]) => p.startsWith(`${prefix}/`))
  const archiveSet = new Set(archiveFiles.map(([p]) => p))
  const problems = []

  for (const file of diskFiles) {
    const diskBuf = readFileSync(join(outDir, file))
    const found = archiveFiles.find(([p]) => p === `${prefix}/${file}`)
    if (found == null) {
      problems.push(`MISSING in asar: ${prefix}/${file}`)
      continue
    }
    const [, node] = found
    const archiveBuf = Buffer.alloc(node.size)
    readSync(fd, archiveBuf, 0, node.size, dataOffset + Number(node.offset))
    if (sha256(diskBuf) !== sha256(archiveBuf)) problems.push(`HASH MISMATCH: ${prefix}/${file}`)
  }
  for (const [p] of archiveFiles) {
    if (!diskSet.has(p.slice(prefix.length + 1))) problems.push(`EXTRA in asar: ${p}`)
  }

  if (problems.length > 0) {
    console.error(`asar verification FAILED (${problems.length} problem(s)):`)
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`)
    if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`)
    process.exit(1)
  }
  console.log(`asar verification OK: ${diskFiles.length} files under ${prefix}/ match the current build (sha256).`)
} finally {
  closeSync(fd)
}
