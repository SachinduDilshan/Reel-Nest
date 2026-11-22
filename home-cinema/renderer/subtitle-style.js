// ============================================================
// subtitle-style.js
// How subtitles look (size, colour, background): remembered settings and the live caption style.
// ============================================================

// Subtitle appearance (remembered between sessions).
const DEFAULT_STYLE = { size: 100, color: 'white', bg: 'box' };

const COLORS = {
  white: '#ffffff',
  yellow: '#ffe14d',
  cyan: '#7df3ff',
  green: '#8dff8d'
};

const subStyle = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('subStyle') || '{}');
    const legacy = parseInt(localStorage.getItem('subSize'), 10);
    const size = s.size || legacy;

    return {
      size: size >= 40 && size <= 250 ? size : DEFAULT_STYLE.size,
      color: COLORS[s.color] ? s.color : DEFAULT_STYLE.color,
      bg: ['box', 'shadow', 'none'].includes(s.bg) ? s.bg : DEFAULT_STYLE.bg
    };
  } catch {
    return { ...DEFAULT_STYLE };
  }
})();

const cueStyle = document.createElement('style');
document.head.append(cueStyle);

function cueLook() {
  return {
    color: COLORS[subStyle.color],
    background: subStyle.bg === 'box' ? 'rgba(0,0,0,.72)' : 'transparent',
    shadow: subStyle.bg === 'shadow'
      ? '0 0 3px #000, 0 0 6px #000, 1px 1px 2px #000, -1px -1px 2px #000'
      : 'none'
  };
}

function applySubStyle() {
  const c = cueLook();

  // vh keeps the text proportional in a window and in fullscreen.
  cueStyle.textContent =
    `#v::cue { font-size: ${(2.6 * subStyle.size / 100).toFixed(2)}vh; ` +
    `color: ${c.color}; background: ${c.background}; text-shadow: ${c.shadow}; }`;

  try {
    localStorage.setItem('subStyle', JSON.stringify(subStyle));
  } catch {}
}

const previewCss = () => {
  const c = cueLook();

  return `font-size:${(18 * subStyle.size / 100).toFixed(1)}px;` +
    `color:${c.color};background:${c.background};text-shadow:${c.shadow}`;
};

// Updates the live preview and size controls without rebuilding the menu.
function refreshStyleUi() {
  const p = $('#subprev');
  if (p) p.style.cssText = previewCss();

  const r = $('#szr');
  if (r) r.value = subStyle.size;

  const l = $('#szv');
  if (l) l.textContent = subStyle.size + '%';
}

function setSubSize(n) {
  subStyle.size = Math.max(40, Math.min(250, Math.round(n / 5) * 5));

  applySubStyle();
  refreshStyleUi();
}

const changeSubSize = d => setSubSize(subStyle.size + d);

applySubStyle();
