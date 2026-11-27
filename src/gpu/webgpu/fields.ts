import { PHASE_TWO_FIELDS, type FieldDescriptor, type GridSize } from "../../core/fields.js";

export interface GpuField {
  readonly descriptor: FieldDescriptor;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
}

export class WebGpuFieldSet {
  private readonly fields = new Map<string, GpuField>();

  public constructor(
    private readonly device: GPUDevice,
    private grid: GridSize,
  ) {
    this.allocate(grid);
  }

  public get size(): GridSize {
    return this.grid;
  }

  public get(name: string): GpuField {
    const field = this.fields.get(name);
    if (!field) throw new Error(`Unknown GPU field: ${name}`);
    return field;
  }

  public values(): readonly GpuField[] {
    return [...this.fields.values()];
  }

  public resize(grid: GridSize): void {
    if (grid.width === this.grid.width && grid.height === this.grid.height) return;
    this.destroy();
    this.allocate(grid);
  }

  public clear(): void {
    for (const field of this.fields.values()) {
      const bytesPerPixel = field.descriptor.format === "rgba16float" ? 8 : 4;
      const zeros = new Uint8Array(this.grid.width * this.grid.height * bytesPerPixel);
      this.device.queue.writeTexture(
        { texture: field.texture },
        zeros,
        { bytesPerRow: this.grid.width * bytesPerPixel, rowsPerImage: this.grid.height },
        { width: this.grid.width, height: this.grid.height },
      );
    }
  }

  public destroy(): void {
    for (const field of this.fields.values()) field.texture.destroy();
    this.fields.clear();
  }

  private allocate(grid: GridSize): void {
    this.grid = grid;
    for (const descriptor of PHASE_TWO_FIELDS) {
      const texture = this.device.createTexture({
        label: `mfve:${descriptor.name}`,
        size: { width: grid.width, height: grid.height },
        format: descriptor.format,
        usage: GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.STORAGE_BINDING
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST,
      });
      this.fields.set(descriptor.name, {
        descriptor,
        texture,
        view: texture.createView(),
      });
    }
  }
}
