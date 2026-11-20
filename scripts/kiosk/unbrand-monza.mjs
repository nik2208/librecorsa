// Takes other companies' marks off Monza's scan (public/tracks/monza/monza.glb) and puts the event's own, Applikat, in
// their place: the same artwork the kiosk's car wears (public/cars/f12026/liveries/applikat/decals.png), so circuit and
// car match.
//
//   git checkout -- public/tracks/monza/monza.glb   # the scan as it came, if an older run of this script changed it
//   node scripts/kiosk/unbrand-monza.mjs [path/to/monza.glb]
//
// Only the pictures change: each edited texture's WebP is re-encoded and written over its own bytes in the GLB's
// binary chunk, and every other byte range (geometry, the meshopt streams, the untouched pictures) keeps its bytes; a
// picture that no longer fits its old room pushes what follows by a multiple of 16 bytes, offsets updated. So the
// colliders, the drawn ground of the Monza fix and every check built on them see the same scan. The GLB is marked
// (asset.extras.unbrandedBy): a second run leaves it alone, a run over an older version's output stops.
//
// What changes, by material (every picture was looked at; national flags, numbers, arrows, PIT LANE and the plain
// buildings stay). The marks are described, not named, so this file carries no brand either:
//   adv_add.003      two banners of the simulator's maker           -> Applikat banners, one light, one dark
//   flag8.005        a clothing maker's vertical banner              -> "applikat.it" banner
//   flag7.005        the simulator's vertical banner                 -> "APPLIKAT" banner
//   flag2.005        the simulator's flag                            -> dark Applikat flag
//   flag3.005        the clothing maker's flag                       -> light Applikat flag
//   misc1.005        the circuit's name banner with its emblems      -> Applikat banner
//                    a tyre shop's sign over a hut                   -> small Applikat sign
//                    a relief organisation's emblem (twice) over a building's doors -> plain band
//                    the circuit's round badge                       -> the Applikat sticker
//                    a biscuit maker's red sign                      -> red "applikat.it" sign
//                    a gate maker's name on a gate box               -> plain box (a logo would not belong there)
//   gstand.005 /     the motoring club's panel and the circuit's     -> Applikat panels
//   gstand-alpha.005 badge on the grandstands
//   apsh-shader2.005 a fuel company's mascot and name painted on a run-off strip -> Applikat paint (the faded mark
//                    above it -> plain grey)
//   serraglio.003    an old painted advert on a wall                 -> "APPLIKAT applikat.it" in the same faded paint
//                    a graffito naming a team and a driver           -> plain wall
// The scan's two wrapper nodes named after the site it was uploaded to are renamed (nothing loads by them); the CC BY
// credit (asset.extras and track_data.json) names its author and that site, and stays as it is. The EU flag stays with
// the national ones.
// Vertical lettering reads the way the original did (bottom to top on the banners, top to bottom on the painted strip
// and the red sign).
import { art, CARBON, clone, CREAM, editGlb, fill, item, markOf, PAINT, RIBBON, SPACE, STICKER } from './glb-art.mjs';

const FILE = process.argv[2] ?? 'public/tracks/monza/monza.glb';
const MARK = 'scripts/kiosk/unbrand-monza.mjs v3';

const panels = [
  // The motoring club's panel and the circuit's badge: white again, then the sticker and the site (the grey metal
  // strips between them stay)
  fill(223, 512, 164, 76, [226, 515]),
  fill(437, 512, 75, 124, [444, 515]),
  art(223, 512, 164, 76, { pad: 5, gap: 6, items: [STICKER(60), item('site', 17, 'dark')] }),
  art(437, 512, 75, 124, { pad: 4, items: [STICKER(64)] }),
];

const EDITS = {
  'adv_add.003': [
    art(0, 0, 512, 64, { bg: CREAM, pad: 7, gap: 14, items: [STICKER(50), item('site', 36, 'dark')] }),
    art(0, 64, 512, 64, { bg: CARBON, pad: 7, gap: 14, items: [STICKER(50), item('site', 36)] }),
  ],
  'flag8.005': [art(0, 0, 128, 512, { bg: CARBON, pad: 10, gap: 18, dir: 'column', items: [item('site', 64, 'light', 270), STICKER(104)] })],
  'flag7.005': [art(0, 0, 128, 512, { bg: CARBON, pad: 10, gap: 18, dir: 'column', items: [item('name', 64, 'light', 270), STICKER(104)] })],
  'flag2.005': [art(0, 0, 256, 256, { bg: CARBON, pad: 16, gap: 10, dir: 'column', items: [STICKER(150), item('site', 34)] })],
  'flag3.005': [art(0, 0, 256, 256, { bg: CREAM, pad: 16, gap: 10, dir: 'column', items: [STICKER(150), item('site', 34, 'dark')] })],
  'misc1.005': [
    // The circuit's name banner with its emblems
    art(0, 408, 706, 47, {
      bg: CREAM,
      pad: 3,
      gap: 8,
      items: [STICKER(41), item('site', 28, 'dark'), SPACE(60), STICKER(41), item('site', 28, 'dark')],
    }),
    // The tyre shop's sign over the hut, both its lines
    art(542, 582, 121, 25, { bg: CARBON, pad: 2, gap: 4, items: [STICKER(20), item('site', 15)] }),
    // A relief organisation's emblem, twice, on the band over a building's doors: the plain band beside each
    clone(88, 514, 16, 19, 106, 514),
    clone(290, 514, 19, 19, 266, 514),
    // The gate box's maker: the box's own front just under it
    clone(214, 950, 46, 18, 214, 967),
    // The circuit's round badge, and the red sign beside it
    art(673, 896, 141, 128, { bg: CREAM, pad: 6, items: [STICKER(116)] }),
    art(813, 896, 26, 100, { bg: RIBBON, pad: 3, dir: 'column', items: [item('site', 18, 'light', 90)] }),
  ],
  'gstand.005': panels,
  'gstand-alpha.005': panels,
  'apsh-shader2.005': [
    fill(205, 0, 51, 512, { rgb: [158, 166, 173] }),
    // Where the fuel company's paint was: Applikat's, the sticker upright and the site reading down the strip
    art(205, 256, 51, 256, { bg: RIBBON, pad: 4, gap: 8, dir: 'column', items: [STICKER(43), item('site', 34, 'light', 90)] }),
  ],
  'serraglio.003': [
    // The painted advert: the wall just above it, then Applikat in the same faded paint
    clone(0, 343, 502, 36, 0, 306),
    art(0, 343, 502, 36, { pad: 4, align: 'start', inset: 16, items: [item('letters', 22, PAINT), SPACE(26), item('site', 22, PAINT)] }),
    // The graffito: the clean wall to its left, in two full-height pieces (no edge across the wall, no paint cut off;
    // the second starts right of a crack, so the crack shows only once more)
    clone(512, 934, 165, 90, 344, 934),
    clone(677, 934, 127, 90, 382, 934),
  ],
};

const done = markOf(FILE);
if (done === MARK) {
  console.log(`${FILE}: already done (${done})`);
  process.exit(0);
}
if (done) {
  console.error(`${FILE} was changed by ${done}: start again from the scan as it came (git checkout -- ${FILE})`);
  process.exit(1);
}
// CC BY 4.0 asks for changes to be marked: the mark says what changed, the credit stays as it was
await editGlb(FILE, EDITS, {
  mark: MARK,
  renames: { Sketchfab_model: 'Scan_model', Sketchfab_Scene: 'Scan_Scene' },
  extras: { changes: 'other companies\u2019 marks replaced by the event\u2019s own (Applikat) on some textures' },
});
