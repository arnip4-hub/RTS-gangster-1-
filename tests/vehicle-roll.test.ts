import { describe, expect, it } from 'vitest';
import { CityRenderer } from '../src/render/scene';
import { nextVehicleRoll, retainVehicleYaw } from '../src/render/vehicleLivery';

describe('vehicle roll and street fittings', () => {
  it('keeps a stable yaw-key count across frames and drops cars that left', () => {
    const samples = new Map<string, number>();
    const frames = [
      ['t:0:1:1', 't:1:2:-1', 'fleet:a'],
      ['t:0:1:1', 't:1:2:-1', 'fleet:a'],
      ['t:0:1:1', 'fleet:a'],
    ];
    for (const keys of frames) {
      const active = new Set(keys);
      for (const key of keys) samples.set(key, nextVehicleRoll(samples.get(key), .2, true));
      retainVehicleYaw(samples, active);
    }
    expect([...samples.keys()].sort()).toEqual(['fleet:a', 't:0:1:1']);
    expect(samples.size).toBe(2);
  });

  it('hides the new vehicle pools when streets close', () => {
    const mesh = () => ({ visible: true, dispose() {} });
    const city = Object.assign(Object.create(CityRenderer.prototype), {
      streetsOpen: true,
      vehicleSpritesActive: false,
      sculptModelsActive: false,
      preferVehicleSprites: false,
      disposed: false,
      preparationRevision: 0,
      reviewSpeedsterSprite: false,
      taillightMat: { opacity: .5 },
      vehicleSprites: undefined,
      sculptModels: undefined,
      sedans: { mesh: mesh() },
      trucks: { mesh: mesh() },
      hearses: { mesh: mesh() },
      speedsters: { mesh: mesh() },
      headlamps: { mesh: mesh() },
      taillights: { mesh: mesh() },
      taxiSigns: { mesh: mesh() },
      policeBeacons: { mesh: mesh() },
      agentMesh: { visible: true, count: 0 },
      actorMotion: { clear() {} },
      actors: { setVisible() {} },
      personHalo: { visible: true },
      footRings: { mesh: mesh() },
      waitMarks: { mesh: mesh() },
      arrestMarks: { mesh: mesh() },
      updateCamera() {},
    });
    city.setStreetsOpen(false);
    expect(city.taillights.mesh.visible).toBe(false);
    expect(city.taxiSigns.mesh.visible).toBe(false);
    expect(city.policeBeacons.mesh.visible).toBe(false);
    expect(city.headlamps.mesh.visible).toBe(false);
  });
});
