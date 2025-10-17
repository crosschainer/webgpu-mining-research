import shaderSource from './beamhashInnerLoop.wgsl?raw';

export interface BeamHashDispatchResult {
  readonly checksumLo: number;
  readonly checksumHi: number;
  readonly elapsedMs: number;
}

export class BeamHashPipeline {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly paramsBuffer: GPUBuffer;
  private readonly outputBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly prePowPacked: Uint32Array;
  private readonly workgroupSize: number;

  constructor(device: GPUDevice, prePow: Uint8Array, workgroupSize = 64) {
    this.device = device;
    this.workgroupSize = workgroupSize;
    this.prePowPacked = BeamHashPipeline.packPrePow(prePow);

    const shaderModule = device.createShaderModule({ code: shaderSource });

    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    this.bindGroupLayout = this.pipeline.getBindGroupLayout(0);

    const paramsSize = 48; // bytes
    this.paramsBuffer = device.createBuffer({
      size: paramsSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const outputSize = 8;
    this.outputBuffer = device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    this.readBuffer = device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.outputBuffer } },
      ],
    });
  }

  async dispatch(baseNonce: number, nonceCount: number, mixSeed: number): Promise<BeamHashDispatchResult> {
    if (nonceCount === 0) {
      return { checksumLo: 0, checksumHi: 0, elapsedMs: 0 };
    }

    const params = new Uint32Array(12);
    params.set(this.prePowPacked, 0);
    params[8] = baseNonce >>> 0;
    params[9] = nonceCount >>> 0;
    params[10] = mixSeed >>> 0;
    params[11] = 0;

    this.device.queue.writeBuffer(this.paramsBuffer, 0, params.buffer, params.byteOffset, params.byteLength);
    this.device.queue.writeBuffer(this.outputBuffer, 0, new Uint32Array(2));

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroups = Math.ceil(nonceCount / this.workgroupSize);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readBuffer, 0, 8);

    const start = performance.now();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    await this.readBuffer.mapAsync(GPUMapMode.READ);
    const elapsedMs = performance.now() - start;

    const view = new Uint32Array(this.readBuffer.getMappedRange().slice(0));
    const checksumLo = view[0] >>> 0;
    const checksumHi = view[1] >>> 0;
    this.readBuffer.unmap();

    return { checksumLo, checksumHi, elapsedMs };
  }

  dispose(): void {
    this.paramsBuffer.destroy();
    this.outputBuffer.destroy();
    this.readBuffer.destroy();
  }

  private static packPrePow(bytes: Uint8Array): Uint32Array {
    if (bytes.length !== 32) {
      throw new Error('prePow state must be 32 bytes');
    }
    const packed = new Uint32Array(8);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 4; i++) {
      const lo = view.getUint32(i * 8, true);
      const hi = view.getUint32(i * 8 + 4, true);
      packed[i * 2] = lo;
      packed[i * 2 + 1] = hi;
    }
    return packed;
  }
}
