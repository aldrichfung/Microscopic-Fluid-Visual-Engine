import {
  MicroscopicEngine,
  WebGpuTransportBackend,
  type Project,
  type ShaderLibrary,
} from "@mfve/engine";
import inject from "@mfve/engine/shaders/inject.wgsl?raw";
import advect from "@mfve/engine/shaders/advect.wgsl?raw";
import divergence from "@mfve/engine/shaders/divergence.wgsl?raw";
import pressure from "@mfve/engine/shaders/pressure.wgsl?raw";
import projectShader from "@mfve/engine/shaders/project.wgsl?raw";
import magneticInit from "@mfve/engine/shaders/magnetic-init.wgsl?raw";
import magneticStep from "@mfve/engine/shaders/magnetic-step.wgsl?raw";
import droplets from "@mfve/engine/shaders/droplets.wgsl?raw";
import optics from "@mfve/engine/shaders/optics.wgsl?raw";

const shaders: ShaderLibrary = {
  inject,
  advect,
  divergence,
  pressure,
  project: projectShader,
  magneticInit,
  magneticStep,
  droplets,
  optics,
};

export interface PreviewAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
}

/** GPU simulation with an asynchronous, canvas-safe optical readback presentation path. */
export class StudioPreview {
  private engine: MicroscopicEngine | undefined;
  private backend: WebGpuTransportBackend | undefined;
  private project: Project;
  private readonly context: CanvasRenderingContext2D;
  private readonly device: GPUDevice;
  private readonly canvas: HTMLCanvasElement;
  public readonly adapterInfo: PreviewAdapterInfo;
  private presenting = false;
  private presentAgain = false;
  private destroyed = false;

  private constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    project: Project,
    adapterInfo: PreviewAdapterInfo,
  ) {
    this.device = device;
    this.canvas = canvas;
    this.project = project;
    this.adapterInfo = adapterInfo;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create the optical preview canvas");
    this.context = context;
  }

  public static async create(canvas: HTMLCanvasElement, project: Project): Promise<StudioPreview> {
    if (!navigator.gpu) throw new Error("This browser does not expose WebGPU");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No compatible WebGPU adapter was found");
    const device = await adapter.requestDevice();
    const preview = new StudioPreview(device, canvas, project, {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
    });
    await preview.setProject(project);
    return preview;
  }

  public get timeSeconds(): number {
    return this.engine?.simulationTimeSeconds ?? 0;
  }

  public get fixedDeltaSeconds(): number {
    return this.project.simulation.fixedDeltaSeconds;
  }

  public async setProject(project: Project): Promise<void> {
    this.project = project;
    this.engine?.destroy();
    this.canvas.width = project.grid.width;
    this.canvas.height = project.grid.height;
    this.backend = new WebGpuTransportBackend(this.device, shaders);
    this.engine = new MicroscopicEngine(project, this.backend);
    await this.engine.initialize();
    this.present();
  }

  public advance(realDeltaSeconds: number): number {
    if (!this.engine) return 0;
    const steps = this.engine.advance(realDeltaSeconds);
    this.present();
    return steps;
  }

  public step(): void {
    this.engine?.step();
    this.present();
  }

  public reset(): void {
    this.engine?.reset();
    this.present();
  }

  public seek(seconds: number): void {
    if (!this.engine) return;
    this.engine.reset();
    const stepCount = Math.max(0, Math.floor(seconds / this.project.simulation.fixedDeltaSeconds + 1e-7));
    for (let index = 0; index < stepCount; index += 1) this.engine.step();
    this.present();
  }

  public destroy(): void {
    this.destroyed = true;
    this.engine?.destroy();
    this.engine = undefined;
    this.backend = undefined;
    this.device.destroy();
  }

  private present(): void {
    if (this.destroyed || !this.backend) return;
    if (this.presenting) {
      this.presentAgain = true;
      return;
    }
    this.presenting = true;
    void this.readOpticalFrame()
      .then((pixels) => {
        if (this.destroyed) return;
        this.context.putImageData(pixels, 0, 0);
      })
      .catch(() => {
        // Device loss is reported by the hook's next operation; stale readbacks are harmless.
      })
      .finally(() => {
        this.presenting = false;
        if (this.presentAgain) {
          this.presentAgain = false;
          this.present();
        }
      });
  }

  private async readOpticalFrame(): Promise<ImageData> {
    if (!this.backend) throw new Error("Preview is not initialized");
    const { width, height } = this.project.grid;
    const bytesPerRow = Math.ceil(width * 8 / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({ label: "studio:optical-readback" });
      encoder.copyTextureToBuffer(
        { texture: this.backend.fieldTexture("optical-target") },
        { buffer, bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const source = new Uint16Array(buffer.getMappedRange());
      const pixels = new ImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        const sourceRow = y * bytesPerRow / 2;
        for (let x = 0; x < width; x += 1) {
          const sourceOffset = sourceRow + x * 4;
          const destinationOffset = (y * width + x) * 4;
          pixels.data[destinationOffset] = halfToByte(source[sourceOffset] ?? 0);
          pixels.data[destinationOffset + 1] = halfToByte(source[sourceOffset + 1] ?? 0);
          pixels.data[destinationOffset + 2] = halfToByte(source[sourceOffset + 2] ?? 0);
          pixels.data[destinationOffset + 3] = 255;
        }
      }
      return pixels;
    } finally {
      buffer.unmap();
      buffer.destroy();
    }
  }
}

function halfToByte(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  let value: number;
  if (exponent === 0) value = sign * 2 ** -14 * (fraction / 1024);
  else if (exponent === 31) value = fraction ? 0 : sign;
  else value = sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
