# Journal Analyzer - Obsidian Plugin

An Obsidian plugin that uses Claude Code to analyze journal entries for patterns, themes, and insights across time.

## Features

- **Analyze Recent Entries**: Quickly analyze your last 30 days (configurable) of journal entries
- **Custom Date Range**: Select specific date ranges for analysis
- **Pattern Recognition**: Identifies recurring themes, behavioral patterns, and decision-making trends
- **Auto-Generated Meta Notes**: Creates analysis notes with proper frontmatter and links
- **Claude Code Integration**: Leverages Claude Code's AI capabilities for deep content analysis

## Installation

### Development Installation

1. Clone this repository into your Obsidian plugins folder:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins
   git clone https://github.com/timmcelreath/obsidian-journal-analyzer.git
   cd obsidian-journal-analyzer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Enable the plugin in Obsidian:
   - Open Settings → Community Plugins
   - Turn off "Safe mode"
   - Enable "Journal Analyzer"

### For Your Vault

To install directly in your `claude-life` vault:

```bash
cd ~/claude-life/.obsidian/plugins
git clone https://github.com/timmcelreath/obsidian-journal-analyzer.git journal-analyzer
cd journal-analyzer
npm install
npm run build
```

Then restart Obsidian and enable the plugin.

## Configuration

Open Settings → Journal Analyzer to configure:

- **Journal Folder**: Path to your journal folder (default: `journal`)
- **Meta Folder**: Where analysis notes are saved (default: `journal/meta`)
- **Default Days**: Number of days for "recent" analysis (default: `30`)
- **Claude Code Path**: Path to Claude Code CLI (default: `claude`)

## Usage

### Analyze Recent Entries

1. Open Command Palette (Cmd/Ctrl + P)
2. Type "Analyze Recent Journal Entries"
3. Wait for analysis to complete
4. A new meta note will open with insights

### Analyze Date Range

1. Open Command Palette (Cmd/Ctrl + P)
2. Type "Analyze Journal Date Range"
3. Enter start and end dates (YYYY-MM-DD format)
4. Analysis note will be created in your meta folder

## What Gets Analyzed

The plugin looks for:

1. **Recurring Themes**: Topics mentioned multiple times across entries
2. **Pattern Recognition**: Behavioral, emotional, and decision-making patterns
3. **Key Insights**: Significant moments or realizations
4. **Suggested Connections**: Entries or concepts that should be linked
5. **Questions to Consider**: Prompts based on identified patterns

## Output Format

Analysis notes include:

```markdown
---
date: YYYY-MM-DD
type: journal-analysis
tags: [meta, analysis, journal]
start_date: YYYY-MM-DD
end_date: YYYY-MM-DD
---

# Journal Analysis: [Date Range]

## Recurring Themes
...

## Pattern Recognition
...

## Key Insights
...

## Suggested Connections
...

## Questions to Consider
...
```

## Requirements

- Obsidian v0.15.0 or higher
- Claude Code CLI installed and accessible
- Journal entries named with date format: `YYYY-MM-DD.md`

## Development

### Build for Development

Watch mode (rebuilds on changes):
```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

### Project Structure

```
obsidian-journal-analyzer/
├── main.ts              # Main plugin code
├── manifest.json        # Plugin manifest
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── esbuild.config.mjs   # Build configuration
├── docs/               # Documentation
│   └── future-features.md
└── README.md           # This file
```

## Roadmap

See [docs/future-features.md](docs/future-features.md) for planned features including:
- Interview Prep Auto-Generator
- Knowledge Graph Connector
- Context-Aware Note Templates
- Decision Journal Assistant

## Contributing

This is a personal project, but suggestions and bug reports are welcome via GitHub issues.

## License

MIT

## Author

Tim McElreath
- GitHub: [@timmcelreath](https://github.com/timmcelreath)
- LinkedIn: [timmcelreath](https://linkedin.com/in/timmcelreath)

---

Built with Claude Code integration for AI-powered journal analysis.
