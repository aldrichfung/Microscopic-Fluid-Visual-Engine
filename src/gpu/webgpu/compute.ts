export class ComputeProgram {
  private readonly pipeline: GPUComputePipeline;

  public constructor(
    device: GPUDevice,
    public readonly name: string,
    code: string,
    entryPoint = "main",
  ) {
    this.pipeline = device.createComputePipeline({
      label: `mfve:${name}`,
      layout: "auto",
      compute: {
        module: device.createShaderModule({ label: `mfve:${name}:shader`, code }),
        entryPoint,
      },
    });
  }

  public get bindGroupLayout(): GPUBindGroupLayout {
    return this.pipeline.getBindGroupLayout(0);
  }

  public encode(
    pass: GPUComputePassEncoder,
    bindGroup: GPUBindGroup,
    width: number,
    height: number,
  ): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  }
}

export function makeUniformBuffer(device: GPUDevice, label: string, size: number): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}
