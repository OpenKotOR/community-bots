import test from "node:test";
import assert from "node:assert/strict";

import { analyzeBinary, compareBinaryEquivalence, detectBinaryFormat, generateReconstructionWorkspace } from "./index.js";

test("detects PE and reports uncertainty instead of guessed source", () => {
  const pe = minimalPe();
  const report = analyzeBinary({ path: "sample.exe", bytes: pe });

  assert.equal(report.identity.format, "pe");
  assert.equal(report.details.architecture, "x86_64");
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0]?.name, ".text");
  assert.ok(report.rebuildPlan.sourceUnits.some((unit) => unit.path === "recovered/manifest.json"));
  assert.ok(report.uncertainty.some((item) => item.id === "compiler-profile-unknown"));
  assert.ok(report.uncertainty.some((item) => item.id === "semantic-lift-not-confirmed"));
});

test("detects ELF metadata and sections from a valid section table", () => {
  const elf = minimalElf64();
  const report = analyzeBinary({ path: "sample.elf", bytes: elf });

  assert.equal(report.identity.format, "elf");
  assert.equal(report.details.architecture, "x86_64");
  assert.equal(report.details.kind, "executable");
  assert.equal(report.sections.some((section) => section.name === ".text"), true);
  assert.equal(report.evidence.symbols.some((symbol) => symbol.name === "puts" && symbol.kind === "import"), true);
  assert.equal(report.evidence.relocations.some((relocation) => relocation.symbol === "puts"), true);
  assert.equal(report.evidence.typeRelationships.some((relationship) => relationship.relationship === "calling-convention"), true);
});

test("archive members become evidence dependencies", () => {
  const ar = Buffer.from("!<arch>\nhello.o/        0           0     0     644     4         `\nABCD", "ascii");
  const report = analyzeBinary({ bytes: ar });

  assert.equal(report.identity.format, "static-library");
  assert.equal(report.dependencies[0]?.name, "hello.o");
  assert.equal(report.dependencies[0]?.kind, "archive-member");
});

test("generates a compilable evidence workspace without semantic fabrication", () => {
  const report = analyzeBinary({ path: "sample.exe", bytes: minimalPe() });
  const workspace = generateReconstructionWorkspace(report);

  assert.equal(workspace.root, "reconstruction");
  assert.ok(workspace.blockedBy.includes("compiler-profile-unknown"));
  assert.ok(workspace.files.some((file) => file.path === "CMakeLists.txt"));
  const source = workspace.files.find((file) => file.path === "src/recovered_inventory.c")?.contents ?? "";
  assert.match(source, /recovered_input_sha256/);
  assert.match(source, /recovered_symbol_count/);
  assert.match(source, /recovered_relocation_count/);
  assert.doesNotMatch(source, /TODO|return 0;|guessed/iu);
});

test("equivalence report identifies exact and drifting binaries", () => {
  const left = Uint8Array.from([1, 2, 3]);
  const right = Uint8Array.from([1, 9, 3, 4]);

  assert.equal(compareBinaryEquivalence(left, left).exactMatch, true);

  const drift = compareBinaryEquivalence(left, right);
  assert.equal(drift.exactMatch, false);
  assert.equal(drift.byteLengthMatches, false);
  assert.equal(drift.firstDifferenceOffset, 1);
  assert.equal(drift.differingByteCount, 2);
});

test("unknown inputs produce blocker uncertainty", () => {
  const report = analyzeBinary({ bytes: Buffer.from("plain text", "utf8") });

  assert.equal(detectBinaryFormat(Buffer.from("plain text", "utf8")), "unknown");
  assert.equal(report.uncertainty.some((item) => item.severity === "blocker"), true);
  assert.equal(report.rebuildPlan.buildSystem, "unknown");
});

function minimalPe(): Uint8Array {
  const bytes = Buffer.alloc(0x400);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "ascii");
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  bytes.writeUInt32LE(1_700_000_000, 0x88);
  bytes.writeUInt16LE(0xf0, 0x94);
  bytes.writeUInt16LE(0x20b, 0x98);
  bytes.writeUInt32LE(0x1000, 0xa8);
  bytes.writeBigUInt64LE(0x140000000n, 0xb0);
  const section = 0x80 + 24 + 0xf0;
  bytes.write(".text\0\0\0", section, "ascii");
  bytes.writeUInt32LE(0x100, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0x100, section + 16);
  bytes.writeUInt32LE(0x200, section + 20);
  bytes.writeUInt32LE(0x60000020, section + 36);
  return bytes;
}

function minimalElf64(): Uint8Array {
  const bytes = Buffer.alloc(0x600);
  bytes[0] = 0x7f;
  bytes.write("ELF", 1, "ascii");
  bytes[4] = 2;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x401000n, 24);
  bytes.writeBigUInt64LE(0n, 32);
  bytes.writeBigUInt64LE(0x200n, 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(0, 54);
  bytes.writeUInt16LE(0, 56);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(7, 60);
  bytes.writeUInt16LE(6, 62);

  const dynstr = Buffer.from("\0puts\0", "ascii");
  dynstr.copy(bytes, 0x180);
  const shstr = Buffer.from("\0.text\0.dynsym\0.dynstr\0.rela.plt\0.eh_frame\0.shstrtab\0", "ascii");
  shstr.copy(bytes, 0x480);
  bytes.writeUInt32LE(1, 0x120 + 24);
  bytes[0x120 + 24 + 4] = 0x12;
  bytes.writeUInt16LE(0, 0x120 + 24 + 6);
  bytes.writeBigUInt64LE(0n, 0x120 + 24 + 8);
  bytes.writeBigUInt64LE(0n, 0x120 + 24 + 16);
  bytes.writeBigUInt64LE(0x401008n, 0x1c0);
  bytes.writeBigUInt64LE((1n << 32n) | 7n, 0x1c8);
  bytes.writeBigInt64LE(-4n, 0x1d0);

  writeElfSection(bytes, 0x200, { name: 0, type: 0, flags: 0, address: 0, offset: 0, size: 0 });
  writeElfSection(bytes, 0x240, { name: 1, type: 1, flags: 0x6, address: 0x401000, offset: 0x100, size: 0x10 });
  writeElfSection(bytes, 0x280, { name: 7, type: 11, flags: 0x2, address: 0x401020, offset: 0x120, size: 48, link: 3, entrySize: 24 });
  writeElfSection(bytes, 0x2c0, { name: 15, type: 3, flags: 0x2, address: 0x401080, offset: 0x180, size: dynstr.length });
  writeElfSection(bytes, 0x300, { name: 23, type: 4, flags: 0x2, address: 0x401100, offset: 0x1c0, size: 24, link: 2, entrySize: 24 });
  writeElfSection(bytes, 0x340, { name: 33, type: 1, flags: 0x2, address: 0x401200, offset: 0x1e0, size: 0x10 });
  writeElfSection(bytes, 0x380, { name: 43, type: 3, flags: 0, address: 0, offset: 0x480, size: shstr.length });
  return bytes;
}

function writeElfSection(
  bytes: Buffer,
  offset: number,
  section: { name: number; type: number; flags: number; address: number; offset: number; size: number; link?: number; entrySize?: number },
): void {
  bytes.writeUInt32LE(section.name, offset);
  bytes.writeUInt32LE(section.type, offset + 4);
  bytes.writeBigUInt64LE(BigInt(section.flags), offset + 8);
  bytes.writeBigUInt64LE(BigInt(section.address), offset + 16);
  bytes.writeBigUInt64LE(BigInt(section.offset), offset + 24);
  bytes.writeBigUInt64LE(BigInt(section.size), offset + 32);
  bytes.writeUInt32LE(section.link ?? 0, offset + 40);
  bytes.writeBigUInt64LE(BigInt(section.entrySize ?? 0), offset + 56);
}
