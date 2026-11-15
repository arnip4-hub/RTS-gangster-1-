import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { cityPlanActivity } from '../src/ui/cityPlanActivity';

describe('live city plan activity', () => {
  it('keeps rival identities hidden until a known rival is near one of our people', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 812, citySize: 10 });
    const w = sim.world, player = sim.playerGang;
    const own = Object.values(w.people).find(p => p.gangId === player.id && p.role === 'lieutenant')!;
    const rival = Object.values(w.people).find(p => p.gangId != null && p.gangId !== player.id && p.role === 'lieutenant')!;
    const police = Object.values(w.people).find(p => p.role === 'police')!;
    const citizen = Object.values(w.people).find(p => p.role === 'citizen')!;
    expect(own).toBeTruthy();
    expect(rival).toBeTruthy();
    expect(police).toBeTruthy();
    expect(citizen).toBeTruthy();
    own.pos = { x: 100, y: 100 }; own.dest = { x: 105, y: 100 };
    rival.pos = { x: 115, y: 100 }; rival.dest = { x: 120, y: 100 };
    police.pos = { x: 280, y: 300 }; police.dest = { x: 285, y: 300 };
    citizen.pos = { x: 315, y: 320 }; citizen.dest = null; citizen.path = [];
    w.phase = 'week';

    const unidentified = cityPlanActivity(w, player.id);
    expect(unidentified.some(m => m.kind === 'gang' && m.gangId === rival.gangId)).toBe(false);
    expect(unidentified.some(m => m.kind === 'police' && m.pos.x === police.pos.x && m.pos.y === police.pos.y)).toBe(true);
    expect(unidentified.some(m => m.kind === 'civilian' && m.pos.x === citizen.pos.x && m.pos.y === citizen.pos.y)).toBe(false);
    citizen.dest = { x: 320, y: 320 };
    expect(cityPlanActivity(w, player.id).some(m => m.kind === 'civilian' && m.pos.x === citizen.pos.x && m.pos.y === citizen.pos.y)).toBe(true);
    player.knownPeople.push(rival.id);
    expect(cityPlanActivity(w, player.id).some(m => m.kind === 'gang' && m.gangId === rival.gangId)).toBe(true);
    rival.pos = { x: 500, y: 500 };
    expect(cityPlanActivity(w, player.id).some(m => m.kind === 'gang' && m.gangId === rival.gangId)).toBe(false);
    w.phase = 'planning';
    expect(cityPlanActivity(w, player.id)).toEqual([]);
  });
});
