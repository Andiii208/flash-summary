import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * 发布管线「三者同名」的离线机械闸门（2026-10-10，plan
 * docs/plans/2026-10-10-updater-feed-fix-and-release-pipeline.md 批 3）。
 *
 * 背景：artifactName 不覆写时，NSIS 默认产物名含空格（`Flash Summary Setup 0.7.15.exe`），
 * electron-builder 把空格换成**连字符**写进 latest.yml（`Flash-Summary-Setup-0.7.15.exe`，
 * app-builder-lib 的 computeSafeArtifactNameIfNeeded），而 GitHub 上传资产时把空格换成
 * **点**（`Flash.Summary.Setup.0.7.15.exe`）——feed 从此指着一个不存在的文件，
 * electron-updater 按 latest.yml 的名字拼下载 URL，必 404（v0.7.13-0.7.15 三个 release
 * 实锤；单测注入的假 updater 碰不到真实 URL，所以闸门必须落在构建产物上）。
 *
 * 两档断言：
 * 1. 无环境依赖：package.json 的 build.artifactName 存在，按当前版本渲染后是 GitHub
 *    安全名（`[0-9A-Za-z._-]`，无空格）。
 * 2. 工作区若构建过（release/latest.yml 存在）：latest.yml 的 `path`/`url` 必须与
 *    artifactName **按 latest.yml 自己的 version 行**渲染的结果逐字一致——用 yml 里的
 *    版本而不是 package.json 的版本，bump 后、重新 dist 前的窗口期不会假红。
 *    没构建过（文件不存在）就跳过，不许因此红。
 */
const ROOT = join(__dirname, '..')
const GITHUB_SAFE = /^[0-9A-Za-z._-]+$/

interface PackageBuild {
  version: string
  artifactName?: string
}

function readPackageBuild(): PackageBuild {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
    version: string
    build: { artifactName?: string }
  }
  return { version: pkg.version, artifactName: pkg.build.artifactName }
}

/** 把 artifactName 模板渲染成具体文件名（只认 ${version} / ${ext} 两个占位符）。 */
function renderArtifactName(template: string, version: string): string {
  return template.replaceAll('${version}', version).replaceAll('${ext}', 'exe')
}

describe('release artifact name（latest.yml ↔ GitHub 资产同名）', () => {
  it('build.artifactName 已显式钉死，渲染后是 GitHub 安全名（无空格）', () => {
    const { version, artifactName } = readPackageBuild()
    expect(artifactName, 'build.artifactName 不能空——空则回退含空格默认名，下载 URL 必 404').toBeTruthy()
    const rendered = renderArtifactName(artifactName ?? '', version)
    expect(rendered).toMatch(GITHUB_SAFE)
    expect(rendered).not.toContain(' ')
  })

  it('release/latest.yml（若存在）的 path/url 与 artifactName 按 yml 自身版本渲染的结果逐字一致', () => {
    const { artifactName } = readPackageBuild()
    const ymlPath = join(ROOT, 'release', 'latest.yml')
    if (!existsSync(ymlPath)) return
    const yml = readFileSync(ymlPath, 'utf-8')
    const version = /^version:\s*(\S+)\s*$/m.exec(yml)?.[1]
    const path = /^path:\s*(\S+)\s*$/m.exec(yml)?.[1]
    const url = /^\s*-\s*url:\s*(\S+)\s*$/m.exec(yml)?.[1]
    expect(version, 'latest.yml 缺 version 行').toBeTruthy()
    const expected = renderArtifactName(artifactName ?? '', version ?? '')
    expect(path, 'latest.yml 的 path 与 artifactName 不一致——下载 URL 会 404').toBe(expected)
    expect(url, 'latest.yml 的 url 与 artifactName 不一致——下载 URL 会 404').toBe(expected)
  })
})
