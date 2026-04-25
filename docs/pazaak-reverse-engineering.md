# Pazaak Reverse Engineering Notes

These notes document the current agdec-http findings against the TSL binary:

- Program: `/TSL/k2_win_gog_aspyr_swkotor2.exe`
- Project context: shared Ghidra server `170.9.241.140:13100/Odyssey`
- Symbol discovery method: `search-symbols query="pazaak"`

## Confirmed Functions

The main pazaak functions discovered through agdec-http are:

| Function | Address | Role |
|---|---|---|
| `CSWGuiPazaakGame` | `0x005512f0` | Pazaak game UI/controller construction |
| `DoGameSequence` | `0x00553f30` | Main pazaak state machine |
| `SetCard` | `0x0054c6b0` | Card type to label/value behavior mapping |
| `LoadInitialSideDeck` | `0x005e3f90` | Loads per-deck side cards from data |
| `AddPazaakCard` | `0x006a39b0` | Adds creature-owned pazaak cards |
| `ExecuteCommandPlayPazaak` | `0x007a3ed0` | Script VM entry point |
| `ExecuteCommandGetLastPazaakResult` | `0x00797be0` | Returns last pazaak result to scripts |

## Binary-Verified Rules

### Win score is 20

`DoGameSequence` contains the set-resolution logic and compares against `0x14`, confirming a target score of 20.

Implementation impact:

- `WIN_SCORE = 20` in the shared engine is correct.

### Board size is 9 and hand size is 4

`CSWGuiPazaakGame` at `0x005512f0` allocates UI collections with `PUSH 0x9` and `PUSH 0x4`, which matches a 9-card board and a 4-card hand.

Implementation impact:

- `MAX_BOARD_SIZE = 9` is correct.
- `HAND_SIZE = 4` is correct.

### TSL special-card dispatch is broader than the current Discord implementation

`SetCard` at `0x0054c6b0` plus helper `FUN_0054cba0` show five special-card branches for types
`0x12` through `0x16`:

- `0x12` uses strings `+1T` and `-1T`, which means the tiebreaker card is sign-selectable in TSL.
- `0x14` maps to `Flip 2&4` via string `0x98fe6c`.
- `0x15` maps to `Flip 3&6` via string `0x98fe68`.
- `0x13` has a fallback label `D` and copies the resolved value of the previous non-empty board card.
- `FUN_005e2e10` writes `0x13` by passing the last occupied board-slot snapshot into `FUN_0054cba0`; there is no safe first-slot fallback in that path, so treating `D` as a zero-value opener is not binary-backed.
- `0x16` renders through the same numeric formatter used for ordinary signed values, but its full player-facing rule is still unresolved.

`LoadInitialSideDeck` at `0x005e3f90` also confirms the TSL deck loader recognizes special code
paths beyond the three already implemented in this repo.

Implementation impact:

- The repo was correct to remove unsupported community-invented card variants like `plus_minus_3_6`.
- The shared engine needed to treat tiebreakers as `±1T`, not fixed `+1`.
- The shared engine should treat `0x13` as the TSL `D` copy card and should not allow `D` to open an empty board.
- The remaining `0x16` TSL special was unresolved at this stage of analysis; see the later section below for the now-resolved `VV` behavior.

### Flip cards do not imply a generic negative-card flip rule

The validated engine behavior is that board-flip specials operate on the targeted board values that are already present. During implementation alignment, the old engine logic was corrected to stop using `Math.abs(boardCard.value)` for `Flip 3&6`.

Implementation impact:

- `Flip 3&6` now targets positive `3` and `6` board values instead of both signs.

### Side decks come from external data, not a hardcoded binary table

`LoadInitialSideDeck` at `0x005e3f90` constructs a resource reference from `0x995658`, which is the string `PazaakDecks`, loads the 2DA, and iterates 10 times to populate the deck.

Implementation impact:

- TSL side-deck composition is data-driven.
- The current Discord implementation can now import the recovered canonical rows that only use fully decoded cards.

### Confirmed TSL deck IDs exist even though the local 2DA rows are still missing

The decompiled TSL script `a_playpazaak.nss` includes a comment block enumerating the deck indices
used by `PazaakDecks.2da`:

| Deck ID | Label |
|---|---|
| `0` | `PlayerDefault_NOTUSED` |
| `1` | `TestAverage_ERASEME` |
| `2` | `TestNightmare_ERASEME` |
| `3` | `SuperDeck_ERASEME` |
| `4` | `DoublesDeck_Testing` |
| `5` | `FlipOneDeck_Testing` |
| `6` | `FlipTwoDeck_Testing` |
| `7` | `TieBreakerDeck_Testing` |
| `8` | `ValueChangeDeck_Testing` |
| `9` | `DeckFromHell_Testing` |
| `10` | `Kotor2_Deck_VeryEasy` |
| `11` | `Kotor2_Deck_Easy` |
| `12` | `Kotor2_Deck_Average` |
| `13` | `Kotor2_Deck_Hard` |
| `14` | `Kotor2_Deck_VeryHard` |

Vanilla script usage confirms at least some of those indices are actually exercised:

- `a_play_pazak.nss` in the Citadel cantina starts Doton Het with deck `10`.
- `a_pazaak_play.nss` in Onderon starts Nikko with deck `2`.
- `a_pato_pazaak.nss` in Khoonda can start with deck `3`, then falls back to a local-number-driven
	deck progression for later matches.
- `k_paz_mebla.nss` and `k_ptar_pazup.nss` still reference deck `1`, which matches the older test deck
	naming that survived into shipped scripts.

The StrategyWiki talk page now includes the recovered `pazaakdecks.2da` rows:

| Deck ID | Label | card0 | card1 | card2 | card3 | card4 | card5 | card6 | card7 | card8 | card9 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `0` | `PlayerDefault_NOTUSED` | `+1` | `+1` | `+2` | `+2` | `+3` | `+3` | `+4` | `+4` | `+5` | `+5` |
| `1` | `TestAverage_ERASEME` | `+3` | `-3` | `+4` | `-4` | `+5` | `-5` | `+5` | `-3` | `+4` | `-5` |
| `2` | `TestNightmare_ERASEME` | `*6` | `+4` | `-4` | `-2` | `+3` | `-2` | `-3` | `+3` | `+2` | `*1` |
| `3` | `SuperDeck_ERASEME` | `*3` | `*3` | `*2` | `*2` | `*4` | `*4` | `*2` | `*2` | `*1` | `*1` |
| `4` | `DoublesDeck_Testing` | `$$` | `$$` | `$$` | `$$` | `$$` | `$$` | `$$` | `$$` | `$$` | `$$` |
| `5` | `FlipOneDeck_Testing` | `F1` | `F1` | `F1` | `F1` | `F1` | `F1` | `F1` | `F1` | `F1` | `F1` |
| `6` | `FlipTwoDeck_Testing` | `F2` | `F2` | `F2` | `F2` | `F2` | `F2` | `F2` | `F2` | `F2` | `F2` |
| `7` | `TieBreakerDeck_Testing` | `TT` | `TT` | `TT` | `TT` | `TT` | `TT` | `TT` | `TT` | `TT` | `TT` |
| `8` | `ValueChangeDeck_Testing` | `VV` | `VV` | `VV` | `VV` | `VV` | `VV` | `VV` | `VV` | `VV` | `VV` |
| `9` | `DeckFromHell_Testing` | `$$` | `$$` | `F1` | `F1` | `F2` | `F2` | `TT` | `TT` | `VV` | `VV` |
| `10` | `Kotor2_Deck_VeryEasy` | `+3` | `-3` | `+4` | `-4` | `+5` | `-5` | `+5` | `-3` | `+4` | `-5` |
| `11` | `Kotor2_Deck_Easy` | `+1` | `+2` | `+3` | `+4` | `+5` | `-6` | `-4` | `-3` | `-2` | `-1` |
| `12` | `Kotor2_Deck_Average` | `*1` | `*2` | `+3` | `+4` | `+5` | `+6` | `*5` | `-6` | `*4` | `$$` |
| `13` | `Kotor2_Deck_Hard` | `F1` | `F2` | `*4` | `*6` | `$$` | `TT` | `VV` | `*3` | `*6` | `F1` |
| `14` | `Kotor2_Deck_VeryHard` | `$$` | `$$` | `F1` | `F1` | `F2` | `F2` | `TT` | `TT` | `VV` | `VV` |

Implementation impact:

- We now know the exact canonical `card0` through `card9` rows.
- The shared engine can safely use exact canonical TSL rows `10` through `14` because every token in those decks now maps to implemented behavior.

### Consecutive-tie handling needed a guard

The implementation alignment pass added a five-tie cap to match the observed external reference behavior used for validation during the merge effort.

Implementation impact:

- `MAX_CONSECUTIVE_TIES = 5` is now enforced in the shared engine.

### Resolved `0x16` / `VV` behavior

Known facts:

- `0x13` falls back to a `D` label when no explicit value is present, and `FUN_005e2e10`
	populates its stored value from the previous non-empty board card's resolved value.
- `0x16` is a value-driven special that defaults to magnitude `1` when unset.
- `SetCard` formats `0x16` through the same `%d`-style numeric path used for resolved value cards,
	not through a dedicated label like `D`, `+1T`, `Flip 2&4`, or `Flip 3&6`.
- `FUN_005e3e40` evaluates `0x16` by trying four concrete outcomes in order: `+2`, `+1`, `-1`,
	then `-2`, stopping on the first result that keeps the total at or below 20.
- `FUN_005e38d0`, which calls `FUN_005e3e40`, is part of the AI card-evaluation path: it loops
	over candidate side cards, compares projected totals, and uses the `0x16` helper as one branch in
	that scoring process.
- `FUN_00555cc0` is a player-facing UI handler that toggles the sign flag for sign-selectable cards,
	including `0x16`, and refreshes the board state afterward.
- `FUN_00555dd0` is a player-facing UI handler specific to `0x16`; it toggles the stored magnitude
	between `1` and `2` and then refreshes the board state.
- `FUN_00550ee0` maps `0x16` to its own UI resource ID, while `SetCard` still renders the current
	resolved numeric state rather than a dedicated symbolic label.
- Together, those UI handlers are enough to treat `0x16` as a player-selectable signed `1/2`
	special with four playable outcomes: `+1`, `+2`, `-1`, and `-2`.
- Both are loaded from `PazaakDecks`-driven side-deck data in TSL.

Implementation impact:

- The shared engine can now model `VV` / `0x16` as a selectable `±1/±2` side card.
- Canonical TSL difficulty rows `13` and `14` are no longer blocked on unresolved gameplay semantics.

## agdec-http Status

`mcp_agdec-http_analyze-data-flow` is operational in this session. A forward analysis attempt on `DoGameSequence` returned a decompilation timeout rather than a transport or tool failure.

Practical consequence:

- Symbol lookup, disassembly, and function extraction are usable.
- Large decompilations may need narrower targets or disassembly-first workflows.

---

## CD Binary Analysis: `k2_win_CD_1.0_swkotor2.exe` and `k2_win_CD_1.0b_swkotor2.exe`

These two binaries are the original 2005 Windows CD releases of KotOR2.  Both are present in the
shared Ghidra server Odyssey project at paths `/TSL/k2_win_CD_1.0_swkotor2.exe` and
`/TSL/k2_win_CD_1.0b_swkotor2.exe`.  They were also queued as local pyghidra-mcp imports from
`C:\Users\boden\` — both imports remain in analysis-incomplete status in pyghidra-mcp as of this
session.

### Binary metadata

| Field | CD 1.0 | CD 1.0b |
|---|---|---|
| Internal label | `swkotor21.0.exe` | `swkotor21.0bGOG.exe` |
| GZF file | `k2_win_CD_1.0_swkotor2.exe.gzf` | `k2_win_CD_1.0b_swkotor2.exe.gzf` |
| GZF size (bytes) | 4,825,608 | 4,825,025 |
| GZF size difference | 583 bytes smaller than 1.0b | baseline |
| pyghidra-mcp name | `/k2_win_CD_1.0_swkotor2.exe.gzf-5db138` | `/k2_win_CD_1.0b_swkotor2.exe.gzf-5e3c70` |
| Odyssey path | `/TSL/k2_win_CD_1.0_swkotor2.exe` | `/TSL/k2_win_CD_1.0b_swkotor2.exe` |
| Decompiler status | not directly analyzed this session | decompiler unavailable (launch failure); disassembly only |

The 583-byte size difference between the two GZFs is negligible and consistent with a minimal
patch release.  All function addresses and string addresses documented below are from CD 1.0b
analysis via agdec-http disassembly.  CD 1.0 was not directly analyzed this session because the
agdec-http tools became unavailable before analysis could begin.  Based on the near-identical file
sizes, CD 1.0 is expected to have the same function layout with at most minor address shifts.

### CD 1.0b: memory map

| Section | Start | End | Size | Permissions |
|---|---|---|---|---|
| Headers | `0x00400000` | `0x00400bff` | 3,072 bytes | r-- |
| `.text` | `0x00401000` | `0x007b4fff` | 3,883,008 bytes | r-x |
| `.rdata` | `0x007b5000` | `0x0080b7ff` | 354,304 bytes | r-- |
| `.data` | `0x0080c000` | `0x008ba037` | 712,760 bytes | rw- |
| `.rsrc` | `0x008bb000` | `0x008f19ff` | 223,744 bytes | r-- |
| tdb | `0xffdff000` | `0xffdfffff` | 4,096 bytes | rw- |

Total defined functions in `.text`: **22,806**

### CD 1.0b: string address table (`.rdata`)

All addresses below were located by raw memory scan of the `.rdata` section (`0x7b5000`–`0x80b7ff`)
and confirmed by reading surrounding context bytes.

| Address | String | Context |
|---|---|---|
| `0x007b5718` | `""` | Empty string; used as fallback label for out-of-range card types |
| `0x007b571c` | `"%d"` | `sprintf`-style integer format; used to render VV numeric value and resolved regular-card value |
| `0x007b6060` | `"pazaak"` | Module name entry in the RIMS module name table alongside `"comp"`, `"map"`, `"store"`, `"back"` |
| `0x007b9fe0` | `"0"` | Adjacent to `"FALSE"`, `"TRUE"`, `"1"`, `"false"`, `"true"` — appears in Flip card path when resolved value/flag is non-zero (semantics TBD; see discrepancy note below) |
| `0x007b9fe4` | `"1"` | Boolean-true string; same table as above |
| `0x007cbd2c` | `"D"` | D copy-card fallback label; used when type 0x13 has no prior board card to copy |
| `0x007cc1d0` | `"PCARDS_BACK_P"` | Card-back UI resource name; pushed in the terminal path of `SetCard` |
| `0x007cc230` | (pad) | 4 zero bytes before the PCARDS_POS_P string |
| `0x007cc234` | `"PCARDS_POS_P"` | Card-position UI resource name |
| `0x007cc244` | `"3&6"` | Flip 3&6 label — **abbreviated** vs GOG Aspyr `"Flip 3&6"` |
| `0x007cc248` | `"2&4"` | Flip 2&4 label — **abbreviated** vs GOG Aspyr `"Flip 2&4"` |
| `0x007cc24c` | `"+1T"` | Tiebreaker positive label |
| `0x007cc250` | `"-1T"` | Tiebreaker negative label |
| `0x007cc254` | `"pz_rounds_on"` | Game variable name used in pazaak round-tracking state |
| `0x007cc5f8` | `"pazaakwager_p"` | Wager-screen GUI resource name |
| `0x007cc8c0` | `"pazaakgame_p"` | Game-board GUI resource name |
| `0x007cc9a0` | `"pazaaksetup_p"` | Setup/launch GUI resource name |
| `0x007d222c` | `"PazaakDecks"` | 2DA resource name; referenced by `LoadInitialSideDeck` equivalent |

### CD 1.0b: confirmed function table

Functions below were identified through cross-reference analysis starting from the known string
addresses.  All names shown are Ghidra auto-names (`FUN_*`) because the CD binary has no exported
symbols.  The "GOG Aspyr equiv" column gives the corresponding named function from the
`k2_win_gog_aspyr_swkotor2.exe` analysis.

| CD 1.0b address | CD 1.0b Ghidra name | Size (bytes) | GOG Aspyr equiv | Role |
|---|---|---|---|---|
| `0x006d2c70` | `FUN_006d2c70` | 107 | `FUN_0054cba0` | Resolved-value getter; called by both D-card and VV-card paths in SetCard to read the current numeric state from the card object |
| `0x006d2f90` | `FUN_006d2f90` | 687 | `SetCard` (`0x0054c6b0`) | Card label/value dispatch; special types 0x12–0x16 handled in order; see full dispatch analysis below |
| `0x006d3890` | `FUN_006d3890` | 1,819 | unknown | UpdateCardDisplay; calls SetCard 5 times; called by multiple callers when the board state changes |
| `0x006d4140` | `FUN_006d4140` | 171 | unknown | Caller of UpdateCardDisplay |
| `0x006d4250` | `FUN_006d4250` | 176 | unknown | Caller of UpdateCardDisplay |
| `0x006d4300` | `FUN_006d4300` | 134 | unknown | Caller of UpdateCardDisplay |
| `0x006d4fe0` | `FUN_006d4fe0` | unknown | unknown | Caller of UpdateCardDisplay |
| `0x006d5670` | `FUN_006d5670` | unknown | unknown | Caller of UpdateCardDisplay; contains `CMP EAX, 0x14` (score check) |
| `0x006d58e0` | `FUN_006d58e0` | unknown | unknown | Pazaak wager screen init; references `"pazaakwager_p"`; called by PazaakSetup |
| `0x006d60c0` | `FUN_006d60c0` | unknown | unknown | CardDisplayHelper; calls SetCard twice |
| `0x006d72f0` | `FUN_006d72f0` | unknown | unknown | Caller of UpdateCardDisplay |
| `0x006d7480` | `FUN_006d7480` | unknown | unknown | PazaakGame board screen; references `"pazaakgame_p"` |
| `0x006d8780` | `FUN_006d8780` | unknown | unknown | Caller of PazaakGame board; no direct call-site callers found (likely virtual dispatch or callback) |
| `0x006d89c0` | `FUN_006d89c0` | unknown | unknown | PazaakSetup entry; references `"pazaaksetup_p"`; calls PazaakWager (`0x6d58e0`) and LoadInitialSideDeck (`0x754f60`); called by `FUN_0063eb70` |
| `0x0063eb70` | `FUN_0063eb70` | unknown | unknown | PazaakSetup caller; called by `FUN_0063ecb0` and `FUN_00638f10` |
| `0x0063ecb0` | `FUN_0063ecb0` | unknown | unknown | Called by `FUN_00638f20`; calls `FUN_0063eb70` |
| `0x00638f10` | `FUN_00638f10` | unknown | unknown | Called at `0x5c4924` (outside defined function range); calls `FUN_0063eb70` |
| `0x00638f20` | `FUN_00638f20` | unknown | unknown | Calls both `FUN_0063ecb0` and (indirectly) PazaakSetup |
| `0x00754f60` | `FUN_00754f60` | 285 | `LoadInitialSideDeck` (`0x005e3f90`) | Deck loader; 10-card iteration loop; references `"PazaakDecks"` 2DA; see disassembly analysis below |
| `0x007547d0` | `FUN_007547d0` | unknown | unknown | Contains 3× `CMP reg, 0x14`; adjacent to LoadInitialSideDeck cluster; candidate for AI score-evaluation or DoGameSequence fragment |
| `0x00754bb0` | `FUN_00754bb0` | unknown | unknown | Contains 2× `CMP reg, 0x14` |
| `0x00754d20` | `FUN_00754d20` | unknown | unknown | Contains 2× `CMP reg, 0x14` |
| `0x00754e90` | `FUN_00754e90` | unknown | unknown | Contains 3× `CMP EAX, 0x14` at `0x754ee2`, `0x754ef8`, `0x754f0f`; strong candidate for win-condition checker or score validator |
| `0x00755330` | `FUN_00755330` | unknown | unknown | Contains `CMP EAX, 0x14` |
| `0x007553a0` | `FUN_007553a0` | unknown | unknown | Contains 2× `CMP EBX, 0x14` |
| `0x00755520` | `FUN_00755520` | unknown | unknown | Contains 3× `CMP reg, 0x14` |
| `0x007556f0` | `FUN_007556f0` | unknown | unknown | Contains `CMP EDI, 0x14` |

**Unanalyzed region — likely DoGameSequence:**  Multiple `CMP reg, 0x14` instructions (5 total)
appear at addresses `0x6d6c2a`–`0x6d6d18` which Ghidra does not associate with any defined
function.  This region lies within the `.text` section and in the center of the pazaak function
cluster.  It is the strongest unconfirmed candidate for the `DoGameSequence`-equivalent state
machine.  Exact instructions observed: `CMP EBX, 0x14` at `0x6d6c2a` and `0x6d6c85`, `CMP EAX,
0x14` at `0x6d6c8a` and `0x6d6d13`, `CMP EBX, 0x14` at `0x6d6d18`.

**Functions NOT located this session:** Equivalents of `CSWGuiPazaakGame` (constructor with
PUSH 9 / PUSH 4), `AddPazaakCard`, `ExecuteCommandPlayPazaak`, and
`ExecuteCommandGetLastPazaakResult` were not confirmed in CD 1.0b.  The PUSH-9/PUSH-4 scan
found `FUN_00495fb0` as a match but it is far from the pazaak cluster and is likely a generic
collection class.

### CD 1.0b: full `SetCard` dispatch analysis (`FUN_006d2f90`)

The function is called with three arguments:
- `[EBP+0x8]` / `ESI` — card type integer
- `[EBP+0xc]` — sign flag (0 = positive, non-zero = negative)
- `[EBP+0x10]` / `EDI` — resolved value or state flag

`this` (ECX on entry) is moved to `EBX`; the card text field appears at offset `0x2c0` from `EBX`
(`LEA ECX, [EBX + 0x2c0]` at `0x6d30dc`).  The function stores the three arguments into a local
struct at `[EBX + 0x318]` at the top of the prologue.

**Valid type range:** Negative types and types >= `0x21` (33) jump to the empty-string fallback at
`0x6d31a6`, which pushes `0x7b5718` (`""`) and falls through to the card-text assignment.

**Special types dispatch (types `0x12`–`0x16`):**

First range check:
```
006d2fe0: CMP ESI, 0x12   ; if type < 0x12 → skip to general path at 0x6d30f0
006d2fe3: JL  0x006d30f0
006d2fe9: CMP ESI, 0x17   ; if type >= 0x17 → skip to general path at 0x6d30f0
006d2fec: JGE 0x006d30f0
```

**Type `0x12` (TT — tiebreaker):**
```
006d2ffb: CMP  ESI, 0x12
006d2ffe: MOV  dword ptr [ESP+0xb4], 0x0   ; state slot = 0
006d3009: JNZ  0x006d3034   ; not 0x12 → try 0x13
006d300b: MOV  EAX, [EBP+0xc]   ; load sign flag
006d300e: TEST EAX, EAX
006d3010: LEA  ECX, [ESP+0x10]
006d3014: JZ   0x006d3025   ; sign == 0 → positive
006d3016: PUSH 0x7cc250     ; "-1T"
006d301b: CALL 0x00630d10   ; assign string
006d3020: JMP  0x006d30d7
006d3025: PUSH 0x7cc24c     ; "+1T"
006d302a: CALL 0x00630d10
```
Sign flag 0 → `"+1T"` label; non-zero → `"-1T"` label.  Identical logic to GOG Aspyr.

**Type `0x13` (D — copy card):**
```
006d3034: CMP  ESI, 0x13
006d3037: JNZ  0x006d306a   ; not 0x13 → try 0x14
006d303c: CALL 0x006d2c70   ; FUN_006d2c70: get resolved value from card object
006d3041: TEST EAX, EAX
006d3043: JZ   0x006d305a   ; no prior board card → show "D"
; prior board card present: call value-getter again, format as "%d"
006d3048: CALL 0x006d2c70
006d304d: PUSH EAX          ; numeric value
006d304e: PUSH 0x7b571c     ; "%d"
006d3053: LEA  EDX, [ESP+0x18]
006d3057: PUSH EDX
006d3058: JMP  0x006d30cc   ; sprintf path
; fallback:
006d305a: PUSH 0x7cbd2c     ; "D"
006d305f: CALL 0x00630d10
```
When `FUN_006d2c70` returns 0 (no prior board card), the `"D"` literal is displayed.  When it
returns non-zero, the resolved numeric value is formatted via `"%d"` and the result is assigned to
the card label.  This is identical to the GOG Aspyr binary-verified rule: `D` cannot be used
as an opener on an empty board because there is no value to copy.

**Type `0x14` (Flip 2&4 — abbreviated to `"2&4"` in CD):**
```
006d306a: CMP  ESI, 0x14
006d306d: JNZ  0x006d308f   ; not 0x14 → try 0x15
006d306f: TEST EDI, EDI     ; test resolved-value/state flag
006d3071: LEA  ECX, [ESP+0x10]
006d3075: JZ   0x006d3083   ; flag == 0 → show "2&4" label
006d3077: PUSH 0x7b9fe0     ; "0" — flag != 0 path (see discrepancy note)
006d307c: CALL 0x00630d10
006d3081: JMP  0x006d30d7
006d3083: PUSH 0x7cc248     ; "2&4"
006d3088: CALL 0x00630d10
```

**Type `0x15` (Flip 3&6 — abbreviated to `"3&6"` in CD):**
```
006d308f: CMP  ESI, 0x15
006d3092: JNZ  0x006d30b4   ; not 0x15 → try 0x16
006d3094: TEST EDI, EDI
006d3096: LEA  ECX, [ESP+0x10]
006d309a: JZ   0x006d30a8   ; flag == 0 → show "3&6" label
006d309c: PUSH 0x7b9fe0     ; "0" — flag != 0 path (same as 0x14)
006d30a1: CALL 0x00630d10
006d30a6: JMP  0x006d30d7
006d30a8: PUSH 0x7cc244     ; "3&6"
006d30ad: CALL 0x00630d10
```

**Type `0x16` (VV — value-change card):**
```
006d30b4: CMP  ESI, 0x16
006d30b7: JNZ  0x006d30d7   ; not 0x16 → fall through to general
006d30bc: CALL 0x006d2c70   ; get current numeric value
006d30c1: PUSH EAX          ; numeric value
006d30c2: PUSH 0x7b571c     ; "%d"
006d30c7: LEA  EAX, [ESP+0x18]
006d30cb: PUSH EAX
006d30cc: CALL 0x006306c0   ; sprintf: format value as "%d"
```
VV always formats the current value as an integer via `"%d"` — identical to the GOG Aspyr finding.
No dedicated label string exists for this type.

**General card path (types `0x00`–`0x11` and `0x17`–`0x20` with `EDI != 0`):**
```
006d30f0: TEST EDI, EDI
006d30f2: JZ   0x006d3134   ; no resolved value → use range-keyed table
; resolved value present → format as "%d"
006d30f8: CALL 0x005ff130   ; string init
006d30fd: PUSH EDI          ; resolved value
006d3102: PUSH 0x7b571c     ; "%d"
006d3108: MOV  dword ptr [ESP+0xc0], 0x1   ; state slot = 1
006d3113: CALL 0x006306c0   ; sprintf
```

**General card path with label table (range `0x0c`–`0x11`):**
```
006d3134: CMP  ESI, 0xc
006d3137: JL   0x006d3183   ; below 0x0c → fallback table
006d3139: CMP  ESI, 0x12
006d313c: JGE  0x006d3183   ; above 0x11 → fallback table
; in range 0x0c-0x11:
006d3142: MOV  ECX, dword ptr [ESI*4 + 0x826f68]  ; positive label table
; or:
006d3165: MOV  EAX, dword ptr [ESI*4 + 0x826f50]  ; negative label table
```
Label lookup tables for regular numeric cards (12 possible sub-types, split into positive/negative
by the sign flag): pointer tables in `.data` at `0x826f50` (negative) and `0x826f68` (positive).
A third table at `0x826f80` covers the fallback range outside `0x0c`–`0x11`.

**Terminal path — card-back texture assignment:**
```
006d3260: PUSH 0x7cc1d0     ; "PCARDS_BACK_P"
006d3265: LEA  ECX, [ESP+0x9c]
006d326d: LEA  ECX, [ESP+0x20]
006d3271: CALL 0x00406350   ; string assignment
; then:
006d327d: LEA  ECX, [EBX+0x84]
006d3283: CALL 0x004143d0   ; assign card label to object at EBX+0x84
```
After the label string is built, the function assigns `"PCARDS_BACK_P"` (card back resource) and
then stores the formatted label into the card object at offset `0x84`.

**Jump table at `0x6d32a0`:** Indexed by `byte ptr [ESI + 0x6d32b8]`, covers the outer loop over
card type values after the special dispatch.  This is the card-display iteration table, not a
secondary card-type dispatch.

### CD 1.0b: `LoadInitialSideDeck` disassembly analysis (`FUN_00754f60`)

**Function signature (inferred):** `void LoadInitialSideDeck(int deckId, CardSlot* outDeck)`
- `[EBP+0x8]` = deck row index (signed integer)
- `[EBP+0xc]` = pointer to output card-slot array

**Key operations:**

1. **Load `PazaakDecks` 2DA:**
	```
	00754f8d: PUSH 0x7d222c     ; "PazaakDecks"
	00754f92: CALL 0x00406e90   ; CExoResMan_GetResource (loads 2DA by name)
	```
   
2. **Validate the 2DA loaded successfully:**
	```
	00754fad: TEST EAX, EAX
	00754faf: JZ   0x0075508e   ; if null → exit immediately (deck not loaded)
	```

3. **Random deck selection when deckId < 0:**
	```
	00754fbe: CMP  dword ptr [EBP+0x8], EDI  ; compare deckId against 0
	00754fc6: JGE  0x00754fd7                ; deckId >= 0 → use as-is
	00754fcc: MOV  ESI, dword ptr [ESP+0x3c] ; load row count from 2DA
	00754fd1: CALL 0x0076f697               ; _rand()
	00754fd2: CDQ
	00754fd4: IDIV ESI                       ; rand % rowCount
	00754fd7: MOV  dword ptr [EBP+0x8], EDX ; store remainder as deckId
	```
	When the caller passes a negative `deckId`, a random row is selected via `rand() % rowCount`.

4. **10-card iteration loop:**
	```
	00754fe0: MOV  ECX, dword ptr [EBP+0x8]  ; deckId / column index
	00754fe3: LEA  EAX, [ESP+0x10]
	00754fe7: PUSH EAX    ; string buffer
	00754fe8: PUSH EDI    ; column counter (starts at 0)
	00754fe9: PUSH ECX    ; row = deckId
	00754fea: LEA  ECX, [ESP+0x24]  ; 2DA object
	00754fee: CALL 0x0041ddd0       ; C2DA::GetCellValue (reads string cell)
	; ... decode card token ...
	0075506b: CMP  EDI, 0xa         ; EDI = loop counter
	0075506e: MOV  dword ptr [EDX+0x8], EAX  ; store into card slot
	00755071: JL   0x00754fe0       ; if < 10 → next card
	```
	Exactly 10 iterations confirmed (`CMP EDI, 0xa` / `JL`).  Each card slot is 12 bytes
	(`ADD EBX, 0xc` at `0x755068`).  The decoded fields per slot (offsets 0, 4, 8) are written as
	integer DWORD values.

5. **Card token decode — partial observation:**
	```
	0075500a: CALL 0x00630680   ; read next char of token
	0075500f: MOVSX EAX, AL
	00755012: ADD  EAX, -0x24   ; subtract '$' (0x24)
	00755015: CMP  EAX, 0x52    ; if adjusted value > 0x52 ('R') → default case
	00755018: JA   0x0075505e
	0075501a: MOVZX EDX, byte ptr [EAX + 0x7550d0]  ; jump-table index
	00755021: JMP  dword ptr [EDX*4 + 0x7550b4]      ; dispatch on token char
	```
	The second character of each 2DA cell token is read, `'$'` (0x24) is subtracted, and the result
	indexes a compact dispatch table at `0x7550b4` / `0x7550d0`.  This is the card-type parser:
	token characters like `+`, `-`, `*`, `F`, `T`, `V`, `$`, `D` are mapped to card-type integers
	and packed into the output slot.

6. **Exit:**
	```
	0075508e: LEA ECX, [ESP+0x18]
	...
	007550b0: RET 0x8   ; __stdcall-style, cleans 8 bytes (deckId + outDeck pointer)
	```

**Confirmed facts from this analysis:**
- 10 cards loaded per deck (confirmed loop bound `CMP EDI, 0xa`).
- Random deck selection on negative deck ID (consistent with the "default/random" deck behavior).
- `PazaakDecks` 2DA is loaded by name, not hard-coded card data.
- Each parsed card slot is 12 bytes (3 × DWORD fields).
- Jump-table-driven token parser at `0x7550b4` / `0x7550d0`.

### Cross-binary discrepancies

#### Flip card label abbreviation (CD vs GOG Aspyr)

| Binary | Type 0x14 label | Type 0x15 label |
|---|---|---|
| CD 1.0b (`FUN_006d2f90`) | `"2&4"` at `0x7cc248` | `"3&6"` at `0x7cc244` |
| GOG Aspyr (`SetCard` `0x0054c6b0`) | `"Flip 2&4"` at `0x98fe6c` | `"Flip 3&6"` at `0x98fe68` |

The `"Flip "` prefix was added between the CD release and the GOG Aspyr release.  Both strings
correctly identify the same cards.  The engine token names `F1` (Flip 2&4) and `F2` (Flip 3&6)
are unaffected.

#### Flip card display with resolved-value flag (CD only — unresolved)

In the CD 1.0b `SetCard` for types `0x14` and `0x15`, when `EDI` (the third argument) is
non-zero, the function pushes `"0"` (at `0x7b9fe0`) instead of the flip label.  This path does
not appear to have a direct equivalent in the documented GOG Aspyr analysis.  Possible
interpretations:

- `EDI != 0` means the flip has already been applied (the card is spent), so `"0"` represents no
  remaining targets.
- `EDI != 0` encodes a secondary numeric state that is rendered differently in the CD UI.
- The `"0"` string is a stub left from an earlier revision and was removed in the GOG Aspyr build.

This behavior was not fully resolved in this session.  The GOG Aspyr decompiler output for
`SetCard` (`0x0054c6b0`) is required to determine whether the same conditional exists there or
whether it was removed.

#### Card struct offset differences (inferred)

| Binary | Card text field offset | Card label field offset |
|---|---|---|
| CD 1.0b | `0x2c0` from `this` (card label string) | `0x84` from `this` (short label DWORD) |
| GOG Aspyr | not documented this session | `0x318` from `this` (struct initialised in prologue) |

The CD 1.0b `SetCard` prologue initialises a sub-struct at `[EBX + 0x318]` with the three
arguments, then later uses `[EBX + 0x2c0]` for the label string and `[EBX + 0x84]` for the
short label assignment.

### Cross-binary address mapping table

All three confirmed TSL Windows PC binaries with known pazaak function addresses:

| Role | GOG Aspyr address | CD 1.0b address | CD 1.0 address |
|---|---|---|---|
| `CSWGuiPazaakGame` constructor | `0x005512f0` | not confirmed | not confirmed |
| `DoGameSequence` state machine | `0x00553f30` | not confirmed (candidate: `0x6d6c2a` region) | not confirmed |
| `SetCard` label dispatch | `0x0054c6b0` | `0x006d2f90` | not confirmed (expected near `0x6d2f90`) |
| Resolved-value getter helper | `FUN_0054cba0` | `0x006d2c70` | not confirmed |
| UpdateCardDisplay | unknown | `0x006d3890` | not confirmed |
| PazaakWager screen | unknown | `0x006d58e0` | not confirmed |
| PazaakGame board screen | unknown | `0x006d7480` | not confirmed |
| PazaakSetup entry | unknown | `0x006d89c0` | not confirmed |
| PazaakSetup caller | unknown | `0x0063eb70` | not confirmed |
| `LoadInitialSideDeck` | `0x005e3f90` | `0x00754f60` | not confirmed |
| D-card writer | `FUN_005e2e10` | not confirmed | not confirmed |
| VV AI evaluator | `FUN_005e3e40` | not confirmed (candidate: `0x754e90` cluster) | not confirmed |
| AI card evaluator caller | `FUN_005e38d0` | not confirmed | not confirmed |
| Player sign toggle (VV/TT) | `FUN_00555cc0` | not confirmed | not confirmed |
| Player magnitude toggle (VV) | `FUN_00555dd0` | not confirmed | not confirmed |
| VV UI resource ID mapper | `FUN_00550ee0` | not confirmed | not confirmed |
| `AddPazaakCard` | `0x006a39b0` | not confirmed | not confirmed |
| `ExecuteCommandPlayPazaak` | `0x007a3ed0` | not confirmed | not confirmed |
| `ExecuteCommandGetLastPazaakResult` | `0x00797be0` | not confirmed | not confirmed |

**Note on CD 1.0:** The CD 1.0 binary (`swkotor21.0.exe`) is only 583 bytes smaller than CD 1.0b
(`swkotor21.0bGOG.exe`).  Based on this near-identical size and the shared internal code structure,
the function layout is expected to be nearly identical to CD 1.0b with at most minor address
shifts.  Direct analysis of CD 1.0 was blocked this session by agdec-http tool unavailability
after CD 1.0b analysis completed.  Both binaries remain in pyghidra-mcp with
`analysis_complete: false`.

### Function call graph (CD 1.0b confirmed chain)

```
ExecuteCommandPlayPazaak (not found)
  └─ FUN_00638f20 (or similar)
		 └─ FUN_0063ecb0
				└─ FUN_0063eb70
					  └─ FUN_006d89c0  [PazaakSetup: refs "pazaaksetup_p"]
							 ├─ FUN_006d58e0  [PazaakWager: refs "pazaakwager_p"]
							 └─ FUN_00754f60  [LoadInitialSideDeck: loads "PazaakDecks"]
									└─ _rand (0x76f697)  [random deck selection]

FUN_006d8780  [no direct callers — likely vtable/callback]
  └─ FUN_006d7480  [PazaakGame board: refs "pazaakgame_p"]

DoGameSequence (not found — candidate at 0x6d6c2a region)
  └─ FUN_006d3890  [UpdateCardDisplay]
		 └─ FUN_006d2f90  [SetCard: types 0x12-0x16 dispatch]
				└─ FUN_006d2c70  [resolved-value getter / D card helper]
```

## Current Merge Status

The repository is only partially through the original goal of "merge PazaakWorld and the Discord bot into one implementation."

Completed:

- Shared engine extracted to `@openkotor/pazaak-engine`
- Bot and activity both consume the shared engine types
- TSL-driven rule corrections applied for card set, flip behavior, and tie cap

Not yet completed:

- Importing canonical side-deck definitions from a real data source
- Porting or adapting PazaakWorld AI into the shared engine/bot flow
- Full reverse-engineering coverage of every pazaak helper around `DoGameSequence` (CD binaries partially covered above; GOG Aspyr `DoGameSequence` itself still needs a decompilation pass)