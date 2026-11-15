import type { WeaponId } from '../sim/types';
import type { CharacterAction } from './characterActions';

export interface IllustratedPose {
  tilt: number;
  collapse: number;
  darken: number;
  burst: number | null;
}

/** Small readable 2D poses and props for every presentation action. */
export function illustratedPose(action?: CharacterAction, _heldWeapon?: WeaponId, carrying = false): IllustratedPose {
  const pose: IllustratedPose = { tilt: carrying ? .025 : 0, collapse: 0, darken: 1, burst: null };
  if (!action) return pose;
  const t = Math.max(0, action.time);
  switch (action.kind) {
    case 'shoot':
      pose.tilt = t < .24 ? .07 : -.08 * Math.exp(-(t - .24) * 5);
      if (Math.abs(t - .24) < .095) pose.burst = 1;
      break;
    case 'strike':
      pose.tilt = Math.sin(Math.min(1, t / .55) * Math.PI) * .22;
      if (t > .2 && t < .55) pose.burst = 2;
      break;
    case 'hit':
      pose.tilt = -Math.sin(Math.min(1, t / .8) * Math.PI) * .25;
      pose.darken = .75;
      if (t < .45) pose.burst = 2;
      break;
    case 'death':
    case 'burnDeath':
      pose.collapse = Math.max(0, Math.min(1, (t - .15) / 1.15));
      pose.tilt = pose.collapse * Math.PI / 2;
      pose.darken = action.kind === 'burnDeath' ? .3 : .62;
      if (action.kind === 'burnDeath' && t < 3.2) pose.burst = 8;
      break;
    case 'fleeBurning':
      pose.tilt = Math.sin(t * 13) * .07;
      pose.burst = 8;
      break;
    case 'shock':
      pose.tilt = Math.sin(t * 8) * .08;
      break;
    case 'firefight':
      pose.tilt = Math.sin(t * 4) * .08;
      break;
    case 'photo':
      pose.tilt = .06;
      if (Math.abs(t - 1.05) < .11) pose.burst = 5;
      break;
    case 'throw':
      pose.tilt = Math.sin(Math.min(1, t / .7) * Math.PI) * .15;
      break;
    case 'draw':
    case 'ready':
      pose.tilt = .055;
      break;
    case 'holster':
      pose.tilt = .055 * (1 - Math.min(1, t / .9));
      break;
  }
  return pose;
}
