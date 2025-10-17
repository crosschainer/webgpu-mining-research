import React, { useMemo, useState } from 'react';
import { beamHashTestVectors } from '../beamhash/testvectors';
import { bytesToHex } from '../utils/bytes';
import { computeHashForPoW, computePrePowState, verifyBeamHashSolution } from '../beamhash/verifier';

const VerifierPanel: React.FC = () => {
  const vector = beamHashTestVectors[0];
  const [status, setStatus] = useState<string>('');
  const [indicesPreview, setIndicesPreview] = useState<number[]>([]);

  const hashForPoW = useMemo(() => bytesToHex(computeHashForPoW(vector.header)), [vector]);
  const prePowHex = useMemo(() => {
    const hash = computeHashForPoW(vector.header);
    const pre = computePrePowState(hash, vector.nonce, vector.solution);
    return bytesToHex(pre);
  }, [vector]);

  const runVerification = () => {
    const report = verifyBeamHashSolution(vector);
    if (report.valid) {
      setStatus('BeamHash III solution verified successfully.');
      setIndicesPreview(report.indices ? report.indices.slice(0, 6) : []);
    } else {
      setStatus(report.reason ?? 'Verification failed.');
      setIndicesPreview([]);
    }
  };

  return (
    <section className="card">
      <h2>Verifier</h2>
      <p>
        Validates the archived mainnet block <strong>{vector.header.height.toLocaleString()}</strong> using the published BeamHash
        III reference logic.
      </p>
      <dl className="kv">
        <div>
          <dt>Hash for PoW</dt>
          <dd className="mono">{hashForPoW}</dd>
        </div>
        <div>
          <dt>Pre-PoW state</dt>
          <dd className="mono">{prePowHex}</dd>
        </div>
        <div>
          <dt>Extra nonce</dt>
          <dd className="mono">{bytesToHex(vector.solution.slice(100))}</dd>
        </div>
      </dl>
      <button type="button" onClick={runVerification}>Verify sample solution</button>
      {status && <p className="status-text">{status}</p>}
      {indicesPreview.length > 0 && (
        <p className="mono">
          First indices: {indicesPreview.map((v) => v.toString()).join(', ')}
        </p>
      )}
    </section>
  );
};

export default VerifierPanel;
