import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
	isAbsolute,
	resolve as resolvePath,
	join,
	dirname,
	parse,
	sep,
} from "node:path";
import { lstat, readlink } from "node:fs/promises";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { errCode } from "./utils.js";

/**
 * Return the private state directory for one workspace.
 *
 * Workspace state is kept below the DSH home rather than inside the project,
 * so SQLite files containing source snapshots cannot be committed accidentally
 * and remote workspace paths are never interpreted as host filesystem paths.
 * The SHA-256 directory key keeps separate workspaces isolated without exposing
 * their absolute paths in the state layout. A session key is included when
 * supplied so remote sandboxes that reuse a POSIX cwd cannot share state.
 * @param cwd - the workspace root, or undefined for the shared-home fallback.
 * @param sessionKey - optional opaque session identity for tool-call stores.
 */
function workspaceKeyInput(cwd: string): string {
	const normalized = cwd.replaceAll("\\", "/");
	// A POSIX absolute cwd can identify a remote filesystem even when the host
	// process is Windows; do not reinterpret it as a drive-rooted host path.
	if (process.platform === "win32" && normalized.startsWith("/") && !normalized.startsWith("//")) {
		return normalized;
	}
	const resolved = resolvePath(cwd).replaceAll("\\", "/");
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function configDir(cwd?: string, sessionKey?: string): string {
	if (cwd === undefined) return join(resolveDshHome(), "plugins", "dsh-better-edit");
	const identity = JSON.stringify([workspaceKeyInput(cwd), sessionKey ?? null]);
	const key = createHash("sha256").update(identity).digest("hex");
	return join(resolveDshHome(), "plugins", "dsh-better-edit", "workspaces", key);
}

export function hashStorePath(cwd?: string, sessionKey?: string): string {
	return join(configDir(cwd, sessionKey), "hash-store.sqlite");
}

export function legacyHashStorePath(cwd?: string, sessionKey?: string): string {
	return join(configDir(cwd, sessionKey), "hash-store.json");
}

export function hashStoreDir(cwd?: string, sessionKey?: string): string {
	return dirname(hashStorePath(cwd, sessionKey));
}

function homeBase(): string {
	const envHome = process.env.HOME;
	return envHome && envHome.length > 0 ? envHome : homedir();
}

function expand(filePath: string): string {
	const home = homeBase();
	if (filePath === "~") return home;
	if (filePath.startsWith("~/")) return home + filePath.slice(1);
	return filePath;
}

export function toCwd(filePath: string, cwd: string): string {
	const expanded = expand(filePath);
	return isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
}

/**
 * Canonicalize a path, resolving every symlink component to its target
 * (loop-guarded, ELOOP on cycles). Non-existent final components resolve
 * lexically — the canonical form of a not-yet-created file. The hashline
 * tools key their state by canonical absolute paths, so the same file reached
 * through different symlink spellings lands on the same store rows.
 * @param path - the path to canonicalize (absolute or relative).
 */
export async function resolveTarget(path: string): Promise<string> {
	const absolutePath = resolvePath(path);
	const { root } = parse(absolutePath);
	const parts = absolutePath
		.slice(root.length)
		.split(sep)
		.filter((part) => part.length > 0);
	const visitedSymlinks = new Set<string>();

	async function resParts(
		currentPath: string,
		remainingParts: string[],
	): Promise<string> {
		if (remainingParts.length === 0) {
			return currentPath;
		}

		const [nextPart, ...tail] = remainingParts;
		const candidatePath = join(currentPath, nextPart);

		try {
			const candidateStats = await lstat(candidatePath);
			if (!candidateStats.isSymbolicLink()) {
				return resParts(candidatePath, tail);
			}

			if (visitedSymlinks.has(candidatePath)) {
				const error = new Error(
					`Too many symbolic links while resolving ${path}`,
				) as NodeJS.ErrnoException;
				error.code = "ELOOP";
				throw error;
			}
			visitedSymlinks.add(candidatePath);

			const linkTargetPath = resolvePath(
				dirname(candidatePath),
				await readlink(candidatePath),
			);
			const targetParts = linkTargetPath
				.slice(parse(linkTargetPath).root.length)
				.split(sep)
				.filter((part) => part.length > 0);
			return resParts(parse(linkTargetPath).root, [
				...targetParts,
				...tail,
			]);
		} catch (error: unknown) {
			if (errCode(error) === "ENOENT") {
				return join(candidatePath, ...tail);
			}
			throw error;
		}
	}

	return resParts(root, parts);
}
