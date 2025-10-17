import { beamHashTestVectors } from '../src/beamhash/testvectors.ts';
import { computeHashForPoW, verifyBeamHashSolution } from '../src/beamhash/verifier.ts';
import { bytesToHex } from '../src/utils/bytes.ts';

for (const vec of beamHashTestVectors) {
  const hashForPoW = computeHashForPoW(vec.header);
  console.log(vec.name, bytesToHex(hashForPoW));
  const report = verifyBeamHashSolution(vec);
  console.log(report);
}
