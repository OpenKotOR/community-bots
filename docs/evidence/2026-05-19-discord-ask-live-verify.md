# Discord /ask live verify

Generated: 2026-06-03T18:40:01.835Z

Queries: 5 (expert verification set; URL reachability enforced)
Passed: 5/5

## When a KotOR mod ships 2DA and TLK changes, what does TSLPatcher automate that manual file copying cannot?

PASS

```
TSLPatcher on GitHub The TSLPatcher project documents how mod authors ship list-driven 2DA, GFF, and TLK changes for KotOR and TSL installs. [1](https://github.com/th3w1zard1/TSLPatcher/blob/85c4d0416fb5b38fea7caf046212789f4e93dd68/README.md#L1)
TSLPatcher is a mod installation tool for Knights of the Old Republic and The Sith Lords. It applies 2DA, GFF, and TLK patches from list files so players do not copy files by hand. [2](https://deadlystream.com/files/file/1982-tslpatcher)
```

Footer: `12 passages · indexer 8787`

## For a custom MDL exported from Blender, which MDLOps workflow step turns it back into game-ready KotOR models?

PASS

```
MDLOps converts KotOR MDL and MDX models for editing in 3ds Max or Blender pipelines and exports them back to game-ready formats. [1](https://deadlystream.com/files/file/1198-mdlops)
kotorblender Work with Odyssey engine game models in Blender. This plugin is based on the venerable neverblender plugin, forked from version 1.23a. [2](https://github.com/ndixUR/kotorblender/blob/f713407923bd76a4585bf93d5a2df2e7e7daee45/README.md#L1)
```

Footer: `12 passages · indexer 8787`

## On Windows 10, KOTOR HUD is stretched after a widescreen patch — which ini or aspect settings should I verify first?

PASS

```
Widescreen support When the HUD or menus look stretched after a widescreen patch, verify aspect ratio settings and the game's resolution entries in the graphics configuration on Windows. [1](https://deadlystream.com/files/file/1252-widescreen-support)
KOTOR widescreen resolutions Widescreen support adjusts aspect ratio and HUD layout on PC. Resolution issues usually trace to the graphics ini, aspect patch, and matching desktop resolution. [2](https://deadlystream.com/files/file/1313-kotor-widescreen-resolutions)
```

Footer: `12 passages · indexer 8787`

## Before modding on Windows, where does Knights of the Old Republic store save games per user profile?

PASS

```
KOTOR save game location Knights of the Old Republic save games on Windows are stored under the active user profile, typically in Documents in a KOTOR Saves folder. [1](https://deadlystream.com/topic/5844-kotor-save-game-location)
Save file paths KOTOR save files on Windows live under the current user's Documents folder in the game's Saves directory for the active profile. [2](https://steamcommunity.com/sharedfiles/filedetails/?id=128193866)
```

Footer: `6 passages · indexer 8787`

## What runtime and scripting capabilities does the reone Odyssey reimplementation expose for engine research?

PASS

```
reone Odyssey engine The reone project is an open-source reimplementation of the Odyssey engine for KotOR and TSL. It provides runtime, rendering, and scripting surfaces for engine research. [1](https://github.com/seedhartha/reone/blob/d5e8c00cba975d637ef5019549a48ff70992531b/README.md#L1)
reone wiki reone exposes Odyssey runtime and scripting capabilities so researchers can experiment with KotOR and TSL behavior outside the retail executable. [2](https://github.com/seedhartha/reone/wiki)
```

Footer: `11 passages · indexer 8787`

---

## Holocron browser MCP (expert queries, 2026-06-04)

Origin: `http://127.0.0.1:4010` with fresh `?thread=<uuid>` per query; suggestion buttons on cold threads (Submit disabled until a question is chosen).

TopNav verified via CDP: `https://openkotor.com/projects`, `/faq`, `/formats` (no `/#` hash routes).

| Query | Thread suffix | Result |
|-------|---------------|--------|
| TSLPatcher / 2DA+TLK | `...101` | PASS — grounded, citations 1–4 |
| Widescreen / ini settings | `...102` | PASS — Deadly Stream widescreen files |
| MDLOps / Blender workflow | `...103` | PASS — MDLOps + kotorblender cites |
| KOTOR save location (Windows) | `...104` | PASS — save path + https cites |
| reone Odyssey runtime/scripting | `...105` | PASS — reone GitHub cites (9 links) |

Playwright local (prior session + CI): `HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright` — 6/6. PR [#96](https://github.com/OpenKotOR/community-bots/pull/96) Holocron Playwright e2e job green.

Discord live (`pnpm verify:trask-discord`): not re-run — `TRASK_DISCORD_BOT_TOKEN` unset in agent env; import-smoke + prior evidence (5/5) remain authoritative for Discord contract.
