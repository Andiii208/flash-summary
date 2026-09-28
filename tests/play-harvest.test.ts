import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  buildPlayPageUrl,
  clickLessonScript,
  lessonNumber,
  parseLessonEntries,
  pickStreamUrls,
  sanitizeStreamUrl
} from '../src/main/school/play-harvest'
import { PLATFORM_API_BASE_PATH, SESSION_PROBE_PATH } from '../src/main/school/platform-paths'

describe('buildPlayPageUrl', () => {
  it('builds the hash route with encoded query params', () => {
    const url = buildPlayPageUrl('https://cvs.seu.edu.cn', {
      courseId: '1691584',
      teclId: '154717',
      teclCode: '202620271B080329101'
    })
    expect(url).toBe(
      'https://cvs.seu.edu.cn/jy-application-resourcemanage-ui/#/play-video?courseId=1691584&teclId=154717&teclCode=202620271B080329101'
    )
  })

  it('encodes special characters in ids', () => {
    const url = buildPlayPageUrl('https://cvs.seu.edu.cn', { courseId: 'a b', teclId: 'x&y', teclCode: 'c=d' })
    expect(url).toContain('courseId=a%20b&teclId=x%26y&teclCode=c%3Dd')
  })
})

describe('pickStreamUrls', () => {
  it('classifies by the Kedacom stream ids embedded in the path', () => {
    const picked = pickStreamUrls([
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1691584-1170195-5-1.mp4?auth_key=aaa',
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1691584-1170193-1-1.mp4?auth_key=bbb'
    ])
    expect(picked.teacherStreamUrl).toContain('1170193')
    expect(picked.screenStreamUrl).toContain('1170195')
  })

  it('falls back to DOM order (first video = teacher) without stream ids', () => {
    const picked = pickStreamUrls(['https://vod/a.mp4?auth_key=x', 'https://vod/b.mp4?auth_key=y'])
    expect(picked.teacherStreamUrl).toBe('https://vod/a.mp4?auth_key=x')
    expect(picked.screenStreamUrl).toBe('https://vod/b.mp4?auth_key=y')
  })

  it('keeps a single stream as the teacher stream', () => {
    const picked = pickStreamUrls(['https://vod/only.mp4?auth_key=z'])
    expect(picked.teacherStreamUrl).toBe('https://vod/only.mp4?auth_key=z')
    expect(picked.screenStreamUrl).toBeUndefined()
  })

  it('returns empty for no sources', () => {
    expect(pickStreamUrls([])).toEqual({})
    expect(pickStreamUrls(['', ''])).toEqual({})
  })
})

describe('sanitizeStreamUrl', () => {
  it('strips the signed query (auth_key red line) and keeps the path', () => {
    expect(sanitizeStreamUrl('https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1.mp4?auth_key=secret-expires')).toBe(
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1.mp4'
    )
  })

  it('handles URLs without a query', () => {
    expect(sanitizeStreamUrl('https://vod/plain.mp4')).toBe('https://vod/plain.mp4')
  })
})

describe('parseLessonEntries', () => {
  it('assigns DOM-order indexes and refs, trimming whitespace', () => {
    const entries = parseLessonEntries([' 第1节课 ', '第2节课', '第3节课'])
    expect(entries).toEqual([
      { index: 0, title: '第1节课', ref: '0' },
      { index: 1, title: '第2节课', ref: '1' },
      { index: 2, title: '第3节课', ref: '2' }
    ])
  })

  it('collapses duplicate labels across regions (playing header + list)', () => {
    const entries = parseLessonEntries(['第1节课', '第2节课', '第1节课', '第2节课'])
    expect(entries.map((e) => e.title)).toEqual(['第1节课', '第2节课'])
    expect(entries.map((e) => e.ref)).toEqual(['0', '1'])
  })

  it('drops empty candidates', () => {
    expect(parseLessonEntries(['', '第1节课'])).toHaveLength(1)
  })

  // 批1 二次评审订正：这个恒等式是「漂移冻结改不动 play_ref」的根据——
  // lessons.id = `${courseId}-L${index}`（lessons/catalog.ts），ref 又恒等于
  // String(index)，所以同一行被重写进去的 play_ref 与库里已有的必然是同一个数字。
  // 冻结的真实效果落在 title 上（笔记挂着的行不会变成另一节课的名字）。
  it('批1 订正: ref 恒等于 String(index)——同一行的 play_ref 与序号一一对应，无第二种取值', () => {
    const entries = parseLessonEntries(['第1节课', '第2节课', '第3节课'])
    expect(entries.every((entry) => entry.ref === String(entry.index))).toBe(true)
    // 去重/裁剪之后也一样（index 是「已收下几条」，不是原始下标）。
    const deduped = parseLessonEntries(['第1节课', '第1节课', '第2节课'])
    expect(deduped.map((e) => `${e.index}:${e.ref}`)).toEqual(['0:0', '1:1'])
  })
})

describe('lessonNumber', () => {
  it('extracts the number from 第N节 text', () => {
    expect(lessonNumber('第12节课')).toBe(12)
    expect(lessonNumber('第 3 节')).toBe(3)
    expect(lessonNumber('其他')).toBeNull()
  })
})

describe('clickLessonScript', () => {
  it('bounds-checks the ref before clicking (injected script sanity)', () => {
    const script = clickLessonScript('2')
    expect(script).toContain('lessonCandidates')
    expect(script).toContain('"2"')
    expect(script).toContain('cands[i].click()')
    expect(script).toContain('i >= cands.length')
  })
})

/**
 * H30 (audit 2026-09-28): 分层倒置修复——play-harvest 曾从 ../auth/cas-login
 * import 平台路径常量（school 域依赖 auth 域）。平台路径常量族现在住在
 * school/platform-paths.ts，school 域的任何文件都不许再 import auth 域。
 */
describe('H30: school 域不 import auth 域（平台路径常量的事实源在 school/platform-paths.ts）', () => {
  it('school/ 下没有指向 auth/ 的 import', () => {
    const dir = join(__dirname, '..', 'src', 'main', 'school')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text, `${file} 不得 import auth 域`).not.toMatch(/from '(?:\.\.\/)+auth\//)
      expect(text, `${file} 不得 import auth 域`).not.toMatch(/from '\.\/auth\//)
    }
  })

  it('play-harvest 与两个 auth 消费方都从 school/platform-paths 拿平台路径常量', () => {
    const harvest = readFileSync(join(__dirname, '..', 'src', 'main', 'school', 'play-harvest.ts'), 'utf8')
    expect(harvest).toContain("from './platform-paths'")
    for (const authFile of ['cas-login.ts', 'main-window-login.ts']) {
      const text = readFileSync(join(__dirname, '..', 'src', 'main', 'auth', authFile), 'utf8')
      expect(text, `${authFile} 应从 school/platform-paths 导入`).toContain("from '../school/platform-paths'")
    }
  })

  it('常量值不变（行为回归：播放页 URL 与会话探针路径照旧）', () => {
    expect(PLATFORM_API_BASE_PATH).toBe('/jy-application-resourcemanage')
    expect(SESSION_PROBE_PATH).toContain('/v1/group_subject_vod_list/t-1')
    expect(buildPlayPageUrl('https://cvs.seu.edu.cn', { courseId: '1', teclId: '2', teclCode: '3' })).toBe(
      'https://cvs.seu.edu.cn/jy-application-resourcemanage-ui/#/play-video?courseId=1&teclId=2&teclCode=3'
    )
  })
})
