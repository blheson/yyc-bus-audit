# Calgary is redesigning its bus network right now. Here's what the open data says the math looks like.

*A civic data project: an open, reproducible model of Calgary's bus
network built entirely from public data — with an optimizer that finds
~10% of bus vehicle-kilometres (~$4.1M/yr, ~6,700 t CO₂) that could be
saved or reinvested, without any stop losing service.*

**Live map:** [blheson.github.io/yyc-bus-audit](https://blheson.github.io/yyc-bus-audit/)
· **Code & data pipeline:**
[github.com/blheson/yyc-bus-audit](https://github.com/blheson/yyc-bus-audit)

---

## The moment

Calgary Transit is in the middle of the largest rebalancing of its bus
network in years. The [Transit Service
Reviews](https://www.calgarytransit.com/plans---projects/long-term-strategic-plans/designing-our-network/transit-service-reviews.html)
for North Central, Saddletowne, and Fish Creek roll out finalized route
changes starting **August 31, 2026** (Fish Creek follows in December 2026
and March 2027). As part of the same rebalancing, [most remaining express
routes are being phased
out](https://livewirecalgary.com/2026/06/30/calgary-transit-changes-this-fall-mean-some-modified-express-service-will-remain/).
The city's stated rationale: express routes are "resource-intensive and
serve a relatively limited number of customers in one direction," and
those service hours buy more when reallocated into frequent, all-day,
two-way service on core routes.

That is a resource-allocation argument, and it's the right one. But it
has so far been made qualitatively: the public materials contain no
dollar figures, no ridership-impact estimates, and no published model
that residents, advocates, or councillors can inspect.

This project is an attempt to supply the missing quantitative half of
that conversation — using only data the city itself publishes. Not to
second-guess Calgary Transit's planners, who have data and constraints
this model can't see, but to show what the trade-off space looks like
when the reasoning is open, and to give the civic conversation numbers
it can argue with.

The model reaches, independently, the same directional conclusion the
city did: Calgary's bus network carries real slack in its thinnest
service, and modest, guardrailed frequency changes free up a lot of
resources at a small, bounded cost. Here is how much, and how sure we
can be.

## The headline

**Calgary's bus network could save about 5.0 million vehicle-kilometres
per year — roughly 10% of all bus vehicle-km, ≈2.5M litres of diesel,
≈6,700 tonnes of CO₂, ≈$4.1M annually — with modeled ridership impact
under 2% and no stop losing service in any period it has today.**

That is the *conservative* scenario of three, and every constraint
behind it is asserted in code, not assumed:

| Scenario | Saved veh-km/yr | % of bus veh-km | Diesel L/yr | t CO₂/yr | $/yr | Modeled ridership impact |
|---|---|---|---|---|---|---|
| Conservative | 5.03M | 10.4% | 2.51M | 6,739 | $4.1M | −2.0% |
| Moderate | 6.85M | 14.2% | 3.43M | 9,186 | $5.7M | −3.5% |
| Aggressive | 8.02M | 16.6% | 4.01M | 10,743 | $6.6M | −5.0% |

Demand is *modeled, not measured* (Calgary publishes no per-stop
ridership), which is why this write-up reports ranges and leads with the
conservative bound. The limitations section below is not fine print —
it's half the point.

And "savings" doesn't have to mean cuts banked as fuel money. The same
5M vehicle-km is a **reallocation dividend**: service hours that could
buy higher frequency where buses are full, exactly the trade the city's
own express-route decision is making.

## What was built

Everything runs from [Open Calgary](https://data.calgary.ca) datasets:
the static GTFS schedule, GTFS-Realtime feeds, monthly ridership totals,
census population and transit mode share, and downtown cordon counts.
Three stages:

**1. Supply — what Calgary actually runs.** Parsed from the July 2026
GTFS: ~10,000 bus trips per weekday, ~48.4M bus vehicle-km per year
(≈24.2M litres of diesel, ≈64,800 t CO₂ at a fleet-average factor).
Every 1% of vehicle-km is worth ~242,000 litres and ~$400k a year. Two
findings shaped everything downstream: only 6 of 145 weekday routes run
hourly-or-worse midday — they're just 1.5% of vehicle-km, so cutting
"empty" community routes saves almost nothing — and 27 routes are long
(>15 km) at ≤30-minute frequency, which is where thin service actually
burns fuel.

**2. Demand — a calibrated model, honestly labeled.** Calgary publishes
no per-stop or per-route ridership, so the model spreads the published
citywide total (224,517 weekday bus boardings) across stops using
population within 400m, community transit mode share, a
downtown-attraction kernel, and an LRT-feeder bonus. Totals are
anchored to published figures; the spatial distribution is an estimate,
carried through as three scenarios rather than one point claim. The
model's verdict on those 27 flagged routes: median modeled midday peak
load of ~14 passengers on a 55-seat bus, even conservatively.

**3. Optimizer — with guardrails doing the real work.** A constraint
solver (Google OR-Tools CP-SAT) picks longer headways per route and
period, minimizing vehicle-km subject to: no stop loses service in any
period it has today; nothing drops worse than hourly; routes running
every 15 minutes or better stay that way (mirroring RouteAhead's
Primary Transit Network promise); no wait more than doubles; modeled
peak loads stay within capacity; and total modeled ridership loss stays
under a hard budget (2% in the conservative scenario) using a standard
wait-time elasticity.

## The part that should earn your trust

The first version of the optimizer had only a capacity constraint, and
it "saved" **50% of vehicle-km** — by gutting the MAX BRT lines to
hourly. That number was absurd, and the reason is instructive: the
demand model, built from stop-catchment population, under-ranks trunk
routes whose ridership comes from frequency and connections, and the
optimizer drove straight through that blind spot. A textbook case of an
optimizer exploiting its model's weakest point.

The published result is what survives after closing that gap with
policy guardrails — the frequent network stays frequent, waits at most
double, and a system-wide ridership-loss budget becomes the binding
constraint. The honest lesson, stated plainly because any transit
professional will spot it anyway: **a savings estimate is only as
strong as its constraint set.** This one is deliberately conservative,
and every constraint is checked programmatically against the solution.

## Where the savings actually live

Not downtown, and not on the frequent grid — the guardrails hold the
core network in place, and weekday peak service is barely touched.
The savings are overwhelmingly **weekend daytime and weekday off-peak
trims on long, thin routes**: route 23 going from every 19 to every 30
minutes on weekends, route 43 from 21 to 30, routes 302 and 20 from
~27 to 45. In the conservative scenario, exactly 406 of 1,217
route-period cells change at all; already-sparse service is untouched.

This is the same species of decision as the city's express-route
phase-out — service that costs a lot per rider carried, rebalanced —
which is precisely why the number is credible as a *scale estimate*:
two very different processes, the city's planning practice and an open
optimization model, point at the same kind of slack.

There's also untouched upside: 62 routes share half or more of their
alignment with another route. Coordinated (offset) scheduling on those
corridors could raise *effective* frequency for riders without adding a
single trip. That's not in the savings numbers — it's the positive-sum
follow-up.

## What this does *not* say

- **It doesn't say buses are empty.** It says a model calibrated to
  published totals finds thin modeled loads in specific places, with
  the spatial pattern unvalidated. Per-stop automatic passenger counter
  (APC) data — which Calgary Transit has internally — would replace the
  weakest layer of this pipeline while keeping the rest intact. That's
  the partnership pitch, not a gotcha.
- **The dollar and CO₂ figures are fleet-average.** 0.5 L/km diesel is
  a placeholder; Calgary's CNG and electric buses reduce the litres
  (not the kilometres). The vehicle-km number is the robust one.
- **Ridership impact uses a literature elasticity (−0.4),** not one
  estimated from Calgary data; the 2–5% scenario spread is the
  sensitivity treatment.
- **Trips are assumed to scale linearly with headway.** A real runcut
  (driver schedules, blocking, layovers) would move the numbers some
  percent in either direction.
- **This audits the July 2026 network** — the schedule as it exists
  *before* the August 31 changes land. That's deliberate: it's a
  baseline snapshot of the network the TSRs are redesigning. Re-running
  the pipeline on the fall GTFS is a one-command comparison of before
  and after — arguably the most useful thing an open model can offer as
  the changes roll out.

## What's next

The pipeline, model, optimizer, and interactive map are open source.
The map shows every route colored by savings opportunity, with per-route
detail: current vs. proposed headways, modeled load profiles, and what
the guardrails did.

If you work at Calgary Transit: the offer in this project is the
obvious one. Open data alone gets this far; your APC data would make it
decision-grade, and the entire pipeline is built so that swapping in
measured demand is a one-module change.

If you're a rider, an advocate, or a councillor's office: the point of
publishing the method — including its failure modes — is that you can
check the reasoning, not just the conclusion. Argue with the
constraints. That's what they're for.

---

*Built on Open Calgary data: static GTFS (`npk7-z3bj`), GTFS-RT
(`am7c-qe3u`, `gs4m-mdc2`), monthly ridership (`iema-jbc4`), federal and
civic census, downtown cordon counts. Methodology details:
[FINDINGS-supply.md](FINDINGS-supply.md),
[FINDINGS-demand.md](FINDINGS-demand.md),
[FINDINGS-optimizer.md](FINDINGS-optimizer.md). City sources:
[Transit Service Reviews](https://www.calgarytransit.com/plans---projects/long-term-strategic-plans/designing-our-network/transit-service-reviews.html),
[RouteAhead](https://www.calgarytransit.com/plans---projects/long-term-strategic-plans.html),
[LiveWire Calgary on the express changes](https://livewirecalgary.com/2026/06/30/calgary-transit-changes-this-fall-mean-some-modified-express-service-will-remain/).*
