import * as THREE from 'three';
import type { HorseAttach } from '@/components/story/horse-shape';
import type { Mare } from '@/components/story/ranch/mare';
import { CONTEXTS, STAGE, arrival, easeInOut, easeOut, span, type Tag } from '@/components/story/ranch/tags';

/**
 * The hand on the scene, outside React: given one number — how far the person has scrolled —
 * it places the camera, turns the doors, walks her, draws her contour, hangs her records on
 * her, lets her go, unspools her contour into the graph's edges and settles the records into
 * their places. It owns the lines it draws and the arrays it lerps, and touches the DOM only
 * to move the tags. Time reaches it only for the wind in her hair and the dust at her hooves.
 */
export const PLANE_Z = -7;
const HORSE_X = { from: -13, to: 0.2 };
/** Where a tag floats from its place on her, in metres. */
const FLOAT: Record<HorseAttach, [number, number]> = {
  withers: [-0.4, 0.72],
  head: [0.42, 0.42],
  chest: [0.8, -0.04],
  belly: [0.12, -0.56],
  croup: [-0.8, 0.5],
  flank: [-0.86, -0.3],
  hock: [-0.9, -0.5],
};
/** A contour shorter than this is nothing to draw: one segment. */
const MIN_CONTOUR = 6;
/** The least a tag keeps from the edge of the screen. */
const EDGE_PX = 8;

export interface Layout {
  phone: boolean;
  camera: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; push: THREE.Vector3 };
  /** The graph's box on the plane, in metres: left, top, width, height (y up). */
  box: { x: number; y: number; w: number; h: number };
}

export function layoutFor(phone: boolean): Layout {
  return phone
    ? {
        phone,
        camera: {
          from: new THREE.Vector3(0, 1.6, 5.5),
          to: new THREE.Vector3(0, 1.7, 0.6),
          look: new THREE.Vector3(0.1, 1.4, PLANE_Z),
          push: new THREE.Vector3(0, -0.05, -0.5),
        },
        box: { x: -0.7, y: 2.0, w: 1.4, h: 2.5 },
      }
    : {
        phone,
        camera: {
          from: new THREE.Vector3(0, 1.6, 5.5),
          to: new THREE.Vector3(0, 1.62, -2.2),
          look: new THREE.Vector3(0.2, 1.32, PLANE_Z),
          push: new THREE.Vector3(0.3, -0.08, -0.6),
        },
        box: { x: -2.4, y: 1.95, w: 5.7, h: 2.55 },
      };
}

export interface Edge {
  from: THREE.Vector3;
  to: THREE.Vector3;
  toBlock: boolean;
}

export interface Frame {
  camera: THREE.Camera;
  size: { width: number; height: number };
  mare: Mare | null;
  leftDoor: THREE.Group | null;
  rightDoor: THREE.Group | null;
  frame: THREE.MeshBasicMaterial | null;
  seam: THREE.MeshBasicMaterial | null;
  tagDom: (HTMLDivElement | null)[];
}

interface Configured {
  layout: Layout;
  tags: Tag[];
  visible: boolean[];
  counts: number[];
  places: Map<string, THREE.Vector3>;
  edges: Edge[];
  decisionAt: THREE.Vector3;
}

/** A geometry with room for this many floats of segments, drawing none of them yet; rewritten in place from then on. */
function segmentsGeometry(capacity: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  // Never empty: an empty position attribute has no bounding sphere, and three says so on the console.
  const attr = new THREE.BufferAttribute(new Float32Array(Math.max(MIN_CONTOUR, capacity)), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setDrawRange(0, 0);
  return geo;
}

/** The first `floats` of a position attribute changed: upload those, draw those. */
function commit(geo: THREE.BufferGeometry, floats: number) {
  const attr = geo.attributes.position as THREE.BufferAttribute;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, floats);
  attr.needsUpdate = true;
  geo.setDrawRange(0, floats / 3);
}

function line(color: string, dashed = false): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0, dashSize: 0.08, gapSize: 0.08 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
  const l = new THREE.Line(geo, mat);
  l.visible = false;
  l.frustumCulled = false;
  return l;
}

export class Rig {
  readonly group = new THREE.Group();
  private leaders: THREE.Line[] = [];
  private edgeLines: THREE.Mesh[] = [];
  private contextLines: THREE.Line[] = [];
  private readonly ribbon = new THREE.PlaneGeometry(1, 1);
  /** Her contour, drawn on her while she is here. */
  private readonly outline: THREE.LineSegments;
  /** Her contour on its way to becoming the graph. */
  private readonly morph: THREE.LineSegments;
  /** The mare the contour buffers are sized for; a new mare (the model after the drawing) gets new ones. */
  private sizedFor: Mare | null = null;
  /** Where each contour segment was when she began to go, and where it is bound; `frozen` floats of each are live. */
  private starts = new Float32Array(MIN_CONTOUR);
  private targets = new Float32Array(MIN_CONTOUR);
  private frozen = 0;
  private cfg: Configured | null = null;
  private contourKey = '';
  private readonly v = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor() {
    this.outline = new THREE.LineSegments(
      segmentsGeometry(MIN_CONTOUR),
      new THREE.LineBasicMaterial({ color: '#e8dcc8', transparent: true, opacity: 0.85 }),
    );
    this.outline.frustumCulled = false;
    this.group.add(this.outline);
    this.morph = new THREE.LineSegments(
      segmentsGeometry(MIN_CONTOUR),
      new THREE.LineBasicMaterial({ color: '#e8dcc8', transparent: true, opacity: 0 }),
    );
    this.morph.visible = false;
    this.morph.frustumCulled = false;
    this.group.add(this.morph);
  }

  /** The rows and the places change without a scroll; the lines are rebuilt to match. */
  configure(cfg: Configured) {
    this.cfg = cfg;
    for (const l of [...this.leaders, ...this.contextLines]) {
      this.group.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    for (const m of this.edgeLines) {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.leaders = cfg.tags.map(() => line('#d48a60'));
    // An edge is a thin ribbon on the graph's plane: a line with a width the eye can find.
    this.edgeLines = cfg.edges.map((e) => {
      const m = new THREE.Mesh(
        this.ribbon,
        new THREE.MeshBasicMaterial({
          color: e.toBlock ? '#d9a45f' : '#c9b9a3',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
        }),
      );
      m.visible = false;
      m.frustumCulled = false;
      return m;
    });
    this.contextLines = CONTEXTS.map(() => line('#d48a60', true));
    for (const l of [...this.leaders, ...this.edgeLines, ...this.contextLines]) this.group.add(l);
    this.frozen = 0;
    this.contourKey = '';
  }

  dispose() {
    for (const l of [...this.leaders, ...this.contextLines, this.morph, this.outline]) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    for (const m of this.edgeLines) (m.material as THREE.Material).dispose();
    this.ribbon.dispose();
  }

  /** Buffers the size of her contour, once per mare: the lines are then rewritten in place, never reallocated. */
  private size(mare: Mare) {
    const capacity = Math.max(MIN_CONTOUR, mare.contourCapacity);
    for (const l of [this.outline, this.morph]) {
      l.geometry.dispose();
      l.geometry = segmentsGeometry(capacity);
    }
    this.starts = new Float32Array(capacity);
    this.targets = new Float32Array(capacity);
    this.frozen = 0;
    this.contourKey = '';
    this.sizedFor = mare;
  }

  update(t: number, f: Frame, seconds: number, dt: number) {
    const cfg = this.cfg;
    if (!cfg) return;
    const L = cfg.layout;
    const mare = f.mare;
    if (mare && mare !== this.sizedFor) this.size(mare);

    // The camera walks through the doorway and settles; at the graph it leans in a little more.
    const dolly = easeInOut(span(t, [0.08, 0.36]));
    const push = easeInOut(span(t, [0.86, 1]));
    f.camera.position.lerpVectors(L.camera.from, L.camera.to, dolly).addScaledVector(L.camera.push, push);
    this.a.set(0, 1.6, -12).lerp(L.camera.look, dolly);
    f.camera.lookAt(this.a);
    const open = easeInOut(span(t, STAGE.doors));
    if (f.leftDoor) f.leftDoor.rotation.y = open * 1.95;
    if (f.rightDoor) f.rightDoor.rotation.y = -open * 1.95;
    // The seam of light is the doors' gap; it goes as they open.
    if (f.seam) f.seam.opacity = 1 - span(t, [0.02, 0.1]);

    // Her walk along the fence, the gait from the distance covered; she comes to a stand as the records arrive.
    const x = HORSE_X.from + (HORSE_X.to - HORSE_X.from) * easeOut(span(t, STAGE.walk));
    const standing = easeInOut(span(t, [0.5, 0.6]));
    const gone = span(t, [STAGE.graph[0], STAGE.graph[0] + 0.14]);
    if (mare) {
      mare.pose(x, PLANE_Z, x - HORSE_X.from, standing);
      mare.fade(1 - gone);
      mare.tick(seconds, dt);
      // Her contour, redrawn only when she or the camera moved.
      const key = `${x.toFixed(3)}|${standing.toFixed(3)}|${f.camera.position.x.toFixed(3)},${f.camera.position.z.toFixed(3)}|${mare.rigged ? 'm' : 's'}`;
      if (t < STAGE.graph[0] && key !== this.contourKey) {
        const geo = this.outline.geometry;
        const n = mare.contour(f.camera, (geo.attributes.position as THREE.BufferAttribute).array as Float32Array);
        if (n >= MIN_CONTOUR) {
          this.contourKey = key;
          commit(geo, n);
        }
      }
      (this.outline.material as THREE.LineBasicMaterial).opacity =
        0.85 * (1 - span(t, [STAGE.graph[0], STAGE.graph[0] + 0.05]));
      this.outline.visible = t < STAGE.graph[0] + 0.05 && x > HORSE_X.from + 0.01;
      if (t >= STAGE.graph[0] && this.frozen === 0) this.freeze(mare, f.camera, cfg);
      if (t < STAGE.graph[0]) this.frozen = 0;
    }

    // The dissolve: her contour, frozen where she stood, unspools into the graph's edges.
    const unspool = easeInOut(span(t, [STAGE.graph[0] + 0.02, STAGE.graph[1] - 0.04]));
    if (this.frozen > 0) {
      const geo = this.morph.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const n = this.frozen / 3;
      const segs = n / 2;
      const S = this.starts;
      const T = this.targets;
      for (let i = 0; i < n; i += 1) {
        // A wave from the first segment to the last: the outline leaves her the way it was drawn.
        const ti = Math.max(0, Math.min(1, unspool * 1.35 - (Math.floor(i / 2) / segs) * 0.35));
        const e = ti * ti * (3 - 2 * ti);
        pos.setXYZ(
          i,
          S[i * 3]! + (T[i * 3]! - S[i * 3]!) * e,
          S[i * 3 + 1]! + (T[i * 3 + 1]! - S[i * 3 + 1]!) * e,
          S[i * 3 + 2]! + (T[i * 3 + 2]! - S[i * 3 + 2]!) * e,
        );
      }
      commit(geo, this.frozen);
      (this.morph.material as THREE.LineBasicMaterial).opacity =
        0.9 * (1 - span(t, [STAGE.graph[1] - 0.05, STAGE.graph[1] + 0.02]));
      this.morph.visible = t >= STAGE.graph[0];
    } else {
      this.morph.visible = false;
    }

    // The records: on her, then to their places; each with its leader while it hangs on her.
    const settle = easeInOut(span(t, [STAGE.graph[0] + 0.02, STAGE.graph[1] - 0.02]));
    cfg.tags.forEach((tag, i) => {
      const el = f.tagDom[i];
      const leader = this.leaders[i]!;
      if (!el) return;
      if (!cfg.visible[i]) {
        el.style.opacity = '0';
        leader.visible = false;
        return;
      }
      const place = cfg.places.get(tag.node.id) ?? cfg.decisionAt;
      let opacity: number;
      if (tag.attach && mare) {
        const on = mare.attach(tag.attach, this.b);
        const scale = L.phone ? 0.7 : 1;
        const float = this.a.set(on.x + FLOAT[tag.attach][0] * scale, on.y + FLOAT[tag.attach][1] * scale, on.z + 0.05);
        this.keepOnScreen(float, el, f);
        opacity = span(t, arrival(i));
        const leaderOpacity = opacity * (1 - span(t, [STAGE.graph[0], STAGE.graph[0] + 0.06]));
        const pos = leader.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, float.x, float.y, float.z);
        pos.setXYZ(1, on.x, on.y, on.z);
        pos.needsUpdate = true;
        (leader.material as THREE.Material).opacity = leaderOpacity * 0.8;
        leader.visible = leaderOpacity > 0;
        this.v.lerpVectors(float, place, settle);
      } else {
        this.v.copy(place);
        opacity = span(t, [STAGE.graph[0] + 0.08, STAGE.graph[0] + 0.18]);
        leader.visible = false;
      }
      this.v.project(f.camera);
      if (this.v.z > 1) opacity = 0;
      const sx = ((this.v.x + 1) / 2) * f.size.width;
      const sy = ((1 - this.v.y) / 2) * f.size.height;
      el.style.transform = `translate(-50%, -50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      el.style.opacity = opacity.toFixed(3);
    });

    // The graph's edges arrive as the contour finishes becoming them; the contexts converge on the person.
    const crisp = span(t, [STAGE.graph[1] - 0.08, STAGE.graph[1] + 0.02]);
    if (f.frame) f.frame.opacity = 0.7 * easeInOut(span(t, [STAGE.graph[0] + 0.04, STAGE.graph[1] - 0.06]));
    cfg.edges.forEach((e, i) => {
      const m = this.edgeLines[i]!;
      const dx = e.to.x - e.from.x;
      const dy = e.to.y - e.from.y;
      m.position.set((e.from.x + e.to.x) / 2, (e.from.y + e.to.y) / 2, e.from.z + 0.01);
      m.rotation.z = Math.atan2(dy, dx);
      m.scale.set(Math.hypot(dx, dy), L.phone ? 0.02 : 0.013, 1);
      (m.material as THREE.Material).opacity = crisp * (e.toBlock ? 0.9 : 0.5);
      m.visible = crisp > 0;
    });
    const converge = span(t, [STAGE.graph[0] + 0.14, STAGE.graph[1] + 0.02]);
    CONTEXTS.forEach((_, i) => {
      const l = this.contextLines[i]!;
      const pos = l.geometry.attributes.position as THREE.BufferAttribute;
      const fx = L.box.x + L.box.w * (0.42 + i * 0.145);
      const fy = L.box.y + 1.6;
      pos.setXYZ(0, fx, fy, PLANE_Z);
      pos.setXYZ(1, cfg.decisionAt.x, cfg.decisionAt.y, cfg.decisionAt.z);
      pos.needsUpdate = true;
      l.computeLineDistances();
      (l.material as THREE.Material).opacity = converge * (cfg.counts[i]! > 0 ? 0.35 : 0.12);
      l.visible = converge > 0 && !L.phone;
    });
  }

  /**
   * A tag that would hang past the edge of the screen is brought back inside it, at the same
   * depth, so its leader follows it there: a phone is narrow and she is wide.
   */
  private keepOnScreen(float: THREE.Vector3, el: HTMLDivElement, f: Frame) {
    const ndc = this.v.copy(float).project(f.camera);
    if (ndc.z > 1) return;
    // Half the tag and a gutter, as fractions of the viewport's half-width and half-height.
    const halfW = (el.offsetWidth + 2 * EDGE_PX) / f.size.width;
    const halfH = (el.offsetHeight + 2 * EDGE_PX) / f.size.height;
    const x = Math.max(-1 + halfW, Math.min(1 - halfW, ndc.x));
    const y = Math.max(-1 + halfH, Math.min(1 - halfH, ndc.y));
    if (x === ndc.x && y === ndc.y) return;
    float.copy(ndc.set(x, y, ndc.z)).unproject(f.camera);
  }

  /** The moment she begins to go: her contour, frozen where she stands, and where each segment is bound. */
  private freeze(mare: Mare, camera: THREE.Camera, cfg: Configured) {
    const n = mare.contour(camera, this.starts);
    if (n < MIN_CONTOUR) return;
    const segs = n / 6;
    const E = cfg.edges.length;
    for (let s = 0; s < segs; s += 1) {
      // Segments are dealt along the edges in order: the outline unspools into them, first to last.
      const e = E > 0 ? Math.min(E - 1, Math.floor((s * E) / segs)) : -1;
      const first = E > 0 ? Math.ceil((e * segs) / E) : 0;
      const last = E > 0 ? Math.ceil(((e + 1) * segs) / E) : segs;
      const k = s - first;
      const count = Math.max(1, last - first);
      const from = e >= 0 ? cfg.edges[e]!.from : cfg.decisionAt;
      const to = e >= 0 ? cfg.edges[e]!.to : cfg.decisionAt;
      this.a.lerpVectors(from, to, k / count);
      this.b.lerpVectors(from, to, (k + 1) / count);
      this.targets.set([this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z], s * 6);
    }
    this.frozen = n;
  }
}
