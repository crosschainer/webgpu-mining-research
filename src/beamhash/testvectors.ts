import { hexToBytes } from '../utils/bytes';

export interface BeamHashTestVector {
  readonly name: string;
  readonly header: {
    readonly height: number;
    readonly prevHash: Uint8Array;
    readonly chainWork: Uint8Array;
    readonly kernels: Uint8Array;
    readonly definition: Uint8Array;
    readonly timestamp: number;
    readonly difficulty: number;
  };
  readonly solution: Uint8Array;
  readonly nonce: Uint8Array;
  readonly expectedHashForPoW: Uint8Array;
}

const headerPrev = hexToBytes('62020e8ee408de5fdbd4c815e47ea098f5e30b84c788be566ac9425e9b07804d');
const chainWork = hexToBytes('0000000000000000000000000000000000000000000000aa0bd15c0cf6e00000');
const kernels = hexToBytes('ccabdcee29eb38842626ad1155014e2d7fc1b00d0a70ccb3590878bdb7f26a02');
const definition = hexToBytes('da1cf1a333d3e8b0d44e4c0c167df7bf604b55352e5bca3bc67dfd350fb707e9');
const solution = hexToBytes('188306068af692bdd9d40355eeca8640005aa7ff65b61a85b45fc70a8a2ac127db2d90c4fc397643a5d98f3e644f9f59fcf9677a0da2e90f597f61a1bf17d67512c6d57e680d0aa2642f7d275d2700188dbf8b43fac5c88fa08fa270e8d8fbc33777619b00000000');
const nonce = hexToBytes('ad636476f7117400');
const expectedHashForPoW = hexToBytes('32a465a9746e233f2cb7831facf633167b6b3ecaab6dabe2b6652ef82aa19b26');

export const beamHashTestVectors: readonly BeamHashTestVector[] = [
  {
    name: 'Mainnet block 903720',
    header: {
      height: 903720,
      prevHash: headerPrev,
      chainWork,
      kernels,
      definition,
      timestamp: 1600968920,
      difficulty: 0xacd56618,
    },
    solution,
    nonce,
    expectedHashForPoW,
  },
];
