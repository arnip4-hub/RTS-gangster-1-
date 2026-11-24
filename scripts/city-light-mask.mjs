/** Pane-only masks for the painted city sheets. Coordinates are in the delivered
 * 512px facade / 1024x512 storefront space, not in arbitrary source-image pixels.
 * Never mark a pixel outside a deliberately inset glazing region. */
const TONES = [[255,227,163],[255,207,128],[240,179,98]];
const median = values => { values.sort((a,b)=>a-b); return values[Math.floor(values.length/2)] ?? 0; };
const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const rects = {
  storefront: [[99,112,149,149],[159,112,209,149],[219,112,269,149],[279,112,329,149],[339,112,389,149],[399,112,444,149],[100,179,442,361],[564,179,756,360],[823,210,889,340]],
  'storefront-market': [[82,139,263,176],[283,139,462,176],[84,197,461,328],[557,138,577,176],[557,198,578,320],[650,229,659,377],[666,229,709,377],[718,229,728,377],[816,140,944,177],[816,196,944,328]],
  'storefront-deco': [[109,143,169,194],[186,143,374,194],[391,143,452,194],[109,212,169,447],[185,212,374,447],[391,212,452,447],[574,143,633,195],[574,209,633,447],[654,145,667,195],[654,211,667,440],[704,260,776,351],[704,379,776,446],[820,150,839,195],[820,211,839,445],[853,143,916,195],[853,211,916,447]],
  'storefront-cafe': [[82,130,262,271],[281,130,467,271],[557,130,631,271],[689,139,803,170],[691,207,732,394],[764,207,803,394],[865,130,941,270]],
  'storefront-nightlife': [[651,253,709,344],[651,374,709,429],[769,253,827,344],[769,374,827,429]],
  'storefront-financial': [[159,195,172,214],[179,195,186,214],[211,163,224,185],[233,163,245,185],[211,194,224,213],[233,194,245,213],[299,162,312,185],[321,162,334,185],[299,194,312,213],[321,194,334,213],[360,195,373,214],[380,195,390,214],...[0,480].flatMap(off=>[151,174,211,233,299,321,357,380].flatMap(x=>[[x+off,249,x+off+13,275],[x+off,286,x+off+13,314]])),...[ [159,195,172,214],[179,195,186,214],[211,163,224,185],[233,163,245,185],[211,194,224,213],[233,194,245,213],[299,162,312,185],[321,162,334,185],[299,194,312,213],[321,194,334,213],[360,195,373,214],[380,195,390,214] ].map(r=>[r[0]+480,r[1],r[2]+480,r[3]])],
  'storefront-service': [[104,121,135,151],[145,121,179,151],[190,121,225,151],[235,121,268,151],[280,121,314,151],[324,121,358,151],[369,121,402,151],[413,121,442,151],...[584,621,657,694,730,768].flatMap(x=>[124,167,218,267,316].map(y=>[x+2,y+2,x+27,y+41])).filter(r=>!(r[0]<615&&r[1]<160)),...[817,853,889].flatMap(x=>[123,165].map(y=>[x+3,y+3,x+29,y+37])),[857,274,879,301]],
  'storefront-pawnshop': [[126,105,510,146],[128,165,305,384],[324,165,510,384],[621,110,884,137],...[622,643,667,690].flatMap(x=>[168,224,330].map((y,i)=>[x,y,x+13,i===0?211:i===1?319:387])),[768,198,862,342]],
  'storefront-apothecary': [[92,125,455,256],[92,271,263,330],[282,271,455,330],[92,349,263,418],[282,349,455,418],[564,123,606,421],[629,123,650,422],[689,135,803,160],[706,215,788,395],[846,128,871,420],[894,125,932,420]],
  'storefront-boutique': [[87,114,132,170],[149,114,401,170],[417,114,462,170],[87,188,132,430],[149,188,401,432],[417,188,462,430],[612,216,649,423],[707,216,746,423],[801,119,831,170],[850,119,932,170],[801,190,831,432],[850,190,932,432]],
  'storefront-poolhall': [[89,121,483,253],[670,132,858,166],[702,253,719,302],[804,253,824,302]],
  'storefront-hotel': [[255,133,338,190],[215,157,239,191],[355,157,379,191],...[215,233,252,271,290,309,328,347,366].map(x=>[x,241,x+9,385]),[640,158,663,190],[682,139,714,152],[730,139,752,152],[779,160,795,190],[704,176,738,190]],
};
rects['storefront-firehouse'] = rects['storefront-service'];
const split = (xs,ys) => xs.flatMap(([l,r])=>ys.map(([t,b])=>[l,t,r,b]));
const facadePanes = name => {
  if (name === 'dark-granite' || name === 'cast-iron') return split([[18,23],[29,34],[40,45],[51,56],[63,68],[74,79],[85,90],[96,101],[107,111]],[[19,29],[35,49],[55,69],[75,85]]);
  if (name === 'terracotta-deco') return [[44,31,83,55],[44,65,83,92]];
  if (name === 'sooted-brick') return [[47,33,61,62],[67,33,79,62],[47,70,79,99]];
  if (name === 'painted-clapboard' || name === 'glazed-brick') return split([[32,55],[75,98]],[[33,61],[71,98]]);
  return split([[42,65],[73,94]],[[38,71],[80,112]]);
};
export function buildLightMask(data, width, height, kind, name) {
  if (width !== (kind === 'facade' ? 512 : 1024) || height !== 512 || data.length !== width*height*3)
    throw new Error('Expected RGB pixels in delivered sheet dimensions');
  const out = new Uint8Array(width*height*3);
  const lum = new Float32Array(width*height);
  for(let i=0;i<lum.length;i++) lum[i] = .3*data[i*3]+.5*data[i*3+1]+.2*data[i*3+2];
  const sample = (l,t,r,b) => {const a=[]; for(let y=t;y<b;y+=3)for(let x=l;x<r;x+=3)a.push(lum[y*width+x]);return a;};
  const paint = ([l,t,r,b], tone, ceiling, gradient, blind=0) => {
    const mid=median(sample(l,t,r,b)); const low=Math.max(7,mid*.42);
    const high=Math.min(ceiling,mid+22);
    for(let y=t+Math.floor((b-t)*blind);y<b;y++)for(let x=l;x<r;x++){
      const i=y*width+x, v=lum[i];
      if(v<low || v>high)continue;
      // Inset rectangles exclude frame edges; reject dark internal mullions
      // and strongly warm wood/metal pixels relative to their blue channel.
      const red=data[i*3], blue=data[i*3+2];
      if(red-blue>55 && kind==='facade')continue;
      if (kind==='storefront' && name!=='storefront-nightlife' && red-blue>58) continue;
      const shade=gradient ? (1-Math.floor((y/height)*12)/12*.42) : 1;
      for(let c=0;c<3;c++)out[i*3+c]=Math.round(tone[c]*shade);
    }
  };
  if(kind==='facade'){
    const seed=[...name].reduce((s,c)=>Math.imul(s,31)+c.charCodeAt(0),17);
    const selected=Array.from({length:16},(_,i)=>i).sort((a,b)=>hash(seed+a)-hash(seed+b)).slice(0,7);
    for(const cell of selected){
      const x=(cell%4)*128,y=Math.floor(cell/4)*128;
      const masonry=median([...sample(x+3,y+12,x+10,y+113),...sample(x+118,y+12,x+125,y+113),...sample(x+16,y+113,x+112,y+123)]);
      const ceiling=masonry*.88;
      const tone=TONES[hash(seed+cell+30)%3], blind=hash(seed+cell+60)%5===0?.48:0;
      for(const [l,t,r,b] of facadePanes(name)){
        if(blind && t<64)continue;
        paint([x+l,y+t,x+r,y+b],tone,ceiling,false);
      }
    }
  }else{
    const panes=rects[name]; if(!panes)throw Error('No storefront glazing layout: '+name);
    for(const pane of panes)paint(pane,TONES[1],name==='storefront-nightlife'?185:145,true);
  }
  return out;
}
