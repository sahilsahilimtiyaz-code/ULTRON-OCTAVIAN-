/**
 * Wireframe "global linkage" globe: dotted sphere + red network nodes + arcs.
 * Independent small WebGL context, capped DPR, paused when hidden.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

let failedOnce = false;

function fibonacciSphere(n: number, radius: number): Float32Array {
  const pts = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts[i * 3] = Math.cos(th) * r * radius;
    pts[i * 3 + 1] = y * radius;
    pts[i * 3 + 2] = Math.sin(th) * r * radius;
  }
  return pts;
}

function nodeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,120,135,1)');
  grad.addColorStop(0.4, 'rgba(255,32,56,0.55)');
  grad.addColorStop(1, 'rgba(255,32,56,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export default function GlobeCanvas() {
  const holderRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(failedOnce);

  useEffect(() => {
    if (failedOnce) return;
    const holder = holderRef.current;
    if (!holder) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
    } catch {
      failedOnce = true;
      setFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
    camera.position.set(0, 0.15, 3.1);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x404855, 2));

    /* dotted sphere */
    const N = 1300;
    const pos = fibonacciSphere(N, 1.02);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dots = new THREE.Points(
      dotGeo,
      new THREE.PointsMaterial({ color: 0x9fb4c8, size: 0.02, transparent: true, opacity: 0.55, sizeAttenuation: true }),
    );
    scene.add(dots);

    /* meridian rings */
    const rings = new THREE.Group();
    const ringMat = new THREE.LineBasicMaterial({ color: 0x2c3542, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.RingGeometry(1.02, 1.021, 72);
      const m = new THREE.Line(new THREE.WireframeGeometry(geo), ringMat);
      m.rotation.x = (Math.PI / 2) * (i / 6) + Math.PI / 4;
      rings.add(m);
    }
    // orbital ellipses
    const orb1 = new THREE.LineLoop(
      new THREE.EdgesGeometry(new THREE.TorusGeometry(1.18, 0.001, 4, 90)),
      new THREE.LineBasicMaterial({ color: 0x5a2129, transparent: true, opacity: 0.8 }),
    );
    orb1.rotation.x = 0.5;
    orb1.rotation.y = 0.3;
    rings.add(orb1);
    const orb2 = new THREE.LineLoop(
      new THREE.EdgesGeometry(new THREE.TorusGeometry(1.3, 0.001, 4, 90)),
      new THREE.LineBasicMaterial({ color: 0x4a2129, transparent: true, opacity: 0.6 }),
    );
    orb2.rotation.x = -0.6;
    orb2.rotation.z = 0.4;
    rings.add(orb2);
    scene.add(rings);

    /* red network nodes */
    const nodeTex = nodeTexture();
    const nodeCount = 9;
    const nodePos: THREE.Vector3[] = [];
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(
        1.03,
        Math.acos(THREE.MathUtils.clamp(Math.random() * 1.6 - 0.8, -1, 1)),
        Math.random() * Math.PI * 2,
      );
      nodePos.push(v);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: nodeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      spr.position.copy(v);
      spr.scale.setScalar(0.16);
      sprites.push(spr);
      scene.add(spr);
    }

    /* arcs between nodes */
    const arcs: THREE.Line[] = [];
    const arcMat = new THREE.LineBasicMaterial({ color: 0xff2038, transparent: true, opacity: 0.55 });
    for (let i = 0; i < nodeCount - 1; i++) {
      const a = nodePos[i];
      const b = nodePos[(i + 3) % nodeCount];
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1.28);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
      const line = new THREE.Line(geo, arcMat);
      arcs.push(line);
      scene.add(line);
    }

    const el = renderer.domElement;
    el.style.touchAction = 'none';
    holder.appendChild(el);

    const resize = () => {
      const w = holder.clientWidth || 10;
      const h = holder.clientHeight || 10;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    let raf = 0;
    let running = true;
    const t0 = performance.now();
    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const t = (performance.now() - t0) / 1000;
      dots.rotation.y = t * 0.12;
      rings.rotation.y = t * 0.05;
      nodePos.forEach((_, i) => {
        const spr = sprites[i];
        if (spr) {
          const pulse = 0.13 + Math.abs(Math.sin(t * 1.4 + i)) * 0.07;
          spr.scale.setScalar(pulse);
        }
      });
      arcs.forEach((a, i) => {
        const m = a.material as THREE.LineBasicMaterial;
        m.opacity = 0.3 + Math.abs(Math.sin(t * 1.1 + i * 1.3)) * 0.45;
      });
      renderer.render(scene, camera);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      holder.removeChild(el);
      scene.traverse((o) => {
        if (o instanceof THREE.Points || o instanceof THREE.Line) {
          o.geometry?.dispose?.();
          (o.material as THREE.Material)?.dispose?.();
        }
      });
      renderer.dispose();
    };
  }, [failed]);

  if (failed) {
    return (
      <div className="globe-fallback" aria-label="Global linkage (static)">
        <div className="gf-disc" />
        <div className="gf-ring" />
      </div>
    );
  }
  return <div ref={holderRef} className="globe-holder" aria-hidden="true" />;
}
