export interface WebGpuDeviceContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
}

export async function requestWebGpuDevice(): Promise<WebGpuDeviceContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is unavailable; use a current browser with WebGPU enabled");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No compatible WebGPU adapter was found");
  const device = await adapter.requestDevice();
  return { adapter, device };
}

export function reportDeviceLoss(device: GPUDevice, onLoss: (message: string) => void): void {
  void device.lost.then((info) => {
    onLoss(`WebGPU device lost (${info.reason}): ${info.message}`);
  });
}
