import { App, Plugin, PluginSettingTab, Setting, TFolder, WorkspaceLeaf } from "obsidian";

interface CleanStartupSettings {
	/** 启动时关闭主编辑区的所有标签页 */
	closeAllTabs: boolean;
	/** 折叠文件浏览器中的所有文件夹 */
	collapseFolders: boolean;
	/** 折叠右侧栏 */
	collapseRightSidebar: boolean;
	/** 折叠左侧栏（默认关闭） */
	collapseLeftSidebar: boolean;
	/** 清理前的延迟毫秒数，用于慢速启动的机器 */
	startupDelay: number;
	/** 清理完成前隐藏界面，避免旧标签闪现 */
	hideUntilDone: boolean;
}

const DEFAULT_SETTINGS: CleanStartupSettings = {
	closeAllTabs: true,
	collapseFolders: true,
	collapseRightSidebar: true,
	collapseLeftSidebar: false,
	startupDelay: 0,
	hideUntilDone: true,
};

/** 启动遮罩的 body class，配合 styles.css 隐藏界面 */
const HIDE_CLASS = "clean-startup-hiding";
/** 兜底：无论清理是否成功，最多隐藏这么久，防止白屏卡死 */
const HIDE_TIMEOUT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export default class CleanStartupPlugin extends Plugin {
	settings: CleanStartupSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new CleanStartupSettingTab(this.app, this));

		this.addCommand({
			id: "clean-now",
			name: "立即清理",
			callback: () => {
				void this.runCleanup();
			},
		});

		// 插件加载早于 Obsidian 恢复 workspace 布局，此刻加遮罩可避免旧标签闪现。
		// 兜底时间随启动延迟一起放宽，避免慢机器上遮罩提前移除。
		if (this.settings.hideUntilDone) {
			document.body.classList.add(HIDE_CLASS);
			const fallback = HIDE_TIMEOUT_MS + Math.max(0, this.settings.startupDelay || 0);
			window.setTimeout(() => this.reveal(), fallback);
		}

		this.app.workspace.onLayoutReady(async () => {
			const delay = Math.max(0, this.settings.startupDelay || 0);
			if (delay > 0) await sleep(delay);

			await this.runCleanup();
			this.reveal();
		});
	}

	onunload(): void {
		// 插件被禁用/重载时确保遮罩不残留
		this.reveal();
	}

	private reveal(): void {
		document.body.classList.remove(HIDE_CLASS);
	}

	async runCleanup(): Promise<void> {
		if (this.settings.closeAllTabs) this.closeAllTabs();
		if (this.settings.collapseFolders) await this.collapseAllFolders();
		if (this.settings.collapseLeftSidebar) this.app.workspace.leftSplit.collapse();
		if (this.settings.collapseRightSidebar) this.app.workspace.rightSplit.collapse();
	}

	/** 关闭主编辑区（根层级）的所有标签页，只留一个空白页 */
	private closeAllTabs(): void {
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));

		if (leaves.length === 0) return;

		for (const leaf of leaves) {
			try {
				leaf.detach();
			} catch (err) {
				console.error("[Clean Startup] 关闭标签失败", err);
			}
		}

		// 关闭最后一个标签后 Obsidian 可能留下空工作区，补一个空白页
		window.setTimeout(() => {
			if (this.app.workspace.getLeavesOfType("empty").length === 0) {
				try {
					this.app.workspace.getLeaf("tab");
				} catch (err) {
					console.error("[Clean Startup] 创建空白页失败", err);
				}
			}
		}, 0);
	}

	/**
	 * 折叠文件浏览器中的所有文件夹。
	 * file-explorer 的内部结构在视图挂载后才可用，因此带重试。
	 */
	private async collapseAllFolders(retries = 5): Promise<void> {
		const view = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view as
			| { fileItems?: Record<string, { setCollapsed?: (collapsed: boolean) => void }> }
			| undefined;

		const fileItems = view?.fileItems;
		const paths = fileItems ? Object.keys(fileItems) : [];

		// 视图尚未挂载时 fileItems 为空，等待后重试
		if (paths.length === 0) {
			if (retries > 0) {
				await sleep(200);
				return this.collapseAllFolders(retries - 1);
			}
			console.warn("[Clean Startup] 未找到文件浏览器视图，跳过文件夹折叠");
			return;
		}

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFolder)) continue;

			try {
				fileItems?.[path]?.setCollapsed?.(true);
			} catch (err) {
				console.error(`[Clean Startup] 折叠文件夹失败: ${path}`, err);
			}
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class CleanStartupSettingTab extends PluginSettingTab {
	plugin: CleanStartupPlugin;

	constructor(app: App, plugin: CleanStartupPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Clean Startup 设置" });
		containerEl.createEl("p", {
			text: "以下动作仅在 Obsidian 启动时自动执行一次；平时打开/关闭标签不受影响。",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("关闭所有标签页")
			.setDesc("启动时关闭主编辑区的全部标签，只保留一个空白页。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.closeAllTabs).onChange(async (value) => {
					this.plugin.settings.closeAllTabs = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("折叠所有文件夹")
			.setDesc("把左侧文件列表里的文件夹全部折叠，只显示顶层文件夹。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collapseFolders).onChange(async (value) => {
					this.plugin.settings.collapseFolders = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("折叠右侧栏")
			.setDesc("启动时收起右侧的反向链接、大纲等面板。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collapseRightSidebar).onChange(async (value) => {
					this.plugin.settings.collapseRightSidebar = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("折叠左侧栏")
			.setDesc("连同整个左侧边栏一起收起，而不只是折叠文件夹。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collapseLeftSidebar).onChange(async (value) => {
					this.plugin.settings.collapseLeftSidebar = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("启动延迟")
			.setDesc("清理前等待的毫秒数。库较大、启动较慢时可调高，单位 ms。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 3000, 100)
					.setValue(this.plugin.settings.startupDelay)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.startupDelay = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("清理前隐藏界面")
			.setDesc("避免启动瞬间闪出上次的标签页。关闭后若出现闪烁，可重新开启。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.hideUntilDone).onChange(async (value) => {
					this.plugin.settings.hideUntilDone = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("立即清理").onClick(() => {
				void this.plugin.runCleanup();
			})
		);
	}
}
