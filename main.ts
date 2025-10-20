import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface JournalAnalyzerSettings {
	journalFolder: string;
	metaFolder: string;
	claudeCodePath: string;
	daysToAnalyze: number;
}

const DEFAULT_SETTINGS: JournalAnalyzerSettings = {
	journalFolder: 'journal',
	metaFolder: 'journal/meta',
	claudeCodePath: '/Users/timmcelreath/Repos/claude-scripts/claude-wrapper.sh',
	daysToAnalyze: 30
}

export default class JournalAnalyzerPlugin extends Plugin {
	settings: JournalAnalyzerSettings;

	async onload() {
		await this.loadSettings();

		// Add command to analyze recent journal entries
		this.addCommand({
			id: 'analyze-recent-journal',
			name: 'Analyze Recent Journal Entries',
			callback: () => {
				this.analyzeRecentJournal();
			}
		});

		// Add command to analyze date range
		this.addCommand({
			id: 'analyze-date-range',
			name: 'Analyze Journal Date Range',
			callback: () => {
				new DateRangeModal(this.app, async (startDate: string, endDate: string) => {
					await this.analyzeJournalRange(startDate, endDate);
				}).open();
			}
		});

		// Add settings tab
		this.addSettingTab(new JournalAnalyzerSettingTab(this.app, this));
	}

	async analyzeRecentJournal() {
		const days = this.settings.daysToAnalyze;
		const endDate = new Date();
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - days);

		const startDateStr = this.formatDate(startDate);
		const endDateStr = this.formatDate(endDate);

		await this.analyzeJournalRange(startDateStr, endDateStr);
	}

	async analyzeJournalRange(startDate: string, endDate: string) {
		const progressModal = new ProgressModal(this.app);
		progressModal.open();

		try {
			// Get all journal files in date range
			progressModal.updateProgress('Finding journal entries...');
			const journalFiles = await this.getJournalFilesInRange(startDate, endDate);

			if (journalFiles.length === 0) {
				progressModal.close();
				new Notice('No journal entries found in the specified range');
				return;
			}

			// Show which entries will be analyzed
			const fileNames = journalFiles.map(f => f.basename).join(', ');
			progressModal.updateProgress(`Found ${journalFiles.length} entries: ${fileNames}`);
			await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause to show files

			// Read all journal content
			progressModal.updateProgress('Reading journal entries...');
			const journalContent = await this.readJournalFiles(journalFiles);

			// Create analysis prompt for Claude Code
			progressModal.updateProgress('Analyzing with Claude Code...\n(This may take 30-60 seconds)');
			const analysis = await this.analyzeWithClaudeCode(journalContent, startDate, endDate);

			// Create meta note with analysis
			progressModal.updateProgress('Creating analysis note...');
			await this.createMetaNote(analysis, startDate, endDate);

			progressModal.close();
			new Notice('Journal analysis complete!');
		} catch (error) {
			progressModal.close();
			console.error('Error analyzing journal:', error);
			new Notice(`Error analyzing journal: ${error.message}`);
		}
	}

	async getJournalFilesInRange(startDate: string, endDate: string): Promise<TFile[]> {
		const journalFolder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder);
		if (!journalFolder) {
			throw new Error(`Journal folder not found: ${this.settings.journalFolder}`);
		}

		const allFiles = this.app.vault.getMarkdownFiles();
		const journalFiles = allFiles.filter(file => {
			if (!file.path.startsWith(this.settings.journalFolder)) {
				return false;
			}

			// Extract date from filename (assumes YYYY-MM-DD.md format)
			const dateMatch = file.basename.match(/(\d{4}-\d{2}-\d{2})/);
			if (!dateMatch) {
				return false;
			}

			const fileDate = dateMatch[1];
			return fileDate >= startDate && fileDate <= endDate;
		});

		return journalFiles.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	async readJournalFiles(files: TFile[]): Promise<string> {
		let content = '';

		for (const file of files) {
			const fileContent = await this.app.vault.read(file);
			content += `\n\n## Entry: ${file.basename}\n\n${fileContent}\n`;
		}

		return content;
	}

	async analyzeWithClaudeCode(content: string, startDate: string, endDate: string): Promise<string> {
		const prompt = `Analyze the following journal entries from ${startDate} to ${endDate}.

Please provide:

1. **Recurring Themes** - Identify major themes that appear multiple times
2. **Pattern Recognition** - Note behavioral patterns, decision-making patterns, emotional patterns
3. **Key Insights** - What stands out as significant across entries
4. **Suggested Connections** - Identify entries or concepts that should be linked together
5. **Questions to Consider** - Based on the patterns, what questions might be worth exploring

Journal Entries:
${content}

Please format your response in markdown with clear sections.`;

		try {
			// Write prompt to temp file to avoid command line length limits
			const os = require('os');
			const fs = require('fs');
			const tempFile = `${os.tmpdir()}/journal-analysis-prompt-${Date.now()}.txt`;

			await fs.promises.writeFile(tempFile, prompt);

			// Call Claude Code CLI with the prompt file
			const { stdout, stderr } = await execAsync(`cat "${tempFile}" | ${this.settings.claudeCodePath}`);

			// Clean up temp file
			await fs.promises.unlink(tempFile);

			if (stderr) {
				console.warn('Claude Code stderr:', stderr);
			}

			if (!stdout || stdout.trim().length === 0) {
				throw new Error('Claude Code returned empty response');
			}

			// Add metadata footer
			const entriesCount = content.split('## Entry:').length - 1;
			return `${stdout.trim()}

---
*Generated by Journal Analyzer Plugin*
*Entries analyzed: ${entriesCount}*
*Generated: ${new Date().toLocaleString()}*`;

		} catch (error) {
			console.error('Error calling Claude Code:', error);
			throw new Error(`Failed to analyze with Claude Code: ${error.message}`);
		}
	}

	async createMetaNote(analysis: string, startDate: string, endDate: string) {
		// Ensure meta folder exists
		const metaFolder = this.settings.metaFolder;
		if (!this.app.vault.getAbstractFileByPath(metaFolder)) {
			await this.app.vault.createFolder(metaFolder);
		}

		// Create filename based on date range
		const filename = `${metaFolder}/analysis-${startDate}-to-${endDate}.md`;

		// Create frontmatter
		const frontmatter = `---
date: ${this.formatDate(new Date())}
type: journal-analysis
tags: [meta, analysis, journal]
start_date: ${startDate}
end_date: ${endDate}
---

`;

		const fullContent = frontmatter + analysis;

		// Create or overwrite the file
		const existingFile = this.app.vault.getAbstractFileByPath(filename);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, fullContent);
		} else {
			await this.app.vault.create(filename, fullContent);
		}

		// Open the new file
		const file = this.app.vault.getAbstractFileByPath(filename);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf().openFile(file);
		}
	}

	formatDate(date: Date): string {
		return date.toISOString().split('T')[0];
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ProgressModal extends Modal {
	private messageEl: HTMLElement;
	private cancelCallback: (() => void) | null = null;

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Analyzing Journal'});

		this.messageEl = contentEl.createEl('p', {
			text: 'Initializing...',
			cls: 'journal-analyzer-progress'
		});

		// Add cancel button
		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
		const cancelButton = buttonContainer.createEl('button', {text: 'Cancel'});
		cancelButton.addEventListener('click', () => {
			if (this.cancelCallback) {
				this.cancelCallback();
			}
			this.close();
		});
	}

	updateProgress(message: string) {
		if (this.messageEl) {
			this.messageEl.setText(message);
		}
	}

	setCancelCallback(callback: () => void) {
		this.cancelCallback = callback;
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class DateRangeModal extends Modal {
	onSubmit: (startDate: string, endDate: string) => void;
	startDate: string;
	endDate: string;

	constructor(app: App, onSubmit: (startDate: string, endDate: string) => void) {
		super(app);
		this.onSubmit = onSubmit;

		// Default to last 30 days
		const end = new Date();
		const start = new Date();
		start.setDate(start.getDate() - 30);

		this.startDate = this.formatDate(start);
		this.endDate = this.formatDate(end);
	}

	formatDate(date: Date): string {
		return date.toISOString().split('T')[0];
	}

	onOpen() {
		const {contentEl} = this;

		contentEl.createEl('h2', {text: 'Select Date Range'});

		new Setting(contentEl)
			.setName('Start Date')
			.setDesc('First date to include (YYYY-MM-DD)')
			.addText(text => text
				.setValue(this.startDate)
				.onChange(value => {
					this.startDate = value;
				}));

		new Setting(contentEl)
			.setName('End Date')
			.setDesc('Last date to include (YYYY-MM-DD)')
			.addText(text => text
				.setValue(this.endDate)
				.onChange(value => {
					this.endDate = value;
				}));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Analyze')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.startDate, this.endDate);
				}));
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class JournalAnalyzerSettingTab extends PluginSettingTab {
	plugin: JournalAnalyzerPlugin;

	constructor(app: App, plugin: JournalAnalyzerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Journal Analyzer Settings'});

		new Setting(containerEl)
			.setName('Journal Folder')
			.setDesc('Path to your journal folder (relative to vault root)')
			.addText(text => text
				.setPlaceholder('journal')
				.setValue(this.plugin.settings.journalFolder)
				.onChange(async (value) => {
					this.plugin.settings.journalFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Meta Folder')
			.setDesc('Where to save analysis notes')
			.addText(text => text
				.setPlaceholder('journal/meta')
				.setValue(this.plugin.settings.metaFolder)
				.onChange(async (value) => {
					this.plugin.settings.metaFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Days to Analyze')
			.setDesc('Number of days to include in recent analysis')
			.addText(text => text
				.setPlaceholder('30')
				.setValue(String(this.plugin.settings.daysToAnalyze))
				.onChange(async (value) => {
					this.plugin.settings.daysToAnalyze = parseInt(value) || 30;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Claude Code Path')
			.setDesc('Path to Claude Code CLI (e.g., "claude" if in PATH)')
			.addText(text => text
				.setPlaceholder('claude')
				.setValue(this.plugin.settings.claudeCodePath)
				.onChange(async (value) => {
					this.plugin.settings.claudeCodePath = value;
					await this.plugin.saveSettings();
				}));
	}
}
