import React from 'react';

export interface TelemetryMetrics {
  readonly hashesTotal: number;
  readonly instantaneous: number;
  readonly average5s: number;
  readonly average60s: number;
  readonly dispatchMs: number;
}

interface TelemetryPanelProps {
  metrics: TelemetryMetrics;
}

const formatRate = (rate: number) => {
  if (!Number.isFinite(rate) || rate <= 0) {
    return '—';
  }
  if (rate >= 1_000_000) {
    return `${(rate / 1_000_000).toFixed(2)} MH/s`;
  }
  if (rate >= 1_000) {
    return `${(rate / 1_000).toFixed(2)} kH/s`;
  }
  return `${rate.toFixed(0)} H/s`;
};

const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ metrics }) => {
  return (
    <section className="card">
      <h3>Telemetry</h3>
      <div className="metric-grid">
        <div>
          <span className="metric-label">Instantaneous</span>
          <span className="metric-value">{formatRate(metrics.instantaneous)}</span>
        </div>
        <div>
          <span className="metric-label">5s average</span>
          <span className="metric-value">{formatRate(metrics.average5s)}</span>
        </div>
        <div>
          <span className="metric-label">60s average</span>
          <span className="metric-value">{formatRate(metrics.average60s)}</span>
        </div>
        <div>
          <span className="metric-label">GPU dispatch</span>
          <span className="metric-value">{metrics.dispatchMs.toFixed(2)} ms</span>
        </div>
        <div>
          <span className="metric-label">Total nonces</span>
          <span className="metric-value">{metrics.hashesTotal.toLocaleString()}</span>
        </div>
      </div>
    </section>
  );
};

export default TelemetryPanel;
