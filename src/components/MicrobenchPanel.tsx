import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { beamHashTestVectors } from '../beamhash/testvectors';
import { computeHashForPoW, computePrePowState } from '../beamhash/verifier';
import TelemetryPanel, { TelemetryMetrics } from './TelemetryPanel';
import { BeamHashPipeline } from '../webgpu/beamhashPipeline';

interface MicrobenchPanelProps {
  consentGiven: boolean;
}

interface Sample {
  timestamp: number;
  hashes: number;
  duration: number;
}

const NONCES_PER_BATCH = 4096;

const MicrobenchPanel: React.FC<MicrobenchPanelProps> = ({ consentGiven }) => {
  const gpuSupported = typeof navigator !== 'undefined' && navigator.gpu !== undefined;
  const [adapterSummary, setAdapterSummary] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [dutyPercent, setDutyPercent] = useState(60);
  const [metrics, setMetrics] = useState<TelemetryMetrics>({
    hashesTotal: 0,
    instantaneous: 0,
    average5s: 0,
    average60s: 0,
    dispatchMs: 0,
  });

  const deviceRef = useRef<GPUDevice | null>(null);
  const pipelineRef = useRef<BeamHashPipeline | null>(null);
  const runningRef = useRef(false);
  const baseNonceRef = useRef(0);
  const dutyCycleRef = useRef(dutyPercent / 100);
  const visibilityRef = useRef(typeof document === 'undefined' || document.visibilityState === 'visible');
  const samplesRef = useRef<Sample[]>([]);
  const totalHashesRef = useRef(0);

  const prePowState = useMemo(() => {
    const vector = beamHashTestVectors[0];
    const hash = computeHashForPoW(vector.header);
    return computePrePowState(hash, vector.nonce, vector.solution);
  }, []);

  useEffect(() => {
    dutyCycleRef.current = dutyPercent / 100;
  }, [dutyPercent]);

  useEffect(() => {
    const onVisibility = () => {
      visibilityRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    pipelineRef.current?.dispose();
    pipelineRef.current = null;
    deviceRef.current?.destroy();
    deviceRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const updateTelemetry = useCallback((hashes: number, durationMs: number) => {
    const now = performance.now();
    const sample: Sample = { timestamp: now, hashes, duration: durationMs };
    samplesRef.current.push(sample);
    const sixtyAgo = now - 60000;
    samplesRef.current = samplesRef.current.filter((s) => s.timestamp >= sixtyAgo);

    const calcAverage = (windowMs: number) => {
      const cutoff = now - windowMs;
      let hashesSum = 0;
      let durationSum = 0;
      for (const s of samplesRef.current) {
        if (s.timestamp >= cutoff) {
          hashesSum += s.hashes;
          durationSum += s.duration;
        }
      }
      return durationSum > 0 ? (hashesSum / durationSum) * 1000 : 0;
    };

    setMetrics({
      hashesTotal: totalHashesRef.current,
      instantaneous: durationMs > 0 ? (hashes / durationMs) * 1000 : 0,
      average5s: calcAverage(5000),
      average60s: calcAverage(60000),
      dispatchMs: durationMs,
    });
  }, []);

  const loopDispatch = useCallback(
    async (mixSeed: number) => {
      const pipeline = pipelineRef.current;
      if (!pipeline) {
        return;
      }
      try {
        while (runningRef.current) {
          if (!visibilityRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          const result = await pipeline.dispatch(baseNonceRef.current, NONCES_PER_BATCH, mixSeed);
          baseNonceRef.current += NONCES_PER_BATCH;
          totalHashesRef.current += NONCES_PER_BATCH;
          updateTelemetry(NONCES_PER_BATCH, result.elapsedMs);

          const duty = dutyCycleRef.current;
          if (duty <= 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          if (duty < 1) {
            const sleepMs = result.elapsedMs * (1 / duty - 1);
            if (sleepMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, sleepMs));
            }
          }
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        }
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'GPU execution failed.');
        setIsRunning(false);
        cleanup();
      }
    },
    [cleanup, updateTelemetry],
  );

  const start = useCallback(async () => {
    if (!gpuSupported) {
      setError('WebGPU is not available in this browser.');
      return;
    }
    setError(null);
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        setError('No compatible GPU adapter found.');
        return;
      }
      const adapterName = (adapter as GPUAdapter & { name?: string }).name ?? 'Unknown GPU';
      let summary = adapterName;
      if ('requestAdapterInfo' in adapter) {
        try {
          const info = await (adapter as GPUAdapter & {
            requestAdapterInfo?: () => Promise<GPUAdapterInfo | undefined>;
          }).requestAdapterInfo?.();
          if (info) {
            summary = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? summary}`.trim();
          }
        } catch (err) {
          console.warn('Adapter info unavailable', err);
        }
      }
      setAdapterSummary(summary);
      if (adapter.limits.maxStorageBufferBindingSize < 4096) {
        setError('Adapter storage buffer binding size is insufficient for the workload.');
        return;
      }
      const device = await adapter.requestDevice();
      deviceRef.current = device;
      pipelineRef.current = new BeamHashPipeline(device, prePowState);
      baseNonceRef.current = 0;
      totalHashesRef.current = 0;
      samplesRef.current = [];
      setMetrics({ hashesTotal: 0, instantaneous: 0, average5s: 0, average60s: 0, dispatchMs: 0 });
      runningRef.current = true;
      setIsRunning(true);
      const mixSeed = Math.floor(Math.random() * 0xffffffff);
      loopDispatch(mixSeed);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to initialise WebGPU.');
      cleanup();
    }
  }, [cleanup, gpuSupported, loopDispatch, prePowState]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    cleanup();
  }, [cleanup]);

  return (
    <section className="card">
      <h2>Microbenchmark</h2>
      <p>
        Runs the BeamHash III inner-loop shader over batches of {NONCES_PER_BATCH.toLocaleString()} nonces to estimate throughput.
        The shader performs 5 rounds of SipHash-based mixing and collision checks per nonce, mirroring the reference algorithm.
      </p>
      {!gpuSupported && <p className="status-text">WebGPU is not supported in this environment.</p>}
      {adapterSummary && <p className="status-text">Adapter: {adapterSummary}</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="controls">
        <button type="button" onClick={isRunning ? stop : start} disabled={!consentGiven || !gpuSupported}>
          {isRunning ? 'Stop microbench' : 'Start microbench'}
        </button>
        <label className="slider">
          <span>Duty cycle: {dutyPercent}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={dutyPercent}
            onChange={(event) => setDutyPercent(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      <TelemetryPanel metrics={metrics} />
    </section>
  );
};

export default MicrobenchPanel;
