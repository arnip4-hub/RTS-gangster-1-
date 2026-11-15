import type { Person, WorldState } from '../sim/types';
import { campaignMinute } from '../sim/calendar';
import { bodySceneStage } from '../sim/bodyRecovery';
import { ACTION_DURATION, type CharacterAction } from './characterActions';

/** A null recovery record explicitly means custody or an indoor death. Old
 * saves without a record retain the previous recent-week street-body rule. */
export function streetCorpseStage(person: Person, world: WorldState, subMinute = 0): 'body' | 'sheet' | 'gone' | null {
  if (person.status !== 'dead' || person.inVehicle || person.bodyRecovery === null) return null;
  if (person.bodyRecovery === undefined)
    return person.diedWeek >= world.week - 1 ? 'body' : null;
  return bodySceneStage(person, campaignMinute(world, world.minute + subMinute));
}

/** Preserve an incident's visible fall, then keep its last pose on reload or
 * after the short-lived action cue expires. This never starts a new fall. */
export function heldCorpseAction(person: Person, current?: CharacterAction): CharacterAction {
  if (current && (current.kind === 'death' || current.kind === 'burnDeath' || current.kind === 'fleeBurning')) return current;
  return person.burningEscape?.fatal
    ? { kind: 'burnDeath', time: ACTION_DURATION.burnDeath }
    : { kind: 'death', time: ACTION_DURATION.death };
}
