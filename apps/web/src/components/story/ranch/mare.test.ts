import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The rigged mare against the model actually shipped: the rig's bone names, the gait read off
 * its walk clip, and what the scene asks of her. The dust's little texture wants a canvas, which
 * Node has not got; a stub stands in for it, since only its existence matters here.
 */
vi.stubGlobal('document', {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => undefined,
      fillStyle: '',
    }),
  }),
});

const { ModelMare } = await import('./mare');

async function load(): Promise<InstanceType<typeof ModelMare>> {
  const file = readFileSync(join(__dirname, '../../../../public/models/horse.glb'));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) =>
    new GLTFLoader().parse(buffer, '', resolve, reject),
  );
  return new ModelMare(gltf.scene, gltf.animations);
}

describe('ModelMare, on the model shipped', () => {
  let mare: InstanceType<typeof ModelMare>;
  beforeAll(async () => {
    mare = await load();
  });

  it('stands her height, on the ground, facing the way the drawing faces', () => {
    mare.pose(0, 0, 0, 0);
    const box = new THREE.Box3().setFromObject(mare.group);
    expect(box.max.y - box.min.y).toBeCloseTo(1.92, 1);
    expect(box.min.y).toBeCloseTo(0, 1);
    const head = mare.attach('head', new THREE.Vector3());
    const croup = mare.attach('croup', new THREE.Vector3());
    expect(head.x).toBeGreaterThan(croup.x);
    expect(head.y).toBeGreaterThan(1.3);
  });

  it('hangs every record from a bone the rig actually has, on the side the lens sees', () => {
    mare.pose(0, 0, 0, 0);
    const fallback = new THREE.Vector3(0, 1, 0);
    for (const name of ['withers', 'head', 'chest', 'belly', 'croup', 'flank', 'hock'] as const) {
      const at = mare.attach(name, new THREE.Vector3());
      expect(at.distanceTo(fallback), name).toBeGreaterThan(0.05);
      expect(at.y, name).toBeGreaterThan(0.2);
      expect(at.y, name).toBeLessThan(1.9);
    }
    expect(mare.attach('flank', new THREE.Vector3()).z).toBeGreaterThan(0.1);
    expect(mare.attach('hock', new THREE.Vector3()).z).toBeGreaterThan(0.1);
  });

  it('raises dust at each footfall walking forward, and none walking back', () => {
    const spawn = vi.spyOn(mare.dust, 'spawn');
    for (let cm = 0; cm <= 300; cm += 1) mare.pose(cm / 100, 0, cm / 100, 0);
    // A walk of three metres is at least two full cycles of four beats.
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(spawn.mock.calls.length).toBeLessThanOrEqual(16);
    spawn.mockClear();
    for (let cm = 300; cm >= 0; cm -= 1) mare.pose(cm / 100, 0, cm / 100, 0);
    expect(spawn).not.toHaveBeenCalled();
    spawn.mockClear();
    // A seek across the cycle is not a step.
    mare.pose(0, 0, 0, 0);
    mare.pose(1, 0, 1, 0);
    expect(spawn).not.toHaveBeenCalled();
    spawn.mockRestore();
  });

  it('draws a silhouette that fits the buffer it is promised', () => {
    mare.pose(0, -7, 4, 0);
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.6, 2);
    camera.lookAt(0, 1.2, -7);
    camera.updateMatrixWorld();
    const out = new Float32Array(mare.contourCapacity);
    const n = mare.contour(camera, out);
    expect(n).toBeGreaterThan(600);
    expect(n).toBeLessThanOrEqual(mare.contourCapacity);
    expect(n % 6).toBe(0);
    // The line sits between her and the lens, never behind her.
    for (let i = 2; i < n; i += 3) expect(out[i]!).toBeGreaterThan(-7.4);
  });
});
