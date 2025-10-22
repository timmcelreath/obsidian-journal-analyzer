import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface Connection {
	sourceFile: string;
	targetFile: string;
	sourceText: string;
	targetText: string;
	reason: string;
	confidence: number;
	connectionType: string;
}

interface JournalAnalyzerSettings {
	journalFolder: string;
	metaFolder: string;
	claudeCodePath: string;
	daysToAnalyze: number;
	connectionMinConfidence: number;
	connectionTypes: string[];
}

const DEFAULT_SETTINGS: JournalAnalyzerSettings = {
	journalFolder: 'journal',
	metaFolder: 'journal/meta',
	claudeCodePath: '/Users/timmcelreath/Repos/claude-scripts/claude-wrapper.sh',
	daysToAnalyze: 30,
	connectionMinConfidence: 70,
	connectionTypes: ['thematic', 'temporal', 'entity']
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

		// Add command to find missing connections
		this.addCommand({
			id: 'find-missing-connections',
			name: 'Find Missing Connections',
			callback: () => {
				this.findMissingConnections();
			}
		});

		// Add command for quick journal entry
		this.addCommand({
			id: 'quick-journal-entry',
			name: 'Quick Journal Entry',
			callback: () => {
				new QuickJournalModal(this.app, this).open();
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
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async findMissingConnections() {
		const progressModal = new ProgressModal(this.app);
		progressModal.open();

		try {
			// Get current active file
			progressModal.updateProgress('Finding current note...');
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile) {
				progressModal.close();
				new Notice('No active file. Please open a note to analyze.');
				return;
			}

			// Get all markdown files in vault
			progressModal.updateProgress('Reading vault files...');
			const allFiles = this.app.vault.getMarkdownFiles();
			const connections = await this.analyzeConnections(activeFile, allFiles, progressModal);

			progressModal.close();

			if (connections.length === 0) {
				new Notice('No connection suggestions found');
			} else {
				new ConnectionSuggestionModal(this.app, this, connections, activeFile).open();
			}
		} catch (error) {
			progressModal.close();
			console.error('Error finding connections:', error);
			new Notice(`Error finding connections: ${error.message}`);
		}
	}

	async analyzeConnections(currentFile: TFile, allFiles: TFile[], progressModal: ProgressModal): Promise<Connection[]> {
		// Read current file content
		const currentContent = await this.app.vault.read(currentFile);

		// Filter out current file and get a sample of other files
		const otherFiles = allFiles.filter(f => f.path !== currentFile.path);

		// Limit to recent files to avoid overwhelming Claude
		const recentFiles = otherFiles
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 50);

		progressModal.updateProgress(`Analyzing connections with ${recentFiles.length} recent notes...`);

		// Build context from other files
		let context = `# Current Note: ${currentFile.basename}\n\n${currentContent}\n\n---\n\n# Other Notes:\n\n`;

		for (const file of recentFiles) {
			const content = await this.app.vault.read(file);
			// Include first 500 chars of each file for context
			const preview = content.length > 500 ? content.substring(0, 500) + '...' : content;
			context += `## ${file.path}\n${preview}\n\n`;
		}

		progressModal.updateProgress('Analyzing with Claude Code...\n(This may take 30-60 seconds)');

		const prompt = `Analyze the current note and suggest wiki-link connections to other notes in the vault.

Current Note: ${currentFile.basename}

Your task:
1. Find concepts, themes, people, or ideas in the current note that relate to other notes
2. Only suggest connections that meet the minimum confidence threshold: ${this.settings.connectionMinConfidence}%
3. Focus on connection types: ${this.settings.connectionTypes.join(', ')}

For each suggested connection, provide:
- sourceText: The exact text in current note that should be linked (5-30 words)
- targetFile: The path to the note it should link to
- targetText: The relevant text in the target note (5-30 words)
- reason: Why this connection is meaningful (1 sentence)
- confidence: Your confidence level (0-100)
- connectionType: One of: thematic, temporal, entity, causal

Return ONLY valid JSON array of connection objects. Example:
[
  {
    "sourceFile": "${currentFile.path}",
    "targetFile": "journal/2025-10-17.md",
    "sourceText": "making art less intimidating",
    "targetText": "Artsy's mission to make art accessible",
    "reason": "Same core mission concept in different contexts",
    "confidence": 95,
    "connectionType": "thematic"
  }
]

Context:
${context}

Return JSON array only:`;

		try {
			const os = require('os');
			const fs = require('fs');
			const tempFile = `${os.tmpdir()}/connection-analysis-${Date.now()}.txt`;

			await fs.promises.writeFile(tempFile, prompt);

			const { stdout, stderr } = await execAsync(`cat "${tempFile}" | ${this.settings.claudeCodePath}`);

			await fs.promises.unlink(tempFile);

			if (stderr) {
				console.warn('Claude Code stderr:', stderr);
			}

			if (!stdout || stdout.trim().length === 0) {
				throw new Error('Claude Code returned empty response');
			}

			// Parse JSON response
			const jsonMatch = stdout.match(/\[[\s\S]*\]/);
			if (!jsonMatch) {
				console.warn('No JSON found in response:', stdout);
				return [];
			}

			const connections: Connection[] = JSON.parse(jsonMatch[0]);

			// Filter by confidence threshold
			return connections.filter(c => c.confidence >= this.settings.connectionMinConfidence);

		} catch (error) {
			console.error('Error analyzing connections:', error);
			throw new Error(`Failed to analyze connections: ${error.message}`);
		}
	}

	async insertWikiLink(file: TFile, sourceText: string, targetPath: string) {
		const content = await this.app.vault.read(file);

		// Create wiki-link to target
		const targetBasename = targetPath.replace(/\.md$/, '');
		const wikiLink = `[[${targetBasename}]]`;

		// Replace first occurrence of exact source text with wiki-linked version
		const updatedContent = content.replace(sourceText, wikiLink);

		if (updatedContent !== content) {
			await this.app.vault.modify(file, updatedContent);
			return true;
		}

		return false;
	}

	async saveJournalEntry(entry: string): Promise<TFile> {
		// Get today's date in YYYY-MM-DD format
		const today = this.formatDate(new Date());
		const journalPath = `${this.settings.journalFolder}/${today}.md`;

		// Ensure journal folder exists
		if (!this.app.vault.getAbstractFileByPath(this.settings.journalFolder)) {
			await this.app.vault.createFolder(this.settings.journalFolder);
		}

		// Get or create today's journal file
		const existingFile = this.app.vault.getAbstractFileByPath(journalPath);

		if (existingFile instanceof TFile) {
			// File exists, append entry
			const existingContent = await this.app.vault.read(existingFile);
			const timestamp = new Date().toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true
			});
			const newContent = `${existingContent}\n\n## ${timestamp}\n\n${entry}`;
			await this.app.vault.modify(existingFile, newContent);
			return existingFile;
		} else {
			// Create new file with frontmatter
			const frontmatter = `---
date: ${today}
type: journal
tags: [journal]
---

# ${today}

${entry}
`;
			const newFile = await this.app.vault.create(journalPath, frontmatter);
			return newFile;
		}
	}

	async quickJournalWithAnalysis(entry: string) {
		const progressModal = new ProgressModal(this.app);
		progressModal.open();

		try {
			// Save entry
			progressModal.updateProgress('Saving journal entry...');
			const journalFile = await this.saveJournalEntry(entry);

			// Analyze connections
			progressModal.updateProgress('Analyzing connections...\n(This may take 30-60 seconds)');
			const allFiles = this.app.vault.getMarkdownFiles();
			const connections = await this.analyzeConnections(journalFile, allFiles, progressModal);

			progressModal.close();

			// Show results
			new Notice('Journal entry saved!');

			if (connections.length > 0) {
				new ConnectionSuggestionModal(this.app, this, connections, journalFile).open();
			} else {
				// Open the journal file
				await this.app.workspace.getLeaf().openFile(journalFile);
			}

		} catch (error) {
			progressModal.close();
			console.error('Error saving journal entry:', error);
			new Notice(`Error: ${error.message}`);
		}
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
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
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

class ConnectionSuggestionModal extends Modal {
	plugin: JournalAnalyzerPlugin;
	connections: Connection[];
	currentFile: TFile;

	constructor(app: App, plugin: JournalAnalyzerPlugin, connections: Connection[], currentFile: TFile) {
		super(app);
		this.plugin = plugin;
		this.connections = connections;
		this.currentFile = currentFile;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Suggested Connections'});
		contentEl.createEl('p', {
			text: `Found ${this.connections.length} potential connections for ${this.currentFile.basename}`,
			cls: 'connection-summary'
		});

		// Sort by confidence descending
		const sortedConnections = this.connections.sort((a, b) => b.confidence - a.confidence);

		for (const connection of sortedConnections) {
			const connectionDiv = contentEl.createDiv({cls: 'connection-item'});

			// Header with confidence and type
			const headerDiv = connectionDiv.createDiv({cls: 'connection-header'});
			headerDiv.createEl('span', {
				text: `${connection.confidence}% confidence`,
				cls: 'connection-confidence'
			});
			headerDiv.createEl('span', {
				text: connection.connectionType,
				cls: 'connection-type'
			});

			// Target file
			connectionDiv.createEl('div', {
				text: `→ ${connection.targetFile}`,
				cls: 'connection-target'
			});

			// Source text
			connectionDiv.createEl('div', {
				text: `"${connection.sourceText}"`,
				cls: 'connection-source-text'
			});

			// Reason
			connectionDiv.createEl('div', {
				text: connection.reason,
				cls: 'connection-reason'
			});

			// Action buttons
			const buttonContainer = connectionDiv.createDiv({cls: 'connection-buttons'});

			// Add link button
			const addButton = buttonContainer.createEl('button', {text: 'Add Link'});
			addButton.addEventListener('click', async () => {
				try {
					const success = await this.plugin.insertWikiLink(
						this.currentFile,
						connection.sourceText,
						connection.targetFile
					);

					if (success) {
						new Notice(`Added link to ${connection.targetFile}`);
						addButton.disabled = true;
						addButton.setText('Added ✓');
					} else {
						new Notice('Could not find exact text to link. Text may have changed.');
					}
				} catch (error) {
					new Notice(`Error adding link: ${error.message}`);
				}
			});

			// Open target button
			const openButton = buttonContainer.createEl('button', {text: 'Open Target'});
			openButton.addEventListener('click', async () => {
				const targetFile = this.app.vault.getAbstractFileByPath(connection.targetFile);
				if (targetFile instanceof TFile) {
					await this.app.workspace.getLeaf().openFile(targetFile);
				} else {
					new Notice(`Target file not found: ${connection.targetFile}`);
				}
			});

			connectionDiv.createEl('hr');
		}

		// Add all button
		const footerDiv = contentEl.createDiv({cls: 'connection-footer'});
		const addAllButton = footerDiv.createEl('button', {text: 'Add All Links', cls: 'mod-cta'});
		addAllButton.addEventListener('click', async () => {
			let added = 0;
			let failed = 0;

			for (const connection of sortedConnections) {
				try {
					const success = await this.plugin.insertWikiLink(
						this.currentFile,
						connection.sourceText,
						connection.targetFile
					);
					if (success) {
						added++;
					} else {
						failed++;
					}
				} catch (error) {
					failed++;
				}
			}

			new Notice(`Added ${added} links. ${failed > 0 ? `${failed} failed.` : ''}`);
			this.close();
		});

		const closeButton = footerDiv.createEl('button', {text: 'Close'});
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class QuickJournalModal extends Modal {
	plugin: JournalAnalyzerPlugin;
	textArea: HTMLTextAreaElement;

	constructor(app: App, plugin: JournalAnalyzerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Quick Journal Entry'});

		// Large text area for entry
		this.textArea = contentEl.createEl('textarea', {
			cls: 'journal-entry-textarea',
			placeholder: 'Write your journal entry here...\n\nThis will be saved to today\'s journal file and automatically analyzed for connections to other notes.'
		});

		// Style the text area
		this.textArea.style.width = '100%';
		this.textArea.style.height = '300px';
		this.textArea.style.marginBottom = '1em';
		this.textArea.style.padding = '0.5em';
		this.textArea.style.fontSize = '1em';
		this.textArea.style.fontFamily = 'inherit';

		// Focus the text area
		this.textArea.focus();

		// Button container
		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '0.5em';
		buttonContainer.style.justifyContent = 'flex-end';

		// Save & Analyze button (primary action)
		const analyzeButton = buttonContainer.createEl('button', {
			text: 'Save & Analyze',
			cls: 'mod-cta'
		});
		analyzeButton.addEventListener('click', async () => {
			const entry = this.textArea.value.trim();
			if (entry.length === 0) {
				new Notice('Please enter some text');
				return;
			}

			this.close();
			await this.plugin.quickJournalWithAnalysis(entry);
		});

		// Save Only button (secondary action)
		const saveButton = buttonContainer.createEl('button', {text: 'Save Only'});
		saveButton.addEventListener('click', async () => {
			const entry = this.textArea.value.trim();
			if (entry.length === 0) {
				new Notice('Please enter some text');
				return;
			}

			this.close();
			try {
				const journalFile = await this.plugin.saveJournalEntry(entry);
				new Notice('Journal entry saved!');
				await this.app.workspace.getLeaf().openFile(journalFile);
			} catch (error) {
				new Notice(`Error saving entry: ${error.message}`);
			}
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl('button', {text: 'Cancel'});
		cancelButton.addEventListener('click', () => this.close());

		// Handle Enter key with Ctrl/Cmd to submit
		this.textArea.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				analyzeButton.click();
			}
		});
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

		// Connection settings section
		containerEl.createEl('h3', {text: 'Knowledge Graph Connector'});

		new Setting(containerEl)
			.setName('Minimum Connection Confidence')
			.setDesc('Only show connection suggestions with this confidence % or higher (0-100)')
			.addText(text => text
				.setPlaceholder('70')
				.setValue(String(this.plugin.settings.connectionMinConfidence))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (num >= 0 && num <= 100) {
						this.plugin.settings.connectionMinConfidence = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Connection Types')
			.setDesc('Types of connections to identify (comma-separated): thematic, temporal, entity, causal')
			.addText(text => text
				.setPlaceholder('thematic, temporal, entity')
				.setValue(this.plugin.settings.connectionTypes.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.connectionTypes = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
					await this.plugin.saveSettings();
				}));
	}
}
