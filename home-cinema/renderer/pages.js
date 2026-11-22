// ============================================================
// pages.js
// render(): decides what the main area shows (home, movies, TV shows, search results, empty states).
// ============================================================

/* ---------- pages ---------- */

function render() {
  const m = $('#main');

  releaseImgs(m);

  m.innerHTML = '';

  if (!items.length) {
    m.append(el(
      'div',
      'empty',
      `<h1>Your library is empty</h1>
      <p>Choose a folder that contains your movies and series.
      Subfolders are included, and .srt or .vtt subtitles with
      the same name are picked up automatically.</p>
      <button class="red big" id="add2">Add folder</button>`
    ));

    $('#add2').onclick = addFolder;

    return;
  }

  const q = query.trim().toLowerCase();

  if (q) {
    const res = [
      ...movies.filter(i =>
        i.title.toLowerCase().includes(q)
      ),
      ...shows.filter(s =>
        s.name.toLowerCase().includes(q)
      )
    ];

    m.append(
      res.length
        ? grid(`Results for “${query}”`, res)
        : el(
            'div',
            'empty',
            `<h1>No matches</h1>
            <p>Nothing in your library matches “${esc(query)}”.</p>`
          )
    );

    return;
  }

  if (view === 'movies') {
    return m.append(
      movies.length
        ? grid('Movies', movies)
        : el(
            'div',
            'empty',
            '<h1>No movies yet</h1><p>Files without an S01E01 style number are treated as movies.</p>'
          )
    );
  }

  if (view === 'tv') {
    return m.append(
      shows.length
        ? grid('TV Shows', shows)
        : el(
            'div',
            'empty',
            '<h1>No TV shows yet</h1><p>Name episodes like Show.Name.S01E03.mkv and they will be grouped by series.</p>'
          )
    );
  }

  m.append(heroEl(featured));

  const cont = items
    .filter(i => pct(i) > 1 && pct(i) < 95)
    .sort((a, b) => prog[b.id].u - prog[a.id].u)
    .slice(0, 15);

  const recent = [...movies, ...shows]
    .sort((a, b) => b.added - a.added)
    .slice(0, 20);

  [
    row('Continue watching', cont),
    row('Recently added', recent),
    row('Movies', movies),
    row('TV shows', shows)
  ].forEach(r => r && m.append(r));
}
