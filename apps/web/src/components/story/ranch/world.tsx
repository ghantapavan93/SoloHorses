'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ground } from '@/components/story/ranch/noise';

/**
 * The world around her: a morning sky with the sun low ahead, a field that rolls away into the
 * fog and is drawn, where it rises, with the same contour lines the site draws everywhere; a
 * fence receding along the field; and the barn the camera starts inside, its doors closed on a
 * seam of light. Every surface is geometry and a procedural texture — nothing is a photograph,
 * and none of it is a place.
 */

/** The sun's direction: low, ahead and to the right of the doorway. The light and the sky agree on it. */
export const SUN = new THREE.Vector3(0.35, 0.06, -1).normalize();
/** Fog and the sky's horizon share one colour, so the field ends where the sky begins. */
export const HORIZON = '#2e1d16';

/** What is made outside JSX is not R3F's to let go: it goes when it is replaced, and when the scene leaves. */
function useDispose(resource: { dispose(): void }) {
  useEffect(() => () => resource.dispose(), [resource]);
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSun;
  void main() {
    float h = vDir.y;
    vec3 zenith = vec3(0.030, 0.023, 0.021);
    vec3 horizon = vec3(0.180, 0.114, 0.086);
    vec3 below = vec3(0.060, 0.042, 0.036);
    vec3 c = h > 0.0 ? mix(horizon, zenith, pow(clamp(h * 2.4, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-h * 8.0, 0.0, 1.0));
    float d = max(dot(vDir, uSun), 0.0);
    c += vec3(0.83, 0.54, 0.38) * (pow(d, 120.0) * 1.6 + pow(d, 14.0) * 0.16);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uSun: { value: SUN } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useDispose(material);
  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[320, 32, 16]} />
    </mesh>
  );
}

/** The field: a displaced plane, lit, receiving her shadow, with contour lines where it rises. */
export function Terrain({ segments }: { segments: number }) {
  const geometry = useMemo(() => {
    const size = 280;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i) - 40;
      pos.setZ(i, z);
      pos.setY(i, ground(x, z));
    }
    geo.computeVertexNormals();
    return geo;
  }, [segments]);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: '#1b1511', roughness: 0.96, metalness: 0 });
    // Iso-lines by height, and faint furrows by depth: the contour field, on the ground it stands for.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec3 vGroundPos;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n vGroundPos = (modelMatrix * vec4(position, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n varying vec3 vGroundPos;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           float lv = vGroundPos.y * 1.7;
           float lf = abs(fract(lv) - 0.5);
           float lw = fwidth(lv) * 1.4;
           float iso = (1.0 - smoothstep(0.0, lw, lf)) * smoothstep(0.05, 0.4, abs(vGroundPos.y));
           float fz = abs(fract(vGroundPos.z / 3.2) - 0.5);
           float fw = fwidth(vGroundPos.z / 3.2) * 1.2;
           float furrow = (1.0 - smoothstep(0.0, fw, fz)) * 0.35;
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.79, 0.73, 0.64), clamp(iso * 0.32 + furrow * 0.16, 0.0, 0.5));`,
        );
    };
    return mat;
  }, []);
  useDispose(geometry);
  useDispose(material);
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

/** A soft dark ground, feathered to nothing at its edges, drawn once. */
function featherTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** A dark, calm ground behind the graph once she is gone: the evidence frame, standing in the field, feathered so it belongs to it. */
export function EvidenceFrame({
  box,
  z,
  materialRef,
}: {
  box: { x: number; y: number; w: number; h: number };
  z: number;
  materialRef: React.RefObject<THREE.MeshBasicMaterial | null>;
}) {
  const alpha = useMemo(() => featherTexture(), []);
  useDispose(alpha);
  const pad = 1.4;
  return (
    <mesh position={[box.x + box.w / 2, box.y - box.h / 2, z - 0.4]} renderOrder={-1}>
      <planeGeometry args={[box.w + pad * 2, box.h + pad * 2]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#0b0908"
        alphaMap={alpha}
        transparent
        opacity={0}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

/** The fence along the field: posts as one instanced mesh, two rails where the ground is level. */
export function Fence({ z = -9.6 }: { z?: number }) {
  const posts = useRef<THREE.InstancedMesh | null>(null);
  const count = 46;
  useEffect(() => {
    const mesh = posts.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const x = -60 + i * 2.65;
      m.makeTranslation(x, ground(x, z) + 0.62, z + (i % 3) * 0.02);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [z]);
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2019', roughness: 0.9 }), []);
  useDispose(wood);
  return (
    <group>
      <instancedMesh
        ref={posts}
        args={[undefined, undefined, count]}
        material={wood}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[0.13, 1.28, 0.13]} />
      </instancedMesh>
      <mesh position={[0, 1.02, z]} material={wood} castShadow>
        <boxGeometry args={[52, 0.07, 0.05]} />
      </mesh>
      <mesh position={[0, 0.58, z]} material={wood} castShadow>
        <boxGeometry args={[52, 0.07, 0.05]} />
      </mesh>
    </group>
  );
}

/** Vertical planks, drawn once into a texture: the barn's walls and doors. */
function plankTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#171210';
  ctx.fillRect(0, 0, size, size);
  const plank = 64;
  for (let i = 0; i < size / plank; i += 1) {
    const shade = 0.85 + ((i * 7919) % 13) / 60;
    ctx.fillStyle = `rgb(${Math.round(30 * shade)}, ${Math.round(23 * shade)}, ${Math.round(19 * shade)})`;
    ctx.fillRect(i * plank + 2, 0, plank - 4, size);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(i * plank + 2, 0, 2, size);
    // Grain: a few faint long strokes per plank.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 5; g += 1) {
      const x = i * plank + 8 + ((g * 37 + i * 11) % (plank - 16));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, size * 0.3, x - 3, size * 0.7, x + 1, size);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function planks(texture: THREE.CanvasTexture, repeatX: number, repeatY: number): THREE.Texture {
  const t = texture.clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

/**
 * The barn: the camera starts inside, looking at two doors closed on a seam of light. The
 * doors swing outward on their hinges as the scroll begins. Refs are handed up so the director
 * can turn them.
 */
export function Barn({
  leftDoor,
  rightDoor,
  seamRef,
}: {
  leftDoor: React.RefObject<THREE.Group | null>;
  rightDoor: React.RefObject<THREE.Group | null>;
  seamRef: React.RefObject<THREE.MeshBasicMaterial | null>;
}) {
  const texture = useMemo(() => plankTexture(), []);
  useDispose(texture);
  const { invalidate } = useThree();
  useEffect(() => {
    // The texture is drawn after the first frame in some browsers; ask for one more.
    invalidate();
  }, [texture, invalidate]);
  // The walls and the doors repeat the planks at their own scale: one drawing, two textures over it, each let go with its material.
  const wall = useMemo(
    () => new THREE.MeshStandardMaterial({ map: planks(texture, 3, 1.2), color: '#8a7a6c', roughness: 0.95 }),
    [texture],
  );
  const door = useMemo(
    () => new THREE.MeshStandardMaterial({ map: planks(texture, 0.8, 1.1), color: '#9a8878', roughness: 0.9 }),
    [texture],
  );
  useEffect(
    () => () => {
      for (const m of [wall, door]) {
        m.map?.dispose();
        m.dispose();
      }
    },
    [wall, door],
  );
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#100c0a', roughness: 1 }), []);
  const seam = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#f3ede4', toneMapped: false, transparent: true, opacity: 1 }),
    [],
  );
  useDispose(dark);
  useDispose(seam);
  useEffect(() => {
    seamRef.current = seam;
  }, [seam, seamRef]);
  return (
    <group>
      {/* floor, ceiling, two walls: the inside of the barn, behind the doorway */}
      <mesh position={[0, 0.001, 7]} rotation={[-Math.PI / 2, 0, 0]} material={dark} receiveShadow>
        <planeGeometry args={[6.6, 14]} />
      </mesh>
      <mesh position={[0, 4.6, 7]} rotation={[Math.PI / 2, 0, 0]} material={dark}>
        <planeGeometry args={[6.6, 14]} />
      </mesh>
      <mesh position={[-3.3, 2.3, 7]} rotation={[0, Math.PI / 2, 0]} material={wall}>
        <planeGeometry args={[14, 4.6]} />
      </mesh>
      <mesh position={[3.3, 2.3, 7]} rotation={[0, -Math.PI / 2, 0]} material={wall}>
        <planeGeometry args={[14, 4.6]} />
      </mesh>
      {/* the doorway: a lintel above, posts either side */}
      <mesh position={[0, 4.42, 0]} material={dark}>
        <boxGeometry args={[7, 0.36, 0.5]} />
      </mesh>
      <mesh position={[-3.25, 2.2, 0]} material={dark}>
        <boxGeometry args={[0.24, 4.6, 0.5]} />
      </mesh>
      <mesh position={[3.25, 2.2, 0]} material={dark}>
        <boxGeometry args={[0.24, 4.6, 0.5]} />
      </mesh>
      {/* the seam of morning between the doors */}
      <mesh position={[0, 2.15, -0.12]} material={seam}>
        <planeGeometry args={[0.05, 4.2]} />
      </mesh>
      {/* the doors, hinged at the posts, swinging outward */}
      <group ref={leftDoor} position={[-3.1, 0, 0]}>
        <mesh position={[1.53, 2.15, 0]} material={door} castShadow>
          <boxGeometry args={[3.04, 4.2, 0.09]} />
        </mesh>
        <mesh position={[1.53, 2.15, 0.06]} material={dark}>
          <boxGeometry args={[2.7, 0.08, 0.03]} />
        </mesh>
      </group>
      <group ref={rightDoor} position={[3.1, 0, 0]}>
        <mesh position={[-1.53, 2.15, 0]} material={door} castShadow>
          <boxGeometry args={[3.04, 4.2, 0.09]} />
        </mesh>
        <mesh position={[-1.53, 2.15, 0.06]} material={dark}>
          <boxGeometry args={[2.7, 0.08, 0.03]} />
        </mesh>
      </group>
    </group>
  );
}
