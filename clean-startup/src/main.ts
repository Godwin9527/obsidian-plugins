import {
	App,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
	WorkspaceLeaf,
	apiVersion,
} from "obsidian";

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
	/** 把执行过程写入库根目录的 clean-startup-debug.md，用于排查问题 */
	debugLog: boolean;
}

const DEFAULT_SETTINGS: CleanStartupSettings = {
	closeAllTabs: true,
	collapseFolders: true,
	collapseRightSidebar: true,
	collapseLeftSidebar: false,
	startupDelay: 0,
	hideUntilDone: true,
	debugLog: true,
};

/** 启动遮罩的 body class，配合 styles.css 隐藏界面 */
const HIDE_CLASS = "clean-startup-hiding";
/** 兜底：无论清理是否成功，最多隐藏这么久，防止白屏卡死 */
const HIDE_TIMEOUT_MS = 5000;
/** 诊断文件路径（库根目录） */
const DEBUG_FILE = "clean-startup-debug.md";
/** 单个 leaf 等待 deferred 视图加载的上限 */
const DEFER_LOAD_TIMEOUT_MS = 1200;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export default class CleanStartupPlugin extends Plugin {
	settings: CleanStartupSettings;
	private debugLines: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new CleanStartupSettingTab(this.app, this));

		this.addCommand({
			id: "clean-now",
			name: "立即清理",
			callback: () => {
				void this.runCleanup(true);
			},
		});

		this.debugLines = [];
		this.log(`启动于 ${new Date().toLocaleString()}`);
		this.log(`Obsidian ${apiVersion} / ${Platform.isDesktop ? "桌面端" : "移动端"}`);

		// 插件加载早于 Obsidian 恢复 workspace 布局，此刻加遮罩可避免旧标签闪现。
		// 兜底时间随启动延迟一起放宽，避免慢机器上遮罩提前移除。
		if (this.settings.hideUntilDone) {
			document.body.classList.add(HIDE_CLASS);
			const fallback = HIDE_TIMEOUT_MS + Math.max(0, this.settings.startupDelay || 0);
			window.setTimeout(() => this.reveal(), fallback);
		}

		this.app.workspace.onLayoutReady(async () => {
			try {
				const delay = Math.max(0, this.settings.startupDelay || 0);
				if (delay > 0) await sleep(delay);
				await this.runCleanup(false);
			} catch (err) {
				this.log(`清理过程异常：${String(err)}`);
				console.error("[Clean Startup]", err);
			} finally {
				this.reveal();
				await this.flushDebug();
			}
		});
	}

	onunload(): void {
		// 插件被禁用/重载时确保遮罩不残留
		this.reveal();
	}

	private reveal(): void {
		document.body.classList.remove(HIDE_CLASS);
	}

	async runCleanup(manual: boolean): Promise<void> {
		if (manual) {
			this.debugLines = [];
			this.log(`手动清理 ${new Date().toLocaleString()}`);
		}

		if (this.settings.closeAllTabs) await this.closeAllTabs();
		if (this.settings.collapseFolders) await this.collapseAllFolders();
		if (this.settings.collapseLeftSidebar) {
			this.app.workspace.leftSplit.collapse();
			this.log("已折叠左侧栏");
		}
		if (this.settings.collapseRightSidebar) {
			this.app.workspace.rightSplit.collapse();
			this.log("已折叠右侧栏");
		}

		if (manual) await this.flushDebug();
	}

	/**
	 * 收集主编辑区（不含左右侧栏、不含弹出窗口）的所有 leaf。
	 * 用 iterateAllLeaves + getRoot() 判断，比 iterateRootLeaves 更明确。
	 */
	private collectRootLeaves(): WorkspaceLeaf[] {
		const rootSplit = this.app.workspace.rootSplit;
		const result: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			try {
				const root = leaf.getRoot();
				if (!rootSplit || root === rootSplit) result.push(leaf);
			} catch {
				// getRoot 抛错时保守跳过，避免误关侧栏面板
			}
		});
		return result;
	}

	private describeLeaf(leaf: WorkspaceLeaf): string {
		const view = leaf.view as unknown as {
			getViewType?: () => string;
			file?: { path?: string };
		};
		const type = view?.getViewType?.() ?? "unknown";
		const file = view?.file?.path ?? "-";
		const deferred = (leaf as unknown as { isDeferred?: boolean }).isDeferred ? " [延迟加载]" : "";
		return `${type}(${file})${deferred}`;
	}

	/**
	 * 关闭主编辑区所有标签，只留一个空白页。
	 *
	 * 关键点：Obsidian 1.7.2+ 后台标签是 deferred view，直接 detach 可能无效，
	 * 因此先 await loadIfDeferred() 再 detach，并对残留做兜底置空。
	 */
	private async closeAllTabs(): Promise<void> {
		const maxRounds = 3;

		for (let round = 1; round <= maxRounds; round++) {
			const leaves = this.collectRootLeaves();
			this.log(`第 ${round} 轮：主区域标签 ${leaves.length} 个`);
			if (leaves.length === 0) break;

			// 先关非活动标签，最后关活动标签，避免 Obsidian 反复切换并加载新视图
			const active = (this.app.workspace as unknown as { activeLeaf?: WorkspaceLeaf }).activeLeaf;
			const ordered = [
				...leaves.filter((l) => l !== active),
				...(active && leaves.includes(active) ? [active] : []),
			];

			for (const leaf of ordered) {
				const desc = this.describeLeaf(leaf);
				try {
					const maybeDeferred = leaf as unknown as {
						isDeferred?: boolean;
						loadIfDeferred?: () => Promise<void>;
					};
					if (maybeDeferred.isDeferred && maybeDeferred.loadIfDeferred) {
						// 给加载设上限，慢文件不至于卡住整个清理
						await Promise.race([maybeDeferred.loadIfDeferred(), sleep(DEFER_LOAD_TIMEOUT_MS)]);
					}
					leaf.detach();
					this.log(`  已关闭 ${desc}`);
				} catch (err) {
					this.log(`  关闭失败 ${desc}：${String(err)}`);
					try {
						await leaf.setViewState({ type: "empty", state: {} });
						this.log(`  兜底置空 ${desc}`);
					} catch (err2) {
						this.log(`  兜底置空也失败：${String(err2)}`);
					}
				}
			}

			await sleep(250);
		}

		const remaining = this.collectRootLeaves();
		this.log(`清理结束，立即复查剩余 ${remaining.length} 个`);
		remaining.forEach((l) => this.log(`  残留：${this.describeLeaf(l)}`));

		if (remaining.length > 0) {
			for (const leaf of remaining) {
				try {
					await leaf.setViewState({ type: "empty", state: {} });
					this.log(`  最终兜底置空：${this.describeLeaf(leaf)}`);
				} catch (err) {
					this.log(`  最终兜底失败：${String(err)}`);
				}
			}
		}

		// 关键诊断：延迟复查，区分「没关掉」与「关了又被恢复」
		await sleep(1500);
		const after = this.collectRootLeaves();
		this.log(`1.5 秒后复查：剩余 ${after.length} 个`);
		after.forEach((l) => this.log(`  又出现：${this.describeLeaf(l)}`));
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
			this.log("未找到文件浏览器视图，跳过文件夹折叠");
			return;
		}

		let folded = 0;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFolder)) continue;

			try {
				fileItems?.[path]?.setCollapsed?.(true);
				folded++;
			} catch (err) {
				this.log(`折叠失败 ${path}：${String(err)}`);
			}
		}
		this.log(`文件夹：共 ${paths.length} 项，折叠 ${folded} 个文件夹`);
	}

	private log(message: string): void {
		this.debugLines.push(`- ${message}`);
	}

	/** 把诊断信息写到库根目录，方便直接打开查看 */
	private async flushDebug(): Promise<void> {
		if (!this.settings.debugLog) return;
		try {
			const body = [
				"# Clean Startup 诊断日志",
				"",
				"> 由插件自动生成，用于排查启动清理是否生效。问题解决后可在插件设置里关闭。",
				"",
				...this.debugLines,
				"",
			].join("\n");
			await this.app.vault.adapter.write(DEBUG_FILE, body);
		} catch (err) {
			console.error("[Clean Startup] 写入诊断日志失败", err);
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
			.setDesc("清理前等待的毫秒数。库较大、启动较慢时可调高，单位 ms。一般保持 0 即可。")
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

		new Setting(containerEl)
			.setName("输出诊断日志")
			.setDesc("把每次启动的清理过程写入库根目录的 clean-startup-debug.md，排查问题用。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugLog).onChange(async (value) => {
					this.plugin.settings.debugLog = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("立即清理").onClick(() => {
				void this.plugin.runCleanup(true);
			})
		);
	}
}
