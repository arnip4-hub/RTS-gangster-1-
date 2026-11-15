import * as THREE from 'three';
import type { Person, WorldState } from '../sim/types';
import { streetCorpseStage } from './corpsePresentation';
import { peopleList } from '../sim/entityLists';
import { illustratedPersonRow } from './illustratedPeople';
import { patchInstancedUv } from './materialUv';
import { InstancePool } from './pool';
import { KERB_H } from './util';

const LENGTH = 2.3, WIDTH = 1.35, ATLAS_ROWS = 32;
type MarkKind = 'sheet' | 'charred';

function markTexture(kind: MarkKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  if (kind === 'sheet') {
    // Shoes remain visible below the cloth; folds separate it from a white tile.
    ctx.fillStyle = '#292723'; ctx.fillRect(92, 220, 25, 17); ctx.fillRect(140, 220, 25, 17);
    ctx.beginPath(); ctx.moveTo(94, 35); ctx.quadraticCurveTo(128, 14, 163, 35);
    ctx.lineTo(184, 92); ctx.lineTo(172, 205); ctx.quadraticCurveTo(128, 221, 83, 205);
    ctx.lineTo(72, 92); ctx.closePath();
    ctx.fillStyle = '#f0ece2'; ctx.fill(); ctx.strokeStyle = '#b5afa2'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(115,112,105,.48)'; ctx.lineWidth = 3;
    for (const [x, y] of [[93, 89], [158, 111], [100, 155], [151, 182]]) {
      ctx.beginPath(); ctx.moveTo(x - 13, y - 8); ctx.quadraticCurveTo(x + 4, y, x + 13, y + 14); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(128, 36, 19, 0, Math.PI * 2);
    ctx.moveTo(99, 57); ctx.lineTo(55, 90); ctx.lineTo(60, 107); ctx.lineTo(90, 93);
    ctx.lineTo(91, 161); ctx.lineTo(69, 230); ctx.lineTo(99, 238); ctx.lineTo(127, 175);
    ctx.lineTo(156, 238); ctx.lineTo(186, 229); ctx.lineTo(163, 160); ctx.lineTo(165, 94);
    ctx.lineTo(196, 110); ctx.lineTo(206, 93); ctx.lineTo(159, 57); ctx.closePath();
    ctx.fillStyle = '#201c18'; ctx.fill(); ctx.strokeStyle = '#40332a'; ctx.lineWidth = 6; ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The victim's actual painted street figure lies on the pavement. Once an
 *  officer arrives it is covered, and disappears when the hearse loads it. */
export class DeathMarks {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(WIDTH, LENGTH).rotateX(-Math.PI / 2);
  private readonly bodies: InstancePool;
  private readonly marks: Record<MarkKind, THREE.InstancedMesh>;
  private signature = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly uv = new THREE.Vector4();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private bodyTexture: THREE.Texture | null;

  constructor(private readonly capacity = 256, private readonly sheetsOnly = false) {
    this.group.name = 'death-scenes';
    this.bodyTexture = sheetsOnly ? null : new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}art/city/illustrated-people-atlas.png`);
    if (this.bodyTexture) {
      this.bodyTexture.colorSpace = THREE.SRGBColorSpace;
      this.bodyTexture.minFilter = this.bodyTexture.magFilter = THREE.LinearFilter;
      this.bodyTexture.generateMipmaps = false;
    }
    const bodyMaterial = new THREE.MeshBasicMaterial({ map: this.bodyTexture, side: THREE.DoubleSide,
      transparent: true, depthWrite: false });
    patchInstancedUv(bodyMaterial);
    this.bodies = new InstancePool(this.geometry, bodyMaterial, capacity, { uv: true, dynamic: true });
    this.bodies.mesh.name = 'individual-street-bodies';
    this.bodies.mesh.renderOrder = 2;
    this.group.add(this.bodies.mesh);
    const make = (kind: MarkKind) => {
      const material = new THREE.MeshBasicMaterial({ map: markTexture(kind), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
      this.group.add(mesh); return mesh;
    };
    this.marks = { sheet: make('sheet'), charred: make('charred') };
  }

  update(w: WorldState, groundY: (x: number, y: number) => number = () => KERB_H,
    at: (p: Person) => { x: number; y: number } = p => p.pos): void {
    const dead = peopleList(w).filter(p => {
      const stage = streetCorpseStage(p, w);
      return stage != null && stage !== 'gone' && (!this.sheetsOnly || stage === 'sheet');
    })
      .sort((a, b) => (b.diedAt ?? 0) - (a.diedAt ?? 0) || b.id - a.id).slice(0, this.capacity);
    const signature = dead.map(p => `${p.id}:${streetCorpseStage(p, w)}`).join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    this.bodies.reset();
    const counts: Record<MarkKind, number> = { sheet: 0, charred: 0 };
    for (const p of dead) {
      const kind = streetCorpseStage(p, w) === 'sheet' ? 'sheet'
        : p.burningEscape?.fatal ? 'charred' : 'body';
      const angle = ((p.id * 2654435761) >>> 0) / 0x100000000 * Math.PI * 2;
      this.rotation.setFromAxisAngle(this.up, angle);
      const pos = at(p);
      this.matrix.compose(new THREE.Vector3(pos.x, groundY(pos.x, pos.y) + .05, pos.y),
        this.rotation, new THREE.Vector3(1, 1, 1));
      if (kind === 'body') {
        const row = illustratedPersonRow(p);
        this.uv.set(1 / 4, 1 / ATLAS_ROWS, 0, (ATLAS_ROWS - 1 - row) / ATLAS_ROWS);
        this.bodies.push(this.matrix, undefined, this.uv);
      } else {
        const mesh = this.marks[kind]; mesh.setMatrixAt(counts[kind]++, this.matrix);
      }
    }
    this.bodies.commit();
    for (const kind of ['sheet', 'charred'] as const) {
      const mesh = this.marks[kind]; mesh.count = counts[kind]; mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.bodies.dispose(); this.bodyTexture?.dispose();
    for (const mesh of Object.values(this.marks)) {
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose(); mesh.dispose();
    }
    this.geometry.dispose();
  }
}
