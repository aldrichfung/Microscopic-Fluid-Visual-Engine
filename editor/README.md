# Microscopic Fluid Studio

A browser-local authoring workspace for the Microscopic Fluid Visual Engine. It provides a real WebGPU preview, editable magnetic/droplet/transport/optics parameters, fixed-step playback and seeking, timeline events, local save, and JSON project import/export.

## Run locally

From the repository root, build the engine first:

```sh
npm install
npm run build
```

Then start the studio:

```sh
cd editor
npm install
npm run dev
```

Create a production bundle with `npm run build`; serve it locally with `npm run preview`.

A WebGPU-capable browser is required. Project documents are stored only in the current browser unless exported. Audio-reactive modulation and video export are not included in this increment.
