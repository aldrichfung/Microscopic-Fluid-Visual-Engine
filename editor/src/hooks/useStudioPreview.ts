import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Project } from "@mfve/engine";
import { StudioPreview, type PreviewAdapterInfo } from "@/lib/preview";

export type PreviewStatus = "initializing" | "ready" | "error";

export function useStudioPreview(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  project: Project,
) {
  const previewRef = useRef<StudioPreview | undefined>(undefined);
  const latestProjectRef = useRef(project);
  const projectRevisionRef = useRef(0);
  const [status, setStatus] = useState<PreviewStatus>("initializing");
  const [error, setError] = useState<string | undefined>();
  const [adapter, setAdapter] = useState<PreviewAdapterInfo | undefined>();
  const [playing, setPlaying] = useState(false);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void StudioPreview.create(canvas, latestProjectRef.current)
      .then(async (preview) => {
        if (cancelled) {
          preview.destroy();
          return;
        }
        previewRef.current = preview;
        setAdapter(preview.adapterInfo);
        if (latestProjectRef.current !== project) await preview.setProject(latestProjectRef.current);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      previewRef.current?.destroy();
      previewRef.current = undefined;
    };
    // The canvas engine is created once; subsequent projects use setProject below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (latestProjectRef.current === project) return;
    latestProjectRef.current = project;
    setPlaying(false);
    setTimeSeconds(0);
    const preview = previewRef.current;
    if (!preview) return;
    const revision = ++projectRevisionRef.current;
    const timer = window.setTimeout(() => {
      setStatus("initializing");
      void preview.setProject(project)
        .then(() => {
          if (projectRevisionRef.current === revision) setStatus("ready");
        })
        .catch((cause: unknown) => {
          if (projectRevisionRef.current !== revision) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus("error");
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!playing || status !== "ready") return;
    let frame = 0;
    let previous = performance.now();
    let sampleStart = previous;
    let sampleFrames = 0;
    const tick = (now: number) => {
      const preview = previewRef.current;
      if (!preview) return;
      // A first rAF timestamp may precede the effect's performance.now() sample.
      preview.advance(Math.max(0, (now - previous) / 1000));
      previous = now;
      sampleFrames += 1;
      setTimeSeconds(preview.timeSeconds);
      if (now - sampleStart >= 500) {
        setFps(Math.round(sampleFrames * 1000 / (now - sampleStart)));
        sampleStart = now;
        sampleFrames = 0;
      }
      if (preview.timeSeconds >= project.simulation.durationSeconds) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, project.simulation.durationSeconds, status]);

  const reset = useCallback(() => {
    setPlaying(false);
    previewRef.current?.reset();
    setTimeSeconds(0);
  }, []);

  const step = useCallback(() => {
    setPlaying(false);
    previewRef.current?.step();
    setTimeSeconds(previewRef.current?.timeSeconds ?? 0);
  }, []);

  const seek = useCallback((seconds: number) => {
    setPlaying(false);
    previewRef.current?.seek(seconds);
    setTimeSeconds(previewRef.current?.timeSeconds ?? 0);
  }, []);

  return {
    status,
    error,
    adapter,
    playing,
    setPlaying,
    timeSeconds,
    fps,
    reset,
    step,
    seek,
  };
}
