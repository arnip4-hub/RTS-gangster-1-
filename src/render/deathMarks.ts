import * as THREE from 'three';
import type { Person, WorldState } from '../sim/types';
import { streetCorpseStage } from './corpsePresentation';
import { peopleList } from '../sim/entityLists';
import { KERB_H } from './util';

const LENGTH = 2.3, WIDTH = 1.35;
type MarkKind = 'sheet' | 'charred';

/** Low draped cloth over a concealed figure, with slight shoe tips at the foot. */
function drapedSheetGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 8, cols = 5;
  const halfL = LENGTH / 2, halfW = WIDTH / 2;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const x = -halfL + t * LENGTH;
    // Raised along the torso, lower at head and feet; slight shoe tips at foot end.
    const ridge = Math.sin(t * Math.PI) * 0.18 + (t > 0.82 ? (t - 0.82) * 0.12 : 0);
    for (let c = 0; c <= cols; c++) {
      const s = c / cols;
      const z = -halfW + s * WIDTH;
      const edge = 1 - Math.abs(s - 0.5) * 2;
      const y = 0.04 + ridge * edge * edge;
      positions.push(x, y, z);
      // Approximate upward normal with a slight outward lean at edges.
      const nx = Math.cos(t * Math.PI) * 0.15;
      const nz = (s - 0.5) * 0.4;
      const ny = 1;
      const len = Math.hypot(nx, ny, nz);
      normals.push(nx / len, ny / len, nz / len);
      uvs.push(t, s);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + (cols + 1);
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function markMaterial(kind: MarkKind): THREE.MeshStandardMaterial {
  if (kind === 'sheet') {
    return new THREE.MeshStandardMaterial({
      color: 0xe8e4dc, roughness: 0.92, metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x2a2420, roughness: 0.98, metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

/** Covered street bodies: a 3D draped sheet (or charred silhouette). Uncovered
 *  bodies stay as the 3D character; no sheet is drawn until police cover them. */
export class DeathMarks {
  readonly group = new THREE.Group();
  private readonly geometry = drapedSheetGeometry();
  private readonly marks: Record<MarkKind, THREE.InstancedMesh>;
  private signature = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly capacity = 256) {
    this.group.name = 'death-scenes';
    const make = (kind: MarkKind) => {
      const material = markMaterial(kind);
      const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = kind === 'sheet';
      mesh.receiveShadow = true;
      this.group.add(mesh); return mesh;
    };
    this.marks = { sheet: make('sheet'), charred: make('charred') };
  }

  update(w: WorldState, groundY: (x: number, y: number) => number = () => KERB_H,
    at: (p: Person) => { x: number; y: number } = p => p.pos): void {
    const dead = peopleList(w).filter(p => {
      const stage = streetCorpseStage(p, w);
      return stage === 'sheet' || (stage != null && p.burningEscape?.fatal);
    })
      .sort((a, b) => (b.diedAt ?? 0) - (a.diedAt ?? 0) || b.id - a.id).slice(0, this.capacity);
    const signature = dead.map(p => `${p.id}:${streetCorpseStage(p, w)}`).join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    const counts: Record<MarkKind, number> = { sheet: 0, charred: 0 };
    for (const p of dead) {
      const stage = streetCorpseStage(p, w);
      const kind: MarkKind = stage === 'sheet' ? 'sheet' : 'charred';
      const angle = ((p.id * 2654435761) >>> 0) / 0x100000000 * Math.PI * 2;
      this.rotation.setFromAxisAngle(this.up, angle);
      const pos = at(p);
      this.matrix.compose(new THREE.Vector3(pos.x, groundY(pos.x, pos.y) + .02, pos.y),
        this.rotation, new THREE.Vector3(1, 1, 1));
      const mesh = this.marks[kind]; mesh.setMatrixAt(counts[kind]++, this.matrix);
    }
    for (const kind of ['sheet', 'charred'] as const) {
      const mesh = this.marks[kind]; mesh.count = counts[kind]; mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of Object.values(this.marks)) {
      (mesh.material as THREE.Material).dispose(); mesh.dispose();
    }
    this.geometry.dispose();
  }
}
