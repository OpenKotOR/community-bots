# Decomp Platform Risk Register

This risk register tracks where the decompilation platform can overclaim, drift, or fail at scale. It complements the runtime contract in `docs/knowledgebase/10-architecture-runtime/decomp-platform-contract.md`.

## False Equivalence Claims

**Risk:** A generated workspace can compile an evidence inventory, but that is not the same as rebuilding the original binary.

**Control:** `compiler-profile-unknown` and `semantic-lift-not-confirmed` remain blocker uncertainties until compiler/linker identity, semantic lift proof, and byte-comparison evidence are present.

**Control:** The workspace writer emits `BLOCKED_REBUILD.md` when blocker uncertainty exists and the generated C target is limited to a static evidence inventory.

**Next improvement:** Add a separate executable rebuild target only after per-function proof objects and compiler-profile evidence remove blocker uncertainty.

## Parser Drift

**Risk:** Internal adapter metadata can leak into public report shapes, creating format-specific API dependencies and making future adapters incompatible.

**Control:** Parser-specific records are normalized into stable `BinarySection`, `BinarySymbol`, `BinaryRelocation`, and `TypeRelationship` evidence objects before report emission.

**Next improvement:** Add schema snapshots for representative PE, ELF, Mach-O, archive, firmware, and unknown inputs.

## Scale Limits

**Risk:** Large binaries, firmware images, static archives, or symbol-heavy C++ applications can produce enormous reports and generated C inventories.

**Control:** Generated C currently caps symbol and relocation rows at 512 each while the manifest preserves the full report. This keeps the compileable inventory bounded without deleting analysis evidence.

**Next improvement:** Add report pagination, artifact chunking, streaming parsers, and workspace manifests that reference evidence shards by content hash.

## Decompilation Drift

**Risk:** Later lifters or source generators may turn weak evidence into plausible but fabricated source code.

**Control:** Source reconstruction must cite evidence IDs for each generated unit. Unknown control flow, calling conventions, data layouts, RTTI, templates, or debug types stay in the uncertainty ledger rather than becoming placeholder logic.

**Next improvement:** Introduce per-function proof objects: bytes covered, CFG hash, relocation references, inferred ABI, type facts, source confidence, and equivalence status.

## Toolchain Misidentification

**Risk:** PE, ELF, and Mach-O containers alone do not prove compiler family, version, flags, linker order, LTO state, or runtime library behavior.

**Control:** Toolchains are `possible` candidates until corroborated by debug producer strings, comments/notes, Rich/PDB/build-id records, runtime imports, section ordering, relocation idioms, and known compiler patterns.

**Next improvement:** Add confidence scoring that requires multiple independent evidence classes before a compiler profile can unblock byte-equivalence claims.

## Format Coverage Gaps

**Risk:** Current PE support includes headers and import-library descriptors but not exports, resources, relocations, Rich/PDB evidence, or packed import recovery. Mach-O support is header-level, ELF support is metadata-level, static archives are not recursively analyzed, and firmware needs external memory maps.

**Control:** Each gap is represented as warning or blocker uncertainty with an explicit recommended action.

**Next improvement:** Implement recursive archive/slice analysis, PE export/resource/relocation and Rich/PDB adapters, Mach-O load-command adapters, ELF note/version/comment adapters, and firmware case metadata ingestion.
