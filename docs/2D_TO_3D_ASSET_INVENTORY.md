# RTS Gangster — úttekt á 2D-vinnu og yfirfærslu í 3D

**Staða:** 23. nóvember 2026, grunnur `rts-development` eftir sameiningu beta `0.3.0-beta.11`.  
**Tilgangur:** Skjalfesta alla mikilvæga áður unnna teiknivinnu áður en borgarheimurinn verður alfarið teiknaður með 3D-líkönum. **Engum 2D-eignum eða kóða er eytt með þessari samantekt.**

## Aðalniðurstaða

2D er ekki ein tæknileið. Verkefnið inniheldur (1) hefðbundnar teiknaðar götupersónur, (2) bílasprítur, (3) tilraun með marglaga HD-persónu, (4) andlitsmyndir í viðmóti og (5) handmálaðar 2D-áferðir *á raunverulegum 3D-líkönum*. Aðeins fyrstu þrír flokkarnir eru beinlínis frambjóðendur til að leggja af sem **teikniaðferð í leikheiminum**. Viðmótsmyndir og áferðir eru áfram eðlilegur hluti 3D-leiks.

### Sannreynd skráarsöfn og stærðir

| Safn | Umfang | Hlutverk |
| --- | ---: | --- |
| `art-source/illustrated/` | 64 frumskrár, um 31,4 MiB | 15 PNG, 16 WebP og 33 SVG; varðveita frumteikningar |
| `art-source/illustrated/layered-pilot/` | 32 SVG, **innifalin í 64 hér að ofan** | 8 lög × 4 sjónarhorn |
| `public/art/city/illustrated-*` | 23 afhentar skrár, um 9,3 MiB | Sprítusöfn, lýsigögn, málaðar bygginga-, bíla- og persónuáferðir |
| `public/art/portraits/illustrated/` | 48 PNG, um 7,3 MiB | Sérteiknaðar Illustrated-andlitsmyndir |
| `public/art/city/sculpt/` | 27 GLB og 8 JSON, um 164,4 MiB | Núverandi 3D-líkön og hreyfigögn |
| `docs/images/` | 14 sýnidæmaskrár, um 12,1 MiB | Myndleg úttekt á búningum, bílum, líkamsgerðum og borg |

Stærðir eru geymslustærðir í Git-tré, ekki GPU-minni. Innfelld undirmappa `layered-pilot` er ekki talin tvisvar.

## 1. Teiknaðir bílar — varðveita sem heimildasafn

**Núverandi 2D-safn:** `public/art/city/illustrated-vehicle-atlas.png` og `illustrated-vehicle-atlas.json`. Skráin skilgreinir **6 gerðir × 8 sjónarhorn = 48 ramma**:

- `coupe` — fólksbíll
- `truck` — vörubíll
- `speedster` — sportbíll
- `police` — lögreglubíll
- `fbi` — alríkislögreglubíll
- `delivery` — dreifingarbíll

Sjónarhorn: N, NA, A, SA, S, SV, V og NV. Teiknarinn er `src/render/vehicleSpriteLayer.ts`. Annað, eldra prufusafn, `vehicle-fleet-eight-atlas.png/.json`, skráir aðeins þrjár grunntegundir; ekki eyða því án staðfestingar á notkun.

**Þegar til í 3D:** `public/art/city/sculpt/coupe.glb`, `truck.glb`, `speedster.glb`; sameiginlegar málaðar UV-áferðir eru `illustrated-coupe-albedo.jpg`, `illustrated-truck-albedo.jpg` og `illustrated-speedster-albedo.jpg`. Þær eru búnar til úr `art-source/illustrated/vehicles/{coupe,truck,speedster}-painted.webp` með `scripts/build-painted-vehicles.mjs`.

`src/render/vehicleLivery.ts` skilgreinir **12 liti** fyrir almenna bíla og sérliti fyrir lögreglu, FBI og líkbíla. `vehiclePaint.ts` aðgreinir málmaða yfirbyggingu frá dekkjum, gleri og krómhlutum. Þetta er **3D-virkni sem á að varðveita**, ekki 2D-sprítukerfi.

**Yfirfærsla:** Halda öllum máluðum áferðum og litasamsetningum; nota 2D-safnið sem viðmið um útlit, sjónarhorn og afbrigði. Ef fleiri bílaafbrigði vantar 3D-form, búa til ný GLB-módel eða leyfileg afbrigði af núverandi þremur, ekki teikna nýjar augljósar sprítur. Ekki gera ráð fyrir því að 6 teiknaðar gerðir merki 6 sérsmíðuð 3D-módel.

## 2. Götupersónur — 32 teiknaðar grunnraðir

**Frumteikningar:** `art-source/illustrated/people-01.png` til `people-08.png` (8 blöð). `scripts/build-illustrated-people.mjs` býr til `public/art/city/illustrated-people-atlas.png`. Atlasið hefur **32 raðir × 4 áttir**. `src/render/illustratedPeople.ts` stjórnar birtingu.

**Hreyfingar:** Þrjú teiknuð frumblöð, `walk-man-01.png`, `walk-woman-01.png` og `walk-police-01.png`. Þessar þrjár persónugerðir hafa sjálfstætt teiknaða gönguramma. Fyrir aðrar raðir býr byggiforritið til einfaldar hreyfingar með vörpun/aflögun (ekki handteiknaðar fjórar hreyfingar á hvert útlit). Afleiddar skrár: `illustrated-people-walk-1.png` til `-3.png`.

**Önnur 2D-verk:** `art-source/illustrated/action-effects.svg` og `public/art/city/illustrated-action-effects.png`. Þetta eru tákn/áhrif, ekki full 3D-hreyfimódel.

**Yfirfærsla:** Nota frumteikningar sem tímabils- og fatnaðarheimildir. Halda gömlu renderer og myndum þar til allar lykilhreyfingar, vopn, lögregluhlutverk og fjarlægðarútgáfur eru þaktar í 3D og prófaðar.

## 3. Marglaga 2D HD-persóna — takmarkaður tilraunagrunnur

`art-source/illustrated/layered-pilot/` hefur **8 lög**: `backHair`, `bodyLower`, `clothesLower`, `bodyUpper`, `clothesUpper`, `face`, `frontHair` og `headwear`.

Fyrir hvert lag eru `front.svg`, `back.svg`, `left.svg` og `right.svg`: **32 breytanleg SVG frumskjöl** fyrir eina karlpersónu í jakkafötum og fedora-hatti. `scripts/build-layered-pilot.mjs` býr til hreyfispjöld og manifest *við byggingu*, í `public/art/city/layered-pilot/`. Þau þurfa því ekki að vera geymd sem sjálfstæðar frumskrár í Git.

`src/render/layeredPilotPeople.ts` og `illustratedCharacterRenderer.ts` virkja tilraunina aðeins fyrir valinn karlkyns boss/lieutenant/hood þegar sérstakur flaggi er á. **Þetta er ekki fullbúið 2D-fatakerfi fyrir 50 búninga**. `src/render/illustratedCharacterSpec.ts` lýsir almennu lagakerfi sem var hugsað fyrir framtíðina; ekki rugla því saman við tilbúnar myndir.

**Yfirfærsla:** Frysta þennan 2D-renderer sem sögulega frumgerð; nota SVG-hlutana sem teikni- og hlutfallaviðmið fyrir 3D-fatnað. Ekki eyða frum-SVG-skránum.

## 4. Fatnaður og auðkenni — kjarninn sem flyst beint í 3D

`src/render/characterWardrobe.ts` er sameiginleg **gagnaskrá og valkerfi**, ekki sprítusafn:

| Þáttur | Skilgreint |
| --- | ---: |
| Borgaralegir búningar | **50**, 25 karl- og 25 kvenbúningar |
| Einkennis-/starfsbúningar | **8** |
| Líkamsgerðir | **8**, grannur / meðal / þéttur / þungur fyrir hvort kyn |
| Hæðir | **3** |
| Húðlitir | **10** |
| Andlitsgerðir | **32** |
| Hárgerðir | **18** |
| Höfuðföt | **18** |
| Litasamsetningar | Allt að **6** fyrir borgaralega búninga |

Búningarnir ná meðal annars til tweed- og röndóttra jakkafata, vesta, vinnufatnaðar, ullarfrakka, loðkraga, kjóla, samkvæmiskjóla, kvenjakka og regnfrakka. Starfsbúningar ná til lögreglu, lögreglustjóra, FBI, slökkviliðs, dómara og klerka.

**Staða í 3D:** `characterMorphology.ts` breytir líkamsstærðum, `characterWardrobeGarments.ts` smíðar hluta fatanna úr rúmfræði, `characterBindSpace.ts` bindur þau við GLB-beinagrind og `characterEquipment.ts` samhæfir búnað/hatta. Þetta er til staðar og var virkjað í beta.11, en **50 skilgreiningar eru ekki 50 aðskildar GLB-flíkur**. Aðgreina þarf nú þegar skinnbundnar flíkur, málaða grunnhluta og form sem enn vantar skýrari 3D-svip.

Útlit er stöðugt valið út frá auðkenni persónu og þarf ekki nýja vistunarskrá. **Varðveita þetta gagnalíkan**, jafnvel þótt allir 2D-rendererar verði síðar lagðir af.

## 5. Andlitsmyndir og UI — halda áfram sem 2D

`art-source/illustrated/portraits-01.png` til `portraits-04.png` innihalda **48 upprunalegar myndir**, klipptar út með `scripts/build-illustrated-people.mjs` og vistaðar í `public/art/portraits/illustrated/`. Að auki eru önnur andlitsmyndasöfn undir `public/art/portraits/`; samtals eru þar **325 PNG-skrár**, þar af fyrrnefndar 48.

`src/ui/Portrait.tsx` notar bæði málverkasöfnin og samsetta SVG-andlitsmynd. Í `illustrated3d` getur sú samsetning sótt húðlit, hár og fatnað frá `resolveCharacterWardrobe`. Þessi 2D-verk eru **viðmótsgrafík sem nýtist áfram í fullum 3D-borgarheimi**; ekki reyna að breyta öllu UI í 3D.

Tákn, kort, blaðsíður, skjöl, myndir og myndræn áhrif geta áfram verið 2D.

## 6. Málning á 3D-líkönum — hluti af framtíðinni

Núverandi `illustrated3d` notar alvöru 3D-rúmfræði en málaðar 2D-áferðir. Þetta á við um **fimm grunnpersónuáferðir**, **þrjár bílaáferðir**, og meðal annars múrsteina, stein, stucco, götur og gangstéttir. Byggingarefni og litir eru í `src/render/textures.ts` og persónu-/bílalíkön í `sculptReviewLayer.ts`.

Núverandi `public/art/city/sculpt/` hefur **27 GLB-skrár**, sundurliðað í:
- **11 persónulíkön**: fedora, woman, worker, police, policeChief, fbi, fbiChief, firefighter, judge, judgeWoman, photographer.
- **3 bílamódel**: coupe, truck og speedster.
- **1 sporvagn**.
- **7 vopna- og búnaðargripi**.
- **3 tré** og **2 hrúgur af rústum**.

Engin `.blend`, `.fbx`, `.gltf` eða önnur venjuleg breytanleg 3D-frumskrá fannst í Git-trénu; það segir **ekki** hvort upprunaskrár séu til annars staðar. Skrá þarf uppruna og vinnuskrár GLB áður en flóknar breytingar eru gerðar.

## 7. Hvað er í notkun núna?

| City artwork | Persónur | Bílar | Áferðir |
| --- | --- | --- | --- |
| **Detailed** | 3D nálægt myndavél, einfaldari fjær | 3D | Hefðbundnari |
| **Illustrated 1930s (preview)** | 2D-atlas, með takmarkaðri HD-tilraun | 2D-atlas | Málaður borgarheimur |
| **Illustrated 3D (experimental)** | Hreyfð GLB-líkön, procedúral fatnaður og einfaldari 3D í fjarlægð | 3D-líkön | Málaðar UV-áferðir |

Í `scene.ts` er `IllustratedPeople` stofnað fyrir `illustrated`, en `illustrated3d` sækir 3D-persónuútlit úr fatnaðarskránni. `VehicleSpriteLayer` er valinn sjálfgefið fyrir `illustrated` en ekki `illustrated3d` (þróunarfánar geta breytt þessu). Því **er raunveruleg 3D-borg þegar til**. Flutningur „úr 2D“ snýst fyrst og fremst um að klára 3D-þekju og síðar fasa út fyrri valkostinn.

**Viðvörun um eldri skjöl:** `docs/ART_DIRECTION.md` og `docs/design/illustrated-1930s-character-system.md` tala enn um að `illustrated3d` sé óvirkt. Það var rétt í eldri útgáfum en er orðið úrelt eftir beta.11. Þessi úttekt lýsir nýrri stöðu.

## 8. Ráðlögð flutningsröð (án gagnataps)

1. **Varðveita og merkja:** Frysta 2D-frumskrár, atlas, manifest, byggiskriftur og skjáskot. Halda þeim útgáfustýrðum og varðveita afturkræfa Git-sögu. Ekki hreinsa til bara vegna þess að sprítur eru ekki lengur sjálfgefnar.
2. **Útlitslisti yfir í 3D:** Fara yfir alla 50 búninga og 8 einkennisbúninga í 3D-galleríi; skrá hvaða fat er rétt mótað, hvaða form er aðeins málað og hvar vantar verulegan þrívíddarhluta. Endurnýta áferðir og litasamsetningar.
3. **Bílasafn yfir í 3D:** Yfirfara sex teiknuðu bílaflokkana gegn þremur GLB-grunnum; bæta við nýjum 3D-líkönum aðeins þegar lögun og gerð eru raunverulega ólík. Halda 12 lita livery-kerfinu.
4. **Hreyfingar og LOD:** Prófa gang, hlaup, akstur, vopn, handtökur, slagsmál, lík og skuggamyndir með fjölda persóna í borginni. Halda einfaldari 3D-persónum í fjarlægð; 6.000 íbúar í hermun merkja ekki 6.000 samtímis GLB-persónur.
5. **Viðmót óbreytt:** Halda andlitsmyndum, táknum, kortum og öðrum 2D-hlutum viðmótsins. Mæla afköst og tryggja að auðkenni fólks sé stöðugt.
6. **Aðeins síðan hreinsa:** Þegar 3D-þekja, sýnileg gæði og prófanir eru samþykktar, taka 2D-borgar-renderera út úr venjulegu keyrsluleiðinni í **aðskildri breytingu**. Varðveita frumteikningar og eldri beta-útgáfur. Ekki eyða vistunum, 3D-áferðum eða lögfræðilegu/RTS-hermunargögnunum.

## Sýnimyndir sem þegar liggja fyrir

- [Teiknaða 48-ramma bílasafnið](../public/art/city/illustrated-vehicle-atlas.png)
- [Málaðir 3D-bílar í 12 litum](images/illustrated-vehicle-fleet.png)
- [3D coupe og litasamsetningar](images/illustrated-coupe-paints.png)
- [Búningar karla](images/wardrobe-men.png)
- [Búningar kvenna](images/wardrobe-women.png)
- [Líkamsgerðir](images/body-builds.png)
- [Einkennisbúningar](images/uniforms.png)
- [3D-fatnaður í borginni](images/wardrobe-city.png)
- [Gamla 2D-götumyndin](images/illustrated-street-preview.png)
- [HD-marglaga persóna](images/illustrated-layered-pilot-preview.svg)

## Tæknileg uppflettiskrá

- Sprítur fyrir fólk: `src/render/illustratedPeople.ts`, `scripts/build-illustrated-people.mjs`.
- Sprítur fyrir bíla: `src/render/vehicleSpriteLayer.ts`, `public/art/city/illustrated-vehicle-atlas.json`.
- Marglaga 2D: `src/render/layeredPilotPeople.ts`, `src/render/illustratedCharacterSpec.ts`, `scripts/build-layered-pilot.mjs`.
- 3D-fatnaður: `src/render/characterWardrobe.ts`, `characterWardrobeGarments.ts`, `characterBindSpace.ts`, `characterMorphology.ts`.
- 3D-bílar: `src/render/sculptVehicles.ts`, `src/render/vehiclePaint.ts`, `src/render/vehicleLivery.ts`.
- 3D-módel í borg: `src/render/sculptReviewLayer.ts` og `src/render/scene.ts`.
- Andlitsmyndir: `src/ui/Portrait.tsx`.
- Myndprófanir: `scripts/capture-vehicle-review.mjs`, `capture-wardrobe-review.mjs`, `capture-visual-review.mjs`.

**Ákvörðun til að taka síðar:** Hvort `Illustrated 1930s (preview)` verði fyrst falið í Options eða haldið áfram sem valfrjáls „retro“ hamur. Sú ákvörðun þarf ekki að eyða einum einasta listmun.
