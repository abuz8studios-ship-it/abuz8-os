# Connect — real connectors, the fleet mesh, MCP, and your account

The **Connect** view is where ABUZ8 reaches the outside world and other machines.
Every credential is stored **only on this machine** (`config/connectors.json`,
gitignored) and is sent **only to that provider's own API** — never to us, never logged.

## Real connectors
Each connector makes genuine API calls with your key, and reports honestly when a
key is missing or rejected (the error comes straight from the provider).

| Connector | Credential | What works today |
|---|---|---|
| **Stripe** | secret key (`sk_…`) | real balance, customers, charges (`/api/connectors/call` → `balance`/`customers`/`charges`) |
| **Cloudflare** | API token | token verify + list zones + DNS records |
| **Gmail** | OAuth access token (gmail scope) | list + **send** mail (RFC822 via the Gmail REST API) |
| **Google Calendar** | OAuth access token (calendar scope) | list + **create** events |
| **OpenRouter** | API key | optional stronger cloud reasoning brain |
| **Serper** | API key | upgrades web search to high-quality Google results automatically |

**Honest note on Google:** Gmail/Calendar use the official REST APIs and work the
moment you paste a valid OAuth access token — but Google access tokens expire ~1h.
A persistent refresh-token flow (a Google Cloud OAuth client) is the next step for
hands-off, long-lived Gmail/Calendar. Stripe, Cloudflare, OpenRouter and Serper keys
are long-lived and work indefinitely once saved.

**API:** `GET /api/connectors`, `POST /api/connectors/set {id,creds}` (saves + tests),
`POST /api/connectors/test {id}`, `POST /api/connectors/call {id,action,args}`,
`POST /api/connectors/delete {id}`.

## Fleet mesh (OpenClaw-style control-node + workers)
Any ABUZ8 instance already exposes `/health` and `/api/chat` and honors the LAN key,
so **every instance is a worker out of the box**. The Connect view turns this one into
a **control node**:
- **Add worker** by URL (+ optional LAN key), or **+ This machine** for a loopback worker.
- Each node is **pinged live** (real health + latency).
- **Dispatch** a task to a worker → it runs the task on its own brain and returns the
  result, which the control node collects. *Verified: a dispatched task ran on the
  worker's Nemotron brain and returned its answer.*

**API:** `GET /api/mesh/nodes` (with live ping), `POST /api/mesh/add`,
`POST /api/mesh/remove`, `POST /api/mesh/ping`, `POST /api/mesh/dispatch {id,task}`,
`GET /api/mesh/whoami`.

This is the federation layer the LINEAGE doc describes: the S-Class flagship
orchestrates; specialist classes or sibling agents on other machines (Pegasus, a Kali
box, a render rig) take the task they're best at, and the mesh stitches the results.

## MCP servers (Claude Desktop / Desktop Commander)
ABUZ8 ships a real MCP client (line-delimited JSON-RPC over stdio: initialize →
tools/list → tools/call). The Connect view lists registered servers and **imports your
Claude Desktop config** (`claude_desktop_config.json`) in one click — so Desktop
Commander and any other MCP server you already run in Claude Desktop become available
to ABUZ8. (`/api/mcp/servers`, `/api/mcp/import/claude-desktop`, `/api/mcp/call`.)

## Secure local account
Optional sign-in: a username + password hashed with **scrypt** (random salt,
constant-time compare), stored only on this machine. Used to gate secret changes and
LAN access. It never phones home. (`/api/account/status|setup|login`.)

## Wake word — "Abuu" (always-listening, like Siri)
Toggle **📢 "Abuu"** in the chat bar. A low-overhead voice-activity loop listens only
when it hears speech, runs a short **offline Whisper** transcription, and when it hears
the wake word ("Abuu") it greets you and opens the hands-free conversation. It steps
aside while you're already talking, and resumes after. 100% offline — the same local
Whisper/Piper stack as the in-chat voice.

**Honest note:** with no dedicated keyword-spotting model, it transcribes each spoken
phrase to detect the word, so it's heavier than a hardware wake-word chip — but it's
real, private, and offline. On a weak CPU expect a ~1s detection latency.
