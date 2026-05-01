import { App, TFile } from "obsidian";

/**
 * Programmatic access to the Templater plugin's API. Returns null when
 * Templater isn't installed; callers should check `isInstalled()` first.
 *
 * Public methods on the Templater plugin instance (verified via
 * `app.plugins.plugins["templater-obsidian"].templater`):
 * - `parse_template(config, source) → Promise<string>` — render a string
 * - `read_and_parse_template(config) → Promise<string>` — render a file
 *
 * RunMode = 0 (CreateNewFromTemplate) is the right context for our use:
 * we want `tp.file.title` etc. to refer to the target note.
 */

const RUN_MODE_CREATE_NEW = 0;

interface RunningConfig {
	template_file: TFile | undefined;
	target_file: TFile;
	run_mode: number;
	active_file?: TFile | null;
}

interface TemplaterApi {
	parse_template(config: RunningConfig, content: string): Promise<string>;
	read_and_parse_template(config: RunningConfig): Promise<string>;
}

interface TemplaterPlugin {
	templater: TemplaterApi;
}

interface PluginsApi {
	plugins?: Record<string, unknown>;
}

export class TemplaterBridge {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	private getTemplater(): TemplaterApi | null {
		const plugins = (this.app as unknown as { plugins?: PluginsApi }).plugins;
		const tp = plugins?.plugins?.["templater-obsidian"] as TemplaterPlugin | undefined;
		return tp?.templater ?? null;
	}

	isInstalled(): boolean {
		return this.getTemplater() !== null;
	}

	/**
	 * Render a Templater template file against a target note. Returns the
	 * rendered string, or null if Templater isn't installed, the template
	 * doesn't exist, or rendering threw.
	 */
	async renderFile(templatePath: string, targetFile: TFile): Promise<string | null> {
		const tp = this.getTemplater();
		if (!tp) return null;
		const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
		if (!(templateFile instanceof TFile)) {
			console.warn(`[schema] body template not found: ${templatePath}`);
			return null;
		}
		try {
			const config: RunningConfig = {
				template_file: templateFile,
				target_file: targetFile,
				run_mode: RUN_MODE_CREATE_NEW,
				active_file: this.app.workspace.getActiveFile(),
			};
			return await tp.read_and_parse_template(config);
		} catch (err) {
			console.error(`[schema] templater render failed for ${templatePath}:`, err);
			return null;
		}
	}

	/** Render a raw template source string against a target note. */
	async renderString(templateSource: string, targetFile: TFile): Promise<string | null> {
		const tp = this.getTemplater();
		if (!tp) return null;
		try {
			const config: RunningConfig = {
				template_file: undefined,
				target_file: targetFile,
				run_mode: RUN_MODE_CREATE_NEW,
				active_file: this.app.workspace.getActiveFile(),
			};
			return await tp.parse_template(config, templateSource);
		} catch (err) {
			console.error(`[schema] templater render-string failed:`, err);
			return null;
		}
	}
}
