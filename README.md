# OGS AI Review Chart

A Tampermonkey userscript that enhances the [Online Go Server (OGS)](https://online-go.com) game review experience by overlaying a move-quality analysis chart directly on game pages.

## What It Does

When you open a finished game with an AI review on OGS, the script injects a visual chart showing every move in the game color-coded by quality category:

| Category | Color |
|---|---|
| Excellent | Blue |
| Great | Green |
| Good | Light Green |
| Inaccuracy | Amber |
| Mistake | Orange |
| Blunder | Red |

Below the categorical chart, a second quantitative panel displays each move's exact score-loss value in fine-grained buckets (0.0–3.0 in steps of 0.2, then broader buckets up to 15+), giving a precise distribution of where accuracy was lost across the game.

## How It Works

OGS already receives AI review data via WebSocket and renders it in a React `SummaryTable` component. Rather than re-implementing the WebSocket protocol, the script reads the move categorization directly from the component's React fiber props — zero additional API calls, no extra load on OGS servers.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser (Chrome, Firefox, Edge, or Safari)
2. Click **Create a new script** in the Tampermonkey dashboard
3. Paste the contents of [`ogs-ai-review-chart.user.js`](tmscript/ogs-ai-review-chart.user.js)
4. Save — the script activates automatically on `online-go.com/game/*` and `online-go.com/review/*`

## Usage

Navigate to any finished OGS game with an AI review enabled. The chart renders automatically once the AI summary panel loads. No configuration needed.

## Requirements

- Tampermonkey (or a compatible userscript manager such as Violentmonkey)
- An OGS account with AI review access on the target game

## Development Reference

The `ogsgit/` directory contains a local mirror of the [online-go/online-go.com](https://github.com/online-go/online-go.com) open-source React codebase, used as a reference for understanding OGS internals and component structure during development.

## License

MIT
