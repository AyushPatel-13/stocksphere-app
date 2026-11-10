import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as statusRoute, POST as uploadRoute } from "@/app/api/community/images/route";
import { POST as cleanupRoute } from "@/app/api/community/images/cleanup/route";
import {
  MAX_IMAGE_BYTES,
  fileProblem,
  galleryLayout,
  imageOwner,
  imagePath,
  imageUrl,
  isImagePath,
  parseImageInputs,
  readPostImages,
  singleAspect,
  sniffImage,
  stripImageMetadata,
} from "../images";
import { cleanUpImages, removeImages, uploadImage, type ImageStore, type UploadRecord } from "../imageService";
import { createPost, toPostView, type CommunityStore, type NewPostRow } from "../service";
import type { PostView } from "../types";

/** Photos on posts: real file types, limits, ownership, and no orphans. */

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-28T12:00:00.000Z");

/* ------------------------------------------------ file headers */

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment (as cameras write), SOF0 with the size, then a scan and EOI.
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ...SCAN,
    0xff, 0xd9,
  ]);
}

/** A start-of-scan header and some compressed data, including a stuffed 0xFF00 and a restart marker. */
const SCAN = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

const segment = (marker: number, body: number[] | Uint8Array) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const pngChunk = (type: string, data: number[] | Uint8Array) => {
  const b = new Uint8Array(12 + data.length);
  new DataView(b.buffer).setUint32(0, data.length);
  b.set(Buffer.from(type), 4);
  b.set(data, 8);
  return [...b]; // the CRC is left at 0: nothing here checks it, and a strip must keep it as it was
};
const riffChunk = (type: string, data: number[]) => [...Buffer.from(type), data.length & 0xff, (data.length >> 8) & 0xff, 0, 0, ...data, ...(data.length & 1 ? [0] : [])];
function riff(chunks: number[]): Uint8Array {
  const size = 4 + chunks.length;
  return new Uint8Array([...Buffer.from("RIFF"), size & 0xff, (size >> 8) & 0xff, 0, 0, ...Buffer.from("WEBP"), ...chunks]);
}
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));
/** What a phone writes into EXIF: its make and the place the photo was taken. */
const GPS = [...Buffer.from("Exif\0\0"), ...Buffer.from("Pixel 9 GPSLatitude 22.7196N 75.8577E")];

function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), ...Buffer.from(kind)]);
  if (kind === "VP8 ") {
    b.set([0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8], 23);
  } else if (kind === "VP8L") {
    const bits = (width - 1) | ((height - 1) << 14);
    b.set([0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff], 20);
  } else {
    b.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff, (height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 24);
  }
  return b;
}

test("a photo's type and size come from its bytes", () => {
  assert.deepEqual(sniffImage(png(1200, 800)), { mime: "image/png", ext: "png", width: 1200, height: 800 });
  assert.deepEqual(sniffImage(jpeg(4032, 3024)), { mime: "image/jpeg", ext: "jpg", width: 4032, height: 3024 });
  assert.deepEqual(sniffImage(webp("VP8 ", 640, 480)), { mime: "image/webp", ext: "webp", width: 640, height: 480 });
  assert.deepEqual(sniffImage(webp("VP8L", 300, 200)), { mime: "image/webp", ext: "webp", width: 300, height: 200 });
  assert.deepEqual(sniffImage(webp("VP8X", 2560, 1440)), { mime: "image/webp", ext: "webp", width: 2560, height: 1440 });
});

test("anything else is refused, whatever it's called", () => {
  const gif = new Uint8Array([...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const svg = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 pretending to be a photo.jpg"));
  for (const bytes of [gif, svg, pdf, new Uint8Array(0), png(1200, 800).subarray(0, 20), jpeg(10, 10).subarray(0, 12), png(0, 10), png(30000, 10)]) {
    assert.equal(sniffImage(bytes), null);
  }
});

test("a JPEG loses its EXIF location, XMP, comments, JFIF thumbnail and trailing data, and keeps its pixels and colour profile", () => {
  const icc = [...Buffer.from("ICC_PROFILE\0"), 1, 1, 9, 9];
  const jfifWithThumb = [...Buffer.from("JFIF\0"), 1, 2, 0, 0, 1, 0, 1, 1, 1, 0xaa, 0xbb, 0xcc];
  const dqt = [0x00, ...Array(64).fill(1)];
  const sof = [0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const original = new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, jfifWithThumb),
    ...segment(0xe1, GPS),
    ...segment(0xe1, [...Buffer.from("http://ns.adobe.com/xap/1.0/\0"), ...Buffer.from("<x:xmpmeta>Indore</x:xmpmeta>")]),
    ...segment(0xed, [...Buffer.from("Photoshop 3.0\0"), ...Buffer.from("IPTC byline Ayush")]),
    ...segment(0xe2, icc),
    ...segment(0xfe, [...Buffer.from("taken at home")]),
    ...segment(0xdb, dqt),
    ...segment(0xc0, sof),
    ...SCAN,
    // A second (progressive) scan, with metadata smuggled in between the scans.
    ...segment(0xe1, GPS),
    ...SCAN,
    0xff, 0xd9,
    ...Buffer.from("appended GPSLatitude"),
  ]);

  const clean = stripImageMetadata(original, "image/jpeg");
  assert.ok(clean);
  for (const leak of ["GPSLatitude", "Pixel 9", "Exif", "xmpmeta", "IPTC", "taken at home", "appended"]) assert.equal(has(clean, leak), false, leak);
  assert.equal(Buffer.from(clean).includes(Buffer.from([0xaa, 0xbb, 0xcc])), false, "JFIF thumbnail");
  assert.deepEqual(
    [...clean],
    [
      0xff, 0xd8,
      ...segment(0xe0, [...Buffer.from("JFIF\0"), 1, 2, 0, 0, 1, 0, 1, 0, 0]),
      ...segment(0xe2, icc),
      ...segment(0xdb, dqt),
      ...segment(0xc0, sof),
      ...SCAN,
      ...SCAN,
      0xff, 0xd9,
    ]
  );
  assert.deepEqual(sniffImage(clean), sniffImage(original));
  // Already clean stays the same.
  assert.deepEqual(stripImageMetadata(clean, "image/jpeg"), clean);
});

test("a PNG loses its EXIF and text chunks and anything after IEND; a WebP loses EXIF and XMP and its header flags say so", () => {
  const ihdr = [0, 0, 0, 40, 0, 0, 0, 30, 8, 6, 0, 0, 0];
  const original = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", ihdr),
    ...pngChunk("eXIf", GPS),
    ...pngChunk("tEXt", [...Buffer.from("Comment\0GPSLatitude 22.7")]),
    ...pngChunk("iTXt", [...Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>")]),
    ...pngChunk("tIME", [7, 234, 10, 28, 12, 0, 0]),
    ...pngChunk("sRGB", [0]),
    ...pngChunk("IDAT", [1, 2, 3, 4]),
    ...pngChunk("IEND", []),
    ...Buffer.from("trailing GPSLatitude"),
  ]);
  const clean = stripImageMetadata(original, "image/png");
  assert.ok(clean);
  assert.deepEqual(
    [...clean],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pngChunk("IHDR", ihdr), ...pngChunk("sRGB", [0]), ...pngChunk("IDAT", [1, 2, 3, 4]), ...pngChunk("IEND", [])]
  );
  assert.deepEqual(sniffImage(clean), { mime: "image/png", ext: "png", width: 40, height: 30 });

  // VP8X with the ICC (0x20), alpha (0x10), EXIF (0x08) and XMP (0x04) flags set.
  const vp8x = [0x3c, 0, 0, 0, 0x27, 0, 0, 0x1d, 0, 0];
  const webpImage = riff([
    ...riffChunk("VP8X", vp8x),
    ...riffChunk("ICCP", [5, 5, 5]),
    ...riffChunk("VP8L", [0x2f, 0x27, 0x40, 0x07, 0x00]),
    ...riffChunk("EXIF", GPS),
    ...riffChunk("XMP ", [...Buffer.from("<x:xmpmeta>Indore</x:xmpmeta>")]),
  ]);
  const cleanWebp = stripImageMetadata(webpImage, "image/webp");
  assert.ok(cleanWebp);
  assert.deepEqual(
    [...cleanWebp],
    [...riff([...riffChunk("VP8X", [0x30, 0, 0, 0, 0x27, 0, 0, 0x1d, 0, 0]), ...riffChunk("ICCP", [5, 5, 5]), ...riffChunk("VP8L", [0x2f, 0x27, 0x40, 0x07, 0x00])])]
  );
  assert.deepEqual(sniffImage(cleanWebp), { mime: "image/webp", ext: "webp", width: 40, height: 30 });
});

test("a file that isn't well formed can't be cleaned, so it isn't accepted", () => {
  const truncated: [Uint8Array, "image/jpeg" | "image/png" | "image/webp"][] = [
    [jpeg(10, 10).subarray(0, 30), "image/jpeg"], // stops inside the scan
    [new Uint8Array([0xff, 0xd8, ...segment(0xc0, [8, 0, 1, 0, 1, 1, 0, 0, 0]), 0xff, 0xd9]), "image/jpeg"], // no scan at all
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]), "image/jpeg"], // a segment longer than the file
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])]), "image/png"], // no IEND
    [riff(riffChunk("VP8L", [0x2f, 0, 0, 0, 0])).subarray(0, 22), "image/webp"], // RIFF size past the end
  ];
  for (const [bytes, mime] of truncated) assert.equal(stripImageMetadata(bytes, mime), null, `${mime} ${bytes.length}`);
});

test("photo names live in the owner's folder and can't escape it", () => {
  const path = imagePath(ME, ID1, "jpg");
  assert.equal(path, `${ME}/${ID1}.jpg`);
  assert.equal(isImagePath(path), true);
  assert.equal(imageOwner(path), ME);
  for (const bad of [`${ME}/../${ID1}.jpg`, `${ME}/${ID1}.gif`, `${ME}/${ID1}.jpg?x=1`, `/${ME}/${ID1}.jpg`, `${ME}/photo.jpg`, 42]) {
    assert.equal(isImagePath(bad), false, String(bad));
  }
  assert.equal(imageUrl(path, "https://x.supabase.co/"), `https://x.supabase.co/storage/v1/object/public/community-images/${path}`);
});

test("a post's photos are checked: at most 4, valid names, no repeats", () => {
  const ok = parseImageInputs([{ path: `${ME}/${ID1}.jpg`, alt: "  A   chart " }, { path: `${ME}/${ID2}.png` }]);
  assert.deepEqual(ok.ok && ok.images, [
    { path: `${ME}/${ID1}.jpg`, alt: "A chart" },
    { path: `${ME}/${ID2}.png`, alt: "" },
  ]);
  assert.equal(parseImageInputs(undefined).ok, true);
  for (const bad of ["x", [{ path: "nope" }], Array.from({ length: 5 }, (_, i) => ({ path: `${ME}/1111111${i}-1111-4111-8111-111111111111.jpg` })), [{ path: `${ME}/${ID1}.jpg` }, { path: `${ME}/${ID1}.jpg` }], [{ path: `${ME}/${ID1}.jpg`, alt: 5 }]]) {
    assert.equal(parseImageInputs(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(readPostImages([{ path: `${ME}/${ID1}.jpg`, width: 10, height: 20, alt: "x" }, { path: "../etc/passwd", width: 1, height: 1 }, null]), [{ path: `${ME}/${ID1}.jpg`, width: 10, height: 20, alt: "x" }]);
});

test("galleries lay out like X and Reddit, and a single photo keeps a sane shape", () => {
  assert.deepEqual(galleryLayout(1).cells.length, 1);
  assert.match(galleryLayout(2).grid, /grid-cols-2/);
  assert.deepEqual(galleryLayout(3).cells, ["row-span-2", "", ""]);
  assert.equal(galleryLayout(4).cells.length, 4);
  assert.equal(singleAspect(1600, 900), 1600 / 900);
  assert.equal(singleAspect(100, 1000), 0.8);
  assert.equal(singleAspect(5000, 100), 2);
  assert.equal(fileProblem({ type: "image/gif", size: 10 }), "Only JPG, PNG and WebP photos can be added.");
  assert.equal(fileProblem({ type: "image/jpeg", size: 12_000_000 }), null);
});

/* ------------------------------------------------ uploads */

function imageStore(overrides: Partial<ImageStore> = {}, records: UploadRecord[] = []): ImageStore & { saved: string[]; removed: string[][] } {
  const saved: string[] = [];
  const removed: string[][] = [];
  return {
    saved,
    removed,
    ready: async () => true,
    verifyToken: async (token) => (token === "good" ? ME : null),
    hasProfile: async () => true,
    countSince: async () => 0,
    countUnused: async () => 0,
    save: async (path) => {
      saved.push(path);
    },
    unused: async (userId, paths) => records.filter((r) => r.userId === userId && r.postId === null && paths.includes(r.path)),
    remove: async (paths) => {
      removed.push(paths);
    },
    orphans: async () => [`${ME}/${ID1}.jpg`],
    detached: async () => [`${ME}/${ID2}.png`],
    ...overrides,
  };
}

test("an upload is stored under the uploader's own folder with a random name", async () => {
  const s = imageStore();
  const result = await uploadImage({ token: "good", bytes: jpeg(800, 600) }, s, NOW, () => ID1);
  assert.deepEqual(result, { ok: true, image: { path: `${ME}/${ID1}.jpg`, width: 800, height: 600 } });
  assert.deepEqual(s.saved, [`${ME}/${ID1}.jpg`]);
});

test("the server stores the photo without its metadata, even when the upload skipped the composer", async () => {
  // As a script posting straight to /api/community/images would send it.
  const fromPhone = new Uint8Array([0xff, 0xd8, ...segment(0xe1, GPS), ...jpeg(800, 600).subarray(2)]);
  let stored: Uint8Array | undefined;
  const s = imageStore({
    save: async (_path, bytes) => {
      stored = bytes;
    },
  });
  const result = await uploadImage({ token: "good", bytes: fromPhone }, s, NOW, () => ID1);
  assert.deepEqual(result, { ok: true, image: { path: `${ME}/${ID1}.jpg`, width: 800, height: 600 } });
  assert.ok(stored);
  assert.equal(has(stored, "GPSLatitude"), false);
  assert.deepEqual([...stored], [...stripImageMetadata(jpeg(800, 600), "image/jpeg")!]);
  assert.deepEqual(sniffImage(stored), sniffImage(fromPhone));

  // A damaged file is refused rather than stored with its metadata.
  const damaged = await uploadImage({ token: "good", bytes: jpeg(800, 600).subarray(0, 30) }, imageStore(), NOW, () => ID1);
  assert.equal(!damaged.ok && damaged.status, 415);
});

test("uploads are refused when signed out, switched off, the wrong type, too big or over the limits", async () => {
  const cases: [Parameters<typeof uploadImage>[0], ImageStore | null, number][] = [
    [{ token: null, bytes: jpeg(1, 1) }, imageStore(), 401],
    [{ token: "forged", bytes: jpeg(1, 1) }, imageStore(), 401],
    [{ token: "good", bytes: jpeg(1, 1) }, imageStore({ ready: async () => false }), 503],
    [{ token: "good", bytes: jpeg(1, 1) }, null, 503],
    [{ token: "good", bytes: jpeg(1, 1) }, imageStore({ hasProfile: async () => false }), 403],
    [{ token: "good", bytes: new Uint8Array(Buffer.from("GIF89a....")) }, imageStore(), 415],
    [{ token: "good", bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) }, imageStore(), 413],
    [{ token: "good", bytes: null }, imageStore(), 400],
    [{ token: "good", bytes: jpeg(1, 1) }, imageStore({ countSince: async () => 30 }), 429],
    [{ token: "good", bytes: jpeg(1, 1) }, imageStore({ countUnused: async () => 12 }), 429],
  ];
  for (const [input, store, status] of cases) {
    const result = await uploadImage(input, store, NOW, () => ID1);
    assert.equal(!result.ok && result.status, status, `${status}`);
  }
});

test("members can only take back their own unused uploads; the cleanup job removes orphans", async () => {
  const records: UploadRecord[] = [
    { path: `${ME}/${ID1}.jpg`, userId: ME, mime: "image/jpeg", bytes: 1, width: 1, height: 1, postId: null },
    { path: `${OTHER}/${ID2}.jpg`, userId: OTHER, mime: "image/jpeg", bytes: 1, width: 1, height: 1, postId: null },
  ];
  const s = imageStore({}, records);
  const result = await removeImages({ token: "good", paths: [`${ME}/${ID1}.jpg`, `${OTHER}/${ID2}.jpg`] }, s);
  assert.deepEqual(result, { ok: true, removed: 1 });
  assert.deepEqual(s.removed, [[`${ME}/${ID1}.jpg`]]);

  const detached = imageStore({}, records);
  await removeImages({ token: "good", paths: [], detached: true }, detached);
  assert.deepEqual(detached.removed, [[`${ME}/${ID2}.png`]]);

  assert.equal((await removeImages({ token: "good", paths: ["../../x"] }, s)).ok, false);
  assert.equal((await removeImages({ token: null, paths: [] }, s)).ok, false);

  const job = imageStore();
  assert.deepEqual(await cleanUpImages(job, NOW), { ok: true, removed: 1 });
  assert.deepEqual((await cleanUpImages(imageStore({ ready: async () => false }), NOW)).ok, false);
});

test("the routes: status is public, upload needs a token, cleanup needs CRON_SECRET", async () => {
  const status = await (await statusRoute(new Request("http://x/api/community/images"), undefined, imageStore({ ready: async () => false }))).json();
  assert.deepEqual([status.enabled, status.maxImages], [false, 4]);

  const form = new FormData();
  form.append("file", new Blob([jpeg(10, 10).slice().buffer]), "photo");
  const unauth = await uploadRoute(new Request("http://x/api/community/images", { method: "POST", body: form }), undefined, imageStore());
  assert.equal(unauth.status, 401);

  const big = await uploadRoute(new Request("http://x/api/community/images", { method: "POST", headers: { "content-length": String(MAX_IMAGE_BYTES * 2) }, body: "x" }), undefined, imageStore());
  assert.equal(big.status, 413);

  const job = await cleanupRoute(new Request("http://x/api/community/images/cleanup", { method: "POST" }), undefined, "secret", imageStore());
  assert.equal(job.status, 401);
  const ran = await cleanupRoute(new Request("http://x/api/community/images/cleanup", { method: "POST", headers: { Authorization: "Bearer secret" } }), undefined, "secret", imageStore());
  assert.equal(ran.status, 200);
});

/* ------------------------------------------------ posting with photos */

function view(row: NewPostRow): PostView {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    body: row.body,
    sentiment: null,
    symbols: [],
    parentId: row.parent_id,
    likeCount: 0,
    replyCount: 0,
    createdAt: new Date(NOW).toISOString(),
    author: { username: "ayush", displayName: "Ayush", avatarUrl: null, role: "user", stats: { resolved: 0, wins: 0, points: 0 } },
  };
}

function postStore(overrides: Partial<CommunityStore> = {}): CommunityStore & { inserted: NewPostRow[]; discarded: string[] } {
  const inserted: NewPostRow[] = [];
  const discarded: string[] = [];
  return {
    inserted,
    discarded,
    verifyToken: async (token) => (token === "good" ? ME : null),
    getAuthor: async (id) => ({ id, createdAt: "2026-09-01T00:00:00.000Z" }),
    countPostsSince: async () => 0,
    recentBodies: async () => [],
    getParent: async (id) => (id === ID1 ? { symbols: [], authorId: OTHER, parentId: null, rootId: null, threads: true } : null),
    insertPost: async (row) => {
      inserted.push(row);
      return view(row);
    },
    listPosts: async () => [],
    sentiment: async () => ({ bullish: 0, bearish: 0, total: 0 }),
    recentSymbols: async () => [],
    unusedUploads: async (_user, paths) => paths.filter((p) => p.startsWith(ME)).map((path) => ({ path, width: 800, height: 600 })),
    attachUploads: async (_post, _user, paths) => paths.length,
    discardPost: async (postId) => {
      discarded.push(postId);
    },
    ...overrides,
  };
}

test("a post carries its author's own uploads, with their sizes", async () => {
  const s = postStore();
  const result = await createPost({ token: "good", body: "Chart attached", images: [{ path: `${ME}/${ID1}.png`, alt: "Daily chart" }] }, s, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(s.inserted[0].images, [{ path: `${ME}/${ID1}.png`, width: 800, height: 600, alt: "Daily chart" }]);

  // No photos: no column written (works before the migration).
  await createPost({ token: "good", body: "Plain" }, s, NOW);
  assert.equal("images" in s.inserted[1], false);
});

test("someone else's photo, a used or missing one, or photos on a comment are refused", async () => {
  const s = postStore();
  const theirs = await createPost({ token: "good", body: "Stolen", images: [{ path: `${OTHER}/${ID1}.png` }] }, s, NOW);
  assert.equal(!theirs.ok && theirs.status, 403);

  const gone = await createPost({ token: "good", body: "Used", images: [{ path: `${ME}/${ID1}.png` }] }, postStore({ unusedUploads: async () => [] }), NOW);
  assert.deepEqual(!gone.ok && [gone.status, gone.code], [409, "IMAGE_GONE"]);

  const comment = await createPost({ token: "good", body: "On a comment", parentId: ID1, postId: ID1, images: [{ path: `${ME}/${ID1}.png` }] }, s, NOW);
  assert.equal(!comment.ok && comment.status, 400);

  const off = await createPost({ token: "good", body: "x", images: [{ path: `${ME}/${ID1}.png` }] }, postStore({ unusedUploads: undefined }), NOW);
  assert.deepEqual(!off.ok && [off.status, off.code], [503, "NOT_CONFIGURED"]);
  assert.equal(s.inserted.length, 0);
});

test("if the photos can't be linked to the new post, the post is taken back (no photo is left to be cleaned up under it)", async () => {
  const s = postStore({ attachUploads: async () => 0 });
  const result = await createPost({ token: "good", body: "Race", images: [{ path: `${ME}/${ID1}.png` }] }, s, NOW);
  assert.deepEqual(!result.ok && [result.status, result.code], [409, "IMAGE_GONE"]);
  assert.deepEqual(s.discarded, ["33333333-3333-4333-8333-333333333333"]);
});

test("posts read their photos with public addresses; malformed entries are dropped", () => {
  const post = toPostView({
    id: ID1,
    body: "b",
    sentiment: null,
    symbols: [],
    parent_id: null,
    like_count: 0,
    reply_count: 0,
    created_at: "2026-10-28T10:00:00.000Z",
    author: null,
    images: [{ path: `${ME}/${ID2}.webp`, width: 1600, height: 900, alt: "" }, { path: "bad", width: 1, height: 1 }],
  });
  assert.equal(post.images?.length, 1);
  assert.match(post.images![0].url, new RegExp(`/storage/v1/object/public/community-images/${ME}/${ID2}\\.webp$`));
});
