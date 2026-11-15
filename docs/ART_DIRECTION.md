# Illustrated city direction

The remake's detailed city relies on photographed facade and road textures,
3D characters and vehicles, and repeatable building geometry. The result is
legible but does not have the compact, hand-drawn feeling of the 1998 game.
The original game's images are not part of this project.

## First playable comparison

**Game Options → City artwork → Illustrated 1930s (preview)** keeps the
remake's own canvas-painted facades, storefronts, pavement, roof and road.
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
