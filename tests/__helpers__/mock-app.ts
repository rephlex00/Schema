/**
 * In-memory Obsidian App mock for exercising the lifecycle/lookup modules with
 * synthetic fixtures. Implements just enough of the App surface that
 * clean / reshelve / builtin-runtime / formula touch:
 *
 *   vault.getAbstractFileByPath / createFolder / getMarkdownFiles / read / modify
 *   fileManager.processFrontMatter / renameFile
 *   metadataCache.getFileCache
 *
 * Not a faithful Obsidian reimplementation - a fixture harness. Frontmatter is
 * stored as a plain object per file; processFrontMatter hands the callback the
 * live object so mutations persist, mirroring the real API contract.
 */

export interface MockFile {
	path: string;
	name: string; // basename + ext, e.g. "Alice.md"
	basename: string; // "Alice"
	extension: string; // "md"
	fm: Record<string, unknown>;
	body: string;
	stat: { ctime: number; mtime: number; size: number };
}

/** Fixed creation time for every mock file (2026-01-15T10:00:00 local) so
 *  ctime-derived behavior is deterministic. Tests may overwrite `file.stat`. */
export const MOCK_CTIME = new Date(2026, 0, 15, 10, 0, 0).getTime();

export interface MockAppHandle {
	app: unknown; // cast to App at the call site
	addFile(path: string, fm?: Record<string, unknown>, body?: string): MockFile;
	addFolder(path: string): void;
	get(path: string): MockFile | undefined;
	all(): MockFile[];
	folders(): string[];
}

function splitPath(path: string): { name: string; basename: string; extension: string } {
	const slash = path.lastIndexOf("/");
	const name = slash === -1 ? path : path.slice(slash + 1);
	const dot = name.lastIndexOf(".");
	const basename = dot === -1 ? name : name.slice(0, dot);
	const extension = dot === -1 ? "" : name.slice(dot + 1);
	return { name, basename, extension };
}

export function createMockApp(): MockAppHandle {
	const files = new Map<string, MockFile>();
	const folderSet = new Set<string>();

	const addFile = (path: string, fm: Record<string, unknown> = {}, body = ""): MockFile => {
		const { name, basename, extension } = splitPath(path);
		const file: MockFile = {
			path,
			name,
			basename,
			extension,
			fm: { ...fm },
			body,
			stat: { ctime: MOCK_CTIME, mtime: MOCK_CTIME, size: body.length },
		};
		files.set(path, file);
		const dir = path.lastIndexOf("/") >= 0 ? path.slice(0, path.lastIndexOf("/")) : "";
		if (dir) folderSet.add(dir);
		return file;
	};

	const app = {
		vault: {
			getAbstractFileByPath(path: string): unknown {
				return files.get(path) ?? (folderSet.has(path) ? { path, isFolder: true } : null);
			},
			async createFolder(path: string): Promise<void> {
				folderSet.add(path);
			},
			getMarkdownFiles(): MockFile[] {
				return Array.from(files.values()).filter((f) => f.extension === "md");
			},
			async read(file: MockFile): Promise<string> {
				return file.body;
			},
			async modify(file: MockFile, content: string): Promise<void> {
				file.body = content;
			},
			async create(path: string, content: string): Promise<MockFile> {
				return addFile(path, {}, content);
			},
		},
		fileManager: {
			async processFrontMatter(
				file: MockFile,
				cb: (fm: Record<string, unknown>) => void
			): Promise<void> {
				cb(file.fm);
			},
			async renameFile(file: MockFile, newPath: string): Promise<void> {
				files.delete(file.path);
				const { name, basename, extension } = splitPath(newPath);
				file.path = newPath;
				file.name = name;
				file.basename = basename;
				file.extension = extension;
				files.set(newPath, file);
				const dir = newPath.lastIndexOf("/") >= 0 ? newPath.slice(0, newPath.lastIndexOf("/")) : "";
				if (dir) folderSet.add(dir);
			},
		},
		metadataCache: {
			getFileCache(file: MockFile): { frontmatter: Record<string, unknown> } | null {
				const f = files.get(file.path) ?? file;
				return { frontmatter: f.fm };
			},
		},
	};

	return {
		app,
		addFile,
		addFolder: (p: string) => folderSet.add(p),
		get: (p: string) => files.get(p),
		all: () => Array.from(files.values()),
		folders: () => Array.from(folderSet),
	};
}
