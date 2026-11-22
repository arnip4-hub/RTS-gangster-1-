import { describe, it, expect } from 'vitest';
import { HOOD_SLOTS, hoodPage, updateHoodSelection } from '../src/ui/hoodSelection';

describe('eight-slot Hoods bar', () => {
  it('keeps exactly eight visible slots with empty placeholders', () => {
    const { slots, page, pageCount } = hoodPage([10,20,30], 0);
    expect(HOOD_SLOTS).toBe(8);
    expect(slots).toHaveLength(8);
    expect(slots.slice(0,3)).toEqual([10,20,30]);
    expect(slots.slice(3)).toEqual(Array(5).fill(null));
    expect(page).toBe(0); expect(pageCount).toBe(1);
  });

  it('pages pool hoods rather than hiding the ninth person', () => {
    const ids=Array.from({length:19}, (_,i)=>i+1);
    const first=hoodPage(ids,0), second=hoodPage(ids,1), third=hoodPage(ids,2);
    expect(first.slots).toEqual([1,2,3,4,5,6,7,8]);
    expect(second.slots).toEqual([9,10,11,12,13,14,15,16]);
    expect(third.slots).toEqual([17,18,19,null,null,null,null,null]);
    expect(third.pageCount).toBe(3);
    expect(hoodPage(ids,999).page).toBe(2);
  });

  it('single clicks replace the selection and Ctrl/Meta clicks toggle it', () => {
    const ids=[1,2,3,4,5,6,7,8];
    expect(updateHoodSelection([1,2],4,ids,2,{})).toEqual([4]);
    expect(updateHoodSelection([1,2],3,ids,2,{ctrlKey:true})).toEqual([1,2,3]);
    expect(updateHoodSelection([1,2],2,ids,2,{ctrlKey:true})).toEqual([1]);
    expect(updateHoodSelection([1,2],3,ids,2,{metaKey:true})).toEqual([1,2,3]);
  });

  it('Shift selects an inclusive visible range, optionally adding to selection', () => {
    const ids=[1,2,3,4,5,6,7,8];
    expect(updateHoodSelection([2],6,ids,2,{shiftKey:true})).toEqual([2,3,4,5,6]);
    expect(updateHoodSelection([1],6,ids,4,{shiftKey:true,ctrlKey:true})).toEqual([1,4,5,6]);
    expect(updateHoodSelection([1],6,ids,99,{shiftKey:true})).toEqual([6]);
  });
});
