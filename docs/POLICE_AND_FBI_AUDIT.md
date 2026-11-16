# Police, FBI and court audit — 16 November 2026

Reviewed source: `c4818ca77673841f2cbae714155305ae7a844b58`, RTS gangster beta
0.2.0-beta.3. This document records an audit and proposed changes; it does not
implement the proposed investigation system. The subsequent beta.4 implementation
and its remaining limits are documented in [RTS law](RTS_LAW.md).

## Main finding

The game stores what really happened, but the police frequently use that truth
directly. It does not yet distinguish an unknown offender, a description, an
identified suspect, an arrest warrant and evidence sufficient for prosecution.
Several original-map rules still apply to continuous RTS campaigns.

## Confirmed behavior

| Area | Current behavior and consequence | Source |
| --- | --- | --- |
| Wanted | Every unsuppressed crime raises the true perpetrator's heat, even when unreported. An unwitnessed murder adds 4 wanted and 0.48 gang evidence. UI calls the heat Wanted/Most Wanted. | `src/sim/events.ts:258`, `src/ui/organizer/LawyerTab.tsx:60` |
| Witnesses | Distance, attitudes and stealth select witness IDs. There is no statement, observation type, identification confidence, wall/line-of-sight check or darkness modifier. Indoor, kidnapped and arrested witnesses can qualify. | `src/sim/events.ts:74`, `src/sim/events.ts:172` |
| Original-city reporting | Only hostile civilian witnesses and police count. Owners, clergy and reporters are skipped; calm civilians do not report even murder through this path. | `src/sim/events.ts:176` |
| Investigation | Hourly RTS review considers reports at least 30 minutes old, delays for an approaching car up to three hours, then makes one probability roll. A completed review cannot be reopened by new evidence. General review filters to the current week. | `src/sim/systems/law.ts:45`, `src/sim/systems/law.ts:66` |
| Responding police | One available on-duty officer drives to the scene, waits 18 game minutes and returns. Arrival does not gather statements or search for an identified suspect. | `src/sim/events.ts:119`, `src/sim/systems/buildingEmergency.ts:164` |
| Body discovery | A nearby officer can trigger a sheet and hearse, but discovering an unreported death does not itself report the crime or open an unknown-offender case. | `src/sim/bodyRecovery.ts:17` |
| Desk arrests | A successful investigation directly sets the true perpetrator to arrested, irrespective of officer/suspect proximity. Automatic case creation then sets onTrial. | `src/sim/systems/law.ts:106` |
| Street arrests | Nearby officers use numeric heat, attitude and RNG, without a linked warrant or identification. On the original map, one arrest can also take active teammates anywhere in the city. | `src/sim/systems/combat.ts:232`, `src/sim/systems/fbi.ts:778` |
| FBI knowledge | Heavy-crime suspicion includes unreported crimes and attributes them to living teammates without participation or location checks. Target selection can inspect the real illegal businesses and stock. | `src/sim/systems/fbi.ts:156`, `src/sim/systems/fbi.ts:618` |
| FBI warrants | A weekly warrant-serving path needs any active agent, rather than an agent who located and reached the suspect. Street officers do not use the separate fbiWarrant flag. | `src/sim/systems/fbi.ts:447`, `src/sim/systems/combat.ts:233` |
| FBI surveillance | Agents really travel, work at premises and conduct raids. Their search produces a skill/zeal/cover result, without records of observed deliveries, visitors, vehicles or interviews. | `src/sim/systems/fbi.ts:201`, `src/sim/types.ts:290` |
| Prosecutor | A DA is assigned after arrest. There is no charging review, rejection for insufficient evidence or request for further investigation. Intelligence contributes to the eventual verdict. | `src/sim/systems/law.ts:154`, `src/sim/systems/law.ts:290` |
| Charge source | Automatic charges select the highest-risk retained crime for the person, including unreported records unrelated to the arrest. Without a crime record the fallback is racketeering. | `src/sim/systems/law.ts:165` |
| Evidence | Global gang evidence boosts individual prosecutions. Initial witness contributions remain baked into case strength even if later testimony is unavailable. The arrest roll does not recheck witnesses. | `src/sim/systems/law.ts:82`, `src/sim/systems/law.ts:195`, `src/sim/systems/law.ts:280` |
| Timing | Trials progress weekly. Independent street/FBI arrests can wait for another due report or weekly settlement before case creation. Weekly review bypasses the live report-age/response delay. | `src/sim/systems/law.ts:18`, `src/sim/systems/law.ts:45` |

## Isolated runtime checks

Ephemeral Vite SSR checks were run against the source without changing gameplay
files or persistent saves. Fixtures isolate individual paths; they are not
claims that every ordinary playthrough takes these outcomes.

- Unwitnessed murder: zero witnesses, reported false, wanted +4, gang evidence
  +0.48.
- An indoor civilian in a different building qualified as a witness.
- After the response grace period, a suspect became onTrial while the assigned
  responding officer remained 764.63 metres away and approaching.
- A street arrest also arrested a teammate 621.55 metres away.
- Police covering an unreported murder victim left reported false and no
  investigation timestamp.
- At weekly review, a zero-minute-old report produced a court case while its
  car was still approaching. A forced successful roll isolated the missing
  report-age/proximity gates.
- Three unreported murder records with no witnesses raised both the culprit's
  and a distant teammate's FBI suspicion to 300. Warrant serving arrested them
  with the agent 2,500 metres from the culprit. The teammate was 1,985 metres
  away; automatic team arrest could give both the racketeering fallback charge.
- An arrested hood with an unreported high-risk murder and a lower-risk
  reported extortion received a murder case from the unreported record.
- With other case/defence factors fixed, raising unrelated gang evidence from
  0 to 100 changed an acquittal to a conviction.

The existing 80 FBI regression tests pass. Several explicitly preserve the
original's remote team-arrest and suspicion rules. RTS changes therefore need
new behavior expectations, with classic-mode compatibility considered explicitly.

## Proposed continuous RTS flow

1. **Incident/discovery:** a witness reports an event or someone discovers a
   victim. A case can exist without an identified offender. World truth remains
   separate from the authorities' knowledge.
2. **Statements:** record whether someone heard shots, saw clothing/a vehicle,
   recognized a face, or identified a known person. Observation quality depends
   on distance, visibility, darkness, fear and time. Statements may be uncertain
   or withdrawn; they are not automatically perfect identification.
3. **Investigation:** a named officer works available leads. Interviews, a
   recovered vehicle, a captive's account or financial records can add evidence
   to that specific file. New evidence can reopen a pending or cold case.
4. **Targeted surveillance:** available officers/agents watch a known site or
   person and record relevant observations. They do not read every real order,
   hidden operation or inventory. Use bounded active cases and observer tasks.
5. **Identification and warrants:** keep suspicion, an identified suspect and
   an arrest warrant distinct. Public wanted status derives from known identity
   and the relevant case. Corrupt officers can delay or weaken their own files.
6. **Physical arrest:** police must locate, approach and detain each person.
   Catching an observed crime in progress can justify an immediate attempt.
   Other crew members require their own grounds and actual presence.
7. **Charging review:** the prosecutor proceeds, requests further investigation
   or declines the case based on its evidence. Preserve the source file and
   arrest reason; do not substitute an unrelated hidden crime.
8. **Court:** use that case's evidence, statements, defence and interference.
   General gang pressure affects investigation priority rather than proving an
   unrelated charge. Process custody and hearings on explicit game deadlines.

## Suggested implementation order

First separate police knowledge, case evidence and wanted/warrant state, and
remove remote arrests and automatic distant teammate arrests in RTS mode.
Then introduce statements/identification and prosecutor review. Build targeted
FBI surveillance on its existing physical travel/work system, and connect body
discovery, witness interference and cold cases to the same files. Keep the
agreed 24-hour clock and seven-day calendar unchanged.
