/**
 * Shared types between main, preload, and renderer processes.
 */
export const APP_TITLE = 'SEU Summary'

/**
 * Session lifecycle as the renderer should display it. «expired» is a local
 * judgement (the stored JWT's exp claim) — no network probe — so the badge
 * can stop showing a stale «logged_in» for a dead session (field case
 * 2026-09-03: the installed app showed «已登录» on a dev-era session).
 */
export type SessionStateValue = 'logged_in' | 'expired' | 'logged_out'
