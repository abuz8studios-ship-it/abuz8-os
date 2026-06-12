# Social Beacon — the home base for posting everywhere

ABUZ8 is the beacon: **compose once, broadcast to every connected network**, and schedule
**faceless-content marketing loops** that run on their own. This is the in-shell answer to
"migrate Postiz" — the core of a social scheduler (multi-account fan-out + scheduling +
AI content), built right into the agent, with the keys staying on your machine.

## Platforms (13)
**Work now with a simple token** (real, verified posts):
- **X (Twitter)** — OAuth2 user token (tweet.write)
- **Mastodon** — instance URL + access token
- **Bluesky** — handle + App Password (AT Protocol)
- **Telegram** — bot token + chat/channel id
- **Discord** — channel webhook URL

**Wired to their real APIs, need the platform's OAuth app + token** (honest — we say
exactly which credential is missing instead of faking a post):
- Instagram, TikTok, LinkedIn, Facebook Page, YouTube, Threads, Reddit, Pinterest

## How it works
- `GET /api/social/platforms` → catalog + connected status.
- `POST /api/social/connect {id, creds}` → store credentials locally (`config/social.json`).
- `POST /api/social/post {platforms[], text, link}` → **the beacon**: fans the post out to
  every selected network at once and returns an honest per-platform result
  (`posted` / `needs_auth` / `error`). Verified: with nothing connected it reports exactly
  which field each platform needs — never a fake success.
- `POST /api/social/draft {topic, platform}` → **faceless content**: the brain writes a
  ready-to-post, platform-tailored post (hook → value → CTA → hashtags, ≤280 for X).
  Verified producing a real 270-char X post.
- Tools: `social_post`, `social_draft`. Natural language: "broadcast: …", "post to all my
  socials: …", "tweet …".

## Marketing loops (the autonomous part)
The autonomy scheduler gained two action kinds:
- `social` — post fixed text on a cadence.
- `content_loop` — **each run, ABUZ8 drafts fresh faceless content on your topic and
  broadcasts it** to your chosen networks. Set it to every 4h or daily and it markets for
  you while you're away (app running). Created from the Social view → "Schedule loop".

## Full browser (Edge) control
The Playwright runner launches the **Microsoft Edge** channel first (`channel: 'msedge'`),
so `browser_do` drives your real Edge for navigate/click/fill/extract/screenshot — useful
for the platforms whose posting still needs a logged-in browser session.

## Honest notes
- Real posts need each platform's credential; the easy five take seconds, the OAuth eight
  need a developer app on that platform first. Nothing is faked.
- Image/video upload is wired for X/Mastodon text today; media posting for IG/TikTok
  (container+publish) activates once those accounts are connected.
- Loops run only while the app is running (sovereign, local — no cloud cron).
