import {
  createDefaultProject,
  createMagneticProject,
  loadShaderLibrary,
  MicroscopicEngine,
  Mulberry32,
  WebGpuTransportBackend,
} from "../../dist/index.js";

const status = document.querySelector("#status");
window.runGpuSmoke = runGpuSmoke;

async function runGpuSmoke() {
  const report = { adapter: undefined, shaders: [], projects: [], uncapturedErrors: [] };
  status.textContent = "Requesting SwiftShader WebGPU device…";
  if (!navigator.gpu) throw new Error("navigator.gpu is unavailable");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter is available");
  const device = await adapter.requestDevice();
  report.adapter = {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    description: adapter.info.description,
  };
  device.addEventListener("uncapturederror", (event) => {
    report.uncapturedErrors.push(event.error.message);
  });

  try {
    const shaders = await loadShaderLibrary(new URL("../../dist/shaders/", import.meta.url));
    for (const [name, code] of Object.entries(shaders)) {
      device.pushErrorScope("validation");
      const module = device.createShaderModule({ label: `smoke:${name}`, code });
      const compilation = await module.getCompilationInfo();
      const validation = await device.popErrorScope();
      const messages = compilation.messages.map((message) => ({
        type: message.type,
        line: message.lineNum,
        message: message.message,
      }));
      report.shaders.push({ name, messages, validation: validation?.message ?? null });
      if (validation || messages.some((message) => message.type === "error")) {
        throw new Error(`Shader compilation failed: ${name}`);
      }
    }

    device.pushErrorScope("validation");
    try {
      report.projects.push(await runTransportProject(device, shaders));
      report.projects.push(await runSignatureProject(device, shaders));
    } finally {
      const validation = await device.popErrorScope();
      if (validation) throw new Error(`GPU validation error: ${validation.message}`);
    }
    if (report.uncapturedErrors.length > 0) throw new Error("Uncaptured WebGPU errors were reported");
    status.textContent = `PASS\n${JSON.stringify(report, null, 2)}`;
    return report;
  } catch (error) {
    status.textContent = `FAIL\n${error.stack ?? String(error)}`;
    throw error;
  } finally {
    device.destroy();
  }
}

async function runTransportProject(device, shaders) {
  const project = createDefaultProject("SwiftShader transport smoke");
  project.grid = { width: 64, height: 64 };
  project.layers[0].pressureIterations = 6;
  const backend = new WebGpuTransportBackend(device, shaders);
  const engine = new MicroscopicEngine(project, backend);
  await engine.initialize();
  engine.step();
  await device.queue.onSubmittedWorkDone();

  const firstOptics = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  const firstDye = combineStats(
    await readTexture(device, backend.fieldTexture("dye-a"), 64, "rgba16float"),
    await readTexture(device, backend.fieldTexture("dye-b"), 64, "rgba16float"),
  );
  assertReadable(firstOptics, "transport optics");
  assertReadable(firstDye, "transport dye");

  engine.step();
  await device.queue.onSubmittedWorkDone();
  const evolved = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  if (evolved.hash === firstOptics.hash) throw new Error("Transport optics did not evolve");

  engine.reset();
  engine.step();
  await device.queue.onSubmittedWorkDone();
  const replay = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  if (replay.hash !== firstOptics.hash) throw new Error("Transport reset/replay is not deterministic");
  engine.destroy();

  return {
    name: project.name,
    steps: 2,
    optics: summarize(firstOptics),
    dye: summarize(firstDye),
    evolvedHash: evolved.hash,
    replayMatches: true,
  };
}

async function runSignatureProject(device, shaders) {
  const project = createMagneticProject("SwiftShader signature smoke");
  project.grid = { width: 64, height: 64 };
  project.timeline = [
    { id: "pulse", atSeconds: 0, durationSeconds: 0.2, action: "magnetic-pulse", strength: 2 },
    { id: "merge", atSeconds: 0, durationSeconds: 0.2, action: "coalesce", strength: 1 },
  ];
  const backend = new WebGpuTransportBackend(device, shaders);
  const engine = new MicroscopicEngine(project, backend);
  await engine.initialize();
  await device.queue.onSubmittedWorkDone();
  const initialOptics = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  assertReadable(initialOptics, "initial signature optics");
  engine.step();
  await device.queue.onSubmittedWorkDone();

  const firstOptics = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  const firstPhase = combineStats(
    await readTexture(device, backend.fieldTexture("phase-a"), 64, "r32float"),
    await readTexture(device, backend.fieldTexture("phase-b"), 64, "r32float"),
  );
  const firstDroplets = await readTexture(device, backend.fieldTexture("droplet-field"), 64, "rgba16float");
  assertReadable(firstOptics, "signature optics");
  assertReadable(firstPhase, "magnetic phase");
  assertReadable(firstDroplets, "droplet field");
  const mergedCount = backend.droplets().length;
  if (mergedCount >= project.layers[1].droplets.length) throw new Error("Droplets did not coalesce");

  for (let index = 0; index < 3; index += 1) engine.step();
  await device.queue.onSubmittedWorkDone();
  const evolvedPhase = combineStats(
    await readTexture(device, backend.fieldTexture("phase-a"), 64, "r32float"),
    await readTexture(device, backend.fieldTexture("phase-b"), 64, "r32float"),
  );
  const evolvedOptics = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  if (evolvedPhase.hash === firstPhase.hash) throw new Error("Magnetic phase did not evolve");
  if (evolvedOptics.hash === firstOptics.hash) throw new Error("Signature optics did not evolve");

  engine.reset();
  for (let index = 0; index < 4; index += 1) engine.step();
  await device.queue.onSubmittedWorkDone();
  const replay = await readTexture(device, backend.fieldTexture("optical-target"), 64, "rgba16float");
  if (replay.hash !== evolvedOptics.hash) throw new Error("Signature reset/replay is not deterministic");

  backend.resize(128, 128);
  const resizedProject = { ...project, grid: { width: 128, height: 128 } };
  backend.step({
    masterSeed: project.seed,
    stepIndex: 0,
    simulationTimeSeconds: project.simulation.fixedDeltaSeconds,
    deltaSeconds: project.simulation.fixedDeltaSeconds,
    random: new Mulberry32(project.seed),
  }, resizedProject);
  await device.queue.onSubmittedWorkDone();
  const resized = await readTexture(device, backend.fieldTexture("optical-target"), 128, "rgba16float");
  assertReadable(resized, "resized optics");
  engine.destroy();

  return {
    name: project.name,
    steps: 4,
    mergedDroplets: mergedCount,
    initialOptics: summarize(initialOptics),
    optics: summarize(firstOptics),
    phase: summarize(firstPhase),
    droplets: summarize(firstDroplets),
    evolvedPhaseHash: evolvedPhase.hash,
    replayMatches: true,
    resized: { width: 128, height: 128, hash: resized.hash, nonZero: resized.nonZero },
  };
}

async function readTexture(device, texture, size, format) {
  const bytesPerTexel = format === "rgba16float" ? 8 : 4;
  const bytesPerRow = size * bytesPerTexel;
  if (bytesPerRow % 256 !== 0) throw new Error("Readback rows must be 256-byte aligned");
  const buffer = device.createBuffer({
    size: bytesPerRow * size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: "smoke:readback" });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: size },
    { width: size, height: size },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(buffer.getMappedRange()).slice();
  buffer.unmap();
  buffer.destroy();

  const values = format === "rgba16float"
    ? decodeHalfFloats(new Uint16Array(bytes.buffer))
    : new Float32Array(bytes.buffer);
  let nonZero = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("Texture readback contains NaN or Infinity");
    if (Math.abs(value) > 1e-7) nonZero += 1;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return { bytes, values, nonZero, minimum, maximum, hash: hashBytes(bytes), format, size };
}

function decodeHalfFloats(half) {
  const output = new Float32Array(half.length);
  for (let index = 0; index < half.length; index += 1) {
    const bits = half[index];
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    if (exponent === 0) output[index] = sign * 2 ** -14 * (fraction / 1024);
    else if (exponent === 31) output[index] = fraction ? NaN : sign * Infinity;
    else output[index] = sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return output;
}

function hashBytes(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function combineStats(...reads) {
  const bytes = new Uint8Array(reads.reduce((sum, read) => sum + read.bytes.length, 0));
  let offset = 0;
  for (const read of reads) {
    bytes.set(read.bytes, offset);
    offset += read.bytes.length;
  }
  return {
    bytes,
    nonZero: reads.reduce((sum, read) => sum + read.nonZero, 0),
    minimum: Math.min(...reads.map((read) => read.minimum)),
    maximum: Math.max(...reads.map((read) => read.maximum)),
    hash: hashBytes(bytes),
  };
}

function summarize(read) {
  return {
    hash: read.hash,
    nonZero: read.nonZero,
    minimum: read.minimum,
    maximum: read.maximum,
  };
}

function assertReadable(read, label) {
  if (read.nonZero === 0) throw new Error(`${label} is empty`);
  if (!Number.isFinite(read.minimum) || !Number.isFinite(read.maximum)) {
    throw new Error(`${label} has invalid numeric output`);
  }
}
