import { useEffect, useState } from 'preact/hooks'

/**
 * P50-2 (plan 2026-09-22-qa-dock-float-window): 追问小卡片的「跟正文一起出现」。
 *
 * Andiii 原话：「我认为应该跟这个章节概括一起出现……在页面的最上面就主动收起来，不然会
 * 影响整体的美感。」——笔记停在题头带（工具行 + 封面 hero + 课程名 + 章节概括 chips）时
 * 卡片自动收成小球，hero 区保持干净；往下滚进正文（课程概览/章节内容）时再展开，读到
 * 哪里问到哪里。
 *
 * 判据用**滚动位置**而不是实时量题头矩形：`scrollTop < 题头带在内容坐标系里的底缘 − 80`。
 * 这样不依赖 DOM 布局时序——笔记是异步加载的、封面图也是异步撑高的，用矩形判据会在
 * 「题头还没挂上/封面还没加载」时读到过期状态（2026-09-22 探针首跑就踩到：atTop 时卡片
 * 仍在）。滚动位置是即时可知的，任何滚动都重新算阈值。
 *
 * **没有题头（空库/库列表态）⇒ 不算 hero，卡片照常显示**——那种页面没有要保护的大 hero
 * 带，而空态卡片（近期追问入口）在那儿是有用的。
 *
 * 纯 renderer 侧 scroll/resize 监听；打印走 `@media print` 整体隐藏 .app-shell，与此无关。
 */
export function useQaDockAtHero(active: boolean, contentKey: string): boolean {
  const [atHero, setAtHero] = useState(true)
  useEffect(() => {
    if (!active) return
    const scroller = document.querySelector('.content')
    if (scroller == null) return
    const HERO_BUFFER_PX = 80
    const measure = (): void => {
      const masthead = document.querySelector('.note-masthead')
      if (masthead == null) {
        // 库列表/空态：没有 hero 带要保护，卡片照常显示。
        setAtHero(false)
        return
      }
      const scrollerTop = scroller.getBoundingClientRect().top
      // 题头带底缘在内容坐标系里的位置（矩形底缘 − 容器视口顶 + 已滚距离）。
      const heroBottom = masthead.getBoundingClientRect().bottom - scrollerTop + scroller.scrollTop
      setAtHero(scroller.scrollTop < heroBottom - HERO_BUFFER_PX)
    }
    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      scroller.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [active, contentKey])
  return atHero
}
