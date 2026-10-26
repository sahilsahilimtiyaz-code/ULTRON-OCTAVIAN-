/**
 * FaceVideoPlayer — the top of the face-renderer chain:
 *   1. AI video clips (public/face/clips/<state>.mp4) — if the user supplies them
 *   2. layered image puppet (public/face/head.png)
 *   3. original procedural 3D head
 *
 * All clips are preloaded muted, looped, crossfaded on state change, and
 * paused when the tab is hidden (battery discipline).
 */
import { useEffect, useRef, useState } from 'react';
import FacePuppetCanvas from './FacePuppetCanvas';
import { getState, useStore } from '../core/store';
import type { FaceStateName } from '../core/types';

const BASE = import.meta.env.BASE_URL ?? '/';

type ClipKey = 'idle' | 'listening' | 'thinking' | 'talking' | 'working' | 'success' | 'error';

const CLIP_FILES: Record<ClipKey, string> = {
  idle: 'idle.mp4',
  listening: 'listening.mp4',
  thinking: 'thinking.mp4',
  talking: 'talking.mp4',
  working: 'working.mp4',
  success: 'success.mp4',
  error: 'error.mp4',
};

const FACE_TO_CLIP: Record<FaceStateName, ClipKey> = {
  boot: 'idle',
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'talking',
  coding: 'working',
  success: 'success',
  error: 'error',
  angry: 'idle', // no angry clip yet — falls back to idle until one exists
};

async function probeClips(): Promise<Set<ClipKey>> {
  const found = new Set<ClipKey>();
  await Promise.allSettled(
    (Object.keys(CLIP_FILES) as ClipKey[]).map(async (key) => {
      const url = BASE + 'face/clips/' + CLIP_FILES[key];
      try {
        // Prefer HEAD, but some static hosts/CDNs reject HEAD or return a
        // generic MIME type for MP4 files. In those cases, try a tiny ranged GET.
        let res = await fetch(url, { method: 'HEAD' });
        let type = (res.headers.get('content-type') ?? '').toLowerCase();
        let isCandidate = res.ok && !type.includes('text/html') &&
          (type.startsWith('video/') || type.includes('octet-stream'));

        if (!isCandidate && (!res.ok || res.status === 405 || !type || type.includes('text/html'))) {
          res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
          type = (res.headers.get('content-type') ?? '').toLowerCase();
          const contentRange = res.headers.get('content-range');
          isCandidate = res.ok && !type.includes('text/html') &&
            (type.startsWith('video/') || type.includes('octet-stream') || !!contentRange);
        }

        if (isCandidate) found.add(key);
      } catch {
        /* unavailable or blocked; use the existing fallback */
      }
    }),
  );
  return found;
}

export default function FaceLive() {
  const clips = useClips();
  if (clips === null) return null; // probing
  if (clips.size === 0) return <FacePuppetCanvas />; // no clips → puppet → 3D
  return <ClipStack clips={clips} />;
}

function useClips(): Set<ClipKey> | null {
  const [clips, setClips] = useState<Set<ClipKey> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void probeClips().then((s) => {
      if (!cancelled) setClips(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return clips;
}

function ClipStack({ clips }: { clips: Set<ClipKey> }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<ClipKey, HTMLVideoElement>>(new Map());
  const face = useStore((s) => s.face);

  // effective clip: requested state, else idle, else first available
  const requested = FACE_TO_CLIP[face] ?? 'idle';
  let active: ClipKey;
  if (clips.has(requested)) active = requested;
  else if (clips.has('idle')) active = 'idle';
  else active = [...clips][0];

  /* play the active clip, pause the rest */
  useEffect(() => {
    videoRefs.current.forEach((v, key) => {
      if (key === active) {
        if (v.paused) void v.play().catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
    });
  }, [active]);

  /* battery discipline: pause everything when the tab hides */
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        videoRefs.current.forEach((v) => v.pause());
      } else {
        const v = videoRefs.current.get(active);
        if (v) void v.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  /* muted autoplay needs the property set imperatively */
  const setRef = (key: ClipKey) => (el: HTMLVideoElement | null) => {
    if (el) {
      el.muted = true;
      videoRefs.current.set(key, el);
      if (key === active && getState().booted) void el.play().catch(() => {});
    } else {
      videoRefs.current.delete(key);
    }
  };

  const heavy = (key: ClipKey) => (key === 'idle' || key === 'talking' ? 'auto' : 'metadata');

  return (
    <div ref={holderRef} className="face-canvas-holder" aria-label="Robotic face">
      {[...clips].map((key) => (
        <video
          key={key}
          ref={setRef(key)}
          className="face-clip"
          style={{ opacity: key === active ? 1 : 0 }}
          src={BASE + 'face/clips/' + CLIP_FILES[key]}
          preload={heavy(key)}
          loop
          playsInline
        />
      ))}
      <div className="face-vignette" aria-hidden="true" />
    </div>
  );
}
