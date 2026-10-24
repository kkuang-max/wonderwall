# Wonder Wall

*Play together, without talking.* Event-goers collect themed stickers. Tapping one at a station (NFC or QR)
puts its character onto a big shared wall. People standing at the wall gather the characters with their hands,
and every tap from anyone unlocks more for everyone: lanterns, a dance party, fireworks, and a Big Friend.

- **`/wall.html`**: the big screen or projector.
- **`/station.html`**: a phone or tablet next to the wall that reads stickers.
- **`/stickers.html`**: a printable sticker sheet, which can also write NFC tags from Android Chrome.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run demo         # low unlock thresholds (2, 4, 6, 9 taps)
npm run dev:phone    # HTTPS on your network, so phones can use the camera and NFC
```

Locally, the shared world lives in memory and resets when the server restarts.

## Deploy (Vercel)

Pushing to `main` deploys automatically. For walls and stations to share one world, add **Upstash Redis**
from the Vercel project's **Storage** tab (Marketplace → Upstash → Redis) and connect it to this project.
That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, then redeploy. Without it, each server instance keeps
its own memory, and the wall shows "Shared storage not connected".

Optional environment variables:
- `MILESTONES=3,7,12,20`: unlock thresholds for lanterns, dance, fireworks, Big Friend.

## How it's built

- `public/`: the three pages (plain HTML/JS/canvas) plus `shared.js` (characters, rules, scenes).
- `app/api/[route]/route.ts`: the API (`state`, `events`, `info`, `tap`, `action`, `scene`, `reset`).
- `lib/core.js`: world rules. `lib/store.js`: Redis or in-memory storage with a write lock.
- Walls poll `/api/events?since=<seq>` about once a second.

## Three scenarios

| Scene | "Leave something" action | Simulated crowd |
|---|---|---|
| Community market | Plant a flower | People drift by 1–2 at a time |
| Theme park queue | Release a balloon | A steady line where the same people re-tap |
| Music festival | Wave a glow stick | Bursts of 4–6 people between sets |

## Many people at once: three wordless gestures

Characters never speak. They react only with motion and light.

1. **Raise a hand → nearby characters gather.** Each character follows the nearest hand, up to 7 per hand.
2. **Hold still → glow** in that hand's color.
3. **Two hands close together → a light bridge.** Sparks cross it, and both groups jump together.

A tap or click sends a ripple.

## Real vs. simulated

| Piece | Status |
|---|---|
| Shared world across devices, NFC read/write (Android Chrome), QR scan | Real |
| Projected wall | Stand-in: any browser full screen |
| Visitor's hands | Simulated with the mouse and touch points (camera tracking later) |
| "Simulate a sticker tap" / "Simulate crowd" | Simulated, and labelled on screen |

**Wall keys:** `1` `2` `3` switch scene · `S` simulate crowd · `H` hide the demo bar · **Shift+R** reset the current scene.
