import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { bodySceneStage, hearseAt, tickBodyRecovery } from '../src/sim/bodyRecovery';
import { campaignMinute } from '../src/sim/calendar';
import { createWorld } from '../src/sim/citygen';
import { killPerson } from '../src/sim/execution';
import { validateSaveWorld } from '../src/sim/saveSchema';

describe('street body recovery', () => {
  it('shows the individual until police arrive, then a sheet and a routed coroner van', () => {
    const w = createWorld({ ...newCampaignOptions(), citySize: 12, seed: 409 }).world;
    w.phase = 'week'; w.minute = 600;
    const victim = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    const officer = w.people[w.policeIds[0]];
    victim.buildingId = null; victim.pos = { ...officer.pos };
    killPerson(w, victim, 'test street death');
    expect(victim.bodyRecovery).toEqual({});
    expect(bodySceneStage(victim, campaignMinute(w))).toBe('body');

    officer.pos = { x: victim.pos.x + 50, y: victim.pos.y + 50 };
    tickBodyRecovery(w);
    expect(victim.bodyRecovery?.coveredAt).toBeUndefined();
    officer.pos = { ...victim.pos }; officer.inVehicle = false;
    tickBodyRecovery(w);
    const recovery = victim.bodyRecovery!;
    expect(recovery.coveredAt).toBe(campaignMinute(w));
    expect(bodySceneStage(victim, campaignMinute(w))).toBe('sheet');
    expect(recovery.hearseRoute!.length).toBeGreaterThan(1);
    expect(hearseAt(victim, recovery.hearseStartAt! - 1)).toBeNull();
    expect(hearseAt(victim, recovery.hearseArriveAt!)?.pos).toBeDefined();
    expect(bodySceneStage(victim, recovery.collectedAt!)).toBe('gone');
    expect(hearseAt(victim, recovery.collectedAt! + 1)).toBeTruthy();
    expect(hearseAt(victim, recovery.collectedAt! + recovery.hearseArriveAt! - recovery.hearseStartAt! + 1)).toBeNull();
    expect(() => validateSaveWorld(structuredClone(w))).not.toThrow();
  });

  it('does not put a prisoner killed in custody on the street', () => {
    const w = createWorld({ ...newCampaignOptions(), citySize: 12, seed: 410 }).world;
    w.phase = 'week'; w.minute = 600;
    const prisoner = Object.values(w.people).find(p => p.role === 'hood' && p.status === 'active')!;
    prisoner.status = 'jailed'; prisoner.jailWeeks = 3;
    killPerson(w, prisoner, 'test custody death');
    expect(prisoner.bodyRecovery).toBeNull();
  });
});
