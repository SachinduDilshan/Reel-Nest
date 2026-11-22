// ============================================================
// app.js
// Start-up: loads the library, navigation, search, buttons and the automatic library refresh. Loaded last.
// ============================================================

/* ---------- boot ---------- */

async function load(r) {
  if (!r) return;

  folders = r.folders;
  build(r.items);
  render();

  // Once per session: drop cached thumbnails of videos that no longer exist.
  if (!pruned && items.length) {
    pruned = true;

    const ids = new Set(items.map(i => i.id));

    setTimeout(() => pruneThumbs(ids), 10000);
  }
}

let pruned = false;

async function addFolder() {
  const r = await api.addFolder();

  if (r) {
    $('#main').innerHTML = `
      <div class="empty">
        <p>Scanning your library…</p>
      </div>`;

    await load(r);
  }
}

// Navigation.
$$('#nav nav a').forEach(a => {
  a.onclick = () => {
    view = a.dataset.v;
    query = '';

    $('#q').value = '';

    $$('#nav nav a').forEach(x =>
      x.classList.toggle('on', x === a)
    );

    render();
    scrollTo(0, 0);
  };
});

// Search.
let qt;

$('#q').oninput = e => {
  clearTimeout(qt);

  qt = setTimeout(() => {
    query = e.target.value;
    render();
  }, 200);
};

// Buttons.
$('#add').onclick = addFolder;
$('#folders').onclick = foldersModal;

// Navigation background on scroll.
addEventListener('scroll', () => {
  $('#nav').classList.toggle('solid', scrollY > 40);
});

// Initial library load.
$('#main').innerHTML = `
  <div class="empty">
    <p>Scanning your library…</p>
  </div>`;

api.getLibrary().then(load);


/* ---------------------------------
   AUTOMATIC LIBRARY REFRESH
---------------------------------- */

api.onLibraryUpdated(library => {
  if (!library) return;

  // Remember the previous featured item.
  const previousFeatured = featured;

  // Update folder list.
  folders = library.folders;

  // Rebuild movies and TV shows.
  build(library.items);

  // Keep the previous featured item when it still exists.
  if (previousFeatured) {
    const previousId =
      previousFeatured.kind === 'show'
        ? null
        : previousFeatured.id;

    const previousName =
      previousFeatured.kind === 'show'
        ? previousFeatured.name
        : null;

    const matchingItem = previousId
      ? movies.find(m => m.id === previousId)
      : shows.find(s =>
          s.name.toLowerCase() ===
          previousName.toLowerCase()
        );

    if (matchingItem) {
      featured = matchingItem;
    }
  }

  // Re-render the current page.
  // Current view and search query are preserved.
  render();

  console.log('Library automatically refreshed.');
});
