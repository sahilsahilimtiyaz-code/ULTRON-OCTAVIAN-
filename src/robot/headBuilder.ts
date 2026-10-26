/**
 * Procedural robotic head v2 — ORIGINAL design.
 * v2 goals (why v1 looked bad): plated construction instead of one blob,
 * thin slit eyes instead of cartoon capsules, vented mouth grille, real
 * side pods, neck pistons + back cables, darker premium materials.
 * The FaceController API (refs below) is unchanged.
 */
import * as THREE from 'three';

export interface HeadRefs {
  root: THREE.Group;
  headGroup: THREE.Group;
  jaw: THREE.Group;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  eyeLidL: THREE.Mesh;
  eyeLidR: THREE.Mesh;
  eyeMat: THREE.MeshStandardMaterial;
  glowMatL: THREE.SpriteMaterial;
  glowMatR: THREE.SpriteMaterial;
  jawFaceplate: THREE.Mesh;
  mouthGlowMat: THREE.MeshStandardMaterial;
}

export interface HeadMaterials {
  chrome: THREE.MeshStandardMaterial;
  bright: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  redGlow: THREE.MeshStandardMaterial;
}

export function buildMaterials(): HeadMaterials {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: 0x99a1ac, metalness: 0.92, roughness: 0.34, envMapIntensity: 1.15 }),
    bright: new THREE.MeshStandardMaterial({ color: 0xd0d5dd, metalness: 0.95, roughness: 0.2, envMapIntensity: 1.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x23262d, metalness: 0.86, roughness: 0.52, envMapIntensity: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0f1116, metalness: 0.6, roughness: 0.72 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0x2a0409, emissive: 0xff2438, emissiveIntensity: 3, metalness: 0.2, roughness: 0.4 }),
  };
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,110,125,0.95)');
  grad.addColorStop(0.4, 'rgba(255,36,56,0.4)');
  grad.addColorStop(1, 'rgba(255,36,56,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sphere-section plate helper. Front of head is phi = PI/2. */
function plate(
  mats: HeadMaterials,
  mat: THREE.MeshStandardMaterial,
  phi0: number,
  phi1: number,
  theta0: number,
  theta1: number,
  parent: THREE.Group,
): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.545, 24, 14, phi0, phi1 - phi0, theta0, theta1 - theta0);
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(0.96, 1.18, 0.98);
  m.position.y = 0.15;
  parent.add(m);
  void mats;
  return m;
}

export function buildHead(mats: HeadMaterials): HeadRefs {
  const root = new THREE.Group();
  const headGroup = new THREE.Group();
  root.add(headGroup);

  /* ---------- under-skull (dark, shows through plate gaps) ---------- */
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.53, 32, 24), mats.dark);
  under.scale.set(0.98, 1.2, 1.0);
  under.position.y = 0.15;
  headGroup.add(under);

  /* ---------- cranium plates ---------- */
  const P = Math.PI;
  plate(mats, mats.chrome, 0.30 * P, 0.70 * P, 0.44, 1.28, headGroup); // forehead center
  plate(mats, mats.bright, 0.36 * P, 0.64 * P, 0.10, 0.44, headGroup); // crown front
  plate(mats, mats.steel, 0.02 * P, 0.30 * P, 0.08, 0.50, headGroup); // crown left
  plate(mats, mats.steel, 0.70 * P, 0.98 * P, 0.08, 0.50, headGroup); // crown right
  plate(mats, mats.steel, 0.04 * P, 0.28 * P, 0.55, 1.25, headGroup); // temple left
  plate(mats, mats.steel, 0.72 * P, 0.96 * P, 0.55, 1.25, headGroup); // temple right
  plate(mats, mats.chrome, 0.30 * P, 0.70 * P, 1.30, 1.62, headGroup); // upper-lip band (static)
  plate(mats, mats.dark, 0.10 * P, 0.90 * P, 1.66, 2.1, headGroup); // lower rear

  /* ---------- center spine ridge ---------- */
  const spine: Array<[number, number, number, number]> = [
    [0, 0.55, 0.19, 0.3],
    [0, 0.43, 0.33, 0.22],
    [0, 0.315, 0.415, 0.14],
  ];
  for (const [x, y, z, rx] of spine) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.045), mats.chrome);
    seg.position.set(x, y, z);
    seg.rotation.x = rx;
    headGroup.add(seg);
  }

  /* ---------- brow visor ---------- */
  const browBridge = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.075, 0.13), mats.chrome);
  browBridge.position.set(0, 0.335, 0.425);
  browBridge.rotation.x = 0.12;
  headGroup.add(browBridge);
  for (const side of [-1, 1]) {
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.11), mats.chrome);
    bp.position.set(side * 0.24, 0.345, 0.4);
    bp.rotation.z = side * 0.22;
    bp.rotation.x = 0.1;
    headGroup.add(bp);
  }
  const browShadow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.022, 0.05), mats.dark);
  browShadow.position.set(0, 0.298, 0.44);
  headGroup.add(browShadow);

  /* ---------- eyes: thin glowing slits ---------- */
  const eyeMat = mats.redGlow.clone();
  const slitGeo = new THREE.CapsuleGeometry(0.026, 0.13, 4, 10);
  const mkEye = (x: number) => {
    const eye = new THREE.Mesh(slitGeo, eyeMat);
    eye.rotation.z = Math.PI / 2;
    eye.rotation.y = x < 0 ? 0.2 : -0.2;
    eye.position.set(x, 0.24, 0.43);
    return eye;
  };
  const eyeL = mkEye(-0.185);
  const eyeR = mkEye(0.185);
  headGroup.add(eyeL, eyeR);

  for (const x of [-0.185, 0.185]) {
    const sock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), mats.dark);
    sock.position.set(x, 0.24, 0.4);
    headGroup.add(sock);
  }

  const glowTex = glowTexture();
  const mkGlow = (x: number) => {
    const m = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(0.5, 0.24, 1);
    s.position.set(x, 0.24, 0.47);
    return { sprite: s, mat: m };
  };
  const gL = mkGlow(-0.185);
  const gR = mkGlow(0.185);
  headGroup.add(gL.sprite, gR.sprite);

  /* ---------- eyelids ---------- */
  const lidGeo = new THREE.BoxGeometry(0.2, 0.05, 0.06);
  const eyeLidL = new THREE.Mesh(lidGeo, mats.chrome);
  eyeLidL.position.set(-0.185, 0.285, 0.43);
  const eyeLidR = new THREE.Mesh(lidGeo, mats.chrome);
  eyeLidR.position.set(0.185, 0.285, 0.43);
  headGroup.add(eyeLidL, eyeLidR);

  /* ---------- nose ---------- */
  const noseTop = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.05), mats.chrome);
  noseTop.position.set(0, 0.17, 0.455);
  noseTop.rotation.x = 0.15;
  headGroup.add(noseTop);
  const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.045), mats.steel);
  noseTip.position.set(0, 0.085, 0.465);
  noseTip.rotation.x = 0.2;
  headGroup.add(noseTip);

  /* ---------- cheek vents ---------- */
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.04), mats.dark);
      vent.position.set(side * 0.335, 0.05 - i * 0.07, 0.3);
      vent.rotation.z = side * 0.3;
      headGroup.add(vent);
    }
  }

  /* ---------- mouth recess + grille (static, jaw moves below) ---------- */
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.05), mats.dark);
  recess.position.set(0, -0.105, 0.415);
  headGroup.add(recess);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.02), mats.steel);
    bar.position.set(0, -0.062 - i * 0.035, 0.445);
    headGroup.add(bar);
  }
  const mouthGlowMat = mats.redGlow.clone();
  mouthGlowMat.emissiveIntensity = 1.4;
  const mouthGlow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.014, 0.02), mouthGlowMat);
  mouthGlow.position.set(0, -0.132, 0.45);
  headGroup.add(mouthGlow);

  /* ---------- jaw (articulated) ---------- */
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.02, 0.06);
  headGroup.add(jaw);

  const jawFaceplate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.13), mats.chrome.clone());
  (jawFaceplate.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xff2438);
  (jawFaceplate.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15;
  jawFaceplate.position.set(0, -0.30, 0.335);
  jaw.add(jawFaceplate);

  const chinTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.1), mats.steel);
  chinTip.position.set(0, -0.375, 0.375);
  jaw.add(chinTip);

  const underbar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.028, 0.08), mats.steel);
  underbar.position.set(0, -0.235, 0.395);
  jaw.add(underbar);

  for (const side of [-1, 1]) {
    const jp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.12), mats.chrome);
    jp.position.set(side * 0.2, -0.27, 0.3);
    jp.rotation.y = side * -0.3;
    jp.rotation.z = side * 0.15;
    jaw.add(jp);
  }

  /* ---------- ear pods ---------- */
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.155, 0.18, 24), mats.steel);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(side * 0.47, 0.08, 0.03);
    headGroup.add(pod);
    for (const r of [0.06, 0.095, 0.125]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 8, 28), mats.chrome);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(side * 0.565, 0.08, 0.03);
      headGroup.add(ring);
    }
    const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 12), mats.redGlow.clone());
    sensor.rotation.z = Math.PI / 2;
    sensor.position.set(side * 0.578, 0.08, 0.03);
    headGroup.add(sensor);
  }

  /* ---------- neck ---------- */
  const neckY = [-0.6, -0.68, -0.76, -0.84];
  neckY.forEach((y, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3 + (i % 2) * 0.025, 0.042, 10, 36), i % 2 ? mats.steel : mats.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    headGroup.add(ring);
  });
  const neckCore = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.42, 20), mats.dark);
  neckCore.position.y = -0.7;
  headGroup.add(neckCore);

  // pistons from back-neck to skull
  for (const side of [-1, 1]) {
    const a = new THREE.Vector3(side * 0.1, -0.72, 0.12);
    const b = new THREE.Vector3(side * 0.16, -0.48, -0.12);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8), mats.chrome);
    piston.position.copy(a).addScaledVector(dir, 0.5);
    piston.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    headGroup.add(piston);
  }

  /* ---------- back cables ---------- */
  const mkCable = (side: number) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.18, -0.45, -0.26),
      new THREE.Vector3(side * 0.3, -0.2, -0.3),
      new THREE.Vector3(side * 0.32, 0.05, -0.26),
      new THREE.Vector3(side * 0.2, 0.32, -0.2),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.02, 8), mats.dark);
    headGroup.add(tube);
  };
  mkCable(-1);
  mkCable(1);

  return {
    root,
    headGroup,
    jaw,
    eyeL,
    eyeR,
    eyeLidL,
    eyeLidR,
    eyeMat,
    glowMatL: gL.mat,
    glowMatR: gR.mat,
    jawFaceplate,
    mouthGlowMat,
  };
}
