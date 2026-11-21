// Puts the event's own advertising, Applikat's, on RISE Motordrome (public/tracks/rwanda_official/rwanda_official.glb,
// the one model both layouts use), as unbrand-monza.mjs does on Monza: the same artwork the kiosk's car wears
// (public/cars/f12026/liveries/applikat/decals.png), so circuit and car match.
//
//   git checkout -- public/tracks/rwanda_official/rwanda_official.glb   # the model as it came, if an older run of this script changed it
//   node scripts/kiosk/brand-rise.mjs [path/to/rwanda_official.glb]     # from the repository's root
//
// What changes: one picture, by material.
//   Banner_Kigali    "KIGALI", yellow on green -> the Applikat banner: the cat sticker, "APPLIKAT" over its ribbon and
//                    "applikat.it" in the livery's cream on its carbon. The picture's two end caps (the three stripes
//                    at each end, columns 0-54 and 970-1023) stay as they were, so it still belongs with the other
//                    two banners and joins them the same way where the banners follow one another along a wall
// It stands wherever that banner did: every third stretch of the banners along the pit wall and the main straight's
// wall and of the hoardings round the outside of the corners (Prop_Banners), one bridge over the Grand Prix lap
// (Prop_Bridges), the backs of the open stands (Prop_Stands_Open) and, in the newer model, the hoardings of the
// circuit's Assetto Corsa release (Prop_Dressing_Hoardings_Kigali). Every face that shows (the bridge's banner is a
// box set into its beam: its front and its rear) has the picture the right way round and the right way up, worked out
// from each face's texture coordinates and then looked at, so the lettering is drawn plainly, left to right.
//
// Where the model shows a shifted picture, or only part of one, the lettering has to allow for it:
//   - the wall along the right of the main straight starts each of its banners 128 px before the picture's end (the
//     end caps sit a metre into each board there). The lettering ends before those last 128 px, as the original's one
//     word did, so on that wall it stays whole; on the other boards it stands a little left of centre for it;
//   - a few hoardings end part-way through a banner (a quarter, a half or three quarters of the picture). There the
//     lettering is cut, where the original's short word in the middle mostly was not.
//
// What stays: everything else. Banner_Rwanda and Banner_Bugesera (the venue keeps its character), Banner_LibreCorsa (the
// game author's own banner, in the newer model), the brake boards (Board_50 ...), the big screen, every other picture
// and all the geometry: colliders and every check built on them see the same model.
//
// The kiosk's game dresses these three banner materials itself while the staff has a logo on
// (src/lib/kiosk/event-scene-branding.ts) and shows the model's own pictures again once every logo is off: this banner
// is what RISE wears then, as the car wears Applikat's livery.
//
// Only the picture changes: its WebP is re-encoded and written over its own bytes in the GLB's binary chunk, and every
// other byte range (geometry, the meshopt streams, the other pictures) keeps its bytes; the new picture is larger than
// the plain one it replaces, so what follows moves by a multiple of 16 bytes, offsets updated (glb-art.mjs). The GLB is
// marked (asset.extras.brandedBy): a second run leaves it alone, a run over an older version's output stops.
//
// RISE Motordrome is Alp Yalay's, made for LibreCorsa, under CC BY-NC-SA 4.0 (public/tracks/rwanda_official/LICENSE.md):
// credit it, say what was changed, keep the same licence. The note in asset.extras says what changed and carries the
// credit and the licence, which stay the model's.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { art, CARBON, editGlb, fill, item, markOf, STICKER } from './glb-art.mjs';

const FILE = process.argv[2] ?? 'public/tracks/rwanda_official/rwanda_official.glb';
const MARK = 'scripts/kiosk/brand-rise.mjs v1';
const MARK_KEY = 'brandedBy';

// The models this was written for and looked at, by sha256: both carry the same three banner pictures
const KNOWN = {
  '066d375864e85f863ece717a51789c2a9a1ca276ceec13e2bcccbb18f4a3b3e7': 'the newer model (84 materials, with the Assetto Corsa release’s scenery)',
  '296e6e8ed423f5b1ef3b3a69fc400ee633cd3bbc4cdc3ddf1dd9679f1f88b217': 'the older model (58 materials)',
};

// The banners are 1024 x 128. The end caps are three 18 px stripes at each end (columns 0-54 and 970-1023); the field
// between them is columns 55-969, and the lettering sits in columns 78-877 of it (see above)
const FIELD = [55, 0, 915, 128];
const LETTERING = [78, 0, 800, 128];

const EDITS = {
  Banner_Kigali: [
    fill(...FIELD, { rgb: CARBON }),
    // The sticker nearly the banner's height; "APPLIKAT" 57 px tall (the original's lettering was 59), its ribbon
    // under it; the site smaller beside it, as the game's own banner has its own
    art(...LETTERING, { gap: 13, items: [STICKER(108), item('name', 83), item('site', 44)] }),
  ],
};

const done = markOf(FILE, MARK_KEY);
if (done === MARK) {
  console.log(`${FILE}: already done (${done})`);
  process.exit(0);
}
if (done) {
  console.error(`${FILE} was changed by ${done}: start again from the model as it came (git checkout -- ${FILE})`);
  process.exit(1);
}
const sha256 = createHash('sha256').update(readFileSync(FILE)).digest('hex');
if (!KNOWN[sha256]) {
  console.error(`${FILE} is not a model this script knows (sha256 ${sha256}): look at its banner pictures, then add it to KNOWN`);
  process.exit(1);
}
console.log(`${FILE}: ${KNOWN[sha256]}`);
// CC BY-NC-SA 4.0 asks for the credit, for changes to be said and for the same licence: all three travel with the file
await editGlb(FILE, EDITS, {
  mark: MARK,
  markKey: MARK_KEY,
  extras: {
    changes: 'one banner picture (banner_kigali) replaced by a banner of the event’s own stand (Applikat); nothing else changed',
    credit: 'RISE Motordrome by Alp Yalay (LibreCorsa), https://librecorsa.org',
    license: 'CC-BY-NC-SA-4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)',
  },
});
