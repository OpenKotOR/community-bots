# Trask Bot

Trask Ulgo is the guild's KOTOR q&a bot. His job is to answer questions clearly, stay useful for
non-technical users, and support his claims with visible citations without dumping backend search
mechanics into the conversation.

## Persona

Trask answers like a competent officer briefing a junior crew member. He states the most important
thing first, provides relevant citations, and flags when information is uncertain. He does not pad
answers with filler text, does not pretend to know things he cannot cite, and avoids genericisms
("interesting question", "great point").

Key voice notes:
- Concise and action-oriented.
- Caveats uncertain information explicitly ("I do not have a cached result for this yet").
- Prefers two sentences over a paragraph when the answer fits.
- References source names naturally ("Per the Deadly Stream index, …").

## Commands

### `/ask`

Ask a KOTOR question and get a source-backed answer.

**Options:**
| Option | Required | Description |
|---|---|---|
| `query` | yes | Question or topic (max 200 characters) |

**Behavior:**
- Sends the question to the configured `ai-researchwizard` backend.
- Restricts research to Trask's approved source list.
- Returns a short Discord-friendly answer with inline numeric citations and a compact `Sources`
  bibliography section.
- Does not explain retrieval internals unless the user explicitly asks.

**Example:**
```
/ask query:mdlops model formats
```

Returns a direct answer supported by approved sources such as MDLOps, KOTOR Neocities, PyKotor,
Deadly Stream, and related KOTOR references.

---

### `/sources`

Inspect the currently approved source policy. This is an admin-facing command.

**Options:**
| Option | Required | Description |
|---|---|---|
| `kind` | no | Filter by type: `website`, `github`, or `discord` |

**Behavior:**
Returns up to ten sources per call. Shows source name, description, and freshness policy.

---

### `/queue-reindex`

Queue a source refresh request. Requires **Manage Guild** permission.

**Options:**
| Option | Required | Description |
|---|---|---|
| `source` | no | Source ID to refresh, or leave blank for all sources |

**Behavior:**
- Currently operates in stub mode — logs the request and records the queued source IDs.
- In the next phase this will dispatch a real crawl/embed job to the ingest worker.

---

## Approved Source Catalog

Trask's answer generation is pinned to these approved sources by default:

| ID | Name | Kind | Notes |
|---|---|---|---|
| `deadlystream` | Deadly Stream | website | Primary KOTOR modding hub |
| `lucasforums-archive` | LucasForums Archive | website | Historical forum archive |
| `pcgamingwiki-kotor` | PCGamingWiki | website | PC compatibility and fixes |
| `kotor-neocities` | KOTOR Neocities | website | Community technical docs |
| `pykotor-wiki` | PyKotor Wiki | website | PyKotor scripting reference |
| `reone-repo` | reone | github | Open engine reimplementation |
| `northernlights-repo` | Northern Lights | github | Engine and tooling work |
| `mdlops-repo` | MDLOps | github | Model conversion tooling |
| `pykotor-repo` | PyKotor | github | Python KOTOR library |
| `kotorjs-repo` | kotor.js | github | JS KOTOR tooling |
| `approved-discord-knowledge` | Approved Discord | discord | Opt-in guild channel index |

## Admin Setup

The following environment variables control Trask's scope:

| Variable | Purpose |
|---|---|
| `TRASK_ALLOWED_GUILD_IDS` | Comma-separated guild IDs where Trask is active |
| `TRASK_APPROVED_CHANNEL_IDS` | Comma-separated channel IDs where `/ask` is allowed |

When `TRASK_APPROVED_CHANNEL_IDS` is set, Trask only answers `/ask` in those channels. It does not
perform blanket server-history reads.

## Current Limitations

- Trask depends on a reachable `ai-researchwizard` backend for `/ask`.
- The vendored backend defaults to a report-oriented workflow, so prompt and formatting controls
  still need refinement to keep replies concise under Discord limits.
- The ingest worker remains separate from the new q&a path. `/queue-reindex` is operational rather
  than part of the normal assistant experience.
- `TRASK_APPROVED_CHANNEL_IDS` only restricts where `/ask` may be used. Trask's current runtime is
  slash-command-only and does not require privileged message intents.

## Next Phase

- Tighten the adapter contract with `ai-researchwizard` so Trask can parse structured citations
  instead of formatting plain report text.
- Add a direct-vendored fallback path for environments that do not want a separate sidecar process.
- Decide whether Discord-channel indexing remains part of Trask's future evidence set or stays as
  maintainer-only infrastructure.
