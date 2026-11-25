// ============================================================
// ripple.js
// Material "ripple": a soft circle that spreads from the point
// you click, on buttons, card pictures and episode rows.
// ============================================================

document.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;

  const host = e.target.closest('button, .ph, .ep');

  if (!host || host.disabled) return;

  const r = host.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;

  const s = document.createElement('span');

  s.className = 'rpl';

  // Inside buttons the ripple goes under the text; elsewhere over the picture.
  s.style.cssText =
    `width:${size}px;height:${size}px;` +
    `left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;` +
    `z-index:${host.matches('button') ? -1 : 1}`;

  host.append(s);

  s.addEventListener('animationend', () => s.remove());
}, { passive: true });
