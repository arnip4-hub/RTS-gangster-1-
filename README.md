# RTS gangster beta

An experimental real-time strategy fork of [Original Gangster](https://github.com/daleeb/original-gangster-release),
the independent fan reimagining of *Gangsters: Organized Crime* (1998). The goal is
to run your gang from the city itself: move crews, issue orders while time passes,
and open the Organizer whenever you need it.

This is a **work in progress**, not a finished RTS conversion. Financial and court
reports still close weekly; crews, vehicles, deliveries and live orders carry on.

## Where the project stands

Work happens on the [`rts-development`](https://github.com/arnip4-hub/RTS-gangster-1-/tree/rts-development)
branch. The `main` branch keeps the earlier remake baseline.

- **City and controls:** watch the 3D city, click the minimap
  to jump across town, open the Organizer with `O` or **Book**, use **Move crew**
  in the People roster, and pan the
  city with `W/A/S/D` or the arrow keys during the working week. **City plan**
  now opens the same overhead map used in the Organizer, with drag and zoom
  controls; **Rooftop** and **Street** return to the 3D city at that location.
  New campaigns run through all 24 hours of Monday through Sunday, with city
  lighting and street activity changing at night. Most residents go home after
  dark; a small nightlife crowd heads for cafes, pool halls, hotels, clubs and
  gambling rooms, while officials and most police go home. Police no longer
  wander aimlessly: a small night-shift group waits at headquarters, and a
  witnessed, reported crime can call an available officer out by car. The
  officer returns home or to headquarters after the response. Mayors, police
  chiefs, judges, DAs and the FBI head use a lightweight service car for long
  evening commutes without adding a permanent fleet to the save. Weekly
  finances still settle, but the city stays open: people, cars and unfinished
  orders keep their positions and continue into the next week. The Organizer
  remains available on demand. Options now has a **Light graphics** switch:
  it lowers drawing resolution, disables real-time shadows and limits detailed
  street characters to eight. It applies immediately and does not change the
  number of people simulated. The separate Standard textures option reduces
  graphics memory use when the city next loads. Rival gangs now check for idle
  crews every 30 game minutes. A six-hour goal steers each free crew toward
  scouting, income or nearby expansion. Reported attacks or visible damage can
  prompt a temporary guard, patrol or a limited retaliation when the attacker
  and a rival site are known. Existing orders are left in progress. Scouting
  reveals sites before the live planner targets them; there is no new district
  ownership system.
- **Time and city life:** the RTS clock now
  takes 24 real minutes for a full day at normal speed.
  People, cars and delivery trucks keep roughly the same screen pace; the
  classic five-day mode keeps its original clock rate. The existing speed
  controls still let players accelerate the longer day. The city also has a
  haulage company, jazz club, movie theater, theater, ice house, bookmaker and
  larger illegal brewery. The existing brothel is now labelled **Brothel**.
  Haulage companies and ice houses hold stock and send goods by truck; jazz
  clubs buy liquor. Residents, officials and off-duty police take individual
  leisure trips, especially at weekends. A rotating police shift remains on
  call, while new routine FBI investigations pause over the weekend. Actual
  visitors affect weekly venue income. An official seen inside a gang-owned
  brothel or casino gives that gang a one-week discount on a lawyer-arranged
  bribe; the leverage is used up when the bribe is paid. On long trips, people
  on foot can now walk to a tram stop, ride a scheduled tram, and walk from the
  stop to their destination when that is faster than walking the whole way.
  This also works for a player crew member given a long **Move** order on foot.
- **Business and freight:** a slaughterhouse produces meat and the ice house
  produces ice on workdays. Service trucks carry these physical loads to owned
  butchers, restaurants and other eligible shops. Haulage companies and other
  depots include one service truck; you can buy up to four more for $3,000 each,
  with $150 weekly upkeep per extra truck. Choose **fast**, **cheap** or **quiet**
  dispatch at a freight business. Cheap waits for fuller loads; quiet schedules
  night trips in RTS games. A contraband truck can carry a legitimate load and
  manifest too, reducing but never eliminating the gang's exposure. Existing
  saves get the included truck and empty legal stock. Profitable businesses
  pay a conservative daily advance in RTS mode; the weekly ledger reconciles
  those advances, wages, upkeep and taxes.
- **Kidnapping and rescue:** crews can kidnap ordinary civilians, business
  owners and rival gang members. Each mayor, police chief, FBI chief, judge and
  district attorney has a named adult civilian relative in the city. Relatives
  appear in the Organizer, but the crew must locate them before acting. A
  business owner who refuses your extortion or a protection collection also
  gains a named adult relative. That relative appears under **Refusing owners’
  families**. Holding them at an office lets you try **Pressure owner**: the
  owner may start or resume protection payments, or refuse and alert police.
  This is one attempt per captive and adds investigative risk. A
  successful crew escorts its captive to an owned office; only then does the
  captive appear under **Prisoners**. There you can demand a ransom, press an
  official through a held relative, or release the captive. Demands may be
  refused and draw attention; pressure can fail and the leverage expires.
  Captives can escape, especially from an unguarded office. Reported crimes,
  missing people and ransom demands advance investigations. Police dispatch a
  car after tracing the office; a rival whose member is held must discover the
  address separately before trying a rescue. A player can also raid a known
  rival safe house to recover a captured gang member. Losing the office frees
  its captives.
- **People and investigations in the current development branch:** click a
  person in the live city to open a camera window, then use **Person profile**
  to see their age, spouse, children and household size. Spouses without a
  named city character and children are background household records. A
  profile can add someone to a persistent **Watch list** or **Hit list**; open
  **Lists** in the city toolbar to revisit or remove names. The hit list can
  open a **Kill** order card for a name; the player must still confirm the
  order. Lists do not reveal hidden rival locations. A
  planned **Kill** or live street **Kill** order can target any available
  person in RTS mode, including civilians and officials; held captives can be
  **Executed** from the Prisoners panel. Unwitnessed kidnappings lead to a
  missing-person report after a delay. Police must trace the safe house before
  dispatching an officer, and a visit there can supply evidence for a live
  arrest review. The family of the FBI chief draws extra Bureau attention.
- **Daily paper:** in RTS mode a new edition appears at 6 a.m. each day in the
  Organizer. It carries the previous day's reported crimes, deaths, business
  moves, politics, charity appeals and period stories. Events after printing
  wait for the next morning, including Sunday news across the weekly accounts.
  The classic calendar retains its weekly newspaper.
- **Still to build:** simpler group selection and move orders, better live reports,
  broader AI goals, day/night tactics and more live responses to events, and a deeper
  redesign of weekly orders and accounting so the game can become a full RTS.
  Automatic week rollover does not remove all weekly rules yet. Freight trucks
  are owned by businesses, not assigned to individual drivers; rival gangs do
  not yet intercept cargo, and there is no manual route editor.

The [RTS time audit](docs/RTS_TIME_AUDIT.md) records which systems use game
minutes, daily boundaries and the weekly settlement.

New games currently start at the planning desk. Press **Hit the Streets!** to enter
the live city. The original GOG installation is separate from this remake fork.

## Download a test build

The previous [Windows prerelease](https://github.com/arnip4-hub/RTS-gangster-1-/releases/tag/rts-beta-20261115.2)
contains the installer `RTS-gangster-beta-Setup.exe` and a portable build
`RTS-gangster-beta-Portable.exe`. The latest source changes are on
`rts-development`; a new Windows build will follow. Existing saves
keep their original five-day clock; start a new campaign to try the continuous
calendar. The classic mode keeps its original pacing.

To run the newest source code locally, use the `rts-development` branch and the
commands below. Browser saves stay in that browser; the desktop app saves to disk.
The desktop save folder keeps its existing `Original Gangster` path so earlier
test saves remain accessible after the application is renamed.

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
