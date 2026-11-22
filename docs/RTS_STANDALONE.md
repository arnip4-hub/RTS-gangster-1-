# RTS Gangster 1: branch and runtime boundaries

## Branches and retirement of the old baseline

The RTS game is self-contained on `rts-development`: it includes its own package,
Electron entry point, assets, tests and build scripts. Building RTS does **not**
check out or import files from the `main` branch. The existing `main` branch
is an earlier remake baseline, not a runtime dependency.

Before retiring `main`, set the repository's GitHub default branch to the
validated RTS branch, review GitHub Pages/Actions release settings, and preserve
the earlier commit history if a future reference is desired. Do not rewrite
`main` or delete it merely to remove the original application's name.
Keep upstream attribution and MIT license notices, even after retirement.

The `graphics/illustrated-vehicles` branch is active, ahead of RTS development,
and must **not** be merged, deleted or reset by this maintenance change.
The dormant `illustrated3d` prototype is retained deliberately.

## RTS and legacy calendar policy

New RTS campaigns use seven full 24-hour days. Old classic-mode saves retain
the five eight-hour working days that their existing timestamps expect.
`src/sim/calendarModes.ts` defines both schedules, and `calendar.ts` exposes
the existing API so simulation, movement, reports and old saves keep working.

Do not remove classic clock constants, old-schedule tests, original-city
generation or original-named simulation modules based on their names.
They are code dependencies, not separate GitHub branches.

## Windows packaging

`.github/workflows/windows-package.yml` is the single Windows test-and-build
workflow. It runs selected regression suites and packages both Setup and
Portable. It can be run manually with an optional prerelease tag, and it
validates pull requests targeting `rts-development`.
A GitHub Pages workflow still targets `main`; revisit it when changing
the default branch.

## Refactor boundaries

`src/sim/orderTargets.ts` owns area-target expansion and route preparation.
`execution.ts` continues to re-export its former API for consumers.

`src/render/markerTextures.ts`, `roadGrit.ts`, and `streetSurface.ts`
own reusable canvas artwork and ground-height calculation previously housed
in `scene.ts`. Rendering styles and saved game structures remain unchanged.
