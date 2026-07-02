# Kick Vote Bot

A local web bot for Kick streams that tracks chat votes like `!vote 1` and `!vote 2`, shows live totals, locks voting, and randomly picks winners from the correct side.

Kick chat is real-time only. Start this bot before you start a vote. It cannot read old chat after the stream ends.

## What it does

- Connects to public Kick chat through the Pusher WebSocket used by Kick chat.
- Tracks `!vote 1` and `!vote 2`.
- Counts one vote per Kick username.
- Lets viewers change their vote until you lock it.
- Shows live totals and recent voters.
- Lets you pick a random winner from side 1, side 2, or the winning side.
- Exports votes to CSV.
- Includes a clean OBS browser overlay.

## Setup

1. Install Node.js LTS from nodejs.org.
2. Unzip this folder.
3. Open Command Prompt in the folder.
4. Run:

```bash
npm install
```

5. Copy `.env.example` to `.env` and edit it:

```bash
KICK_CHANNEL=yourkickname
PORT=3000
```

6. Start it:

```bash
npm start
```

7. Open the dashboard:

```text
http://localhost:3000
```

8. Add this to OBS as a Browser Source:

```text
http://localhost:3000/overlay
```

Recommended OBS size: `1920 x 250` or `1000 x 250` depending where you place it.

## Stream usage

Say on stream:

```text
Type !vote 1 for YES or !vote 2 for NO
```

On the dashboard:

1. Click **Reset Vote** before a new poll.
2. Let chat vote.
3. Click **Lock Vote** when time is up.
4. Choose the correct side.
5. Click **Pick Winner From Correct Side**.

## Commands tracked

These all work:

```text
!vote 1
!vote 2
!vote yes
!vote no
!vote over
!vote under
!vote red
!vote black
```

The aliases map like this:

- `yes`, `over`, `red`, `left` -> side `1`
- `no`, `under`, `black`, `right` -> side `2`

You can edit aliases in `server.js`.

## Troubleshooting

### It says channel lookup failed

Kick sometimes blocks the channel lookup from non-browser scripts. The bot supports a manual fallback:

1. Find your Kick chatroom ID.
2. Put it in `.env`:

```bash
KICK_CHATROOM_ID=12345678
```

3. Restart the bot.

### It connects but no votes appear

- Make sure the stream/chat is public.
- Make sure people type the exact command, like `!vote 1`.
- Make sure you did not lock the vote.
- Restart the bot and refresh the dashboard.

## Notes

Kick's public chat event format can change. The bot is written defensively, but if Kick changes Pusher channels or event payloads, the connection code may need a small update.
