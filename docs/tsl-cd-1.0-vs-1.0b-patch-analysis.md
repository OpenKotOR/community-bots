# TSL CD EXE Diff: 1.0 vs 1.0b

## Executive Summary

I compared the imported Ghidra program files for:

- `/TSL/k2_win_CD_1.0_swkotor2.exe`
- `/TSL/k2_win_CD_1.0b_swkotor2.exe`

The result is unexpectedly narrow:

- There are exactly **7 differing bytes** in the entire raw file.
- Those 7 bytes are at **file offset `0xAA4`**.
- The differing bytes live inside the **PE header area**, not inside executable code, game data, resources, or any file overlay.
- The 1.0 executable contains the ASCII string **`CARBON!`** at that location.
- The 1.0b executable replaces those 7 bytes with **all zeroes**.
- There are **no differences at all** in:
  - `.text` (code)
  - `.rdata` (read-only data)
  - `.data` (writable globals)
  - `.rsrc` (resources)
  - raw bytes outside the mapped sections

## Bottom Line

For these exact two imported executables, **1.0b does not add new gameplay logic, bug-fix logic, UI logic, scripting logic, or resources over 1.0**.

The only observed change is that **an unreferenced header-padding string was cleared**.

In plain English: the game code is the same. The patch, as represented by these two binaries, only removes a tiny text marker in unused header space.

## Exact Binary Difference

### Diff Location

- Image base: `0x00400000`
- Differing virtual address: `0x00400AA4`
- Differing file offset: `0x00000AA4`
- Differing byte count: `7`

### 1.0 bytes

At `0x00400AA4` / file offset `0xAA4`, version 1.0 contains:

```text
43 41 52 42 4F 4E 21
```

ASCII:

```text
CARBON!
```

### 1.0b bytes

At the same location, version 1.0b contains:

```text
00 00 00 00 00 00 00
```

### Therefore

The full raw-file delta is:

```text
1.0  : 43 41 52 42 4F 4E 21   ("CARBON!")
1.0b : 00 00 00 00 00 00 00
```

## Why This Does Not Change Runtime Behavior

### 1. The change is in header padding

The PE header reports:

- `SizeOfHeaders = 0xC00`
- First section raw data (`.text`) begins at `0xC00`

The changed bytes are at `0xAA4`, which is:

- still inside the header region
- before the first code section
- not part of `.text`
- not part of `.rdata`
- not part of `.data`
- not part of `.rsrc`

So the change is in unused or non-executed header-space padding, not live code or content.

### 2. No code references point to it

There are **zero references** to `0x00400AA4` in the 1.0 program.

That means the executable does not read or branch on this location during normal operation.

### 3. No code bytes differ anywhere

The `.text` section, which contains the executable machine code, is byte-for-byte identical between the two programs.

That rules out:

- new instructions
- removed instructions
- changed control flow
- bug-fix branches
- altered function calls
- patched game logic

### 4. No data or resources differ either

The read-only data, writable data, and resource sections are also identical.

That rules out:

- changed strings used by the game
- changed tables
- changed global defaults
- changed dialogs or UI resources inside the EXE
- changed icons/version resources in `.rsrc`

## What Was Added by 1.0b Over 1.0?

Strictly speaking, for these two exact binaries, **nothing was added**.

Instead, one small marker was **removed/zeroed**:

- 1.0 had `CARBON!`
- 1.0b has zero bytes in the same spot

So the observed transformation is subtraction/cleanup, not addition.

## Non-Technical Explanation

Think of the executable like a big binder:

- the front pages are the header
- the important chapters are the real game code and data

In this comparison, the important chapters are completely unchanged.

The only difference is that on one front page margin, version 1.0 has a tiny stamp that says `CARBON!`, and version 1.0b has that stamp erased.

Nothing in the actual instructions for how the game runs was changed.

So if you ask, "What does 1.0b do differently here?", the answer is:

> It does not behave differently. It only removes a stray text marker in unused header space.

## Technical Method

The comparison was performed directly inside the shared Ghidra Odyssey project by opening both program databases and comparing:

- all mapped memory blocks byte-for-byte
- all original imported file bytes byte-for-byte
- the exact changed range
- references to the changed address
- the PE header layout around the changed file offset

### Comparison results

- Total raw-file differences: `7` bytes
- Diff ranges: one contiguous range
  - `0xAA4` to `0xAAA`
- Section differences:
  - `Headers`: 7 bytes differ
  - `.text`: 0 bytes differ
  - `.rdata`: 0 bytes differ
  - `.data`: 0 bytes differ
  - `.rsrc`: 0 bytes differ
  - overlay/raw remainder: 0 bytes differ

## Ghidra Documentation Added

The following annotations were added in the shared project so the discrepancy is documented in-place:

### `/TSL/k2_win_CD_1.0_swkotor2.exe`

- Label at `0x00400AA4`:
  - `PATCH_DIFF_HEADER_CARBON_MARKER_1_0`
- Plate comment explaining that `CARBON!` is the only byte-level difference vs 1.0b
- Analysis bookmark in category `PatchDiff`

### `/TSL/k2_win_CD_1.0b_swkotor2.exe`

- Label at `0x00400AA4`:
  - `PATCH_DIFF_HEADER_ZEROED_CARBON_MARKER_1_0B`
- Plate comment explaining that 1.0b zeroes the `CARBON!` marker found in 1.0
- Analysis bookmark in category `PatchDiff`

## Interpretation Caveat

This report answers a very specific question:

> What is the exact binary difference between these two imported program files?

For that question, the answer is complete: the binaries are functionally identical except for one unreferenced 7-byte header marker.

If some historical source claims that a retail "1.0b patch" changed gameplay or fixed engine bugs, then one of the following would have to be true:

- these exact imported binaries are not the historically distinct pair people usually mean
- the meaningful patch content lived outside this EXE
- the historical claim refers to another distribution build

But for the two files compared here, there is no hidden code patch waiting elsewhere in the executable.