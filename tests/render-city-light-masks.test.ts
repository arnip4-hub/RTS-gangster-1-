import { describe, expect, it } from 'vitest';
import { buildLightMask } from '../scripts/city-light-mask.mjs';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const lit = (data: Uint8Array, width: number, x: number, y: number) => data[(y*width+x)*3] > 0;
describe('painted city emissive masks', () => {
  it('lights exactly seven of sixteen dark-window cells and never the masonry or sash', () => {
    const w=512, data=new Uint8Array(w*w*3).fill(160);
    for(let row=0;row<4;row++) for(let col=0;col<4;col++)
      for(let y=32;y<116;y++)for(let x=38;x<100;x++){
        const i=((row*128+y)*w+col*128+x)*3;
        data.fill(x>=66&&x<73||y>=72&&y<80?100:30,i,i+3);
      }
    const mask=buildLightMask(data,w,w,'facade','red-brick');
    expect(mask).toEqual(buildLightMask(data,w,w,'facade','red-brick'));
    let cells=0;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++){
      if(lit(mask,w,c*128+50,r*128+95))cells++;
      expect(lit(mask,w,c*128+69,r*128+95)).toBe(false);
      expect(lit(mask,w,c*128+10,r*128+50)).toBe(false);
      expect(lit(mask,w,c*128+50,r*128+75)).toBe(false);
    }
    expect(cells).toBe(7);
  });
  it('keeps service shutters, fascia, plinth and piers black even when dark', () => {
    const w=1024,h=512, data=new Uint8Array(w*h*3).fill(32);
    const mask=buildLightMask(data,w,h,'storefront','storefront-service');
    expect(lit(mask,w,117,137)).toBe(true);
    for(const [x,y] of [[220,300],[510,250],[18,200],[750,70],[650,470]]) expect(lit(mask,w,x,y)).toBe(false);
  });
  it('preserves the six authored masks byte for byte', () => {
    for(const stem of ['facade-red-brick','facade-brown-brick','facade-buff-brick','facade-limestone','facade-stucco','storefront']){
      const file=stem+'-lit.png';
      expect(readFileSync('public/art/city/'+file)).toEqual(readFileSync('art-source/illustrated/corner/authored-lights/'+file));
    }
  });
  it('ships opaque RGB masks for all newly painted styles', async () => {
    for(const stem of ['facade-dark-granite','facade-terracotta-deco','facade-sooted-brick','facade-painted-clapboard','facade-glazed-brick','facade-cast-iron','storefront-market','storefront-deco','storefront-cafe','storefront-nightlife','storefront-financial','storefront-service','storefront-pawnshop','storefront-apothecary','storefront-boutique','storefront-poolhall','storefront-firehouse','storefront-hotel']){
      const {data,info}=await sharp('public/art/city/'+stem+'-lit.png').removeAlpha().raw().toBuffer({resolveWithObject:true});
      expect(info.width).toBe(stem.startsWith('facade')?512:1024);
      expect(info.height).toBe(512);
      expect(info.channels).toBe(3);
      expect(data.some(x=>x>0)).toBe(true);
      expect(data[0]).toBe(0); expect(data[1]).toBe(0); expect(data[2]).toBe(0);
    }
  });
});
