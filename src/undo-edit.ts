/**
 * Undo persistence for the hashline tools: before an edit is applied, the
 * pre-edit state (content, BOM, original line ending, hash anchors, and the
 * result content that the undo must verify against) is written to the hash
 * store. `undo_last_edit` reverts only when the file still matches the stored
 * result — a later external write clears the history instead of being
 * overwritten. Undo survives restarts (the store is on disk).
 * @module dsh-better-edit/undo-edit
 */

import type { LineEnding } from './edit-diff.js'
import { loadHashStore, type UndoRecord } from './hash-store.js'

/** Load the last undo row for a session and path from the active store, if any. */
async function readUndo(path: string, sessionKey: string): Promise<UndoRecord | undefined> {
	const store = await loadHashStore()
	return store.getUndo(path, sessionKey)
}

/** Persist the undo row for a session and path to the active store. */
async function writeUndo(path: string, entry: UndoRecord, sessionKey: string): Promise<void> {
	const store = await loadHashStore()
	store.upsertUndo(path, entry, sessionKey)
}

/** Drop the undo row for a session and path from the active store. */
async function removeUndo(path: string, sessionKey: string): Promise<void> {
	const store = await loadHashStore()
	store.deleteUndo(path, sessionKey)
}
export interface UndoEntry {
	content: string
	bom: string
	originalEnding: LineEnding
	hashes: string[]
	resultContent: string
}

/**
 * Persist an undo entry for one path before mutating it.
 * @param path - canonical absolute path.
 * @param entry - the pre-edit state plus the result content the undo will verify.
 * @returns whether persistence succeeded, plus a restore that puts the previous
 *   undo entry back (used when the mutation itself fails).
 */
export async function saveUndo(
	path: string,
	entry: UndoEntry,
	sessionKey = "default",
): Promise<{ persisted: boolean; restore: () => Promise<void> }> {
	let previous: UndoRecord | undefined
	try {
		previous = await readUndo(path, sessionKey)
		await writeUndo(path, {
			content: entry.content,
			bom: entry.bom,
			ending: entry.originalEnding,
			hashes: entry.hashes,
			resultContent: entry.resultContent,
		}, sessionKey)
	} catch (error) {
		console.error('Failed to persist undo entry:', error)
		return { persisted: false, restore: async () => undefined }
	}
	return {
		persisted: true,
		restore: async () => {
			try {
				if (previous) await writeUndo(path, previous, sessionKey)
				else await removeUndo(path, sessionKey)
			} catch (error) {
				console.error('Failed to restore previous undo entry:', error)
			}
		},
	}
}

/** Load the last undo entry for a session and path, if any. */
export async function getUndo(path: string, sessionKey = "default"): Promise<UndoEntry | undefined> {
	try {
		const record = await readUndo(path, sessionKey)
		if (!record) return undefined
		const originalEnding = record.ending
		if (
			originalEnding !== '\r\n' &&
			originalEnding !== '\n' &&
			originalEnding !== '\r'
		) {
			await removeUndo(path, sessionKey)
			return undefined
		}
		return {
			content: record.content,
			bom: record.bom,
			originalEnding,
			hashes: record.hashes,
			resultContent: record.resultContent,
		}
	} catch (error) {
		console.error('Failed to load undo entry:', error)
		return undefined
	}
}

/** Drop the undo entry for a session and path (a write or an undone revert clears history). */
export async function clearUndo(path: string, sessionKey = "default"): Promise<void> {
	try {
		await removeUndo(path, sessionKey)
	} catch (error) {
		console.error('Failed to clear undo entry:', error)
	}
}
