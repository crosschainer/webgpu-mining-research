import React, { useMemo, useState } from 'react';
import ConsentBanner from './components/ConsentBanner';
import MicrobenchPanel from './components/MicrobenchPanel';
import VerifierPanel from './components/VerifierPanel';
import { beamHashTestVectors } from './beamhash/testvectors';
import { bytesToHex } from './utils/bytes';
import { computeHashForPoW } from './beamhash/verifier';

const App: React.FC = () => {
  const [consentGiven, setConsentGiven] = useState(false);
  const referenceVector = beamHashTestVectors[0];
  const targetHex = useMemo(() => bytesToHex(computeHashForPoW(referenceVector.header)), [referenceVector]);

  return (
    <div className="app">
      <header className="hero">
        <h1>BeamHash III · WebGPU Research Harness</h1>
        <p>
          This is a tiny, ethical prototype that demonstrates BeamHash III&apos;s inner loop on WebGPU compute shaders. It never
          connects to pools or wallets; everything runs locally for measurement and verification only.
        </p>
        <div className="badges">
          <span>Research prototype</span>
          <span>MIT Licensed</span>
          <span>Target hash: {targetHex.slice(0, 16)}…</span>
        </div>
      </header>
      <main>
        <ConsentBanner onAcknowledge={() => setConsentGiven(true)} acknowledged={consentGiven} />
        {!consentGiven && (
          <p className="status-text">Consent is required before the microbenchmark controls become active.</p>
        )}
        <MicrobenchPanel consentGiven={consentGiven} />
        <VerifierPanel />
      </main>
      <footer>
        <p>
          Built with ❤️ for reproducible GPU research. Review the source, share your findings, and contribute improvements under the
          MIT License.
        </p>
      </footer>
    </div>
  );
};

export default App;
