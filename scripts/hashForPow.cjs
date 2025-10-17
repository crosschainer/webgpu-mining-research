const { createHash } = require('crypto');

const WORK_BIT_SIZE = 448;
const NUM_ROUNDS = 5;
const header = {
  height: 903720,
  prev: '62020e8ee408de5fdbd4c815e47ea098f5e30b84c788be566ac9425e9b07804d',
  chainWork: '0000000000000000000000000000000000000000000000aa0bd15c0cf6e00000',
  kernels: 'ccabdcee29eb38842626ad1155014e2d7fc1b00d0a70ccb3590878bdb7f26a02',
  definition: 'da1cf1a333d3e8b0d44e4c0c167df7bf604b55352e5bca3bc67dfd350fb707e9',
  timestamp: 1600968920,
  difficulty: 0xacd56618,
};
const solutionHex = '188306068af692bdd9d40355eeca8640005aa7ff65b61a85b45fc70a8a2ac127db2d90c4fc397643a5d98f3e644f9f59fcf9677a0da2e90f597f61a1bf17d67512c6d57e680d0aa2642f7d275d2700188dbf8b43fac5c88fa08fa270e8d8fbc33777619b00000000';
const nonceHex = 'ad636476f7117400';

function writeVarUint(value) {
  let v = BigInt(value >>> 0);
  const bytes = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

const parts = [
  writeVarUint(header.height),
  Buffer.from(header.prev, 'hex'),
  Buffer.from(header.chainWork, 'hex'),
  Buffer.from(header.kernels, 'hex'),
  Buffer.from(header.definition, 'hex'),
  writeVarUint(header.timestamp),
  writeVarUint(header.difficulty >>> 0),
];
const sha = createHash('sha256');
for (const part of parts) {
  sha.update(part);
}
const hashForPoW = sha.digest();
console.log('hashForPoW', hashForPoW.toString('hex'));

const personalization = Buffer.alloc(16, 0);
personalization.write('Beam-PoW');
personalization.writeUInt32LE(WORK_BIT_SIZE, 8);
personalization.writeUInt32LE(NUM_ROUNDS, 12);
const blake = createHash('blake2b512', { outputLength: 32, personalization });
blake.update(hashForPoW);
blake.update(Buffer.from(nonceHex, 'hex'));
blake.update(Buffer.from(solutionHex.slice(200), 'hex'));
const prePow = blake.digest();
console.log('prePoW', prePow.toString('hex'));
