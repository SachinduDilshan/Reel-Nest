// ============================================================
// ambient.js
// The soft glow behind the glass takes its colours from the
// featured picture (a little like Material You dynamic colour).
// ============================================================

const ambRoot = document.documentElement;

// Back to the default red and violet glow.
function resetAmbient() {
  ambRoot.style.removeProperty('--amb-a');
  ambRoot.style.removeProperty('--amb-b');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (!d) return [0, 0, l];

  const s = d / (1 - Math.abs(2 * l - 1));

  const h =
    max === r ? ((g - b) / d) % 6
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;

  return [(h * 60 + 360) % 360, s, l];
}

// Picks the most colourful hue of a picture and tints the glow with it.
async function setAmbient(blob) {
  try {
    const W = 24, H = 14;
    const bmp = await createImageBitmap(blob, { resizeWidth: W, resizeHeight: H });
    const c = document.createElement('canvas');

    c.width = W;
    c.height = H;

    const g = c.getContext('2d', { willReadFrequently: true });

    g.drawImage(bmp, 0, 0);
    bmp.close();

    const px = g.getImageData(0, 0, W, H).data;

    let x = 0, y = 0, total = 0;

    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      const w = s * Math.min(l, 1 - l);          // colourful mid-tones count most

      x += Math.cos(h * Math.PI / 180) * w;
      y += Math.sin(h * Math.PI / 180) * w;
      total += w;
    }

    // Almost grey picture: keep the default glow.
    if (total < 0.5) return;

    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    ambRoot.style.setProperty('--amb-a', `hsl(${hue.toFixed(0)} 72% 42%)`);
    ambRoot.style.setProperty('--amb-b', `hsl(${((hue + 160) % 360).toFixed(0)} 60% 40%)`);
  } catch {}
}
