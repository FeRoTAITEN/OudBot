# OudBot

Multi-slave Discord voice bridge with music and a web control panel. One master bot coordinates one slave bot per voice room: rooms are bridged to each other while per-room music queues play.

## Features

- Multi-room voice bridging — one slave bot per room, all synced by the master
- Per-room music queue (YouTube playback with lyrics)
- Web control panel and guest listen page
- Per-room access roles, DJ-only mode, pause/volume controls

## Install

See [how-to-install.md](how-to-install.md).

Requirements: Node.js 22+, one Discord application per bot (master + one slave per room).

```bash
npm install
# create .env and data/ from the .example files, then:
npm start
```

## Layout

- `index.js` — entrypoint
- `src/` — master/slave bots, voice bridge, music, web panel
- `data/*.example` — config templates (copy and fill in)
- `scripts/` — developer tools
- `legal/` — privacy/terms pages served by the panel
