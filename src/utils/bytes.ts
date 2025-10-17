export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function writeVarUint(value: number | bigint): Uint8Array {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('writeVarUint expects a non-negative integer');
    }
    value = BigInt(value);
  }
  let v = value;
  const bytes: number[] = [];
  const mask = 0x7fn;
  while (v >= 0x80n) {
    bytes.push(Number((v & mask) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Uint8Array.from(bytes);
}
