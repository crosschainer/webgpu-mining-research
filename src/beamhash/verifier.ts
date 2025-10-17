import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, writeVarUint } from '../utils/bytes';
import type { BeamHashTestVector } from './testvectors';

const WORK_BIT_SIZE = 448;
const COLLISION_BIT_SIZE = 24;
const NUM_ROUNDS = 5;
const WORK_WORDS = WORK_BIT_SIZE / 64;
const MASK_64 = (1n << 64n) - 1n;
const COLLISION_MASK = (1n << BigInt(COLLISION_BIT_SIZE)) - 1n;
const INDEX_BIT_LENGTH = COLLISION_BIT_SIZE + 1; // 25 bits
const EXTRA_NONCE_OFFSET = 100; // bytes

export interface BlockHeaderInputs {
  readonly height: number;
  readonly prevHash: Uint8Array;
  readonly chainWork: Uint8Array;
  readonly kernels: Uint8Array;
  readonly definition: Uint8Array;
  readonly timestamp: number;
  readonly difficulty: number;
}

export interface VerificationReport {
  readonly valid: boolean;
  readonly reason?: string;
  readonly indices?: readonly number[];
}

function rotl64(value: bigint, amount: number): bigint {
  const shift = BigInt(amount & 63);
  return ((value << shift) & MASK_64) | (value >> (64n - shift));
}

function add64(a: bigint, b: bigint): bigint {
  return (a + b) & MASK_64;
}

function xor64(a: bigint, b: bigint): bigint {
  return (a ^ b) & MASK_64;
}

function siphashRound(v: [bigint, bigint, bigint, bigint]): void {
  v[0] = add64(v[0], v[1]);
  v[2] = add64(v[2], v[3]);
  v[1] = rotl64(v[1], 13);
  v[3] = rotl64(v[3], 16);
  v[1] = xor64(v[1], v[0]);
  v[3] = xor64(v[3], v[2]);
  v[0] = rotl64(v[0], 32);
  v[2] = add64(v[2], v[1]);
  v[0] = add64(v[0], v[3]);
  v[1] = rotl64(v[1], 17);
  v[3] = rotl64(v[3], 21);
  v[1] = xor64(v[1], v[2]);
  v[3] = xor64(v[3], v[0]);
  v[2] = rotl64(v[2], 32);
}

function siphash24(state: readonly bigint[], nonce: bigint): bigint {
  const v: [bigint, bigint, bigint, bigint] = [state[0], state[1], state[2], state[3]];
  v[3] = xor64(v[3], nonce);
  siphashRound(v);
  siphashRound(v);
  v[0] = xor64(v[0], nonce);
  v[2] = xor64(v[2], 0xffn);
  siphashRound(v);
  siphashRound(v);
  siphashRound(v);
  siphashRound(v);
  return xor64(xor64(v[0], v[1]), xor64(v[2], v[3]));
}

function wordsToBytes(words: readonly bigint[]): Uint8Array {
  const out = new Uint8Array(words.length * 8);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < 8; j++) {
      out[i * 8 + (7 - j)] = Number((word >> BigInt(j * 8)) & 0xffn);
    }
  }
  return out;
}

function bytesToWords(bytes: Uint8Array, count: number): bigint[] {
  const out: bigint[] = new Array(count).fill(0n);
  for (let i = 0; i < count; i++) {
    let value = 0n;
    for (let j = 0; j < 8; j++) {
      const idx = i * 8 + (7 - j);
      const byte = idx < bytes.length ? BigInt(bytes[idx]) : 0n;
      value |= byte << BigInt(j * 8);
    }
    out[i] = value & MASK_64;
  }
  return out;
}

class StepElem {
  public readonly workWords: bigint[];

  constructor(prePow: readonly bigint[], index: number) {
    this.workWords = new Array<bigint>(WORK_WORDS).fill(0n);
    for (let i = WORK_WORDS - 1; i >= 0; i--) {
      const nonce = (BigInt(index) << 3n) + BigInt(i);
      this.workWords[i] = siphash24(prePow, nonce);
    }
  }

  mergeWith(other: StepElem, remLen: number): void {
    const remBytes = remLen >> 3;
    const collisionBytes = COLLISION_BIT_SIZE >> 3;
    for (let i = 0; i < WORK_WORDS; i++) {
      this.workWords[i] = xor64(this.workWords[i], other.workWords[i]);
    }
    const bytes = wordsToBytes(this.workWords);
    for (let i = 0; i < remBytes; i++) {
      bytes[i] = bytes[i + collisionBytes] ?? 0;
    }
    for (let i = remBytes; i < bytes.length; i++) {
      bytes[i] = 0;
    }
    const updated = bytesToWords(bytes, WORK_WORDS);
    for (let i = 0; i < WORK_WORDS; i++) {
      this.workWords[i] = updated[i];
    }
  }

  applyMix(remLen: number, indices: readonly number[]): void {
    const temp: bigint[] = new Array(9).fill(0n);
    for (let i = 0; i < WORK_WORDS; i++) {
      temp[i] = this.workWords[i];
    }
    const padNumMax = Math.floor((512 - remLen + COLLISION_BIT_SIZE) / (COLLISION_BIT_SIZE + 1));
    const padNum = Math.min(padNumMax, indices.length);
    for (let i = 0; i < padNum; i++) {
      const nShift = remLen + i * (COLLISION_BIT_SIZE + 1);
      const baseWord = Math.floor(nShift / 64);
      const shift = nShift % 64;
      const idxValue = BigInt(indices[i]);
      temp[baseWord] = xor64(temp[baseWord], (idxValue << BigInt(shift)) & MASK_64);
      if (shift + COLLISION_BIT_SIZE + 1 > 64) {
        const spill = idxValue >> BigInt(64 - shift);
        temp[baseWord + 1] = xor64(temp[baseWord + 1], spill & MASK_64);
      }
    }
    let result = 0n;
    for (let i = 0; i < 8; i++) {
      result = add64(result, rotl64(temp[i], (29 * (i + 1)) & 0x3f));
    }
    result = rotl64(result, 24);
    this.workWords[0] = result;
  }

  hasCollision(other: StepElem): boolean {
    const delta = xor64(this.workWords[0], other.workWords[0]);
    return (delta & COLLISION_MASK) === 0n;
  }

  isZero(): boolean {
    return this.workWords.every((word) => word === 0n);
  }
}

export function decodeSolutionIndices(solution: Uint8Array): number[] {
  if (solution.length !== 104) {
    throw new Error('BeamHash solution must be 104 bytes');
  }
  const streamBytes = solution.slice(0, 100);
  let accumulator = 0n;
  for (let i = streamBytes.length - 1; i >= 0; i--) {
    accumulator <<= 8n;
    accumulator |= BigInt(streamBytes[i]);
  }
  const mask = (1n << BigInt(INDEX_BIT_LENGTH)) - 1n;
  const indices: number[] = [];
  for (let i = 0; i < 32; i++) {
    const value = Number(accumulator & mask);
    indices.push(value);
    accumulator >>= BigInt(INDEX_BIT_LENGTH);
  }
  return indices;
}

export function computeHashForPoW(header: BlockHeaderInputs): Uint8Array {
  const parts = [
    writeVarUint(header.height),
    header.prevHash,
    header.chainWork,
    header.kernels,
    header.definition,
    writeVarUint(header.timestamp),
    writeVarUint(header.difficulty >>> 0),
  ];
  const payload = concatBytes(...parts);
  return Uint8Array.from(sha256(payload));
}

export function computePrePowState(hashForPoW: Uint8Array, nonce: Uint8Array, solution: Uint8Array): Uint8Array {
  const personalization = new Uint8Array(16);
  personalization.set(new TextEncoder().encode('Beam-PoW'));
  const view = new DataView(personalization.buffer);
  view.setUint32(8, WORK_BIT_SIZE, true);
  view.setUint32(12, NUM_ROUNDS, true);

  const blake = blake2b.create({ dkLen: 32, personalization });
  blake.update(hashForPoW);
  blake.update(nonce);
  blake.update(solution.slice(EXTRA_NONCE_OFFSET, EXTRA_NONCE_OFFSET + 4));
  return Uint8Array.from(blake.digest());
}

function parsePrePowWords(prePow: Uint8Array): bigint[] {
  if (prePow.length !== 32) {
    throw new Error('prePow must be 32 bytes');
  }
  const words: bigint[] = [];
  const view = new DataView(prePow.buffer, prePow.byteOffset, prePow.byteLength);
  for (let i = 0; i < 4; i++) {
    const lo = BigInt(view.getUint32(i * 8, true));
    const hi = BigInt(view.getUint32(i * 8 + 4, true));
    words.push((hi << 32n) | lo);
  }
  return words;
}

export function verifyBeamHashSolution(vector: BeamHashTestVector): VerificationReport {
  const hashForPoW = computeHashForPoW(vector.header);
  const expected = bytesToHex(vector.expectedHashForPoW);
  if (expected !== bytesToHex(hashForPoW)) {
    return { valid: false, reason: 'Hash-for-PoW mismatch for provided header data.' };
  }

  const prePow = computePrePowState(hashForPoW, vector.nonce, vector.solution);
  const prePowWords = parsePrePowWords(prePow);
  const indices = decodeSolutionIndices(vector.solution);

  const elems: StepElem[] = indices.map((idx) => new StepElem(prePowWords, idx));

  let round = 1;
  for (let step = 1; step < indices.length; step <<= 1) {
    for (let i0 = 0; i0 < indices.length; ) {
      let remLen = WORK_BIT_SIZE - (round - 1) * COLLISION_BIT_SIZE;
      if (round === 5) remLen -= 64;
      elems[i0].applyMix(remLen, indices.slice(i0, i0 + step));
      const i1 = i0 + step;
      elems[i1].applyMix(remLen, indices.slice(i1, i1 + step));
      if (!elems[i0].hasCollision(elems[i1])) {
        return { valid: false, reason: 'Collision bits mismatch during reduction.' };
      }
      if (indices[i0] >= indices[i1]) {
        return { valid: false, reason: 'Indices are not strictly increasing at merge step.' };
      }
      remLen = WORK_BIT_SIZE - round * COLLISION_BIT_SIZE;
      if (round === 4) remLen -= 64;
      if (round === 5) remLen = COLLISION_BIT_SIZE;
      elems[i0].mergeWith(elems[i1], remLen);
      i0 = i1 + step;
    }
    round++;
  }

  if (!elems[0].isZero()) {
    return { valid: false, reason: 'Final work bits are non-zero.' };
  }

  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (sorted[i] === sorted[i + 1]) {
      return { valid: false, reason: 'Duplicate indices detected.' };
    }
  }

  return { valid: true, indices };
}

export function formatVerification(report: VerificationReport): string {
  if (!report.valid) {
    return `❌ ${report.reason ?? 'Verification failed.'}`;
  }
  return `✅ BeamHash III solution is valid. First index: ${report.indices?.[0] ?? 0}`;
}

export function derivePrePowFromHex(headerHex: string, nonceHex: string, solutionHex: string): Uint8Array {
  const [heightHex, prevHex, chainWorkHex, kernelsHex, definitionHex, timestampHex, difficultyHex] = headerHex.split(':');
  const header: BlockHeaderInputs = {
    height: parseInt(heightHex, 16),
    prevHash: hexToBytes(prevHex),
    chainWork: hexToBytes(chainWorkHex),
    kernels: hexToBytes(kernelsHex),
    definition: hexToBytes(definitionHex),
    timestamp: parseInt(timestampHex, 16),
    difficulty: parseInt(difficultyHex, 16) >>> 0,
  };
  const hashForPoW = computeHashForPoW(header);
  return computePrePowState(hashForPoW, hexToBytes(nonceHex), hexToBytes(solutionHex));
}
