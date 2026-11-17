# How to Install

## Requirements
- Node.js 22+
- One Discord app per bot (Master + Slave per room)

## Discord (each bot)
1. [Developer Portal](https://discord.com/developers/applications) → Bot → copy token
2. Enable **Message Content Intent**
3. **Master** invite: View Channels, Connect, Speak, Send Messages, Read Message History, Embed Links, **Manage Channels**, **Manage Roles**
4. **Slave** invite: View Channels, Connect, Speak, Send Messages, Read Message History, Embed Links
5. Put the **Master bot role above** the auto-created `oud` role (Server Settings → Roles)

## Setup
```bash
npm install
```

Create `.env` (see project `.env` for commented template):
```env
GUILD_ID=

# Master
MASTER_TOKEN=
MASTER_VOICE_CHANNEL_ID=
MASTER_TEXT_CHANNEL_ID=

# Slave bots — tokens in data/bots.json (copy from data/bots.json.example)
# Rooms assigned from Master panel → saved in data/bot-channels.json
# Add / remove slaves: panel → Edit all bots → Add bot or Remove menu
# Optional: CONTROL_USER_IDS, BRIDGE_OUD_ROLE_NAME, DEFAULT_CONTACT_URL, DEFAULT_CONTACT_LABEL

# Discord API resilience (recommended on VPS — restart after change):
# DISCORD_REST_TIMEOUT_MS=45000
# DISCORD_REST_RETRIES=5
# DISCORD_UI_RETRY_ATTEMPTS=3
# DISCORD_UI_RETRY_DELAY_MS=750
```

Bridge audio (continuous playback):
```env
BRIDGE_MIN_BUFFER=4
BRIDGE_SOURCE_IDLE_MS=6000   # drop source only after 6s silence
BRIDGE_INJECT_SILENCE=0      # 0 = no hollow fade (recommended)
BRIDGE_OPUS_BITRATE=128000
```

## Run
```bash
npm start
```

## Commands
- **Master room:** `panel` → control panel · `p` / `P` → music
- **Slave room:** `p` / `help` → music
