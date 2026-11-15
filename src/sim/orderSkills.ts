/**
 * Which skill an order is done with (issue 17 item 28).
 *
 * Each order names the skills its success roll uses (ORDERS[type].skills): a
 * shop is smashed up with Fists, torched with Arson, an owner leaned on with
 * Intimidation. Where a gun changes how the job is done, the order also names
 * the skills an armed man uses (armedSkills): a raid is Fists without a
 * firearm and Firearms with one, a killing Knives or Firearms. A man carrying
 * a gun does the job whichever way he is better at; a man without one has no
 * choice. Physical attacks use their task expertise; stealth influences
 * observation and arrest separately (events.ts). Scouting and other orders
 * may still explicitly list Stealth as part of their own task rating.
 */
import type { OrderDef } from './constants';
import { SKILL_LABELS, type Person } from './types';
import { skillAvg } from './world';

/** One man's rating for an order, in stars. */
export function orderSkill(p: Person, def: OrderDef, armed: boolean): number {
  const bare = skillAvg(p, def.skills);
  return armed && def.armedSkills ? Math.max(bare, skillAvg(p, def.armedSkills)) : bare;
}

/** The crew's rating: the best hand on the job leads, the rest help a little. */
export function crewOrderSkill(actors: Person[], def: OrderDef, armed: (p: Person) => boolean): number {
  if (!actors.length) return 1;
  let best = 0, sum = 0;
  for (const a of actors) {
    const s = orderSkill(a, def, armed(a));
    sum += s;
    if (s > best) best = s;
  }
  return best * 0.7 + (sum / actors.length) * 0.3;
}

/** "Fists, or Firearms with a gun": the skills an order uses, for the order list and the job card. */
export function orderSkillText(def: OrderDef): string {
  const names = (skills: OrderDef['skills']) => skills.map(k => SKILL_LABELS[k]).join(' + ');
  if (!def.skills.length) return '';
  return def.armedSkills ? `${names(def.skills)}, or ${names(def.armedSkills)} with a gun` : names(def.skills);
}
