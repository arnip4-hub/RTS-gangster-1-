# Police, FBI and prosecution in RTS gangster beta

Implemented for continuous RTS games in **0.2.0-beta.4**. The older five-day
mode retains its separate police rules. The [original audit](POLICE_AND_FBI_AUDIT.md)
records the problems found in beta.3, not the behavior of this version.

## From an incident to a hearing

1. **Observation and reporting.** Nearby people can hear a disturbance, see a
   description or vehicle, recognize a face, or directly observe an offender.
   Walls, interiors, distance, darkness, stealth and willingness to report matter.
   Civilian reports usually take 5–30 game minutes; an injured victim must recover
   before reporting. Report times and observations survive saving and midnight.
   A body can create an inquiry with no known offender. An unseen crime does not
   automatically make its true perpetrator wanted.
2. **Investigation.** Officers travel to a known scene or witness's home,
   examine the scene and interview reachable witnesses. A scene alone does not
   establish identity. New evidence can revive a cold file. At most eight
   ordinary investigation tasks run together; each review handles a bounded
   batch. This limit is separate from emergency response and FBI search work.
3. **Warrants and searches.** A received report, sufficient identification and
   case evidence support a warrant. Officers use sightings and last-known
   positions, then search nearby pavement locations. They cannot follow a hidden
   person by reading his destination. Losing the identifying evidence withdraws
   the warrant. An expired warrant needs fresh grounds to be renewed.
4. **Arrest.** An active officer must reach and see the individual at close
   range. A warrant or the officer's own recent observation supplies grounds.
   An attempt can fail. Being on the same crew does not arrest distant teammates.
   Each detention records the precise source case and arresting officer.
5. **Prosecutor.** The initial charging review is scheduled six game hours after
   arrest. The prosecutor charges, declines, or requests more investigation.
   Scene work can continue during that request. An uncharged detention has a
   24-hour deadline. A hidden, unrelated crime cannot replace the arrest reason.
6. **Court.** Hearings normally fall one or two game days after charges, rather
   than at weekly settlement. Each review uses that file's current evidence and
   identification. Unrelated gang-wide heat supplies no courtroom bonus.
   Lawyers, judges, prosecutors, witnesses and jurors still affect the result.
   Replacement officials or jurors delay the hearing. Completed verdicts are
   not reopened merely by ordinary evidence updates.

These durations are gameplay abstractions, not a reconstruction of historical
criminal procedure. The agreed clock remains **24 real minutes per full game
day at normal speed**, through all seven days. Weekly accounts and sentence
settlement remain; the city and crew positions do not reset.

## FBI

Federal leads come from reported kidnappings/hijackings, owner complaints,
disclosed tax records, or knowledge already recorded in an older save. Agents
travel to the known premises. Observation of actual illicit unloading can add
surveillance evidence; darkness and a legitimate manifest reduce detection.
Repeated observations and sufficient evidence schedule a search, with an
additional two-hour delay. The agent must arrive before entering and searching.
Seized records can identify a manager; only a manager physically reached can be
arrested. Hidden city-wide inventories, low Intelligence and crew membership do
not automatically establish an individual's guilt. Routine new assignments
respect weekends; urgent warrant/search work can continue.

## Information and interference

Open **Book → Lawyer → Police and Bureau files**. A lawyer inquiry, or the
assigned officer on your payroll, reveals file details. Before disclosure the
panel withholds evidence, identification confidence and the investigating
officer. A public warrant or your member's detention can name that suspect.
Witness names still require the existing court disclosure. Received statements
are distinct from pending reports.

A corrupt investigator can delay a file once for three game hours, with the
deadline saved across reloads. Afterwards an independent available officer can
continue it. Corruption can still weaken prosecution; it does not permanently
stop the case. Withdrawn or unavailable testimony is reassessed, while seized
financial records do not disappear because their source is jailed or dies.

## Saves and limits

Existing RTS saves acquire investigation fields conservatively. Legacy court
cases retain their recorded strength and receive live deadlines. Old unexplained
remote arrests are released rather than assigned invented charges. Classic-mode
saves retain their existing rules. New saves validate case references, witness
records, task state, custody and deadlines.

This is a first playable investigation model. Descriptions and vehicle sightings
are basic observations; there is no licence-plate registry, forensic laboratory,
interactive interrogation, full case appeals system or simulated courthouse
interior. Local searching can fail, and scheduling/balance needs playtesting.
The Windows installer is built on GitHub Actions; automated simulation and
browser checks do not replace a real Windows playthrough.
