/**
 * Per-call workspace context. dsh serves several sessions in one process, each
 * with its own cwd, and only the tool execution knows which one it belongs to —
 * so a module-global "current cwd" would race between parallel sessions. The
 * store key is derived per tool call from the session cwd; this module carries
 * that cwd through the async execution so every store access inside the call
 * (served rows, undo, hash snapshots) selects the right isolated workspace store.
 * @module dsh-better-edit/workspace
 */

import { AsyncLocalStorage } from 'node:async_hooks'

interface WorkspaceContext {
	cwd: string;
	sessionKey?: string;
}

const current = new AsyncLocalStorage<WorkspaceContext>()

/**
 * Run `fn` with the workspace and optional session identity active for this
 * async execution. Store access inside `fn` uses both values when present.
 * @param cwd - the session workspace root (absolute or backend-native).
 * @param fn - the tool body.
 * @param sessionKey - opaque session identity used to isolate remote stores.
 * @returns the body's result.
 */
export function withWorkspace<T>(
	cwd: string,
	fn: () => Promise<T>,
	sessionKey?: string,
): Promise<T> {
	return current.run({ cwd, sessionKey }, fn)
}

/** The workspace cwd active for this async execution. */
export function workspaceCwd(): string | undefined {
	return current.getStore()?.cwd
}

/** The active session identity, or undefined outside a tool call. */
export function workspaceSessionKey(): string | undefined {
	return current.getStore()?.sessionKey
}
