# Decomp Platform Contract

The decompilation platform starts from a proof-first contract: every generated artifact must be traceable to binary evidence, recovered metadata, or an explicitly recorded operator input. It must not emit guessed logic, fake compiler flags, or target-specific shortcuts as if they were recovered source.

Operational risks and failure modes are tracked in `docs/knowledgebase/40-operational-risk/decomp-platform-risk-register.md`.

## Pipeline

1. **Intake** records immutable identity: path, byte length, SHA-256, and detected container format.
2. **Format adapters** parse container facts for PE/COFF, ELF, Mach-O, static archives, and raw firmware-like images. Adapters may add richer evidence, but they must preserve offsets and confidence.
3. **Evidence graph** links sections, symbols, relocations, imports, debug records, RTTI/type facts, string tables, and loader metadata.
4. **Source reconstruction** may emit only evidence-backed units. Until an instruction lifter and data-flow proof exist, generated C/C++ is an inventory or verified stub, not guessed semantics.
5. **Build reconstruction** proposes compiler and linker candidates with confidence and caveats. Unknown compiler profiles block byte-equivalence claims.
6. **Equivalence validation** compares rebuilt output against the original by hash, byte offsets, section layout, relocations, and symbol/layout diffs.

## Current Vertical Slice

`@openkotor/decomp-platform` provides the runtime spine:

- deterministic format detection for PE, ELF, Mach-O, universal Mach-O, static libraries, firmware-like images, and unknown inputs
- bounded PE/ELF/Mach-O/archive metadata extraction
- PE import-directory walking for confirmed import-library dependencies
- an explicit evidence graph for recovered symbols, relocations, and type/calling-convention hints
- ELF `.symtab` / `.dynsym` symbol extraction, relocation-section extraction, `DT_NEEDED` dependency extraction, and DWARF/unwind presence signals
- uncertainty ledger entries for missing compiler profiles, import/load-command expansion, semantic lifting, and layout gaps
- rebuild-plan and equivalence-check generation
- reconstruction workspace generation with `manifest.json`, `recovered_inventory.c`, `CMakeLists.txt`, `UNCERTAINTY.md`, and `VERIFY.md`
- proof-gated workspace writing with path traversal protection and `BLOCKED_REBUILD.md` when byte-equivalent rebuild is not yet justified
- byte-for-byte equivalence reporting
- CLI entrypoint: `decomp-analyze <binary-path> --pretty`
- CLI workspace mode: `decomp-analyze <binary-path> --workspace --pretty`
- CLI write mode: `decomp-analyze <binary-path> --write-workspace <output-dir> --pretty`

## Non-Negotiables

- A blocker uncertainty prevents claims of immediate byte-accurate recompilation.
- Symbol and relocation records are evidence facts, not proof that the corresponding source-level functions or types have been recovered.
- Toolchain candidates are hypotheses until corroborated by debug records, linker signatures, import/runtime evidence, section ordering, and compiler idioms.
- Firmware requires a confirmed memory map, CPU family, reset vector, endianness, and packing scheme before source or linker-script recovery is considered trustworthy.
- Static libraries and universal binaries must be recursively split and analyzed per member or architecture slice.
- Adapters must improve evidence resolution; they must not patch over uncertainty with placeholders.

## Next Architecture Gaps

- PE export/resource/relocation and Rich/PDB evidence adapters
- ELF notes, versioning, `.comment`, GNU property, build-id debug-file discovery, and full relocation-type decoding
- Mach-O load-command, dyld info, Objective-C, Swift, and chained-fixup adapter
- architecture-specific lifter interface with proof objects for control flow, data flow, calling convention, and type recovery
- executable source/lifter integration that only appears after per-function proof objects remove blocker uncertainty
