// ============================================================
// main/media-protocol.js
// The media:// address the player uses to read your files (with seeking). Only library files and files you pick are served.
// ============================================================

const path = require('path');
const fsp = require('fs/promises');
const { createReadStream } = require('fs');
const { Readable } = require('stream');
const { protocol } = require('electron');
const { VIDEO, AUDIO, loadCfg, isInsideFolder } = require('./config');

// Files the user picked manually through a dialog.
const granted = new Set();

// Register the media protocol before app initialization.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

function registerMediaProtocol() {

  protocol.handle('media', async request => {
    try {
      const mediaUrl = new URL(request.url);

      if (mediaUrl.hostname !== 'local') {
        return new Response('Forbidden', {
          status: 403
        });
      }

      const filePath = path.resolve(
        decodeURIComponent(mediaUrl.pathname.slice(1))
      );

      const config = await loadCfg();

      // Library files, plus audio files the user picked manually.
      const isGranted = granted.has(filePath);

      const allowed =
        isGranted ||
        config.folders.some(folder =>
          isInsideFolder(filePath, folder)
        );

      if (!allowed) {
        return new Response('Forbidden', {
          status: 403
        });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = isGranted ? AUDIO[ext] : VIDEO[ext];

      if (!mime) {
        return new Response('Unsupported media type', {
          status: 415
        });
      }

      const stats = await fsp.stat(filePath);

      if (!stats.isFile()) {
        return new Response('Not found', {
          status: 404
        });
      }

      const size = stats.size;

      const headers = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      };

      if (size === 0) {
        headers['Content-Length'] = '0';

        return new Response(null, {
          status: 200,
          headers
        });
      }

      let start = 0;
      let end = size - 1;
      let status = 200;

      // Support seeking and partial video loading.
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

        if (!match || (!match[1] && !match[2])) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${size}`
            }
          });
        }

        if (match[1]) {
          start = Number(match[1]);

          if (match[2]) {
            end = Math.min(Number(match[2]), size - 1);
          }
        } else {
          const suffixLength = Number(match[2]);

          if (suffixLength <= 0) {
            return new Response(null, {
              status: 416,
              headers: {
                'Content-Range': `bytes */${size}`
              }
            });
          }

          start = Math.max(size - suffixLength, 0);
        }

        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start >= size ||
          start > end
        ) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${size}`
            }
          });
        }

        status = 206;

        headers['Content-Range'] =
          `bytes ${start}-${end}/${size}`;
      }

      headers['Content-Length'] = String(
        end - start + 1
      );

      const stream = createReadStream(filePath, {
        start,
        end
      });

      return new Response(
        Readable.toWeb(stream),
        {
          status,
          headers
        }
      );

    } catch (error) {
      console.error('Media protocol error:', error);

      return new Response('Not found', {
        status: 404
      });
    }
  });

}

module.exports = { registerMediaProtocol, granted };
