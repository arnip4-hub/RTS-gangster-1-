# Illustrated city direction

The remake's detailed city relies on photographed facade and road textures,
3D characters and vehicles, and repeatable building geometry. The result is
legible but does not have the compact, hand-drawn feeling of the 1998 game.
The original game's images are not part of this project.

## Illustrated 3D wardrobe

Choose **Game Options → City artwork → Illustrated 3D**, then save and reopen
the city. The painted building materials now accompany animated 3D people in
normal play, with the same walking, combat and held equipment as the detailed
character layer.

| Appearance component | Delivered choices |
| --- | ---: |
| Civilian clothing combinations | 50: 25 male and 25 female |
| Occupational uniforms | 8 |
| Body builds | 8: thin, average, stocky and heavy on both bodies |
| Heights | 3 |
| Skin shades | 10 |
| Face presets | 32 |
| Hair variants | 18 |
| Headwear variants | 18 |
| Civilian garment palettes | Up to 6 per outfit |

These are assembled outfits: painted base bodies, separate coat/trouser
colours, fabric patterns, fitted headwear and collars, and skinned skirt or
coat extensions. Heavy builds change the torso and belly geometry, widen the
shoulders, and preserve normal head and shoe proportions. The variation is
more than a colour change. Uniforms follow actual roles; a visit to a venue
does not change a citizen into one of its workers.

![Male clothing combinations](images/wardrobe-men.png)

![Female clothing combinations](images/wardrobe-women.png)

![Body builds with clothing and other identity traits held fixed](images/body-builds.png)

![Ten shades applied consistently to face and hands](images/skin-tones.png)

![Eight occupational uniforms](images/uniforms.png)

![Illustrated 3D wardrobe in the real city renderer](images/wardrobe-city.png)

Identity comes from the saved person ID and portrait index. Clothing, build,
skin and face use separate deterministic choices, so old saves acquire stable
looks without a new save format. Composed portraits use the corresponding
skin shade, hair and clothing palette. Commissioned crew portraits retain
their existing skin family. Female officers use a female body with their
uniform.

The five 1024-pixel painted base maps are shared. The city retains its limit
of 32 detailed visible characters (fewer with Light graphics); distant people
keep their identity's body scale, coat and skin in instanced simpler figures.
A bounded geometry cache shares body/face variants and retains only referenced
rigs plus spare geometry. This is not a benchmark of 6,000 simultaneously
animated detailed bodies. Automated population checks cover all 50 civilian
outfits and all builds and tones across 6,000 generated identities.

The new coat and skirt extensions have simple folds and the fur collars are
still coarse at close zoom. They need a further art pass for tailored hems,
lapels and fine fabric detail. The system supplies the full configured
set now; it remains beta artwork.

Rebuild the base maps with `npm run art:character`. Capture all presets with
`node scripts/capture-wardrobe-review.mjs /tmp/wardrobe.png --page=all`.
Other pages are `men`, `women`, `bodies`, `skins` and `uniforms`; `--phase=.75`
samples another walking pose. `wardrobe-review.html` uses the same character
layer as normal gameplay. The actual city capture is
`node scripts/capture-visual-review.mjs /tmp/wardrobe-city.png 0.25 --wardrobe`.

Uncovered street bodies retain the victim's wardrobe and build in the final
3D fall pose. An arriving officer replaces the body with the existing white
sheet; the coroner's collection removes it. There is no switch to an unrelated
old street sprite after the fall cue expires. Use `--corpse=body` or
`--corpse=sheet` with the city capture command to review those stages.

## First playable comparison

**Game Options → City artwork → Illustrated 1930s (preview)** uses newly
painted red, brown and buff brick facades, limestone and stucco facades, a
storefront, pavement and road.
Other building materials and roofs still use the remake's procedural art.
It requests eight-direction car art, 32 four-direction people silhouettes,
48 painted portraits, and a layered portrait drawing for everyday citizens
and rank-and-file police/FBI. The drawing has 1,536 deterministic identity
seeds, with face shape, skin, hair, hat, clothing, glasses and details; these
are composed variants, **not** 1,536 hand-painted files. The person's saved
ID fixes the same look on reload, including old saves. Skin palette and gender
are shared with the street-sprite selector. Senior officers and crews retain
the painted portraits; their street skin palette follows that painting.

The new street rows include formal evening wear, fur coats, shop staff, work
clothes, the mayor, a judge, a journalist, Black officers, federal investigators,
and more varied everyday pedestrians. A nightclub worker costume is drawn but reserved until
there is an actual worker occupation and schedule in the simulation; regular
venue customers are not silently treated as workers. Special character
actions still use the existing animated 3D figures. The city style applies
when the city next opens. This is a visual preview.

The original illustration sheets are in `art-source/illustrated`; run
`npm run art:people` to rebuild the portrait tiles and street atlas. The
32-row atlas is 512 × 4096 pixels, at the common 4096-pixel texture limit.
These are original assets for this remake, with no graphics from the 1998 game.

Examples: [gang portraits](../art-source/illustrated/portraits-04.png) ·
[police and federal portraits](../art-source/illustrated/portraits-02.png) ·
[street silhouettes](../art-source/illustrated/people-03.png).

![First illustrated street preview](images/illustrated-street-preview.png)

## Street-corner review

The second pass tests the illustrated setting in the actual city renderer,
with a commercial corner, a period car and walking citizens, police and FBI.
It uses one fixed city seed and camera position so later art revisions can be
compared at the same scale. The three brick palettes now use painted sheets,
and pale roof props have a warmer finish.
The street and pavement use a shared palette. No images from the 1998 game are
included.

![Illustrated street-corner review](images/illustrated-corner-review.png)

![Four renderer frames showing the street figures walking](images/illustrated-corner-motion.gif)

The animation combines four frames from the same running renderer at different
game minutes. The coupe is parked; pedestrians move across the pavement.

The source sheets live in `art-source/illustrated/corner`; run
`npm run art:corner` to rebuild the smaller game textures. For a fresh renderer
capture, run `node scripts/capture-visual-review.mjs docs/images/illustrated-corner-review.png`.
`visual-review.html` is a development preview, outside the normal game menu.
The illustrated material selection itself runs in the game whenever that
artwork option is chosen.

## Painted art on a moving 3D character

The next proof uses the existing fedora man's actual skinned 3D mesh and walk
clip, with a newly painted brown suit and felt hat albedo. The buildings remain
3D, with the illustrated material set above. The surrounding pedestrians and
car in this comparison are still sprites; the brown-suited man immediately
outside the pool hall is the 3D prototype.

![Painted 3D man outside the pool hall](images/illustrated-3d-person-review.png)

![Close inspection of the rigged character and painted suit](images/illustrated-3d-person-close.png)

This verifies that painted art can wrap around the existing body and move with
its skeleton. It does not convert every illustrated costume into a new body:
fur coats, long dresses and different hats need matching geometry and weights.
The source atlas has many small UV islands, so each new costume also needs a
close inspection for seams and misplaced details.

Run `npm run art:character` to rebuild the 1024-pixel character map. Capture
the proof with `node scripts/capture-visual-review.mjs /tmp/painted-3d.png 0.25 --hybrid`;
add `--close` for inspection, or `--texture=source` for the original albedo.
This person is currently a development preview. The normal artwork option
still uses the delivered street sprites.

For wider 3D adoption, reuse a small set of animated bodies with different
clothes, hats, faces and skin palettes. Preserve the existing visible-rig limit
and simpler distant figures, then measure busy streets before raising it.

## What the prototype reveals

The illustrated textures make the street less photographic. The repeated
building masses, simple window rhythm, small character silhouettes and strong
territory outlines still dominate the image. A convincing 1930s style needs
new art and composition, not only a colour filter.

## Next art passes

1. **Buildings:** draw a small set of distinctive period roofs, storefronts,
   corner buildings and industrial buildings with varied silhouettes. First
   test one residential block and one commercial block at street and rooftop
   zoom. Keep walls and roofs readable at the camera's actual pixel scale.
2. **People:** three common street silhouettes now have four drawn gait frames
   in each of four directions: the brown-coat man, green-coat woman and patrol
   officer. Other figures still have a slight walking bob, and complex actions
   fall back to the working 3D animation. Extend gait coverage to the other
   common costumes, then draw role-specific actions. The layered portraits
   also need a visual quality pass at large UI sizes.
3. **Street:** redraw the road, pavement, tram and street furniture as a
   coherent palette, with clear separation between walkable space and buildings.
4. **Lighting and overlays:** tune day and night colours around that art; soften
   selection and territory outlines so they do not overwhelm the city.

Keep the first two passes behind the artwork setting until a side-by-side
playtest at both zoom levels shows that people, targets and routes remain easy
to read. New artwork must be created for this remake or separately licensed.
