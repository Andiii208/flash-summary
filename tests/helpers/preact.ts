import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach } from 'vitest'

const mounted: HTMLElement[] = []

/** Mount a vnode into a fresh host element; every host is unmounted after the test. */
export function mount(node: ComponentChild): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  mounted.push(host)
  act(() => render(node, host))
  return host
}

/** Dispatch a click and flush preact's pending state updates. */
export function click(target: Element | null): void {
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Set an input/textarea value the way a user would, then flush preact updates. */
export function input(target: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  act(() => {
    if (target == null) return
    target.value = value
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  // 2026-09-21（审计补齐）：先**卸载**再清 DOM。只清 DOM 会把 window 键监听、
  // body 滚动锁与 toast 自动消失定时器留给下一个用例乃至环境拆除之后——批1 记过
  // 「旧实例也响应 Esc」的假红，批3 记过 teardown 之后 requestAnimationFrame 未
  // 定义的 unhandled error（全量跑里偶发，会让门禁 exit=1）。卸载会跑 effect 清理
  // （useToasts 的定时器清理就在那里）。
  for (const host of mounted.splice(0)) act(() => render(null, host))
  document.body.innerHTML = ''
})
