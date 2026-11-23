import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { paintedVehicleMaterial } from '../src/render/vehiclePaint';
import { isTrafficTaxi, TAXI_VEHICLE_PAINT, truckCanvasPaint, VEHICLE_PAINTS } from '../src/render/vehicleLivery';
import { createSculptVehicle } from '../src/render/sculptVehicles';

describe('1930s enamel and traffic variants', () => {
  it('keeps illustrated paint matte and gives enamel a lower coachwork roughness', () => {
    const source = new THREE.MeshStandardMaterial({ roughness: .4, metalness: .2 });
    const illustrated = paintedVehicleMaterial(source) as THREE.MeshStandardMaterial;
    const enamel = paintedVehicleMaterial(source, 'coupe', undefined, { finish: 'enamel' }) as THREE.MeshStandardMaterial;
    expect(illustrated.roughness).toBeGreaterThanOrEqual(.72);
    expect(enamel.roughness).toBe(.4);
    const shader = { vertexShader: '\n#include <common>\n#include <color_vertex>\n', fragmentShader: '\n#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n' };
    enamel.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 0.37, coachMask);');
    expect(shader.fragmentShader).toContain('metalnessFactor = mix(metalnessFactor, 0.14, coachMask);');
  });

  it('keeps a traffic slot a taxi across minutes', () => {
    const slots = Array.from({ length: 40 }, (_, i) => i);
    const first = slots.map(isTrafficTaxi);
    expect(slots.map(isTrafficTaxi)).toEqual(first);
    expect(first.filter(Boolean).length).toBeGreaterThan(0);
    expect(TAXI_VEHICLE_PAINT).not.toBe(VEHICLE_PAINTS[0].color);
  });

  it('keeps truck canvas colour stable and off the civilian palette length', () => {
    expect(VEHICLE_PAINTS).toHaveLength(12);
    expect(truckCanvasPaint('truck:4')).toBe(truckCanvasPaint('truck:4'));
    expect(truckCanvasPaint('truck:4')).not.toBe(truckCanvasPaint('truck:9'));
  });

  it('paints coachwork without swapping illustrated atlases', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ name: 'body' }));
    root.add(mesh);
    const built = createSculptVehicle(root, 'coupe', 2, { painted: false, coachworkPaint: true });
    expect(built.parts[0].instanceColor).toBeTruthy();
    built.parts.forEach(part => { part.geometry.dispose(); part.dispose(); });
    built.ownedMaterials.forEach(material => material.dispose());
  });

  it('keeps truck canvas above the bed and police cream on the doors only', () => {
    const source = new THREE.MeshStandardMaterial();
    const truck = paintedVehicleMaterial(source, 'truck', { length: 5.54, width: 1.98, height: 2.43 }) as THREE.MeshStandardMaterial;
    const coupe = paintedVehicleMaterial(source, 'coupe', { length: 4.64, width: 1.86, height: 1.92 }) as THREE.MeshStandardMaterial;
    const shader = { vertexShader: '\n#include <common>\n#include <color_vertex>\n', fragmentShader: '\n#include <common>\n#include <map_fragment>\n' };
    truck.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('step(1.142100, vVehiclePoint.y)');
    expect(shader.fragmentShader).toContain('canvasTint');
    coupe.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('step(-0.835200, vVehiclePoint.x)');
    expect(shader.fragmentShader).toContain('step(0.632400, abs(vVehiclePoint.z))');
  });
});
