/**
 * GLOBAL LINKAGE — cinematic planet renderer.
 *
 * A single-pass procedural Earth: value-noise continents with domain warp,
 * ice caps, cloud layer, day/night terminator, city lights on the night side,
 * ocean specular, a fresnel atmosphere shell and subtle graticule. Around it:
 * a starfield, two orbit tracks with a satellite, and dashed great-circle
 * data arcs with travelling packets — all in the app's crimson/steel palette.
 *
 * Everything here is real geometry + real shaders; nothing is a looping GIF.
 * Cost is kept low for phones: one sphere, one shell, capped DPR, rendering
 * paused when the tab is hidden or the panel is off-screen.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

let failedOnce = false;

/* ------------------------------------------------------------------ */
/* Shaders                                                            */
/* ------------------------------------------------------------------ */

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec3 vObj;

  void main() {
    vObj = normalize(position);
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uLight;

  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec3 vObj;

  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  // 4 octaves — enough structure for continents, cheap enough for phone GPUs
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * vnoise(p);
      p *= 2.05;
      amp *= 0.5;
    }
    return sum;
  }

  // Sparse point lights: one candidate per coarse cell, placed by a jitter
  // hash and drawn as a soft dot. Drawing whole cells produced dashes that
  // smeared along the limb, which is why this is a point, not a mask.
  float cityLights(vec3 sp) {
    vec3 g = sp * 34.0;
    vec3 cell = floor(g);
    if (hash13(cell + 5.1) < 0.88) return 0.0;
    vec3 jitter = vec3(hash13(cell + 11.3), hash13(cell + 27.7), hash13(cell + 43.1)) - 0.5;
    float d = length(fract(g) - 0.5 - jitter * 0.55);
    return smoothstep(0.13, 0.02, d);
  }

  // anti-aliased latitude/longitude graticule
  float graticule(vec2 uv, vec2 count) {
    vec2 t = uv * count;
    vec2 f = fract(t);
    vec2 d = min(f, 1.0 - f) / max(fwidth(t), vec2(1e-4));
    return 1.0 - min(min(d.x, d.y), 1.0);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLight);

    float sun = dot(N, L);
    vec3 p = normalize(vObj);

    /* ---- continents: warped noise on the object-space sphere ---- */
    vec3 q = p * 2.15;
    float warp = fbm(q * 1.35 + 7.3);
    float raw = fbm(q + warp * 0.8);

    float land = smoothstep(0.49, 0.525, raw);
    float coast = smoothstep(0.465, 0.50, raw) * (1.0 - land);
    float relief = vnoise(q * 6.0 + warp) * land;

    /* ---- palette: cold steel ocean, graphite-green land ---- */
    vec3 deep = vec3(0.010, 0.040, 0.070);
    vec3 shelf = vec3(0.032, 0.110, 0.150);
    vec3 ocean = mix(deep, shelf, smoothstep(0.28, 0.50, raw));
    ocean += vec3(0.02, 0.05, 0.08) * (raw - 0.42);

    vec3 lowland = vec3(0.060, 0.092, 0.074);
    vec3 highland = vec3(0.165, 0.168, 0.156);
    vec3 landCol = mix(lowland, highland, relief * 1.7);
    landCol = mix(landCol, vec3(0.235, 0.185, 0.155), smoothstep(0.62, 0.78, raw) * 0.5);

    vec3 col = mix(ocean, landCol, land);
    col = mix(col, vec3(0.09, 0.14, 0.16), coast * 0.5);

    /* ---- polar ice ---- */
    float ice = smoothstep(0.80, 0.94, abs(p.y));
    col = mix(col, vec3(0.72, 0.83, 0.90), ice * 0.92);

    /* ---- clouds: one warped fbm, drifting, banded by latitude ---- */
    float cloudNoise = fbm(p * 3.0 + vec3(uTime * 0.012, 0.0, uTime * 0.006));
    float bands = 0.5 + 0.5 * sin(p.y * 12.0);
    float clouds = smoothstep(0.58, 0.80, cloudNoise + bands * 0.05);

    /* ---- lighting ---- */
    float dayMask = smoothstep(-0.16, 0.32, sun);
    float nightMask = 1.0 - smoothstep(-0.22, 0.08, sun);
    col *= 0.035 + 1.02 * dayMask;

    /* ocean specular */
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 110.0) * (1.0 - land) * (1.0 - ice);
    col += vec3(0.55, 0.78, 1.0) * spec * dayMask * 0.65;

    /* city lights: small dots on the dark land, faded off the limb */
    float city = cityLights(p) * land * (1.0 - ice);
    city *= smoothstep(-0.35, 0.1, sun + 0.22);
    city *= smoothstep(0.05, 0.45, dot(N, V));
    col += vec3(1.0, 0.42, 0.28) * city * nightMask * 0.55;
    col += vec3(0.40, 0.55, 0.80) * 0.025 * nightMask * (1.0 - land);
    col += vec3(0.9, 0.35, 0.22) * 0.012 * land * nightMask;

    /* clouds composite, lit by the sun */
    vec3 cloudCol = mix(vec3(0.06, 0.09, 0.13), vec3(0.92, 0.96, 1.0), dayMask);
    col = mix(col, cloudCol, clouds * 0.55);

    /* graticule — restrained HUD latitude/longitude, faded off the limb
       (derivative-based lines alias badly at grazing angles) */
    float grid = graticule(vUv, vec2(36.0, 18.0));
    float gridFade = smoothstep(0.08, 0.45, dot(N, V));
    col += vec3(0.85, 0.20, 0.24) * grid * (0.05 + 0.055 * dayMask) * gridFade;

    /* ---- limb + atmosphere ---- */
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 atmo = mix(vec3(0.30, 0.66, 1.0), vec3(1.0, 0.22, 0.30), 0.32);
    col += atmo * fres * (0.38 + 0.7 * max(sun, 0.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float f = pow(1.0 - abs(dot(N, V)), 2.8);
    vec3 tint = mix(uColorA, uColorB, 0.28);
    gl_FragColor = vec4(tint * f * 1.15, f);
  }
`;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** lat/lon (degrees) -> unit sphere position (three.js Y-up). */
function toVec3(lat: number, lon: number, radius = 1.005): THREE.Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(la) * Math.cos(lo) * radius,
    Math.sin(la) * radius,
    Math.cos(la) * Math.sin(lo) * radius,
  );
}

let glowTexture: THREE.Texture | null = null;
function glowTex(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,110,125,0.85)');
  grad.addColorStop(0.6, 'rgba(255,45,71,0.28)');
  grad.addColorStop(1, 'rgba(255,45,71,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

interface Flow {
  curve: THREE.Curve<THREE.Vector3>;
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  count: number;
  speed: number;
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function GlobeCanvas({ className = '' }: { className?: string }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(failedOnce);

  useEffect(() => {
    if (failedOnce) return;
    const holder = holderRef.current;
    if (!holder) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      failedOnce = true;
      setFailed(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    // far enough back that the atmosphere shell and both orbit tracks sit
    // fully inside the square frame (no cropped poles, no cut orbit lines)
    camera.position.set(0, 0.1, 4.0);
    camera.lookAt(0, 0, 0);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    /* ---------------- starfield ---------------- */
    const starCount = 420;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 9 + Math.random() * 8;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = r * Math.cos(ph);
      starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xbcd2e8,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    /* ---------------- planet group ---------------- */
    const planet = new THREE.Group();
    planet.rotation.set(0.16, 2.1, 0.06);
    scene.add(planet);

    const light = new THREE.Vector3(-1.35, 0.5, 1.0).normalize();

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLight: { value: light.clone() },
      },
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    });
    const earthGeo = new THREE.SphereGeometry(1, 56, 42);
    const earth = new THREE.Mesh(earthGeo, earthMat);
    planet.add(earth);

    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(0x5ec8ff) },
        uColorB: { value: new THREE.Color(0xff2d47) },
      },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmoGeo = new THREE.SphereGeometry(1.045, 48, 36);
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    planet.add(atmo);

    /* ---------------- graticule-free orbit tracks ---------------- */
    const orbitGroup = new THREE.Group();
    planet.add(orbitGroup);

    const orbitDefs = [
      { radius: 1.12, tilt: new THREE.Euler(0.62, 0.0, 0.18), color: 0xff2d47 },
      { radius: 1.21, tilt: new THREE.Euler(-0.48, 0.5, -0.22), color: 0x4a8fb8 },
    ];

    const satellites = orbitDefs.map((o, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius);
        v.applyEuler(o.tilt);
        pts.push(v);
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(140));
      const l = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: o.color, transparent: true, opacity: 0.24 }),
      );
      orbitGroup.add(l);

      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex(),
          color: i === 0 ? 0xff6a7c : 0x8fd8ff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      s.scale.setScalar(0.11);
      orbitGroup.add(s);
      return { curve, sprite: s, speed: 0.14 + i * 0.05, offset: i * 0.42 };
    });

    /* ---------------- surface nodes + data arcs ---------------- */
    const nodes: Array<[number, number]> = [
      [51.5, -0.1],
      [40.7, -74.0],
      [35.7, 139.7],
      [1.35, 103.8],
      [-33.9, 151.2],
      [19.1, 72.9],
      [37.8, -122.4],
    ];

    const nodeGroup = new THREE.Group();
    planet.add(nodeGroup);

    const nodeSprites: THREE.Sprite[] = [];
    nodes.forEach(([lat, lon]) => {
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex(),
          color: 0xff4a5e,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      spr.position.copy(toVec3(lat, lon, 1.008));
      spr.scale.setScalar(0.09);
      nodeGroup.add(spr);
      nodeSprites.push(spr);
    });

    const arcPairs: Array<[number, number]> = [
      [0, 1],
      [2, 3],
      [3, 4],
      [5, 2],
    ];

    const flows: Flow[] = [];
    const packets: THREE.Sprite[] = [];

    arcPairs.forEach(([ia, ib], idx) => {
      if (!nodes[ia] || !nodes[ib]) return;
      const a = toVec3(nodes[ia][0], nodes[ia][1], 1.004);
      const b = toVec3(nodes[ib][0], nodes[ib][1], 1.004);
      const mid = a.clone().add(b).normalize().multiplyScalar(1.2 + (idx % 2) * 0.06);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);

      // faint continuous path
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(56)),
        new THREE.LineBasicMaterial({ color: 0xff3348, transparent: true, opacity: 0.1, depthWrite: false }),
      );
      line.renderOrder = 2;
      nodeGroup.add(line);

      // particles flowing along it
      const count = 9;
      const arr = new Float32Array(count * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xff8a99,
          size: 0.02,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        }),
      );
      pts.renderOrder = 3;
      nodeGroup.add(pts);
      flows.push({ curve, points: pts, geometry: geo, count, speed: 0.12 + Math.random() * 0.08 });

      // bright head packet
      const head = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex(),
          color: 0xffd0d6,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      head.scale.setScalar(0.07);
      nodeGroup.add(head);
      packets.push(head);
    });

    /* ---------------- mounts ---------------- */
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    holder.appendChild(el);

    const resize = () => {
      const w = holder.clientWidth || 10;
      const h = holder.clientHeight || 10;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    /* ---------------- drag to orbit ---------------- */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let idleDrag = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      idleDrag = 0;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = (e.clientX - lastX) * 0.006;
      const dy = (e.clientY - lastY) * 0.004;
      planet.rotation.y += dx;
      planet.rotation.x = THREE.MathUtils.clamp(planet.rotation.x + dy, -0.9, 0.9);
      lastX = e.clientX;
      lastY = e.clientY;
      idleDrag = 0;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      el.releasePointerCapture?.(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });

    /* ---------------- animation ---------------- */
    let raf = 0;
    let running = false;
    let visible = true;
    const t0 = performance.now();
    let last = t0;

    const renderOnce = (t: number) => {
      earthMat.uniforms.uTime.value = t;
      stars.rotation.y = t * 0.006;
      nodeSprites.forEach((spr, i) => {
        spr.scale.setScalar(0.075 + Math.abs(Math.sin(t * 1.1 + i)) * 0.035);
      });
      flows.forEach((flow) => {
        const attr = flow.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let k = 0; k < flow.count; k++) {
          const u = (k / flow.count + t * flow.speed) % 1;
          const p = flow.curve.getPoint(u);
          attr.setXYZ(k, p.x, p.y, p.z);
        }
        attr.needsUpdate = true;
      });
      packets.forEach((head, i) => {
        const flow = flows[i];
        if (!flow) return;
        head.position.copy(flow.curve.getPoint((t * flow.speed) % 1));
        head.scale.setScalar(0.045);
      });
      satellites.forEach((sat) => {
        const u = (t * sat.speed + sat.offset) % 1;
        sat.sprite.position.copy(sat.curve.getPoint(u));
      });
      renderer.render(scene, camera);
    };

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;

      if (!dragging && !reduced) {
        idleDrag += dt;
        planet.rotation.y += dt * 0.075;
        if (idleDrag > 0) planet.rotation.x += (0.16 - planet.rotation.x) * dt * 0.5;
      }
      orbitGroup.rotation.y -= dt * 0.04;

      renderOnce(t);
    };

    const start = () => {
      if (running || !visible) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    let io: IntersectionObserver | null = null;
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };

    if (reduced) {
      renderOnce(0);
    } else {
      io = new IntersectionObserver(
        (entries) => {
          visible = entries.some((en) => en.isIntersecting);
          if (visible && !document.hidden) start();
          else stop();
        },
        { threshold: 0.05 },
      );
      io.observe(holder);
      document.addEventListener('visibilitychange', onVis);
      start();
    }

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      if (el.parentNode === holder) holder.removeChild(el);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.Sprite) {
          o.geometry?.dispose?.();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose?.();
        }
      });
      renderer.dispose();
    };
  }, [failed]);

  if (failed) {
    return (
      <div className={`globe-fallback ${className}`} aria-label="Global linkage (static render)">
        <div className="gf-glow" />
        <div className="gf-disc" />
        <div className="gf-grid" />
        <div className="gf-ring" />
      </div>
    );
  }

  return <div ref={holderRef} className={`globe-holder ${className}`} aria-hidden="true" />;
}
