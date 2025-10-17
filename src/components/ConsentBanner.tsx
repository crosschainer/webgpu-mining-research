import React from 'react';

interface ConsentBannerProps {
  onAcknowledge: () => void;
  acknowledged: boolean;
}

const ConsentBanner: React.FC<ConsentBannerProps> = ({ onAcknowledge, acknowledged }) => {
  return (
    <section className="banner">
      <h2>Responsible GPU Research</h2>
      <p>
        This prototype is for academic exploration of BeamHash III on WebGPU. Running the microbenchmark will drive your GPU at
        high load, which can increase power usage, heat, and fan noise. No mining pools, wallets, or network submissions are
        involved.
      </p>
      <button type="button" onClick={onAcknowledge} disabled={acknowledged}>
        {acknowledged ? 'Consent recorded' : 'I understand and want to experiment'}
      </button>
    </section>
  );
};

export default ConsentBanner;
