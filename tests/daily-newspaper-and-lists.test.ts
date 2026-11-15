import { describe,expect,it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { addNews } from '../src/sim/events';
import { newspaperEdition } from '../src/sim/newspaper';
import { personListIds,togglePersonList } from '../src/sim/personLists';
import { Sim } from '../src/sim/sim';
import { dailyNews } from '../src/sim/systems/news';

const make=()=>new Sim({...defaultGameOptions(),continuousTime:true,seed:714,citySize:10,startHoods:8});

describe('RTS morning paper and person lists',()=>{
  it('keeps a private watch list and hit list through a save without revealing rival intel',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const rival=Object.values(w.people).find(p=>p.gangId!=null && p.gangId!==g.id)!;
    expect(g.knownPeople).not.toContain(rival.id);
    expect(togglePersonList(w,g.id,rival.id,'watch').ok).toBe(true);
    expect(togglePersonList(w,g.id,rival.id,'hit').ok).toBe(true);
    expect(personListIds(w,g.id,'watch')).toEqual([rival.id]);
    expect(personListIds(w,g.id,'hit')).toEqual([rival.id]);
    expect(g.knownPeople).not.toContain(rival.id);
    const restored=Sim.fromSave(structuredClone(w));
    expect(personListIds(restored.world,g.id,'watch')).toEqual([rival.id]);
    expect(personListIds(restored.world,g.id,'hit')).toEqual([rival.id]);
    expect(togglePersonList(w,g.id,rival.id,'hit').ok).toBe(true);
    expect(personListIds(w,g.id,'hit')).toEqual([]);
  });

  it('prints the next morning and holds later reports for the following issue',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    sim.launchWeek();
    expect(w.lastNewspaperMinute).toBe(360);
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='WELCOME TO NEW TEMPERANCE')).toBe(true);
    w.minute=600;
    addNews(w,{section:'business',headline:'MONDAY PURCHASE',body:'A shop changed hands.',gangId:null});
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='MONDAY PURCHASE')).toBe(false);
    w.minute=1800;
    dailyNews(w,sim.rng);
    expect(w.lastNewspaperMinute).toBe(1800);
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='MONDAY PURCHASE')).toBe(true);
    const count=w.news.length;
    dailyNews(w,sim.rng);
    expect(w.news).toHaveLength(count);
    w.minute=1900;
    addNews(w,{section:'law',headline:'TUESDAY ARREST',body:'Police made an arrest.',gangId:null});
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='TUESDAY ARREST')).toBe(false);
    w.minute=3240;
    dailyNews(w,sim.rng);
    const edition=newspaperEdition(w,g.id);
    expect(edition.editionAt).toBe(3240);
    expect(edition.items.some(n=>n.headline==='TUESDAY ARREST')).toBe(true);
    expect(edition.items.some(n=>n.headline==='MONDAY PURCHASE')).toBe(false);
    expect(Sim.fromSave(structuredClone(w)).world.lastNewspaperMinute).toBe(3240);
  });

  it('carries Sunday reports into Monday morning across the weekly accounts',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    sim.launchWeek();
    w.minute=6*1440+23*60;
    addNews(w,{section:'crime',headline:'SUNDAY NIGHT INCIDENT',body:'Police have begun inquiries.',gangId:null});
    w.week=2;w.minute=360;
    dailyNews(w,sim.rng);
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='SUNDAY NIGHT INCIDENT')).toBe(true);
  });

  it('publishes from the live simulation clock at six in the morning',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    sim.launchWeek();
    w.minute=1799;
    addNews(w,{section:'city',headline:'LATE REPORT',body:'Before dawn.',gangId:null});
    sim.advance(1,1);
    expect(w.minute).toBe(1800);
    expect(w.lastNewspaperMinute).toBe(1800);
    expect(newspaperEdition(w,g.id).items.some(n=>n.headline==='LATE REPORT')).toBe(true);
  });
});
