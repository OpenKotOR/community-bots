import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";

export type BinaryFormat =
  | "pe"
  | "elf"
  | "macho"
  | "fat-macho"
  | "static-library"
  | "firmware-image"
  | "unknown";

export type Confidence = "confirmed" | "probable" | "possible" | "unknown";

export interface BinaryInput {
  readonly path?: string;
  readonly bytes: Uint8Array;
}

export interface BinaryIdentity {
  readonly path?: string;
  readonly format: BinaryFormat;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface BinarySection {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly virtualAddress?: number;
  readonly flags: readonly string[];
  readonly confidence: Confidence;
}

export interface BinaryDependency {
  readonly name: string;
  readonly kind: "import-library" | "shared-object" | "framework" | "archive-member" | "unknown";
  readonly confidence: Confidence;
  readonly evidence: string;
}

export interface BinarySymbol {
  readonly name: string;
  readonly address?: number;
  readonly size?: number;
  readonly binding: "local" | "global" | "weak" | "unknown";
  readonly kind: "function" | "object" | "section" | "file" | "tls" | "import" | "unknown";
  readonly section?: string;
  readonly confidence: Confidence;
  readonly evidence: string;
}

export interface BinaryRelocation {
  readonly offset: number;
  readonly kind: string;
  readonly symbol?: string;
  readonly addend?: bigint;
  readonly confidence: Confidence;
  readonly evidence: string;
}

export interface TypeRelationship {
  readonly subject: string;
  readonly relationship: "rtti" | "debug-type" | "template" | "calling-convention" | "data-layout" | "unknown";
  readonly detail: string;
  readonly confidence: Confidence;
  readonly evidence: string;
}

export interface EvidenceGraph {
  readonly symbols: readonly BinarySymbol[];
  readonly relocations: readonly BinaryRelocation[];
  readonly typeRelationships: readonly TypeRelationship[];
}

export interface ToolchainCandidate {
  readonly name: string;
  readonly confidence: Confidence;
  readonly evidence: readonly string[];
  readonly caveats: readonly string[];
}

export interface Uncertainty {
  readonly id: string;
  readonly severity: "info" | "warning" | "blocker";
  readonly area: string;
  readonly evidence: string;
  readonly impact: string;
  readonly recommendedAction: string;
}

export interface SourceUnitPlan {
  readonly path: string;
  readonly language: "c" | "c++" | "assembly" | "linker-script" | "manifest" | "build";
  readonly purpose: string;
  readonly confidence: Confidence;
  readonly blockedBy: readonly string[];
}

export interface RebuildPlan {
  readonly buildSystem: "cmake" | "make" | "ninja" | "msbuild" | "unknown";
  readonly projectRoot: string;
  readonly sourceUnits: readonly SourceUnitPlan[];
  readonly toolchains: readonly ToolchainCandidate[];
  readonly deterministicInputs: readonly string[];
  readonly requiredExternalArtifacts: readonly string[];
}

export interface EquivalenceCheck {
  readonly name: string;
  readonly command: string;
  readonly purpose: string;
  readonly prerequisites: readonly string[];
}

export interface GeneratedFile {
  readonly path: string;
  readonly purpose: string;
  readonly contents: string;
}

export interface ReconstructionWorkspace {
  readonly root: string;
  readonly files: readonly GeneratedFile[];
  readonly blockedBy: readonly string[];
}

export interface WrittenWorkspace {
  readonly root: string;
  readonly writtenFiles: readonly string[];
  readonly blockedBy: readonly string[];
}

export interface FormatDetails {
  readonly summary: string;
  readonly architecture?: string;
  readonly entryPoint?: number;
  readonly imageBase?: bigint;
  readonly machine?: string;
  readonly bitness?: 32 | 64;
  readonly endianness?: "little" | "big";
  readonly kind?: string;
  readonly sectionCount?: number;
  readonly programHeaderCount?: number;
  readonly timestamp?: number;
}

export interface DecompilationReport {
  readonly identity: BinaryIdentity;
  readonly details: FormatDetails;
  readonly sections: readonly BinarySection[];
  readonly dependencies: readonly BinaryDependency[];
  readonly evidence: EvidenceGraph;
  readonly rebuildPlan: RebuildPlan;
  readonly equivalenceChecks: readonly EquivalenceCheck[];
  readonly uncertainty: readonly Uncertainty[];
}

export interface EquivalenceReport {
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly byteLengthMatches: boolean;
  readonly exactMatch: boolean;
  readonly firstDifferenceOffset?: number;
  readonly differingByteCount?: number;
}

interface ParsedBinary {
  readonly details: FormatDetails;
  readonly sections: readonly BinarySection[];
  readonly dependencies: readonly BinaryDependency[];
  readonly evidence: EvidenceGraph;
  readonly uncertainty: readonly Uncertainty[];
}

interface ElfSectionRecord extends BinarySection {
  readonly index: number;
  readonly type: number;
  readonly link: number;
  readonly entrySize: number;
}

export function analyzeBinary(input: BinaryInput): DecompilationReport {
  const bytes = input.bytes;
  const format = detectBinaryFormat(bytes);
  const identity = buildIdentity(input, format);
  const parsed = parseByFormat(bytes, format);
  const uncertainty = [
    ...parsed.uncertainty,
    ...baselineUncertainty(identity, parsed),
  ];
  const rebuildPlan = buildRebuildPlan(identity, parsed, uncertainty);

  return {
    identity,
    details: parsed.details,
    sections: parsed.sections,
    dependencies: parsed.dependencies,
    evidence: parsed.evidence,
    rebuildPlan,
    equivalenceChecks: buildEquivalenceChecks(identity),
    uncertainty,
  };
}

export function detectBinaryFormat(bytes: Uint8Array): BinaryFormat {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return "elf";
  }
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    return "pe";
  }
  if (bytes.length >= 8 && ascii(bytes.subarray(0, 8)) === "!<arch>\n") {
    return "static-library";
  }
  const magicBe = readU32(bytes, 0, false);
  const magicLe = readU32(bytes, 0, true);
  if (magicBe === 0xcafebabe || magicBe === 0xcafebabf) return "fat-macho";
  if (
    magicLe === 0xfeedface ||
    magicLe === 0xfeedfacf ||
    magicBe === 0xfeedface ||
    magicBe === 0xfeedfacf
  ) {
    return "macho";
  }
  if (looksLikeFirmware(bytes)) return "firmware-image";
  return "unknown";
}

export function compareBinaryEquivalence(expected: Uint8Array, actual: Uint8Array): EquivalenceReport {
  const expectedSha256 = sha256(expected);
  const actualSha256 = sha256(actual);
  const limit = Math.min(expected.length, actual.length);
  let firstDifferenceOffset: number | undefined;
  let differingByteCount = Math.abs(expected.length - actual.length);

  for (let offset = 0; offset < limit; offset += 1) {
    if (expected[offset] !== actual[offset]) {
      firstDifferenceOffset ??= offset;
      differingByteCount += 1;
    }
  }

  const exactMatch = expectedSha256 === actualSha256 && expected.length === actual.length;
  const base = {
    expectedSha256,
    actualSha256,
    byteLengthMatches: expected.length === actual.length,
    exactMatch,
  };

  if (exactMatch) return base;

  return {
    ...base,
    firstDifferenceOffset: firstDifferenceOffset ?? limit,
    differingByteCount,
  };
}

export function generateReconstructionWorkspace(report: DecompilationReport): ReconstructionWorkspace {
  const blockedBy = unique(report.uncertainty.filter((item) => item.severity === "blocker").map((item) => item.id));
  const files: GeneratedFile[] = [
    {
      path: "recovered/manifest.json",
      purpose: "Evidence manifest for reproducible reconstruction.",
      contents: `${JSON.stringify(report, jsonReplacer, 2)}\n`,
    },
    {
      path: "src/recovered_inventory.c",
      purpose: "Compilable C source containing only confirmed binary inventory facts.",
      contents: renderInventoryC(report),
    },
    {
      path: "CMakeLists.txt",
      purpose: "Portable build harness for the evidence inventory source.",
      contents: renderCMake(report),
    },
    {
      path: "UNCERTAINTY.md",
      purpose: "Human-readable uncertainty ledger and blockers.",
      contents: renderUncertaintyMarkdown(report),
    },
    {
      path: "VERIFY.md",
      purpose: "Binary equivalence validation commands and prerequisites.",
      contents: renderVerifyMarkdown(report),
    },
  ];

  if (blockedBy.length > 0) {
    files.push({
      path: "BLOCKED_REBUILD.md",
      purpose: "Proof gate explaining why byte-equivalent rebuild output is not emitted.",
      contents: renderBlockedRebuildMarkdown(report, blockedBy),
    });
  }

  return {
    root: report.rebuildPlan.projectRoot,
    blockedBy,
    files,
  };
}

export async function writeReconstructionWorkspace(
  workspace: ReconstructionWorkspace,
  outputDir: string,
): Promise<WrittenWorkspace> {
  const root = resolve(outputDir);
  const writtenFiles: string[] = [];
  await mkdir(root, { recursive: true });

  for (const file of workspace.files) {
    const relativePath = validateWorkspaceRelativePath(file.path);
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`Generated workspace path escapes output root: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf8");
    writtenFiles.push(relativePath);
  }

  return {
    root,
    writtenFiles,
    blockedBy: workspace.blockedBy,
  };
}


function parseByFormat(bytes: Uint8Array, format: BinaryFormat): ParsedBinary {
  switch (format) {
    case "pe":
      return parsePe(bytes);
    case "elf":
      return parseElf(bytes);
    case "macho":
      return parseMachO(bytes);
    case "fat-macho":
      return parseFatMachO(bytes);
    case "static-library":
      return parseStaticLibrary(bytes);
    case "firmware-image":
      return parseFirmware(bytes);
    case "unknown":
      return unknownParsed("No recognized executable container magic was found.");
  }
}

function parsePe(bytes: Uint8Array): ParsedBinary {
  const peOffset = readU32(bytes, 0x3c, true);
  if (peOffset === undefined || peOffset + 24 > bytes.length || ascii(bytes.subarray(peOffset, peOffset + 4)) !== "PE\0\0") {
    return unknownParsed("MZ header is present but the PE signature or COFF header is not within file bounds.");
  }

  const machine = readU16(bytes, peOffset + 4, true);
  const sectionCount = readU16(bytes, peOffset + 6, true) ?? 0;
  const timestamp = readU32(bytes, peOffset + 8, true);
  const optionalHeaderSize = readU16(bytes, peOffset + 20, true) ?? 0;
  const optionalOffset = peOffset + 24;
  const optionalMagic = readU16(bytes, optionalOffset, true);
  const isPe32Plus = optionalMagic === 0x20b;
  const entryPoint = readU32(bytes, optionalOffset + 16, true);
  const imageBase32 = readU32(bytes, optionalOffset + 28, true);
  const imageBase64 = readU64(bytes, optionalOffset + 24, true);
  const imageBase = isPe32Plus ? imageBase64 : imageBase32 === undefined ? undefined : BigInt(imageBase32);
  const dataDirectoryOffset = optionalOffset + (isPe32Plus ? 112 : 96);
  const importTableRva = readU32(bytes, dataDirectoryOffset + 8, true);
  const importTableSize = readU32(bytes, dataDirectoryOffset + 12, true) ?? 0;
  const sectionOffset = optionalOffset + optionalHeaderSize;
  const sections: BinarySection[] = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * 40;
    if (offset + 40 > bytes.length) break;
    const name = ascii(bytes.subarray(offset, offset + 8)).replace(/\0+$/u, "") || `.section${index}`;
    const virtualSize = readU32(bytes, offset + 8, true) ?? 0;
    const virtualAddress = readU32(bytes, offset + 12, true) ?? 0;
    const rawSize = readU32(bytes, offset + 16, true) ?? 0;
    const rawOffset = readU32(bytes, offset + 20, true) ?? 0;
    const characteristics = readU32(bytes, offset + 36, true) ?? 0;
    sections.push({
      name,
      offset: rawOffset,
      size: rawSize || virtualSize,
      virtualAddress,
      flags: peSectionFlags(characteristics),
      confidence: rawOffset + rawSize <= bytes.length ? "confirmed" : "possible",
    });
  }

  let details: FormatDetails = {
    summary: "Portable Executable image",
    bitness: isPe32Plus ? 64 : 32,
    sectionCount,
  };
  const architecture = peMachineName(machine);
  const machineHex = hex(machine);
  if (architecture !== undefined) details = { ...details, architecture };
  if (machineHex !== undefined) details = { ...details, machine: machineHex };
  if (entryPoint !== undefined) details = { ...details, entryPoint };
  if (imageBase !== undefined) details = { ...details, imageBase };
  const fullDetails = timestamp === undefined ? details : { ...details, timestamp };
  const dependencies = readPeImports(bytes, sections, importTableRva, importTableSize);
  const uncertainty: Uncertainty[] = [];
  if ((importTableRva ?? 0) > 0 && importTableSize > 0 && dependencies.length === 0) {
    uncertainty.push({
      id: "pe-imports-not-resolved",
      severity: "warning",
      area: "dependencies",
      evidence: `PE import data directory points to RVA ${importTableRva} with size ${importTableSize}, but no import descriptors were resolved.`,
      impact: "Rebuild plans cannot yet name required import libraries with confirmed confidence.",
      recommendedAction: "Inspect section RVA mappings, import descriptor bounds, and packed/obfuscated import tables.",
    });
  }

  return {
    details: fullDetails,
    sections,
    dependencies,
    evidence: emptyEvidenceGraph(),
    uncertainty,
  };
}

function parseElf(bytes: Uint8Array): ParsedBinary {
  const elfClass = bytes[4];
  const data = bytes[5];
  const bitness = elfClass === 2 ? 64 : 32;
  const littleEndian = data !== 2;
  const endianness = littleEndian ? "little" : "big";
  const type = readU16(bytes, 16, littleEndian);
  const machine = readU16(bytes, 18, littleEndian);
  const entryPoint = bitness === 64 ? numberFromU64(readU64(bytes, 24, littleEndian)) : readU32(bytes, 24, littleEndian);
  const programHeaderOffset = bitness === 64 ? numberFromU64(readU64(bytes, 32, littleEndian)) : readU32(bytes, 28, littleEndian);
  const sectionHeaderOffset = bitness === 64 ? numberFromU64(readU64(bytes, 40, littleEndian)) : readU32(bytes, 32, littleEndian);
  const programHeaderEntrySize = readU16(bytes, bitness === 64 ? 54 : 42, littleEndian) ?? 0;
  const programHeaderCount = readU16(bytes, bitness === 64 ? 56 : 44, littleEndian) ?? 0;
  const sectionHeaderEntrySize = readU16(bytes, bitness === 64 ? 58 : 46, littleEndian) ?? 0;
  const sectionCount = readU16(bytes, bitness === 64 ? 60 : 48, littleEndian) ?? 0;
  const sectionStringIndex = readU16(bytes, bitness === 64 ? 62 : 50, littleEndian) ?? 0;
  const sections = readElfSections(bytes, bitness, littleEndian, sectionHeaderOffset, sectionHeaderEntrySize, sectionCount, sectionStringIndex);
  const dependencies = readElfNeededLibraries(bytes, sections, bitness, littleEndian);
  const symbols = readElfSymbols(bytes, sections, bitness, littleEndian);
  const relocations = readElfRelocations(bytes, sections, bitness, littleEndian);
  const typeRelationships = readElfTypeRelationships(sections, symbols);

  let details: FormatDetails = {
    summary: "Executable and Linkable Format image",
    bitness,
    endianness,
    sectionCount,
    programHeaderCount,
  };
  const architecture = elfMachineName(machine);
  const machineHex = hex(machine);
  const kind = elfTypeName(type);
  if (architecture !== undefined) details = { ...details, architecture };
  if (machineHex !== undefined) details = { ...details, machine: machineHex };
  if (entryPoint !== undefined) details = { ...details, entryPoint };
  if (kind !== undefined) details = { ...details, kind };

  const uncertainty: Uncertainty[] = [];
  if (programHeaderOffset === undefined || programHeaderEntrySize === 0) {
    uncertainty.push({
      id: "elf-program-headers-unread",
      severity: "warning",
      area: "load-map",
      evidence: "ELF program header offset or entry size is absent.",
      impact: "Loader segment reconstruction is incomplete.",
      recommendedAction: "Recover PT_LOAD mapping before claiming runtime memory equivalence.",
    });
  }
  if (symbols.length === 0) {
    uncertainty.push({
      id: "elf-symbols-unavailable",
      severity: "warning",
      area: "symbols",
      evidence: "No ELF symbol table entries were recovered from .symtab or .dynsym.",
      impact: "Function names, object boundaries, and import/export relationships will depend on later analysis passes.",
      recommendedAction: "Preserve stripped-symbol state and run architecture lifter plus relocation/import recovery.",
    });
  }
  if (!sections.some((section) => section.name === ".debug_info") && !sections.some((section) => section.name === ".zdebug_info")) {
    uncertainty.push({
      id: "debug-types-not-present",
      severity: "warning",
      area: "types",
      evidence: "No DWARF debug-info section was found in the ELF section map.",
      impact: "Type, template, and source-language relationships cannot be recovered from debug metadata.",
      recommendedAction: "Search external debug files, .gnu_debuglink targets, build-id debug packages, or recover types from ABI/data-flow evidence.",
    });
  }

  return { details, sections: publicSections(sections), dependencies, evidence: { symbols, relocations, typeRelationships }, uncertainty };
}

function parseMachO(bytes: Uint8Array): ParsedBinary {
  const magicLe = readU32(bytes, 0, true);
  const is64 = magicLe === 0xfeedfacf;
  const cpuType = readU32(bytes, 4, true);
  const fileType = readU32(bytes, 12, true);
  const commandCount = readU32(bytes, 16, true) ?? 0;
  const commandBytes = readU32(bytes, 20, true) ?? 0;

  return {
    details: buildMachODetails({
      summary: "Mach-O image",
      architecture: machoCpuName(cpuType),
      machine: hex(cpuType),
      bitness: is64 ? 64 : 32,
      endianness: "little",
      kind: machoFileTypeName(fileType),
      sectionCount: commandCount,
    }),
    sections: [{
      name: "__load_commands",
      offset: is64 ? 32 : 28,
      size: commandBytes,
      flags: ["metadata"],
      confidence: (is64 ? 32 : 28) + commandBytes <= bytes.length ? "confirmed" : "possible",
    }],
    dependencies: [],
    evidence: emptyEvidenceGraph(),
    uncertainty: [{
      id: "macho-load-commands-not-expanded",
      severity: "warning",
      area: "linkage",
      evidence: "Mach-O header is parsed but segment, dylib, symbol, and dyld info commands are not expanded in this core pass.",
      impact: "Generated rebuild plans cannot yet model framework linkage, Objective-C metadata, or chained fixups.",
      recommendedAction: "Attach a Mach-O load-command adapter and preserve every command as typed evidence.",
    }],
  };
}

function parseFatMachO(bytes: Uint8Array): ParsedBinary {
  const architectureCount = readU32(bytes, 4, false) ?? 0;
  return {
    details: {
      summary: "Universal Mach-O container",
      kind: `${architectureCount} architecture slice(s)`,
      sectionCount: architectureCount,
    },
    sections: [{
      name: "fat_header",
      offset: 0,
      size: Math.min(bytes.length, 8 + architectureCount * 20),
      flags: ["metadata"],
      confidence: "confirmed",
    }],
    dependencies: [],
    evidence: emptyEvidenceGraph(),
    uncertainty: [{
      id: "fat-macho-slices-not-expanded",
      severity: "blocker",
      area: "multi-architecture",
      evidence: "Universal Mach-O header was detected.",
      impact: "Each architecture slice must be analyzed separately before source, build, or equivalence claims are meaningful.",
      recommendedAction: "Split slices by the fat architecture table and run the same analysis per slice.",
    }],
  };
}

function parseStaticLibrary(bytes: Uint8Array): ParsedBinary {
  const dependencies: BinaryDependency[] = [];
  let offset = 8;
  let memberIndex = 0;
  while (offset + 60 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 60);
    const name = ascii(header.subarray(0, 16)).trim().replace(/\/$/u, "") || `member-${memberIndex}`;
    const sizeText = ascii(header.subarray(48, 58)).trim();
    const size = Number.parseInt(sizeText, 10);
    if (!Number.isFinite(size) || size < 0) break;
    dependencies.push({
      name,
      kind: "archive-member",
      confidence: "confirmed",
      evidence: `ar member header at offset ${offset}`,
    });
    offset += 60 + size + (size % 2);
    memberIndex += 1;
  }

  return {
    details: {
      summary: "Unix ar static library",
      kind: `${dependencies.length} member(s)`,
      sectionCount: dependencies.length,
    },
    sections: [{
      name: "ar_archive",
      offset: 0,
      size: bytes.length,
      flags: ["container"],
      confidence: "confirmed",
    }],
    dependencies,
    evidence: emptyEvidenceGraph(),
    uncertainty: [{
      id: "archive-members-not-recursively-analyzed",
      severity: dependencies.length > 0 ? "warning" : "blocker",
      area: "container",
      evidence: "Static archive member boundaries were detected.",
      impact: "Each object member needs an independent object-file analysis before link equivalence can be claimed.",
      recommendedAction: "Extract members preserving names, offsets, and symbol table records, then analyze recursively.",
    }],
  };
}

function parseFirmware(bytes: Uint8Array): ParsedBinary {
  return {
    details: {
      summary: "Raw firmware-like image",
      kind: "entropy/signature heuristic",
    },
    sections: [{
      name: "raw_image",
      offset: 0,
      size: bytes.length,
      flags: ["opaque"],
      confidence: "possible",
    }],
    dependencies: [],
    evidence: emptyEvidenceGraph(),
    uncertainty: [{
      id: "firmware-layout-unknown",
      severity: "blocker",
      area: "memory-map",
      evidence: "No executable container header was found; firmware classification is heuristic.",
      impact: "No trustworthy source, relocation, interrupt-vector, or linker-script reconstruction can be emitted yet.",
      recommendedAction: "Provide or infer a memory map, CPU family, reset vector, endianness, and image packing scheme.",
    }],
  };
}

function unknownParsed(evidence: string): ParsedBinary {
  return {
    details: { summary: "Unknown binary container" },
    sections: [],
    dependencies: [],
    evidence: emptyEvidenceGraph(),
    uncertainty: [{
      id: "container-format-unknown",
      severity: "blocker",
      area: "intake",
      evidence,
      impact: "The platform cannot make source, linker, or toolchain claims without a confirmed container or memory map.",
      recommendedAction: "Add a format adapter or provide manual case metadata with architecture and load map.",
    }],
  };
}

function buildIdentity(input: BinaryInput, format: BinaryFormat): BinaryIdentity {
  const path = input.path;
  const base = {
    format,
    sizeBytes: input.bytes.length,
    sha256: sha256(input.bytes),
  };
  return path === undefined ? base : { ...base, path };
}

function buildRebuildPlan(identity: BinaryIdentity, parsed: ParsedBinary, uncertainty: readonly Uncertainty[]): RebuildPlan {
  const sourceUnits: SourceUnitPlan[] = [
    {
      path: "recovered/manifest.json",
      language: "manifest",
      purpose: "Machine-readable evidence inventory, hashes, format facts, and uncertainty ledger.",
      confidence: "confirmed",
      blockedBy: [],
    },
    {
      path: "src/recovered_inventory.c",
      language: "c",
      purpose: "Evidence-backed data/section inventory; no guessed control flow is emitted.",
      confidence: parsed.sections.length > 0 ? "probable" : "unknown",
      blockedBy: blockingIds(uncertainty),
    },
    {
      path: "CMakeLists.txt",
      language: "build",
      purpose: "Rebuild harness that only becomes executable after a confirmed compiler/linker profile is selected.",
      confidence: "possible",
      blockedBy: unique(["compiler-profile-unknown", ...blockingIds(uncertainty)]),
    },
  ];

  return {
    buildSystem: chooseBuildSystem(identity.format),
    projectRoot: "reconstruction",
    sourceUnits,
    toolchains: inferToolchains(identity, parsed),
    deterministicInputs: [
      `input.sha256=${identity.sha256}`,
      `input.size=${identity.sizeBytes}`,
      `container.format=${identity.format}`,
    ],
    requiredExternalArtifacts: requiredExternalArtifacts(uncertainty),
  };
}

function buildEquivalenceChecks(identity: BinaryIdentity): EquivalenceCheck[] {
  return [
    {
      name: "whole-file-sha256",
      command: `sha256sum original.bin rebuilt.bin # expected ${identity.sha256}`,
      purpose: "Detect exact byte identity across the complete binary.",
      prerequisites: ["rebuilt.bin exists", "rebuilt output is not stripped or post-processed differently"],
    },
    {
      name: "byte-for-byte-compare",
      command: "cmp -l original.bin rebuilt.bin",
      purpose: "Locate first drift and count byte differences when hashes do not match.",
      prerequisites: ["original.bin and rebuilt.bin are both deterministic outputs"],
    },
  ];
}

function baselineUncertainty(identity: BinaryIdentity, parsed: ParsedBinary): Uncertainty[] {
  const uncertainty: Uncertainty[] = [
    {
      id: "compiler-profile-unknown",
      severity: "blocker",
      area: "toolchain",
      evidence: "No debug producer string, build metadata, or verified compiler signature has been recovered yet.",
      impact: "Immediate recompilation cannot be claimed byte-accurate; compiler version, flags, linker order, and runtime libraries remain open.",
      recommendedAction: "Recover debug records, linker signatures, imports, section ordering, and known compiler idioms before selecting a build profile.",
    },
    {
      id: "semantic-lift-not-confirmed",
      severity: "blocker",
      area: "decompilation",
      evidence: "Core intake only parsed container evidence; no instruction lifter or data-flow proof has been attached.",
      impact: "Human-readable source must be limited to evidence inventory and verified stubs, not guessed logic.",
      recommendedAction: "Attach architecture lifters and require control-flow, type, and relocation evidence before emitting executable functions.",
    },
  ];

  if (parsed.sections.length === 0) {
    uncertainty.push({
      id: "section-map-unavailable",
      severity: "blocker",
      area: "layout",
      evidence: `${identity.format} parsing produced no confirmed sections.`,
      impact: "Project layout, linker script, and section-level equivalence checks cannot be generated.",
      recommendedAction: "Provide a parser adapter or manual load-map metadata for this binary.",
    });
  }

  return uncertainty;
}

function inferToolchains(identity: BinaryIdentity, parsed: ParsedBinary): ToolchainCandidate[] {
  const evidence = [`format=${identity.format}`];
  if (parsed.details.architecture !== undefined) evidence.push(`architecture=${parsed.details.architecture}`);
  if (identity.format === "pe") {
    return [
      {
        name: "MSVC link.exe family",
        confidence: "possible",
        evidence,
        caveats: ["PE/COFF alone does not prove MSVC; MinGW, LLVM lld-link, and custom linkers can emit compatible images."],
      },
      {
        name: "LLVM lld-link / clang-cl",
        confidence: "possible",
        evidence,
        caveats: ["Requires import table, Rich header, PDB/debug, section naming, and runtime-library evidence before promotion."],
      },
    ];
  }
  if (identity.format === "elf") {
    return [
      {
        name: "GCC/binutils",
        confidence: "possible",
        evidence,
        caveats: ["ELF container evidence does not distinguish GCC, Clang, rustc, Zig, Go, or hand-authored assembly."],
      },
      {
        name: "LLVM clang/lld",
        confidence: "possible",
        evidence,
        caveats: ["Needs .comment, notes, relocations, symbol versions, and idiom matching before use."],
      },
    ];
  }
  if (identity.format === "macho" || identity.format === "fat-macho") {
    return [{
      name: "Apple clang/ld64 family",
      confidence: "possible",
      evidence,
      caveats: ["Mach-O evidence must be expanded through load commands, LC_BUILD_VERSION, Objective-C metadata, and dyld info."],
    }];
  }
  return [{
    name: "unknown",
    confidence: "unknown",
    evidence,
    caveats: ["No compiler or linker should be selected until container, architecture, and layout evidence are confirmed."],
  }];
}

function readElfSections(
  bytes: Uint8Array,
  bitness: 32 | 64,
  littleEndian: boolean,
  sectionHeaderOffset: number | undefined,
  entrySize: number,
  count: number,
  stringIndex: number,
): ElfSectionRecord[] {
  if (sectionHeaderOffset === undefined || entrySize === 0 || count === 0) return [];
  const nameOffsets: number[] = [];
  const entries: { offset: number; size: number; address: number; flags: number; type: number; link: number; entrySize: number }[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = sectionHeaderOffset + index * entrySize;
    if (offset + entrySize > bytes.length) break;
    const nameOffset = readU32(bytes, offset, littleEndian) ?? 0;
    const type = readU32(bytes, offset + 4, littleEndian) ?? 0;
    const flags = bitness === 64 ? numberFromU64(readU64(bytes, offset + 8, littleEndian)) ?? 0 : readU32(bytes, offset + 8, littleEndian) ?? 0;
    const address = bitness === 64 ? numberFromU64(readU64(bytes, offset + 16, littleEndian)) ?? 0 : readU32(bytes, offset + 12, littleEndian) ?? 0;
    const fileOffset = bitness === 64 ? numberFromU64(readU64(bytes, offset + 24, littleEndian)) ?? 0 : readU32(bytes, offset + 16, littleEndian) ?? 0;
    const size = bitness === 64 ? numberFromU64(readU64(bytes, offset + 32, littleEndian)) ?? 0 : readU32(bytes, offset + 20, littleEndian) ?? 0;
    const link = readU32(bytes, bitness === 64 ? offset + 40 : offset + 24, littleEndian) ?? 0;
    const sectionEntrySize = bitness === 64 ? numberFromU64(readU64(bytes, offset + 56, littleEndian)) ?? 0 : readU32(bytes, offset + 36, littleEndian) ?? 0;
    nameOffsets.push(nameOffset);
    entries.push({ offset: fileOffset, size, address, flags, type, link, entrySize: sectionEntrySize });
  }

  const stringEntry = entries[stringIndex];
  const stringTable = stringEntry === undefined ? new Uint8Array() : bytes.subarray(stringEntry.offset, stringEntry.offset + stringEntry.size);

  return entries.map((entry, index) => ({
    index,
    name: readCString(stringTable, nameOffsets[index] ?? 0) || `.section${index}`,
    offset: entry.offset,
    size: entry.size,
    virtualAddress: entry.address,
    flags: elfSectionFlags(entry.flags, entry.type),
    confidence: entry.offset + entry.size <= bytes.length ? "confirmed" : "possible",
    type: entry.type,
    link: entry.link,
    entrySize: entry.entrySize,
  }));
}

function readElfSymbols(
  bytes: Uint8Array,
  sections: readonly ElfSectionRecord[],
  bitness: 32 | 64,
  littleEndian: boolean,
): BinarySymbol[] {
  const symbols: BinarySymbol[] = [];
  const symbolSections = sections.filter((section) => section.type === 2 || section.type === 11);
  for (const section of symbolSections) {
    const linkedStrings = sections[section.link];
    if (linkedStrings === undefined) continue;
    const strings = bytes.subarray(linkedStrings.offset, linkedStrings.offset + linkedStrings.size);
    const entrySize = section.entrySize || (bitness === 64 ? 24 : 16);
    for (let offset = section.offset; offset + entrySize <= section.offset + section.size; offset += entrySize) {
      const nameOffset = readU32(bytes, offset, littleEndian) ?? 0;
      const info = bytes[offset + (bitness === 64 ? 4 : 12)] ?? 0;
      const sectionIndex = readU16(bytes, offset + (bitness === 64 ? 6 : 14), littleEndian);
      const value = bitness === 64 ? numberFromU64(readU64(bytes, offset + 8, littleEndian)) : readU32(bytes, offset + 4, littleEndian);
      const size = bitness === 64 ? numberFromU64(readU64(bytes, offset + 16, littleEndian)) : readU32(bytes, offset + 8, littleEndian);
      const name = readCString(strings, nameOffset);
      if (name.length === 0 && value === 0 && size === 0) continue;
      const targetSection = sectionIndex === undefined || sectionIndex >= 0xff00 ? undefined : sections[sectionIndex]?.name;
      const kind = elfSymbolKind(info & 0xf, sectionIndex);
      symbols.push(compactSymbol({
        name: name || `${section.name}:symbol@${offset}`,
        address: value,
        size,
        binding: elfSymbolBinding(info >> 4),
        kind,
        section: targetSection,
        confidence: name.length > 0 ? "confirmed" : "possible",
        evidence: `${section.name} entry at file offset ${offset}`,
      }));
    }
  }
  return symbols;
}

function readElfRelocations(
  bytes: Uint8Array,
  sections: readonly ElfSectionRecord[],
  bitness: 32 | 64,
  littleEndian: boolean,
): BinaryRelocation[] {
  const relocations: BinaryRelocation[] = [];
  const relocationSections = sections.filter((section) => section.type === 4 || section.type === 9);
  for (const section of relocationSections) {
    const hasAddend = section.type === 4;
    const entrySize = section.entrySize || (bitness === 64 ? hasAddend ? 24 : 16 : hasAddend ? 12 : 8);
    for (let offset = section.offset; offset + entrySize <= section.offset + section.size; offset += entrySize) {
      const relocationOffset = bitness === 64 ? numberFromU64(readU64(bytes, offset, littleEndian)) : readU32(bytes, offset, littleEndian);
      const info = bitness === 64 ? readU64(bytes, offset + 8, littleEndian) : toBigInt(readU32(bytes, offset + 4, littleEndian));
      if (relocationOffset === undefined || info === undefined) continue;
      const symbolIndex = bitness === 64 ? Number(info >> 32n) : Number(info >> 8n);
      const relocationType = bitness === 64 ? Number(info & 0xffffffffn) : Number(info & 0xffn);
      const symbol = readElfLinkedSymbolName(bytes, sections, bitness, littleEndian, section.link, symbolIndex);
      const addend = hasAddend
        ? bitness === 64 ? readI64(bytes, offset + 16, littleEndian) : toBigInt(readI32(bytes, offset + 8, littleEndian))
        : undefined;
      relocations.push(compactRelocation({
        offset: relocationOffset,
        kind: `ELF_REL_${relocationType}`,
        symbol,
        addend,
        confidence: "confirmed",
        evidence: `${section.name} entry at file offset ${offset}`,
      }));
    }
  }
  return relocations;
}

function readElfLinkedSymbolName(
  bytes: Uint8Array,
  sections: readonly ElfSectionRecord[],
  bitness: 32 | 64,
  littleEndian: boolean,
  symbolSectionIndex: number,
  symbolIndex: number,
): string | undefined {
  const symbolSection = sections[symbolSectionIndex];
  if (symbolSection === undefined) return undefined;
  const stringSection = sections[symbolSection.link];
  if (stringSection === undefined) return undefined;
  const entrySize = symbolSection.entrySize || (bitness === 64 ? 24 : 16);
  const offset = symbolSection.offset + symbolIndex * entrySize;
  if (offset + entrySize > symbolSection.offset + symbolSection.size) return undefined;
  const nameOffset = readU32(bytes, offset, littleEndian);
  if (nameOffset === undefined) return undefined;
  const strings = bytes.subarray(stringSection.offset, stringSection.offset + stringSection.size);
  const name = readCString(strings, nameOffset);
  return name.length > 0 ? name : undefined;
}

function readElfTypeRelationships(sections: readonly ElfSectionRecord[], symbols: readonly BinarySymbol[]): TypeRelationship[] {
  const relationships: TypeRelationship[] = [];
  for (const section of sections) {
    if (section.name === ".eh_frame" || section.name === ".eh_frame_hdr") {
      relationships.push({
        subject: section.name,
        relationship: "calling-convention",
        detail: "Exception/unwind frame data can constrain stack layout and call-frame recovery.",
        confidence: "probable",
        evidence: `${section.name} section at file offset ${section.offset}`,
      });
    }
    if (section.name === ".debug_info" || section.name === ".zdebug_info") {
      relationships.push({
        subject: section.name,
        relationship: "debug-type",
        detail: "DWARF debug information is present and should be parsed before type or source claims are made.",
        confidence: "confirmed",
        evidence: `${section.name} section at file offset ${section.offset}`,
      });
    }
  }
  for (const symbol of symbols) {
    if (symbol.name.includes("_Z")) {
      relationships.push({
        subject: symbol.name,
        relationship: "template",
        detail: "Mangled C++-style symbol may encode namespace, overload, or template relationships.",
        confidence: "possible",
        evidence: symbol.evidence,
      });
    }
  }
  return relationships;
}

function publicSections(sections: readonly ElfSectionRecord[]): BinarySection[] {
  return sections.map((section) => compactSection({
    name: section.name,
    offset: section.offset,
    size: section.size,
    virtualAddress: section.virtualAddress,
    flags: section.flags,
    confidence: section.confidence,
  }));
}

function compactSection(input: {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly virtualAddress: number | undefined;
  readonly flags: readonly string[];
  readonly confidence: Confidence;
}): BinarySection {
  let section: BinarySection = {
    name: input.name,
    offset: input.offset,
    size: input.size,
    flags: input.flags,
    confidence: input.confidence,
  };
  if (input.virtualAddress !== undefined) section = { ...section, virtualAddress: input.virtualAddress };
  return section;
}

function readElfNeededLibraries(
  bytes: Uint8Array,
  sections: readonly BinarySection[],
  bitness: 32 | 64,
  littleEndian: boolean,
): BinaryDependency[] {
  const dynamic = sections.find((section) => section.name === ".dynamic");
  const dynstr = sections.find((section) => section.name === ".dynstr");
  if (dynamic === undefined || dynstr === undefined) return [];
  const dynstrBytes = bytes.subarray(dynstr.offset, dynstr.offset + dynstr.size);
  const dependencies: BinaryDependency[] = [];
  const entrySize = bitness === 64 ? 16 : 8;
  for (let offset = dynamic.offset; offset + entrySize <= dynamic.offset + dynamic.size; offset += entrySize) {
    const tag = bitness === 64 ? readU64(bytes, offset, littleEndian) : toBigInt(readU32(bytes, offset, littleEndian));
    const value = bitness === 64 ? readU64(bytes, offset + 8, littleEndian) : toBigInt(readU32(bytes, offset + 4, littleEndian));
    if (tag === 0n) break;
    if (tag === 1n && value !== undefined) {
      const name = readCString(dynstrBytes, Number(value));
      if (name.length > 0) {
        dependencies.push({
          name,
          kind: "shared-object",
          confidence: "confirmed",
          evidence: `DT_NEEDED entry at file offset ${offset}`,
        });
      }
    }
  }
  return dependencies;
}

function readPeImports(
  bytes: Uint8Array,
  sections: readonly BinarySection[],
  importTableRva: number | undefined,
  importTableSize: number,
): BinaryDependency[] {
  if (importTableRva === undefined || importTableRva === 0 || importTableSize === 0) return [];
  const start = peRvaToFileOffset(sections, importTableRva);
  if (start === undefined) return [];
  const end = Math.min(bytes.length, start + importTableSize);
  const dependencies: BinaryDependency[] = [];
  const seen = new Set<string>();

  for (let offset = start; offset + 20 <= end; offset += 20) {
    const originalFirstThunk = readU32(bytes, offset, true) ?? 0;
    const timestamp = readU32(bytes, offset + 4, true) ?? 0;
    const forwarderChain = readU32(bytes, offset + 8, true) ?? 0;
    const nameRva = readU32(bytes, offset + 12, true) ?? 0;
    const firstThunk = readU32(bytes, offset + 16, true) ?? 0;
    if (originalFirstThunk === 0 && timestamp === 0 && forwarderChain === 0 && nameRva === 0 && firstThunk === 0) break;
    const nameOffset = peRvaToFileOffset(sections, nameRva);
    if (nameOffset === undefined) continue;
    const name = readCString(bytes, nameOffset);
    if (name.length === 0 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    dependencies.push({
      name,
      kind: "import-library",
      confidence: "confirmed",
      evidence: `IMAGE_IMPORT_DESCRIPTOR at file offset ${offset}`,
    });
  }

  return dependencies;
}

function peRvaToFileOffset(sections: readonly BinarySection[], rva: number): number | undefined {
  for (const section of sections) {
    if (section.virtualAddress === undefined) continue;
    const mappedSize = Math.max(section.size, 1);
    const start = section.virtualAddress;
    const end = start + mappedSize;
    if (rva >= start && rva < end) {
      return section.offset + (rva - start);
    }
  }
  return undefined;
}

function blockingIds(uncertainty: readonly Uncertainty[]): string[] {
  return unique(uncertainty.filter((item) => item.severity === "blocker").map((item) => item.id));
}

function requiredExternalArtifacts(uncertainty: readonly Uncertainty[]): string[] {
  const artifacts = new Set<string>();
  for (const item of uncertainty) {
    if (item.id.includes("compiler")) artifacts.add("verified compiler and linker profile");
    if (item.id.includes("semantic")) artifacts.add("architecture lifter output with control-flow proof");
    if (item.id.includes("section") || item.id.includes("layout")) artifacts.add("confirmed load map");
  }
  return [...artifacts];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function chooseBuildSystem(format: BinaryFormat): RebuildPlan["buildSystem"] {
  if (format === "pe") return "msbuild";
  if (format === "elf" || format === "macho" || format === "fat-macho") return "cmake";
  return "unknown";
}

function looksLikeFirmware(bytes: Uint8Array): boolean {
  if (bytes.length < 256) return false;
  let printable = 0;
  let zero = 0;
  for (const byte of bytes.subarray(0, Math.min(bytes.length, 4096))) {
    if (byte === 0) zero += 1;
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x0a || byte === 0x0d || byte === 0x09) printable += 1;
  }
  const sample = Math.min(bytes.length, 4096);
  return zero / sample > 0.2 || printable / sample < 0.25;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function renderInventoryC(report: DecompilationReport): string {
  const sectionRows = report.sections
    .map((section) => `  { ${section.offset}, ${section.size}, ${section.virtualAddress ?? 0}, "${cString(section.name)}" }`)
    .join(",\n");
  const rows = sectionRows.length > 0 ? sectionRows : "  { 0, 0, 0, \"no-confirmed-sections\" }";
  const symbolRows = report.evidence.symbols.slice(0, 512)
    .map((symbol) => `  { ${symbol.address ?? 0}, ${symbol.size ?? 0}, "${cString(symbol.name)}", "${symbol.kind}", "${symbol.binding}" }`)
    .join(",\n");
  const symbolTableRows = symbolRows.length > 0 ? symbolRows : "  { 0, 0, \"no-confirmed-symbols\", \"unknown\", \"unknown\" }";
  const relocationRows = report.evidence.relocations.slice(0, 512)
    .map((relocation) => `  { ${relocation.offset}, "${cString(relocation.kind)}", "${cString(relocation.symbol ?? "")}" }`)
    .join(",\n");
  const relocationTableRows = relocationRows.length > 0 ? relocationRows : "  { 0, \"no-confirmed-relocations\", \"\" }";
  return `#include <stdint.h>
#include <stddef.h>

struct recovered_section {
  uint64_t file_offset;
  uint64_t size;
  uint64_t virtual_address;
  const char *name;
};

struct recovered_symbol {
  uint64_t address;
  uint64_t size;
  const char *name;
  const char *kind;
  const char *binding;
};

struct recovered_relocation {
  uint64_t offset;
  const char *kind;
  const char *symbol;
};

const char *recovered_input_sha256 = "${report.identity.sha256}";
const char *recovered_input_format = "${report.identity.format}";

const struct recovered_section recovered_sections[] = {
${rows}
};

const size_t recovered_section_count = sizeof(recovered_sections) / sizeof(recovered_sections[0]);

const struct recovered_symbol recovered_symbols[] = {
${symbolTableRows}
};

const size_t recovered_symbol_count = sizeof(recovered_symbols) / sizeof(recovered_symbols[0]);

const struct recovered_relocation recovered_relocations[] = {
${relocationTableRows}
};

const size_t recovered_relocation_count = sizeof(recovered_relocations) / sizeof(recovered_relocations[0]);
`;
}

function renderCMake(report: DecompilationReport): string {
  return `cmake_minimum_required(VERSION 3.20)
project(reconstructed_binary_inventory C)

add_library(recovered_inventory STATIC src/recovered_inventory.c)
target_compile_features(recovered_inventory PRIVATE c_std_99)

# Original input: ${report.identity.format}, ${report.identity.sizeBytes} bytes, sha256=${report.identity.sha256}
# This target intentionally rebuilds the evidence inventory only. Byte-equivalent
# binary reconstruction remains blocked until UNCERTAINTY.md has no blockers.
`;
}

function renderUncertaintyMarkdown(report: DecompilationReport): string {
  const lines = [
    "# Uncertainty Ledger",
    "",
    `Input SHA-256: \`${report.identity.sha256}\``,
    `Format: \`${report.identity.format}\``,
    "",
  ];
  for (const item of report.uncertainty) {
    lines.push(`## ${item.id}`, "", `Severity: \`${item.severity}\``, `Area: \`${item.area}\``, "", item.evidence, "", `Impact: ${item.impact}`, "", `Recommended action: ${item.recommendedAction}`, "");
  }
  return `${lines.join("\n")}\n`;
}

function renderVerifyMarkdown(report: DecompilationReport): string {
  const lines = ["# Equivalence Verification", ""];
  for (const check of report.equivalenceChecks) {
    lines.push(`## ${check.name}`, "", check.purpose, "", "```bash", check.command, "```", "");
    if (check.prerequisites.length > 0) {
      lines.push("Prerequisites:", "");
      for (const prerequisite of check.prerequisites) lines.push(`- ${prerequisite}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderBlockedRebuildMarkdown(report: DecompilationReport, blockedBy: readonly string[]): string {
  const lines = [
    "# Rebuild Blocked",
    "",
    "The generated workspace is an evidence inventory, not a byte-equivalent source reconstruction.",
    "",
    `Input SHA-256: \`${report.identity.sha256}\``,
    `Format: \`${report.identity.format}\``,
    "",
    "Byte-equivalent executable rebuild output is blocked by:",
    "",
  ];
  for (const id of blockedBy) lines.push(`- \`${id}\``);
  lines.push(
    "",
    "Resolve these uncertainties with evidence-backed adapters before emitting executable source or claiming binary equivalence.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function cString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function validateWorkspaceRelativePath(path: string): string {
  if (path.includes("\0")) throw new Error("Generated workspace path contains a null byte.");
  const normalized = normalize(path.replaceAll("\\", "/"));
  if (isAbsolute(normalized) || normalized === "." || normalized.startsWith("..") || normalized.split("/").includes("..")) {
    throw new Error(`Generated workspace path is not safely relative: ${path}`);
  }
  return normalized;
}

function ascii(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("ascii");
}

function readCString(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= bytes.length) return "";
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return ascii(bytes.subarray(offset, end));
}

function readU16(bytes: Uint8Array, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, littleEndian);
}

function readU32(bytes: Uint8Array, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian);
}

function readU64(bytes: Uint8Array, offset: number, littleEndian: boolean): bigint | undefined {
  if (offset < 0 || offset + 8 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, littleEndian);
}

function readI32(bytes: Uint8Array, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, littleEndian);
}

function readI64(bytes: Uint8Array, offset: number, littleEndian: boolean): bigint | undefined {
  if (offset < 0 || offset + 8 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(offset, littleEndian);
}

function numberFromU64(value: bigint | undefined): number | undefined {
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}

function toBigInt(value: number | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

function hex(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `0x${value.toString(16)}`;
}

function peMachineName(machine: number | undefined): string | undefined {
  if (machine === 0x014c) return "x86";
  if (machine === 0x8664) return "x86_64";
  if (machine === 0xaa64) return "arm64";
  if (machine === 0x01c4) return "arm";
  return undefined;
}

function elfMachineName(machine: number | undefined): string | undefined {
  if (machine === 3) return "x86";
  if (machine === 62) return "x86_64";
  if (machine === 40) return "arm";
  if (machine === 183) return "arm64";
  if (machine === 8) return "mips";
  if (machine === 243) return "riscv";
  return undefined;
}

function elfTypeName(type: number | undefined): string | undefined {
  if (type === 1) return "relocatable";
  if (type === 2) return "executable";
  if (type === 3) return "shared-object";
  if (type === 4) return "core";
  return undefined;
}

function elfSymbolBinding(value: number): BinarySymbol["binding"] {
  if (value === 0) return "local";
  if (value === 1) return "global";
  if (value === 2) return "weak";
  return "unknown";
}

function elfSymbolKind(value: number, sectionIndex: number | undefined): BinarySymbol["kind"] {
  if (sectionIndex === 0) return "import";
  if (value === 1) return "object";
  if (value === 2) return "function";
  if (value === 3) return "section";
  if (value === 4) return "file";
  if (value === 6) return "tls";
  return "unknown";
}

function compactSymbol(input: {
  readonly name: string;
  readonly address: number | undefined;
  readonly size: number | undefined;
  readonly binding: BinarySymbol["binding"];
  readonly kind: BinarySymbol["kind"];
  readonly section: string | undefined;
  readonly confidence: Confidence;
  readonly evidence: string;
}): BinarySymbol {
  let symbol: BinarySymbol = {
    name: input.name,
    binding: input.binding,
    kind: input.kind,
    confidence: input.confidence,
    evidence: input.evidence,
  };
  if (input.address !== undefined) symbol = { ...symbol, address: input.address };
  if (input.size !== undefined) symbol = { ...symbol, size: input.size };
  if (input.section !== undefined) symbol = { ...symbol, section: input.section };
  return symbol;
}

function compactRelocation(input: {
  readonly offset: number;
  readonly kind: string;
  readonly symbol: string | undefined;
  readonly addend: bigint | undefined;
  readonly confidence: Confidence;
  readonly evidence: string;
}): BinaryRelocation {
  let relocation: BinaryRelocation = {
    offset: input.offset,
    kind: input.kind,
    confidence: input.confidence,
    evidence: input.evidence,
  };
  if (input.symbol !== undefined) relocation = { ...relocation, symbol: input.symbol };
  if (input.addend !== undefined) relocation = { ...relocation, addend: input.addend };
  return relocation;
}

function emptyEvidenceGraph(): EvidenceGraph {
  return {
    symbols: [],
    relocations: [],
    typeRelationships: [],
  };
}

function machoCpuName(cpuType: number | undefined): string | undefined {
  if (cpuType === 0x01000007) return "x86_64";
  if (cpuType === 0x00000007) return "x86";
  if (cpuType === 0x0100000c) return "arm64";
  if (cpuType === 0x0000000c) return "arm";
  return undefined;
}

function machoFileTypeName(fileType: number | undefined): string | undefined {
  if (fileType === 1) return "object";
  if (fileType === 2) return "executable";
  if (fileType === 6) return "dylib";
  if (fileType === 8) return "bundle";
  return undefined;
}

function peSectionFlags(characteristics: number): string[] {
  const flags: string[] = [];
  if ((characteristics & 0x00000020) !== 0) flags.push("code");
  if ((characteristics & 0x00000040) !== 0) flags.push("initialized-data");
  if ((characteristics & 0x00000080) !== 0) flags.push("uninitialized-data");
  if ((characteristics & 0x20000000) !== 0) flags.push("execute");
  if ((characteristics & 0x40000000) !== 0) flags.push("read");
  if ((characteristics & 0x80000000) !== 0) flags.push("write");
  return flags;
}

function elfSectionFlags(flags: number, type: number): string[] {
  const names: string[] = [];
  if ((flags & 0x1) !== 0) names.push("write");
  if ((flags & 0x2) !== 0) names.push("alloc");
  if ((flags & 0x4) !== 0) names.push("execute");
  if (type === 8) names.push("nobits");
  if (type === 3) names.push("string-table");
  if (type === 6) names.push("dynamic");
  return names;
}

function buildMachODetails(input: {
  readonly summary: string;
  readonly architecture: string | undefined;
  readonly machine: string | undefined;
  readonly bitness: 32 | 64;
  readonly endianness: "little";
  readonly kind: string | undefined;
  readonly sectionCount: number;
}): FormatDetails {
  let details: FormatDetails = {
    summary: input.summary,
    bitness: input.bitness,
    endianness: input.endianness,
    sectionCount: input.sectionCount,
  };
  if (input.architecture !== undefined) details = { ...details, architecture: input.architecture };
  if (input.machine !== undefined) details = { ...details, machine: input.machine };
  if (input.kind !== undefined) details = { ...details, kind: input.kind };
  return details;
}
