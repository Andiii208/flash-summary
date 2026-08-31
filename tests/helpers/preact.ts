import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach } from 'vitest'

/** Mount a vnode into a fresh host element; body is reset after each test. */
export function mount(node: ComponentChild): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => render(node, host))
  return host
}

/** Dispatch a click and flush preact's pending state updates. */
export function click(target: Element | null): void {
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Set an input value the way a user would, then flush preact updates. */
export function input(target: HTMLInputElement | null, value: string): void {
  act(() => {
    if (target == null) return
    target.value = value
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})
