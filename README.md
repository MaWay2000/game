# 3D First-Person Game

[**Play the live game**](https://maway2000.github.io/game/) · [Source code](https://github.com/MaWay2000/game) · [Report an issue](https://github.com/MaWay2000/game/issues)

A browser-based first-person 3D game prototype with maps, enemies, weapons, and companion editing/viewing tools. The project uses plain HTML, CSS, JavaScript, and Three.js, with static assets published on GitHub Pages.

## Features

- First-person movement and a real-time 3D scene.
- Map loading from project data files.
- Weapons and zombie/enemy systems.
- Local browser save/statistics handling.
- Browser-based map and model tools.
- Separate PHP utilities for server-side editing workflows.

## Live pages

| Page | Link |
| --- | --- |
| Game | [Play now](https://maway2000.github.io/game/) |
| Map maker | [Open map maker](https://maway2000.github.io/game/mapmaker.html) |
| GLB viewer | [Open model viewer](https://maway2000.github.io/game/glb_viewer.html) |

Use the game's interface for current controls and options. The project is a prototype, and individual tools may have different requirements.

## Run locally

Install Python 3 and use a browser with JavaScript and working WebGL support:

```bash
git clone https://github.com/MaWay2000/game.git
cd game
python -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/). Keep the terminal open while playing; use Ctrl+C to stop the local server.

No application build step is required for the static pages. Do not rely on opening `index.html` directly: asset and map requests should run over HTTP.

## Static hosting versus PHP tools

GitHub Pages serves the game and static JSON data, but does **not** execute PHP. The Python command above also serves static files only.

Utilities such as `save_map.php`, `load_map.php`, and the PHP editing/generation pages require a separately configured PHP-capable development server. Opening a tool's page on GitHub Pages does not mean its server-side save operations are available.

The static map loader uses project JSON files, including map, object, and zombie data. Keep filenames and paths case-correct when deploying to GitHub Pages.

## Project layout

- `index.html`: main game entry point.
- `js/`: gameplay, rendering, map loading, and save-related modules.
- `maps/`: map data.
- `models/`, `images/`, and `sounds/`: assets.
- `mapmaker.html`: browser map tool.
- `glb_viewer.html`: GLB model viewer.
- PHP files: optional server-side editing and data-generation utilities.
- [AGENTS.md](AGENTS.md): development and debugging guidelines.

## Local progress

Save-related data is stored in browser `localStorage`. It belongs to the current browser profile and site address, not to your GitHub account. Clearing site data can remove it. Local development and the hosted game use separate storage.

## Development and feedback

Keep patches focused and preserve working movement, rendering, asset loading, and save behavior. After changes, check the page and browser console, then exercise the affected feature and related gameplay systems.

[Report a bug](https://github.com/MaWay2000/game/issues) with reproduction steps, browser/OS details, console errors, and a screenshot if useful. State whether you used GitHub Pages, a local static server, or a PHP-capable server.
