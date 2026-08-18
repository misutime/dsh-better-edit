import { describe, expect, it } from "vitest";
import { join, dirname, resolve } from "node:path";
import { defaultDshHome } from "@deepseek-ai/dsh-home-paths";
import { configDir, hashStorePath, hashStoreDir } from "../../src/paths.js";

describe("configDir", () => {
	it("returns the store dir under the default DSH home when DSH_HOME is unset", () => {
		const previousDsh = process.env.DSH_HOME;
		delete process.env.DSH_HOME;
		try {
			expect(configDir()).toBe(
				join(defaultDshHome(), "plugins", "dsh-better-edit"),
			);
		} finally {
			if (previousDsh === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previousDsh;
		}
	});

	it("uses DSH_HOME when set", () => {
		const previousDsh = process.env.DSH_HOME;
		process.env.DSH_HOME = "/custom/dsh";
		try {
			expect(configDir()).toBe(join(resolve("/custom/dsh"), "plugins", "dsh-better-edit"));
		} finally {
			if (previousDsh === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previousDsh;
		}
	});

	it("ignores an empty DSH_HOME", () => {
		const previousDsh = process.env.DSH_HOME;
		process.env.DSH_HOME = "   ";
		try {
			expect(configDir()).toBe(
				join(defaultDshHome(), "plugins", "dsh-better-edit"),
			);
		} finally {
			if (previousDsh === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previousDsh;
		}
	});
});

describe("workspace-scoped state", () => {
	it("stores workspace state below DSH_HOME without exposing the workspace path", () => {
		const first = configDir("/workspace/alpha");
		const second = configDir("/workspace/beta");
		expect(first).not.toBe(second);
		expect(first).not.toContain("alpha");
		expect(first).toContain("workspaces");
		expect(configDir("/workspace/alpha", "session-a")).not.toBe(
			configDir("/workspace/alpha", "session-b"),
		);
		expect(configDir("/workspace/alpha\u0000session", "suffix")).not.toBe(
			configDir("/workspace/alpha", "session\u0000suffix"),
		);
		if (process.platform === "win32") {
			expect(configDir("/workspace/alpha")).not.toBe(
				configDir("D:\\workspace\\alpha"),
			);
		}
	});
});

describe("hashStorePath", () => {
	it("returns the hash store file path", () => {
		const path = hashStorePath();
		expect(path).toBe(join(configDir(), "hash-store.sqlite"));
	});
});

describe("hashStoreDir", () => {
	it("returns the directory of the hash store path", () => {
		const dir = hashStoreDir();
		expect(dir).toBe(dirname(hashStorePath()));
	});
});
