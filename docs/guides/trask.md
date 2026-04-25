# Trask — KOTOR Q&A

Trask is the server's KOTOR help bot. Ask it about modding, tools, troubleshooting, or related projects and it will answer directly with citations instead of making you interpret raw search results.

---

## Quick Start

Type **`/ask`** followed by your question. Trask replies in a short Discord-friendly format and includes a compact bibliography.

**Example:**
```
/ask query:how to convert models with mdlops
```

---

## Commands

### `/ask`

Search for KOTOR-related resources.

| What to fill in | What it means |
|---|---|
| **query** | Your question or topic (up to 200 characters) |

Trask uses the server's approved KOTOR sources behind the scenes and answers the question directly. By default it does not explain the mechanics of how it gathered the answer. The reply includes inline citation markers and a short `Sources` list.

The response is visible to everyone in the channel.

**Example searches:**
- `/ask query:dialog editor` — Find tools for editing dialog files
- `/ask query:kotor crash fix widescreen` — Find PC compatibility and troubleshooting resources
- `/ask query:nwscript compiling` — Find scripting references
- `/ask query:texture modding` — Find modding resources

### `/sources`

This is an admin-facing policy view rather than a normal user command. It exists so server staff can inspect the approved source list if needed.

---

## What Sources Does Trask Search?

Trask searches a curated list of trusted KOTOR community resources:

### Websites

| Source | What it covers |
|---|---|
| **Deadly Stream** | The main KOTOR modding hub — mods, forums, guides, TSLRCM |
| **LucasForums Archive** | Archived forum discussions from the original KOTOR modding community |
| **PCGamingWiki** | PC compatibility fixes, widescreen patches, troubleshooting |
| **KOTOR Neocities** | Community technical documentation, file format notes, guides |
| **PyKotor Wiki** | PyKotor scripting reference and automation documentation |

### GitHub Repositories

| Source | What it covers |
|---|---|
| **reone** | Open-source KOTOR engine reimplementation |
| **Northern Lights** | Engine, rendering, and tooling work |
| **MDLOps** | Model conversion and asset pipeline tools |
| **PyKotor** | Python library for reading/writing KOTOR file formats |
| **kotor.js** | JavaScript KOTOR tools for browser and web |

### Discord

| Source | What it covers |
|---|---|
| **Approved Discord** | Indexed messages from opt-in server channels (when enabled) |

---

## FAQ

**Trask gave me a "not available here" error. What happened?**
Trask may be restricted to certain channels on this server. Try using the command in a different channel, or ask a server admin which channels Trask works in.

**Why does Trask answer directly instead of showing search results?**
That is intentional. Trask is meant to behave like a helpful assistant, not a search console. It still shows citations so you can check the underlying sources.

**Can I suggest a new source?**
Yes — ask a server admin. Sources are added to the approved list by the people running the server.
