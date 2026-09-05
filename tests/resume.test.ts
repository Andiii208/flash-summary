import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { rmSync as rmSyncFs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import {
  resolveResumeStage,
  urlsAreFresh,
  freeDiskBytes,
  STREAM_URL_FRESH_MS
} from '../src/main/tasks/resume'

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-resume-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedOutput(taskId: string, stage: string, payload: unknown): void {
  db.prepare("INSERT OR IGNORE INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, 'l1', 'failed', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run(taskId)
  db.prepare('INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)').run(
    taskId,
    stage,
    JSON.stringify(payload)
  )
}

function seedStreamFiles(taskId: string, which: 'teacher' | 'screen' | 'both'): string {
  const taskDir = join(dir, 'cache', taskId)
  mkdirSync(taskDir, { recursive: true })
  const paths: Record<string, string> = {
    teacher: join(taskDir, 'teacher.ts'),
    screen: join(taskDir, 'screen.ts')
  }
  const wanted = which === 'both' ? ['teacher', 'screen'] : [which]
  for (const name of wanted) {
    writeFileSync(paths[name]!, 'stream-bytes')
    writeFileSync(`${paths[name]}.ok`, '')
  }
  return taskDir
}

describe('urlsAreFresh (review B1: auth_key is time-limited)', () => {
  const signed = {
    teacherStreamUrl: 'https://vod/t.mp4?auth_key=secret',
    screenStreamUrl: 'https://vod/s.mp4?auth_key=secret'
  }

  it('accepts signed URLs harvested within the freshness window', () => {
    const now = Date.now()
    expect(urlsAreFresh({ ...signed, harvestedAt: new Date(now - STREAM_URL_FRESH_MS / 2).toISOString() }, now)).toBe(true)
  })

  it('rejects signed URLs older than the window or with no harvest timestamp', () => {
    const now = Date.now()
    expect(urlsAreFresh({ ...signed, harvestedAt: new Date(now - STREAM_URL_FRESH_MS - 1000).toISOString() }, now)).toBe(false)
    expect(urlsAreFresh(signed, now)).toBe(false)
    expect(urlsAreFresh(null, now)).toBe(false)
  })

  it('legacy unsigned URLs never expire (pre-V1 rows carry no signature)', () => {
    const now = Date.now()
    expect(urlsAreFresh({ teacherStreamUrl: 'https://vod/t.mp4', screenStreamUrl: 'https://vod/s.mp4' }, now)).toBe(true)
  })
})

describe('resolveResumeStage (review B1: degrade instead of dead-ending)', () => {
  it('resumes at the failed stage when its inputs are intact', () => {
    seedOutput('t1', 'extracting_audio', { audioPath: '/nonexistent-root/x.wav' })
    // Touch the audio file so it exists.
    const audioPath = join(dir, 'audio.wav')
    writeFileSync(audioPath, 'wav')
    db.prepare("UPDATE task_stage_outputs SET output_json = ? WHERE task_id = 't1' AND stage = 'extracting_audio'").run(
      JSON.stringify({ audioPath })
    )
    const decision = resolveResumeStage(db, 't1', 'transcribing')
    expect(decision.stage).toBe('transcribing')
    expect(decision.note).toBe('')
  })

  it('degrades transcribing → downloading when the audio was reaped and URLs are fresh', () => {
    seedOutput('t2', 'extracting_audio', { audioPath: join(dir, 'gone.wav') })
    seedOutput('t2', 'fetching_course', {
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=k',
      screenStreamUrl: 'https://vod/s.mp4?auth_key=k',
      harvestedAt: new Date().toISOString()
    })
    const decision = resolveResumeStage(db, 't2', 'transcribing')
    expect(decision.stage).toBe('downloading_video')
    expect(decision.note).toContain('downloading_video')
    expect(decision.note).toContain('重新开始')
  })

  it('degrades all the way to fetching_course when the signed URLs are stale (P0-1 scenario a)', () => {
    seedOutput('t3', 'extracting_audio', { audioPath: join(dir, 'gone.wav') })
    seedOutput('t3', 'fetching_course', {
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=k',
      screenStreamUrl: 'https://vod/s.mp4?auth_key=k',
      harvestedAt: new Date(Date.now() - STREAM_URL_FRESH_MS - 60_000).toISOString()
    })
    const decision = resolveResumeStage(db, 't3', 'transcribing')
    expect(decision.stage).toBe('fetching_course')
    expect(decision.note).toContain('从头重新开始')
  })

  it('treats a corrupted stage output as missing (P2-4: no dead end from one broken JSON)', () => {
    db.prepare("INSERT OR IGNORE INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t4', 'l1', 'failed', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t4', 'extracting_audio', '{broken json')").run()
    seedOutput('t4', 'fetching_course', {
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=k',
      screenStreamUrl: 'https://vod/s.mp4?auth_key=k',
      harvestedAt: new Date().toISOString()
    })
    const decision = resolveResumeStage(db, 't4', 'transcribing')
    expect(decision.stage).toBe('downloading_video')
  })

  it('resumes extracting_visuals when the screen stream is complete (marker present)', () => {
    const taskDir = seedStreamFiles('t5', 'both')
    seedOutput('t5', 'downloading_video', { teacherPath: join(taskDir, 'teacher.ts'), screenPath: join(taskDir, 'screen.ts') })
    const decision = resolveResumeStage(db, 't5', 'extracting_visuals')
    expect(decision.stage).toBe('extracting_visuals')
    expect(decision.note).toBe('')
  })

  it('degrades extracting_visuals when the screen stream file is gone', () => {
    seedOutput('t6', 'downloading_video', { teacherPath: join(dir, 'nope', 'teacher.ts'), screenPath: join(dir, 'nope', 'screen.ts') })
    seedOutput('t6', 'fetching_course', {
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=k',
      screenStreamUrl: 'https://vod/s.mp4?auth_key=k',
      harvestedAt: new Date().toISOString()
    })
    const decision = resolveResumeStage(db, 't6', 'extracting_visuals')
    expect(decision.stage).toBe('downloading_video')
  })

  it('resumes extracting_audio when at least one stream is complete with its marker (B3)', () => {
    const taskDir = seedStreamFiles('t7', 'teacher')
    seedOutput('t7', 'downloading_video', { teacherPath: join(taskDir, 'teacher.ts'), screenPath: join(taskDir, 'screen.ts') })
    const decision = resolveResumeStage(db, 't7', 'extracting_audio')
    expect(decision.stage).toBe('extracting_audio')
    expect(decision.note).toBe('')
  })

  it('a partial stream file without its .ok marker does not count as complete (B3)', () => {
    const taskDir = seedStreamFiles('t8', 'both')
    // Kill the markers: partial-file semantics from a killed run.
    rmMarker(taskDir, 'teacher.ts')
    rmMarker(taskDir, 'screen.ts')
    seedOutput('t8', 'downloading_video', { teacherPath: join(taskDir, 'teacher.ts'), screenPath: join(taskDir, 'screen.ts') })
    seedOutput('t8', 'fetching_course', {
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=k',
      screenStreamUrl: 'https://vod/s.mp4?auth_key=k',
      harvestedAt: new Date().toISOString()
    })
    const decision = resolveResumeStage(db, 't8', 'extracting_audio')
    expect(decision.stage).toBe('downloading_video')
  })

  it('summarizing always resumes in place (no file inputs)', () => {
    const decision = resolveResumeStage(db, 't9', 'summarizing')
    expect(decision).toEqual({ stage: 'summarizing', note: '' })
  })

  it('an unknown failed stage starts from the top', () => {
    const decision = resolveResumeStage(db, 't10', 'pending' as never)
    expect(decision.stage).toBe('fetching_course')
  })
})

function rmMarker(taskDir: string, name: string): void {
  rmSyncFs(join(taskDir, `${name}.ok`), { force: true })
}

describe('freeDiskBytes (review B6)', () => {
  it('returns a positive number for a real directory and null for an unreadable path', () => {
    const real = freeDiskBytes(dir)
    expect(real == null || real > 0).toBe(true)
    expect(freeDiskBytes(join(dir, 'definitely-missing-dir'))).toBeNull()
  })
})
