# Pazaak Vendor Parity Ledger

This ledger tracks the implementation merge from `vendor/HoloPazaak` and `vendor/PazaakWorld` into the canonical OpenKotOR Pazaak stack. It is intentionally checklist-shaped so future slices can keep the "do not omit things" requirement visible.

## Canonical Rule Baseline

- [x] Main deck values 1-10 with four copies each.
- [x] Sideboard size 10 and hand size 4.
- [x] First to 3 sets wins the match.
- [x] Win score 20, bust above 20.
- [x] 9-card board auto-win without bust.
- [x] Stand, draw, end-turn, and side-card phases.
- [x] Plus, minus, flip, D/copy-previous, TT/tiebreaker, VV/value-change, F1/Flip 2&4, and F2/Flip 3&6 canonical side-card support.
- [ ] Vendor terminology aliases for PazaakWorld `Yellow` cards and HoloPazaak card enums are documented in UI copy and import adapters.
- [ ] Replay/event log records cover every game action.

## HoloPazaak Feature Coverage

- [x] Opponent profile schema: id, name, description, difficulty tier, stand threshold, tie chance, species, origin, skill level, prizes, sideboard, and phrase pools.
- [x] HoloPazaak opponent roster imported into the engine catalogue.
- [x] HoloPazaak difficulty tiers represented as `novice`, `easy`, `normal`, `hard`, `expert`, and `master`.
- [ ] Five-tier AI strategy behavior is fully mapped into engine advisor profiles.
- [ ] HoloPazaak network protocol message types are represented as engine/shared API types.
- [ ] Side-deck editor behavior is fully represented in the Activity workshop.
- [ ] Sound event model is implemented in the Activity with safe asset fallback.
- [ ] Per-opponent local practice stats are migrated to shared engine/backend records.

## PazaakWorld Feature Coverage

- [x] PazaakWorld AI tiers remain compatible through `easy`, `hard`, and `professional` advisor mappings.
- [ ] PazaakWorld game log shape is superseded by canonical engine replay/event logs.
- [ ] Matchmaking MMR tolerance and average wait-time behavior is implemented server-side.
- [ ] Lobby ready state, AI fill, and websocket broadcasts are complete.
- [ ] Activity lobby/matchmaking UI reflects all backend metadata.
- [ ] Chat/emote messages are available in lobby and match websockets.
- [ ] Persistence records cover match history, replay summaries, settings, stats, and achievements.

## Activity Integration

- [x] Local opponent data is sourced from the engine catalogue instead of an Activity-only copy.
- [ ] Local practice uses the engine coordinator for rule parity with online play.
- [ ] Opponent browser exposes full catalogue metadata and phrase previews.
- [ ] Game board renders replay/log, chat/emotes, phrase reactions, AI takeover notices, and improved timers.
- [ ] Sideboard Workshop exposes vendor templates, validation summaries, copy/fork, and imports.

## Compatibility Requirements

- [x] Existing Activity profile IDs that were already exposed locally remain resolvable through aliases where needed.
- [x] Existing `easy`, `hard`, and `professional` Activity difficulty flows continue to work.
- [ ] Existing JSON data migrations cover new replay, stats, settings, and opponent fields.
- [ ] Existing Discord commands continue to use the same public flows while gaining richer data.
# Pazaak Vendor Merge Parity Checklist

This checklist tracks the exhaustive merge from `vendor/HoloPazaak` and `vendor/PazaakWorld` into the canonical TypeScript implementation. The shared engine remains the source of truth when vendor behavior conflicts with binary-backed KOTOR/TSL rules already implemented in this repo.

## Rules And Cards

- [x] Canonical main-deck draw flow: values 1-10, four copies each.
- [x] Canonical sideboard size and per-set hand size.
- [x] Plus, minus, flip, D/copy previous, TT/tiebreaker, VV/value change, Flip 2&4, and Flip 3&6 card types.
- [x] Bust, stand, exact 20, 9-card auto-win, set wins, match wins, and repeated tie guardrails.
- [ ] Formal vendor parity tests for HoloPazaak `PazaakGame` and PazaakWorld `PazaakGame` edge cases.
- [ ] Public aliases for PazaakWorld yellow-special terminology.

## AI And Advisor

- [x] PazaakWorld-style `easy`, `hard`, and `professional` advisor tiers.
- [x] Shared advisor snapshots with confidence, category, bust risk, and alternatives.
- [x] HoloPazaak-style opponent difficulty taxonomy captured as `novice`, `easy`, `normal`, `hard`, `expert`, and `master`.
- [ ] Full HoloPazaak strategy parity for `normal`, `expert`, and `master` decision logic.
- [ ] AI takeover for disconnected players wired through backend match flow.

## Opponents And Decks

- [x] Shared engine opponent catalogue seeded from Activity local opponents and HoloPazaak metadata.
- [x] Opponent phrase pools, sideboard tokens, stand thresholds, tie chances, skill levels, species, origin, archetype, and prize metadata represented in TypeScript.
- [x] Activity local practice reads opponent data from the shared engine catalogue.
- [x] Backend endpoint for the shared opponent catalogue.
- [ ] Per-opponent online and local stats persisted outside browser-local practice storage.

## Sideboards

- [x] Named Activity sideboard workshop backed by bot API.
- [x] Drag/drop reorder and active sideboard switching in Activity.
- [ ] Engine-owned sideboard template library generated from vendor opponent decks and canonical TSL rows.
- [ ] Shared validation summaries for Activity, bot commands, and backend APIs.

## Multiplayer, Lobbies, And Matchmaking

- [x] Existing Activity matchmaking queue, lobbies, ready state, AI fill, and WebSocket match updates.
- [ ] PazaakWorld MMR tolerance matching and real average wait calculations.
- [ ] Lobby chat and emote broadcasts.
- [ ] Reconnect/AI takeover lifecycle from PazaakWorld/HoloPazaak protocol concepts.

## Event Logs, Replays, And Spectating

- [x] Discord-side live spectator mirrors.
- [ ] Engine event-log schema for draw, play, stand, end-turn, bust, round end, match end, forfeit, disconnect, AI takeover, chat, and emote events.
- [ ] Replay serialization and Activity replay viewer.
- [ ] Backend match-log and replay retrieval endpoints.

## Audio And Feedback

- [ ] Activity sound-event API based on HoloPazaak `SoundManager` event names.
- [ ] License review before copying any vendor audio assets.
- [ ] Graceful silent fallback when audio assets are unavailable.

## Persistence, Stats, And Settings

- [x] JSON-backed wallets, accounts, lobbies, sideboards, matchmaking queue, settings, and match history.
- [x] Browser-local practice stats by opponent.
- [ ] JSON repositories for replay/event logs and richer per-opponent stats.
- [ ] Migration smoke tests for existing live JSON data shapes.

## UI Surfaces

- [x] Activity mode selection, matchmaking, lobby, live board, local practice, and sideboard workshop.
- [x] Opponent browser with shared catalogue metadata.
- [ ] Match log, replay controls, chat/emote panel, audio/settings controls, and richer post-match stats.
- [ ] Mobile/desktop Playwright checks for the expanded Activity surfaces.

## Source References

- HoloPazaak rules: `vendor/HoloPazaak/src/holopazaak/game/engine.py`
- HoloPazaak cards: `vendor/HoloPazaak/src/holopazaak/game/card.py`
- HoloPazaak players/stats: `vendor/HoloPazaak/src/holopazaak/game/player.py`
- HoloPazaak AI: `vendor/HoloPazaak/src/holopazaak/ai/strategies.py`
- HoloPazaak opponents: `vendor/HoloPazaak/src/holopazaak/data/opponents.py`
- HoloPazaak protocol: `vendor/HoloPazaak/src/holopazaak/network/protocol.py`
- HoloPazaak sideboard UI: `vendor/HoloPazaak/src/holopazaak/ui/sidedeck_dialog.py`
- HoloPazaak sound events: `vendor/HoloPazaak/src/holopazaak/ui/sound.py`
- PazaakWorld schema: `vendor/PazaakWorld/shared/schema.ts`
- PazaakWorld game: `vendor/PazaakWorld/server/game/pazaak.ts`
- PazaakWorld AI: `vendor/PazaakWorld/server/game/ai.ts`
- PazaakWorld matchmaking: `vendor/PazaakWorld/server/game/matchmaking.ts`
- PazaakWorld routes/WebSocket: `vendor/PazaakWorld/server/routes.ts`
- PazaakWorld storage: `vendor/PazaakWorld/server/storage.ts`
- PazaakWorld React board: `vendor/PazaakWorld/client/src/components/GameBoard.tsx`