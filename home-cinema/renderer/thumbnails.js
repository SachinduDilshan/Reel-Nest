// ============================================================
// thumbnails.js
// Thumbnails: captures a frame from each video, caches it offline, and loads/releases pictures as you scroll.
// ============================================================

/* ---------- thumbnails ---------- */

// Frames are captured from the videos themselves and cached offline in
// IndexedDB as small JPEG files (blobs). Only the thumbnails near the screen
// are kept in memory; the rest are released and reloaded from disk on demand.

// Picture sizes (in pixels wide). Larger than the on-screen size so they stay
// sharp on high-resolution screens (Windows scaling 125% / 150% / 200%).
const THUMB = { card: 640, ep: 480, hero: 1600 };
const THUMB_WIDTHS = new Set(Object.values(THUMB));

const idb = new Promise(res => {
  const r = indexedDB.open('hc2', 1);

  r.onupgradeneeded = () =>
    r.result.createObjectStore('t');

  r.onsuccess = () => res(r.result);
  r.onerror = () => res(null);
});

// One-time removal of the old (much larger) base64 thumbnail cache.
try {
  if (!localStorage.getItem('hcCleaned')) {
    indexedDB.deleteDatabase('hc');
    localStorage.setItem('hcCleaned', '1');
  }
} catch {}

const idbGet = async k => {
  const d = await idb;

  if (!d) return;

  return new Promise(r => {
    const q = d.transaction('t').objectStore('t').get(k);

    q.onsuccess = () => r(q.result);
    q.onerror = () => r();
  });
};

const idbSet = async (k, v) => {
  const d = await idb;

  if (d) {
    d.transaction('t', 'readwrite')
      .objectStore('t')
      .put(v, k);
  }
};

// Deletes cached thumbnails of videos that are no longer in the library,
// and pictures of sizes that are not used any more.
async function pruneThumbs(validIds) {
  const d = await idb;

  if (!d) return;

  const req = d.transaction('t', 'readwrite')
    .objectStore('t')
    .openCursor();

  req.onsuccess = () => {
    const c = req.result;

    if (!c) return;

    const key = String(c.key);
    const width = Number(key.slice(0, key.indexOf(':')));
    const id = key.slice(key.indexOf(':') + 1);

    if (!validIds.has(id) || !THUMB_WIDTHS.has(width)) c.delete();

    c.continue();
  };
}

const grab = (it, w) => new Promise(res => {
  const v = document.createElement('video');

  v.muted = true;
  v.preload = 'metadata';
  v.crossOrigin = 'anonymous';

  const done = r => {
    clearTimeout(t);
    v.removeAttribute('src');
    v.load();
    res(r);
  };

  const t = setTimeout(() => done(null), 10000);

  v.onerror = () => done(null);

  v.onloadedmetadata = () => {
    v.currentTime = Math.min(v.duration * 0.15, 600) || 1;
  };

  v.onseeked = () => {
    try {
      const h = Math.round(w * 9 / 16);
      const c = document.createElement('canvas');

      c.width = w;
      c.height = h;

      const vr = v.videoWidth / v.videoHeight;
      const cr = w / h;

      let sw = v.videoWidth;
      let sh = v.videoHeight;
      let sx = 0;
      let sy = 0;

      if (vr > cr) {
        sw = sh * cr;
        sx = (v.videoWidth - sw) / 2;
      } else {
        sh = sw / cr;
        sy = (v.videoHeight - sh) / 2;
      }

      const g = c.getContext('2d');

      // High-quality scaling: without this, shrunk pictures look jagged.
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';

      g.drawImage(
        v,
        sx, sy,
        sw, sh,
        0, 0,
        w, h
      );

      const d = v.duration;

      c.toBlob(blob => {
        c.width = c.height = 0;          // free the canvas memory right away
        done(blob ? { blob, d } : null);
      }, 'image/jpeg', w >= 1000 ? 0.86 : 0.82);

    } catch {
      done(null);
    }
  };

  v.src = it.url;
});

let chain = Promise.resolve();

const pending = new Map();     // thumbnails being prepared right now
const failed = new Set();      // files that can't give a frame (don't retry)

// Resolves to the JPEG blob of a thumbnail (creating and caching it if needed).
function thumbBlob(it, w = THUMB.card) {
  const k = w + ':' + it.id;

  if (failed.has(k)) return Promise.resolve(null);

  if (!pending.has(k)) {
    pending.set(k, (async () => {
      let r = await idbGet(k);

      if (!r || !r.blob) {
        // Capture one at a time so the app never decodes several videos at once.
        chain = chain
          .then(() => grab(it, w))
          .catch(() => null);

        r = await chain;

        if (r) idbSet(k, r);
        else failed.add(k);
      }

      if (r && r.d) it.dur = r.d;

      return r ? r.blob : null;
    })().finally(() => pending.delete(k)));
  }

  return pending.get(k);
}

const imgUrls = new WeakMap();

function setImg(img, blob) {
  clearImg(img);

  const url = URL.createObjectURL(blob);

  imgUrls.set(img, url);
  img.src = url;
  img.classList.add('in');
}

// Releases the picture (and its decoded pixels) held by an <img>.
function clearImg(img) {
  const url = imgUrls.get(img);

  if (!url) return;

  img.classList.remove('in');
  img.removeAttribute('src');

  URL.revokeObjectURL(url);
  imgUrls.delete(img);
}

// Hero / detail pictures: loaded once when shown.
function loadImg(img, it, w) {
  thumbBlob(it, w).then(blob => {
    if (blob && img.isConnected) setImg(img, blob);
  });
}

// Cards: load when near the screen, release when scrolled far away.
const io = new IntersectionObserver(es => {
  es.forEach(e => {
    const img = e.target;
    const d = img._d;

    if (!d) return;

    d.vis = e.isIntersecting;

    if (!d.vis) {
      clearImg(img);
      return;
    }

    if (imgUrls.has(img) || d.busy) return;

    d.busy = true;

    thumbBlob(d.it, d.w).then(blob => {
      d.busy = false;

      if (blob && d.vis && img.isConnected) setImg(img, blob);
    });
  });
}, {
  rootMargin: '400px'
});

const lazy = (img, it, w = THUMB.card) => {
  img._d = { it, w, vis: false, busy: false };
  io.observe(img);
};

// Call before removing a part of the page so its pictures are freed.
function releaseImgs(root) {
  root.querySelectorAll('img').forEach(img => {
    io.unobserve(img);
    clearImg(img);
  });
}
