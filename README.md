# Gangsters RTS

An experimental real-time strategy fork of [Original Gangster](https://github.com/daleeb/original-gangster-release),
the independent fan reimagining of *Gangsters: Organized Crime* (1998). The goal is
to run your gang from the city itself: move crews, issue orders while time passes,
and open the Organizer whenever you need it.

This is a **work in progress**, not a finished RTS conversion. The remake's weekly
economy, order deadlines and other simulation rules still run underneath the live
city. We are changing those systems incrementally and testing each step.

## Where the project stands

Work happens on the [`rts-development`](https://github.com/arnip4-hub/RTS-gangster-1-/tree/rts-development)
branch. The default `main` branch is kept as the remake baseline, with this project
page and the Windows build workflow.

- **In the latest published Windows test build:** watch the 3D city, click the
  minimap to jump across town, open the Organizer during a working week with `O`
  or **Book**, and use **Move crew** in the People roster to choose a destination
  for a deployed team.
- **Implemented on `rts-development`, awaiting the next Windows build:** pan the
  city with `W/A/S/D` or the arrow keys in plan, rooftop and street zoom during
  the working week. After weekly settlement, the next working week starts
  automatically; the Organizer is still available on demand.
- **Still to build:** simpler group selection and move orders, better live reports,
  and a deeper redesign of weekly orders and accounting so the game can become
  a full RTS. Automatic week rollover does not remove weekly rules yet.

New games currently start at the planning desk. Press **Hit the Streets!** to enter
the live city. The original GOG installation is separate from this remake fork.

## Download a test build

The current [Windows prerelease](https://github.com/arnip4-hub/RTS-gangster-1-/releases/tag/rts-test-20261115.3)
contains an installer (`Original.Gangster.Setup.1.0.6.exe`) and a portable executable
(`Original.Gangster.1.0.6.exe`). The filenames still use the remake's product name.
This published build predates the `W/A/S/D` and automatic week rollover changes
listed above. Check each release's notes for what is included before downloading.

To run the newest source code locally, use the `rts-development` branch and the
commands below. Browser saves stay in that browser; the desktop app saves to disk.

## Requirements

- [Node.js](https://nodejs.org/) 20.19+, 22.12+ or 24+ (`.node-version` pins 24.19.0)
- npm 11

## Getting started

```bash
git clone --branch rts-development https://github.com/arnip4-hub/RTS-gangster-1-.git
cd RTS-gangster-1-
npm install
npm run dev
```

Then open the URL Vite prints (port 5180 by default).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Check the save schema, typecheck and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Run the TypeScript compiler without emitting |
| `npm test` | Run the full test suite (slow: allow 40+ minutes) |
| `npm run test:acceptance` | Run the core acceptance tests |
| `npm run test:long` | Run the long playthrough and integrity tests |
| `npm run desktop` | Build and launch the Electron desktop app |
| `npm run desktop:dev` | Run the desktop app against the dev server |
| `npm run package` | Build desktop installers for the current platform |
| `npm run package:win` | Build the Windows installer and portable exe |
| `npm run package:linux` | Build a Linux `.tar.gz` |
| `npm run package:mac` | Build macOS `.dmg` files for Apple Silicon and Intel (macOS only) |

macOS builds can only be made on a Mac. Without one, run the **Mac build**
workflow from the repository's Actions tab: it builds both `.dmg` files on
GitHub's macOS runners and can attach them to a release.

Packaged builds go to `release/`. A checkout inside OneDrive packages to
`%LOCALAPPDATA%\OriginalGangster-release` instead, because OneDrive locks the
folders electron-builder renames; set `OG_RELEASE_DIR` to override.

## Project layout

```
src/
  app/      game state, saves, scenarios and tutorials
  sim/      the simulation: economy, combat, AI gangs, elections, police
  render/   the Three.js city, characters, vehicles and effects
  ui/       React interface: desk, menus, city view
  audio/    music and street sound
electron/   desktop shell and on-disk save store
public/     art, models and audio
scripts/    build, packaging and asset tools
tests/      Vitest suites
```

## Credits

This fork builds on [Original Gangster by daleeb](https://github.com/daleeb/original-gangster-release),
licensed under [MIT](LICENSE). The remake supplies the original code and its own
art, models, music and sound. No files from the 1998 GOG game are included here.

*Gangsters: Organized Crime* was designed by Martin Capel, developed by Hothouse
Creations and published by Eidos Interactive in 1998.

Built with Three.js, React, Vite, Zustand, Electron and Vitest. Fonts are Barlow,
Barlow Condensed, Special Elite and Cinzel from Google Fonts (SIL Open Font License).

This fan project is not affiliated with or endorsed by Hothouse Creations, Eidos
Interactive or the rights holders of the 1998 game.

## License

[MIT](LICENSE)
