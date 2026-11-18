# Home Cinema

An offline, Netflix-style player for the videos on your laptop (Electron).

## Run
1. Install Node.js (LTS) from https://nodejs.org
2. In this folder:  npm install   then   npm start
3. Click "Add folder" and pick the folder with your movies / series.

## Build an installer (.exe)
npm run dist     (output goes to the dist folder)

## Naming tips
- Series: Show.Name.S01E03.mkv  (grouped by show and season)
- Subtitles: put movie.srt next to movie.mp4 (same name) and press C in the player
- Everything else is treated as a movie
