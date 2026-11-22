// ============================================================
// player-state.js
// Player elements (video, extra audio) and the player's shared variables. Loaded early because other files use them.
// ============================================================

/* ---------- player ---------- */

const v = $('#v');
const P = $('#player');

// Optional external audio track (played in sync with the muted video).
const A = new Audio();
A.preload = 'auto';

let cur = null;
let queue = [];
let hideT;
let lastSave = 0;

let subList = [];     // [{ label, el }] loaded subtitle tracks
let ccIdx = -1;       // active subtitle index, -1 = off
let subDelay = 0;     // seconds
let ext = null;       // { name } while an external audio file is active
let audioDelay = 0;   // seconds (positive = audio plays later)
let audioStreams = [];   // audio tracks inside the video file (from ffmpeg)
let audioBusy = null;    // { n, id, pct } while a track is being prepared
let note = '';
let noteT;
let subsBusy = false;    // reading subtitles embedded in the video file
let subsInfo = '';       // short status text shown in the menu
let subTouched = false;  // user picked a subtitle manually (disables auto-select)
