# RTS time audit — beta 2026-11-15

The RTS clock advances one game minute per real second at normal speed. A full
day takes 24 real minutes; a full week takes 168 real minutes. The classic save
clock remains five eight-hour days and 2,400 game minutes per week. The clock
mode is saved with each campaign, so an older save is not silently converted.

| System | Time basis and response |
| --- | --- |
| Clock, light, weekends and leisure | Seven 1,440-minute days. Saturday and Sunday have different pedestrian, police and official routines. Shopkeepers now travel to trading premises for weekday shifts from 08:00 to 18:00, then use the existing home, leisure and faster-tram routines. |
| People, crew cars, trams and service trucks | Positions advance in game minutes. RTS movement is scaled so normal-speed screen travel remains close to the prior beta. Transport does not reset at a week boundary. |
| Order estimates, crew budget and Organizer percentages | The budget now reads the saved clock mode: 10,080 RTS minutes or 2,400 classic minutes. Standing-order duty and save validation use that same limit. |
| Rival planning | Free crews are reconsidered every 30 RTS minutes. A six-hour goal prevents constant strategic switching. In-flight jobs keep running. |
| Goods production | Five workday batches per week, including the new meat and ice goods. Output does not multiply with the extra overnight and weekend minutes. Delivery scans occur every ten game minutes. |
| Business money | An RTS business banks a conservative advance at each midnight. The weekly result subtracts these advances, so they are not paid twice. Weekly wages, upkeep, taxes and financial reports remain at Sunday settlement. Classic mode keeps its old weekly cash flow. |
| Crime, police and FBI | Reported crimes are reviewed hourly in RTS time after the response window; each report is investigated once. On-call police and FBI agents travel and work in game minutes. Cases and court dates still progress weekly. |
| Week boundary and saves | Settlement runs after Sunday. Active people, vehicles, orders, emergencies, cargo and route positions survive. New optional freight and receipt fields allow older saves to load. |

Family links are intentionally sparse: officials have a named adult relative,
and owners gain one after refusing extortion. A bounded personal history records
known kidnappings, family pressure and attributed killings. Recent attributed
trauma raises witness reporting willingness; fear can still suppress it. Older
saves load without history and acquire entries as new incidents happen.

The longer week means court dates, wages and final taxes take longer in real time
at normal speed. The speed controls can accelerate those periods. The daily
advance keeps ordinary business purchases possible before the Sunday report.
This beta still has some week-sized orders and weekly political and court
decisions; those are further RTS design work, not hidden real-time behavior.
