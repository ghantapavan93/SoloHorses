import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BODY,
  EARS,
  EYE,
  HORSE_ATTACH,
  HORSE_VIEWBOX,
  LEGS,
  MANE,
  TAIL,
  sample,
  type HorseAttach,
  type Pt,
} from '@/components/story/horse-shape';
import { footfallCrossed, strideFromStance, touchdownIndex } from '@/components/story/ranch/gait';

/**
 * The mare, two ways, one contract. The built scene walks a rigged, animated horse — a
 * public-domain model (Quaternius, CC0; see public/models/horse.LICENSE.txt) recoloured to the
 * site's palette, its walk cycle scrubbed by the distance she has covered, never by time. Until
 * it arrives, and wherever it cannot, the drawing's own outline stands in as a bevelled slab
 * with hinged legs. Either way the scene asks the same things of her: stand here, posed for
 * this much distance; where does this record attach; what is your contour from this camera;
 * fade. The contour is what the graph is made from.
 */
export interface Mare {
  readonly group: THREE.Group;
  /** Whether she is the rigged model (true) or the drawing standing in for it. */
  readonly rigged: boolean;
  /** The most floats `contour` can ever write: the caller sizes its buffers once. */
  readonly contourCapacity: number;
  /** Places her at (x, z) on level ground, posed for the distance covered; `standing` blends the walk into stillness. */
  pose(x: number, z: number, distance: number, standing: number): void;
  /** Where a record attaches to her, in world coordinates. */
  attach(name: HorseAttach, target: THREE.Vector3): THREE.Vector3;
  /**
   * Her contour from this camera, as world-space segments (pairs of points), pulled a touch
   * toward the lens. Written into `out`, which the caller owns; returns how many floats were written.
   */
  contour(camera: THREE.Camera, out: Float32Array): number;
  fade(opacity: number): void;
  /** Time passing: hair in the wind, dust settling. The only motion here that is not the scroll's. */
  tick(seconds: number, dt: number): void;
  dispose(): void;
}

/** The drawing's stride, in metres per walk cycle; the model measures its own from its clip. */
const STRIDE_M = 1.5;
/** How far a contour line sits in front of the surface, so it draws over her and not through her. */
const LIFT = 0.02;

// ───────────────────────────── dust ─────────────────────────────

function puffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const PUFF_LIFE_S = 0.8;
const PUFF_RISE_M_PER_S = 0.15;

/** A hoof meets the ground: a little dust, rising and thinning for most of a second. A pool of eight, recycled. */
export class Dust {
  readonly group = new THREE.Group();
  private readonly pool: { sprite: THREE.Sprite; born: number; seed: number }[] = [];
  private readonly texture: THREE.CanvasTexture;
  private now = 0;
  constructor() {
    this.texture = puffTexture();
    for (let i = 0; i < 8; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: '#8c7460',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({ sprite, born: -10, seed: Math.random() * 6.28 });
    }
  }
  spawn(at: THREE.Vector3) {
    const slot = this.pool.reduce((oldest, p) => (p.born < oldest.born ? p : oldest), this.pool[0]!);
    slot.born = this.now;
    // Centred a little under the hoof's own point: half in the ground at first, it rises out of it.
    slot.sprite.position.set(at.x, at.y - 0.03, at.z + 0.05);
    slot.sprite.visible = true;
  }
  tick(seconds: number, dt: number) {
    this.now = seconds;
    for (const p of this.pool) {
      const age = seconds - p.born;
      if (age < 0 || age > PUFF_LIFE_S) {
        p.sprite.visible = false;
        continue;
      }
      const t = age / PUFF_LIFE_S;
      const size = 0.16 + t * 0.4;
      p.sprite.scale.set(size * 1.3, size, 1);
      p.sprite.position.y += PUFF_RISE_M_PER_S * dt;
      // Bright at the strike, then thinning: a puff that is noticed, not a cloud that stays.
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.6 * (1 - t) * (1 - t * 0.5);
      (p.sprite.material as THREE.SpriteMaterial).rotation = p.seed + t * 0.4;
    }
  }
  dispose() {
    for (const p of this.pool) (p.sprite.material as THREE.SpriteMaterial).dispose();
    this.texture.dispose();
  }
}

// ───────────────────────────── the slab: the drawing standing in ─────────────────────────────

export const HORSE_SCALE = 0.0092;
const DEPTH = 0.34;
const BEVEL = 0.035;

function toLocal([x, y]: Pt, z = 0): THREE.Vector3 {
  return new THREE.Vector3((x - 170) * HORSE_SCALE, (HORSE_VIEWBOX.ground - y) * HORSE_SCALE, z);
}
function polygon(points: readonly Pt[], per: number): THREE.Vector2[] {
  return sample(points, true, per).map(
    ([x, y]) => new THREE.Vector2((x - 170) * HORSE_SCALE, (HORSE_VIEWBOX.ground - y) * HORSE_SCALE),
  );
}
function slab(poly: THREE.Vector2[], depth: number, bevel: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(poly), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
function pushSegments(out: number[], pts: THREE.Vector3[], closed: boolean) {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

export class SlabMare implements Mare {
  readonly group = new THREE.Group();
  readonly rigged = false;
  readonly contourCapacity: number;
  private readonly legs: THREE.Group[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly segments: Float32Array;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly a = new THREE.Vector3();

  constructor() {
    // Transparent from the start: toggling it later would recompile every program mid-scroll.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: '#3d2e24',
      roughness: 0.78,
      metalness: 0,
      emissive: '#1a120d',
      transparent: true,
    });
    const farMat = new THREE.MeshStandardMaterial({
      color: '#241b15',
      roughness: 0.88,
      metalness: 0,
      emissive: '#0e0906',
      transparent: true,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: '#b8a88f',
      roughness: 0.7,
      emissive: '#2a2419',
      transparent: true,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: '#f3ede4',
      emissive: '#f3ede4',
      emissiveIntensity: 0.5,
      transparent: true,
    });
    this.materials.push(bodyMat, farMat, hairMat, eyeMat);
    const keep = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    for (const leg of LEGS) {
      const pivot = toLocal(leg.pivot);
      const geo = keep(slab(polygon(leg.points, 4), 0.15, 0.015));
      geo.translate(-pivot.x, -pivot.y, 0);
      const g = new THREE.Group();
      g.position.set(pivot.x, pivot.y, (leg.near ? 1 : -1) * 0.09);
      const mesh = new THREE.Mesh(geo, leg.near ? bodyMat : farMat);
      mesh.castShadow = true;
      g.add(mesh);
      this.legs.push(g);
      this.group.add(g);
    }
    const body = new THREE.Mesh(keep(slab(polygon(BODY, 5), DEPTH, BEVEL)), bodyMat);
    body.castShadow = true;
    this.group.add(body);
    for (const ear of EARS)
      this.group.add(
        new THREE.Mesh(
          keep(
            slab(
              ear.map(([x, y]) => new THREE.Vector2((x - 170) * HORSE_SCALE, (HORSE_VIEWBOX.ground - y) * HORSE_SCALE)),
              0.05,
              0,
            ),
          ),
          bodyMat,
        ),
      );
    TAIL.forEach((strand, i) =>
      this.group.add(
        new THREE.Mesh(
          keep(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(strand.map((p) => toLocal(p, -0.05 + i * 0.05))),
              20,
              0.012,
              5,
              false,
            ),
          ),
          hairMat,
        ),
      ),
    );
    MANE.forEach(([x, y], i) =>
      this.group.add(
        new THREE.Mesh(
          keep(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3([
                toLocal([x, y], 0.02 + (i % 2) * 0.03),
                toLocal([x - 5, y + 4], 0.06),
                toLocal([x - 10, y + 8], 0.03),
              ]),
              6,
              0.011,
              5,
              false,
            ),
          ),
          hairMat,
        ),
      ),
    );
    const eye = new THREE.Mesh(keep(new THREE.SphereGeometry(0.02, 12, 8)), eyeMat);
    eye.position.copy(toLocal(EYE, DEPTH / 2 - 0.01));
    this.group.add(eye);

    const seg: number[] = [];
    const front = DEPTH / 2 + BEVEL + 0.006;
    const poly = sample(BODY, true, 5).map((p) => toLocal(p));
    pushSegments(
      seg,
      poly.map((v) => new THREE.Vector3(v.x, v.y, front)),
      true,
    );
    for (const strand of TAIL)
      pushSegments(seg, new THREE.CatmullRomCurve3(strand.map((p) => toLocal(p, front))).getPoints(14), false);
    for (const ear of EARS)
      pushSegments(
        seg,
        ear.map((p) => toLocal(p, front)),
        true,
      );
    for (const leg of LEGS.filter((l) => l.near))
      pushSegments(
        seg,
        polygon(leg.points, 4).map((v) => new THREE.Vector3(v.x, v.y, 0.09 + 0.075 + 0.015 + 0.006)),
        true,
      );
    this.segments = new Float32Array(seg);
    this.contourCapacity = this.segments.length;
  }

  pose(x: number, z: number, distance: number, standing: number) {
    const phase = (distance / (STRIDE_M * 0.93)) * Math.PI * 2;
    this.group.position.set(x, Math.abs(Math.sin(phase)) * 0.03 * (1 - standing), z);
    this.legs.forEach((leg, i) => {
      const sign = i === 0 || i === 3 ? 1 : -1;
      leg.rotation.z = -sign * Math.sin(phase) * 0.24 * (1 - standing);
    });
    this.group.updateMatrixWorld(true);
  }

  attach(name: HorseAttach, target: THREE.Vector3): THREE.Vector3 {
    const [fx, fy] = HORSE_ATTACH[name];
    return target
      .copy(toLocal([fx * HORSE_VIEWBOX.w, fy * HORSE_VIEWBOX.h], DEPTH / 2))
      .applyMatrix4(this.group.matrixWorld);
  }

  contour(_camera: THREE.Camera, out: Float32Array): number {
    // The drawing's own outline, where she stands: the lines are drawn on the slab's face and move with it.
    const n = Math.floor(Math.min(this.segments.length, out.length) / 3);
    for (let i = 0; i < n; i += 1) {
      this.a
        .set(this.segments[i * 3]!, this.segments[i * 3 + 1]!, this.segments[i * 3 + 2]!)
        .applyMatrix4(this.group.matrixWorld);
      out[i * 3] = this.a.x;
      out[i * 3 + 1] = this.a.y;
      out[i * 3 + 2] = this.a.z;
    }
    return n * 3;
  }

  fade(opacity: number) {
    for (const m of this.materials) m.opacity = opacity;
    this.group.visible = opacity > 0;
  }

  tick() {}

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ───────────────────────────── the model: a rigged mare ─────────────────────────────

/** The site's palette on the model's named materials; the hair sways in a shader. */
const PALETTE: Record<string, { color: string; emissive: string; roughness: number }> = {
  Main: { color: '#4a3628', emissive: '#170f0b', roughness: 0.82 },
  Main_Dark: { color: '#2e2119', emissive: '#0e0906', roughness: 0.9 },
  Main_Light: { color: '#5c4736', emissive: '#1a120d', roughness: 0.8 },
  Hair: { color: '#1c1410', emissive: '#0a0705', roughness: 0.75 },
  Muzzle: { color: '#2a1f18', emissive: '#0c0806', roughness: 0.9 },
  Hooves: { color: '#1a1411', emissive: '#080605', roughness: 0.6 },
  Eye_Black: { color: '#0b0808', emissive: '#000000', roughness: 0.4 },
  Eye_White: { color: '#e8dcc8', emissive: '#6b6052', roughness: 0.5 },
};
const BODY_MATERIALS = new Set(['Main', 'Main_Dark', 'Main_Light']);

/**
 * The rig's own names. Oriented, the model faces +x, so its right side (R) is the side the lens
 * sees; the hoof bones are the tips of the legs, which the walk clip animates.
 */
const BONES = { head: 'Head', back: 'Back', hooves: ['FFL', 'FFR', 'FFBL', 'FFBR'] } as const;
/** Bones the records hang from, with where the tag's leader meets her, relative to the bone, in metres (x forward, z toward the lens). */
const ANCHORS: Record<HorseAttach, { bone: string; offset: [number, number, number] }> = {
  withers: { bone: 'Torso3', offset: [0.05, 0.16, 0] },
  head: { bone: 'Head', offset: [0.06, 0.04, 0] },
  chest: { bone: 'Torso3', offset: [0.28, -0.3, 0.18] },
  belly: { bone: 'Torso2', offset: [0.05, -0.42, 0.2] },
  croup: { bone: 'Back', offset: [-0.05, 0.14, 0] },
  flank: { bone: 'BackShoulderR', offset: [0, -0.02, 0.2] },
  hock: { bone: 'BackLowerLegR', offset: [0, 0, 0.1] },
};

interface Edge {
  a: number;
  b: number;
  f1: number;
  f2: number;
}
interface Skin {
  mesh: THREE.SkinnedMesh;
  posed: Float32Array;
  faces: Uint32Array;
  edges: Edge[];
  facing: Uint8Array;
}
interface Footfall {
  bone: THREE.Bone;
  /** Where in the walk cycle the hoof meets the ground, in seconds. */
  at: number;
}

/** The hair is loose this far from the body, in metres, and its tips move this much. */
const SWAY_REACH_M = 0.2;
const SWAY_AMPLITUDE_M = 0.03;

export class ModelMare implements Mare {
  readonly group = new THREE.Group();
  readonly rigged = true;
  readonly dust = new Dust();
  readonly contourCapacity: number;
  private readonly orient = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly walk: THREE.AnimationAction;
  private readonly idle: THREE.AnimationAction;
  private readonly walkDuration: number;
  private readonly idleDuration: number;
  /** Metres per walk cycle: the clip's own, so her planted hooves slide as little as they can. */
  private readonly stride: number;
  private readonly skins: Skin[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly footfalls: Footfall[] = [];
  private readonly wind = {
    time: { value: 0 },
    strength: { value: 1 },
    amplitude: { value: 0 },
    perMetre: { value: 1 },
  };
  private lastWalkTime = 0;
  private idleClock = 0;
  private standing = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();

  constructor(root: THREE.Group, clips: THREE.AnimationClip[]) {
    root.updateMatrixWorld(true);
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    // Her size and her stance: feet on the ground, centred, facing +x — the way the drawing faces.
    const box = new THREE.Box3().setFromObject(root);
    const scale = 1.92 / (box.max.y - box.min.y);
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    root.position.set(-(box2.min.x + box2.max.x) / 2, -box2.min.y, -(box2.min.z + box2.max.z) / 2);
    this.orient.add(root);
    this.group.add(this.orient);
    root.updateMatrixWorld(true);
    const head = this.bones.get(BONES.head);
    const back = this.bones.get(BONES.back);
    if (head && back) {
      head.getWorldPosition(this.a);
      back.getWorldPosition(this.b);
      this.orient.rotation.y = Math.atan2(this.a.z - this.b.z, this.a.x - this.b.x);
    }
    this.group.updateMatrixWorld(true);

    // Her materials, and what the contour needs of each mesh — once she is her size, so the hair's reach is in metres.
    const body = meshes.filter((m) => BODY_MATERIALS.has((m.material as THREE.Material).name));
    for (const mesh of meshes) {
      const original = mesh.material as THREE.Material;
      const tone = PALETTE[original.name] ?? PALETTE['Main']!;
      mesh.geometry = smoothed(mesh.geometry);
      // Transparent from the start: she fades at the end, and toggling it then would recompile every program mid-scroll.
      const material = new THREE.MeshStandardMaterial({
        color: tone.color,
        emissive: tone.emissive,
        roughness: tone.roughness,
        metalness: 0,
        transparent: true,
      });
      if (original.name === 'Hair') this.blow(material, mesh, body);
      mesh.material = material;
      // The model's own material is not coming back.
      original.dispose();
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.materials.push(material);
      this.skins.push(this.prepare(mesh));
    }
    this.contourCapacity = this.skins.reduce((n, s) => n + s.edges.length * 6, 0);

    this.mixer = new THREE.AnimationMixer(root);
    const walkClip = clips.find((c) => c.name === 'Walk') ?? clips[0]!;
    const idleClip = clips.find((c) => c.name === 'Idle') ?? walkClip;
    this.walk = this.mixer.clipAction(walkClip);
    this.idle = this.mixer.clipAction(idleClip);
    this.walkDuration = walkClip.duration;
    this.idleDuration = idleClip.duration;
    this.walk.play();
    this.idle.play();
    this.walk.paused = true;
    this.idle.paused = true;
    this.stride = this.readGait();
  }

  /**
   * The hair material sways with time: a displacement after skinning, weighted by how far each
   * vertex sits from the body, so the roots stay put and the tips move; fading as she goes. The
   * mesh keeps its own units (this one is modelled at a hundredth of a metre under a scaled
   * node), so the amplitude and the wave's length are given in metres and converted once.
   */
  private blow(material: THREE.MeshStandardMaterial, hair: THREE.SkinnedMesh, body: THREE.SkinnedMesh[]) {
    hair.geometry.setAttribute('aSway', new THREE.BufferAttribute(swayWeights(hair, body), 1));
    hair.matrixWorld.decompose(this.a, new THREE.Quaternion(), this.b);
    const metresPerUnit = this.b.y;
    this.wind.perMetre.value = metresPerUnit;
    this.wind.amplitude.value = SWAY_AMPLITUDE_M / metresPerUnit;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['uWindTime'] = this.wind.time;
      shader.uniforms['uWind'] = this.wind.strength;
      shader.uniforms['uSwayAmplitude'] = this.wind.amplitude;
      shader.uniforms['uPerMetre'] = this.wind.perMetre;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\n attribute float aSway; uniform float uWindTime; uniform float uWind; uniform float uSwayAmplitude; uniform float uPerMetre;',
        )
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>
           vec3 metres = transformed * uPerMetre;
           float gust = sin(uWindTime * 1.9 + metres.y * 4.0 + metres.z * 2.2) * 0.7 + sin(uWindTime * 0.63 + metres.y * 1.3) * 0.3;
           transformed += vec3(0.45, 0.2, -0.6) * gust * uSwayAmplitude * uWind * aSway;`,
        );
    };
  }

  /** The mesh, ready to be posed on the CPU: a copy of its positions, its faces, and its edges keyed by position so duplicated vertices still share one edge. */
  private prepare(mesh: THREE.SkinnedMesh): Skin {
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const index = geo.index
      ? (geo.index.array as Uint16Array | Uint32Array)
      : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const faces = Uint32Array.from(index);
    const canon = new Map<string, number>();
    const canonOf = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      const found = canon.get(key);
      if (found === undefined) {
        canon.set(key, i);
        canonOf[i] = i;
      } else canonOf[i] = found;
    }
    const edgeMap = new Map<string, Edge>();
    const faceCount = faces.length / 3;
    for (let f = 0; f < faceCount; f += 1) {
      for (let k = 0; k < 3; k += 1) {
        const a = faces[f * 3 + k]!;
        const b = faces[f * 3 + ((k + 1) % 3)]!;
        const ca = canonOf[a]!;
        const cb = canonOf[b]!;
        const key = ca < cb ? `${ca}-${cb}` : `${cb}-${ca}`;
        const edge = edgeMap.get(key);
        if (!edge) edgeMap.set(key, { a, b, f1: f, f2: -1 });
        else if (edge.f2 === -1) edge.f2 = f;
      }
    }
    return {
      mesh,
      posed: new Float32Array(pos.count * 3),
      faces,
      edges: [...edgeMap.values()],
      facing: new Uint8Array(faceCount),
    };
  }

  /**
   * What the walk clip says about her gait: when each hoof meets the ground, and how far the
   * planted hooves carry her per cycle — the stride the scroll should scrub at, so they skate
   * as little as this clip allows (its front and hind hooves do not quite agree; the mean is
   * the least of it). Returns the stride, or the drawing's where the clip says nothing.
   */
  private readGait(): number {
    const hooves = BONES.hooves.map((n) => this.bones.get(n)).filter((b): b is THREE.Bone => Boolean(b));
    const steps = 96;
    this.walk.setEffectiveWeight(1);
    this.idle.setEffectiveWeight(0);
    const heights = hooves.map(() => new Float32Array(steps));
    const forward = hooves.map(() => new Float32Array(steps));
    for (let s = 0; s < steps; s += 1) {
      this.walk.time = (s / steps) * this.walkDuration;
      this.mixer.update(0);
      this.group.updateMatrixWorld(true);
      hooves.forEach((bone, i) => {
        bone.getWorldPosition(this.a);
        heights[i]![s] = this.a.y;
        forward[i]![s] = this.a.x;
      });
    }
    const strides: number[] = [];
    hooves.forEach((bone, i) => {
      const down = touchdownIndex(heights[i]!);
      if (down >= 0) this.footfalls.push({ bone, at: (down / steps) * this.walkDuration });
      const stride = strideFromStance(heights[i]!, forward[i]!);
      if (stride > 0) strides.push(stride);
    });
    this.walk.time = 0;
    this.mixer.update(0);
    this.group.updateMatrixWorld(true);
    return strides.length > 0 ? strides.reduce((a, b) => a + b, 0) / strides.length : STRIDE_M;
  }

  pose(x: number, z: number, distance: number, standing: number) {
    this.group.position.set(x, 0, z);
    this.standing = standing;
    const t = ((distance / this.stride) * this.walkDuration) % this.walkDuration;
    this.walk.time = t;
    this.idle.time = this.idleClock % this.idleDuration;
    this.walk.setEffectiveWeight(1 - standing);
    this.idle.setEffectiveWeight(standing);
    this.mixer.update(0);
    this.group.updateMatrixWorld(true);
    // A hoof that came down since the last pose raises a little dust — only as she walks forward, a step at a time.
    if (standing < 0.5 && this.group.visible) {
      for (const fall of this.footfalls)
        if (footfallCrossed(this.lastWalkTime, t, this.walkDuration, fall.at))
          this.dust.spawn(fall.bone.getWorldPosition(this.a));
    }
    this.lastWalkTime = t;
  }

  attach(name: HorseAttach, target: THREE.Vector3): THREE.Vector3 {
    const anchor = ANCHORS[name];
    const bone = this.bones.get(anchor.bone);
    if (!bone) return target.copy(this.group.position).add(this.a.set(0, 1, 0));
    bone.getWorldPosition(target);
    return target.add(this.a.set(anchor.offset[0], anchor.offset[1], anchor.offset[2]));
  }

  contour(camera: THREE.Camera, out: Float32Array): number {
    // The silhouette: every edge where the surface turns away from the lens, plus every open edge.
    const eye = camera.getWorldPosition(this.c);
    let n = 0;
    for (const skin of this.skins) {
      const { mesh, posed, faces, edges, facing } = skin;
      const count = posed.length / 3;
      for (let i = 0; i < count; i += 1) {
        // getVertexPosition reads the vertex and skins it; applyBoneTransform alone would skin whatever the target held.
        mesh.getVertexPosition(i, this.a).applyMatrix4(mesh.matrixWorld);
        posed[i * 3] = this.a.x;
        posed[i * 3 + 1] = this.a.y;
        posed[i * 3 + 2] = this.a.z;
      }
      const faceCount = faces.length / 3;
      for (let f = 0; f < faceCount; f += 1) {
        const i0 = faces[f * 3]! * 3;
        const i1 = faces[f * 3 + 1]! * 3;
        const i2 = faces[f * 3 + 2]! * 3;
        const ax = posed[i1]! - posed[i0]!;
        const ay = posed[i1 + 1]! - posed[i0 + 1]!;
        const az = posed[i1 + 2]! - posed[i0 + 2]!;
        const bx = posed[i2]! - posed[i0]!;
        const by = posed[i2 + 1]! - posed[i0 + 1]!;
        const bz = posed[i2 + 2]! - posed[i0 + 2]!;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        facing[f] =
          nx * (eye.x - posed[i0]!) + ny * (eye.y - posed[i0 + 1]!) + nz * (eye.z - posed[i0 + 2]!) > 0 ? 1 : 0;
      }
      for (const e of edges) {
        if (n + 6 > out.length) return n;
        const open = e.f2 === -1;
        if (!open && facing[e.f1] === facing[e.f2]) continue;
        n = this.lift(posed, e.a * 3, eye, out, n);
        n = this.lift(posed, e.b * 3, eye, out, n);
      }
    }
    return n;
  }

  /** One contour point, moved toward the lens by a hair so the line reads on the surface rather than inside it. */
  private lift(posed: Float32Array, i: number, eye: THREE.Vector3, out: Float32Array, n: number): number {
    this.a.set(posed[i]!, posed[i + 1]!, posed[i + 2]!);
    this.b.copy(eye).sub(this.a).normalize().multiplyScalar(LIFT);
    this.a.add(this.b);
    out[n] = this.a.x;
    out[n + 1] = this.a.y;
    out[n + 2] = this.a.z;
    return n + 3;
  }

  fade(opacity: number) {
    for (const m of this.materials) m.opacity = opacity;
    this.group.visible = opacity > 0;
    this.wind.strength.value = opacity;
  }

  tick(seconds: number, dt: number) {
    this.wind.time.value = seconds;
    this.idleClock += dt * this.standing;
    this.dust.tick(seconds, dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const skin of this.skins) {
      skin.mesh.geometry.dispose();
      skin.mesh.skeleton.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.dust.dispose();
  }
}

/**
 * The model is built low-poly, with a normal per facet; in this light a faceted body reads as a
 * game piece, a smooth one as a horse. Vertices split only for their normals are joined again
 * and the normals recomputed across the shared surface.
 */
function smoothed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.deleteAttribute('normal');
  const joined = mergeVertices(geometry);
  joined.computeVertexNormals();
  geometry.dispose();
  return joined;
}

/**
 * How loose each hair vertex is: its distance from the nearest body vertex, in metres, eased to
 * one at SWAY_REACH_M. The roots of the mane and the dock of the tail come out near zero; the
 * tips near one.
 */
function swayWeights(hair: THREE.SkinnedMesh, body: THREE.SkinnedMesh[]): Float32Array {
  const surface: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of body) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      surface.push(v.x, v.y, v.z);
    }
  }
  const pos = hair.geometry.attributes.position as THREE.BufferAttribute;
  const weights = new Float32Array(pos.count);
  if (surface.length === 0) return weights.fill(1);
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(hair.matrixWorld);
    let nearest = Infinity;
    for (let j = 0; j < surface.length; j += 3) {
      const dx = surface[j]! - v.x;
      const dy = surface[j + 1]! - v.y;
      const dz = surface[j + 2]! - v.z;
      nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
    }
    const t = Math.min(1, Math.sqrt(nearest) / SWAY_REACH_M);
    weights[i] = t * t * (3 - 2 * t);
  }
  return weights;
}

/** The model, from the site's own files; the caller keeps the slab until this resolves. */
export async function loadMare(url = '/models/horse.glb'): Promise<ModelMare> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return new ModelMare(gltf.scene, gltf.animations);
}
