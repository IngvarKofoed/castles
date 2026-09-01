# Castles — Concept

*Last updated 2026-09-01.*

A voxel colony builder about claiming land from a dangerous wilderness. Inside
your walls, nothing can ever hurt you. Outside, threats roam in plain sight.
The game is the push outward: reading the map, picking your moment, sending
workers beyond the wall to grab the next bite of land — and getting them home.

The feeling to protect: **risk is never imposed, only chosen.** The colony
behind its wall is unconditionally safe — you can leave the game running and
nothing will have gone wrong when you return. Danger exists only where you
deliberately put people: outside. The interesting decisions are about
placement, when to spend, and when to dare — never about reacting fast to
something the game did to you.

## Pillars

**1. The wall is absolute.** It never breaches. There are no sieges, no waves,
no horde — the wall doesn't fight, it simply *is* safety. A closed gate counts
as wall. The only way danger gets in is a gap the player made themselves, and
then it pours in until the gap is sealed: devastating, but recoverable, and
always self-inflicted.

**2. Expansion is the game — and the risk.** Threats roam the wilds in plain
sight; safety outside is a local, readable fact, not a timer. Expanding means
sending a crew out during a window you judged yourself: throw up a wood
palisade to claim the ground, build the stone wall behind it, then tear down
the now-inner old wall. The palisade buys time, not safety — threats can
damage it and unfinished stone — so every push is a race to close the real
wall while the palisade holds. Workers caught outside can die. The old wall
stands until the new one is finished: a failed expansion means retreat and
lost materials, never a lost colony. Land is grabbed bite by bite, in whatever
direction you choose — the wall's final shape is the history of your
decisions.

**3. Chains vary in depth, and depth pulls outward.** Most production lines
are one or two steps (log → plank, rock → block). Some run longer — and the
longer chains want raw inputs that only exist further out, so a deeper economy
and a bigger wall are the same ambition. Two things pull the player outward:
room to build, and resources you can see but don't yet own.

## The labour model

This is the mechanic the whole economy hangs on, borrowed from Kubifaktorium
because it is the best idea in that game.

Two kinds of worker:

- **Pool workers** take hauling and construction tasks off a queue and switch
  between them freely. Cheap to reschedule; they go where the work is.
- **Slot workers** are bound to a workshop and stay there. Their skill grows with
  use, and they will not haul, ever.

The consequence that makes it interesting: **effective hauling capacity is
population minus everyone locked in a workshop.** Every workshop you staff
quietly shrinks the pool that feeds all the *other* workshops. That produces a
trap worth designing around — you staff more workshops to raise output, hauling
capacity drops, the workshops starve for inputs, output falls, and the instinct
is to staff *more*. The fix is the opposite direction: unstaff something, or
automate the feeding so the building does not need a hauler at all.

Expansion crews come from the pool too, so pushing the wall outward competes
directly with hauling and construction inside it. A big land grab is also a
logistics slowdown — that is the intended coupling, not a bug.

That is also the honest justification for belts and carts later: they add
throughput *without consuming population*, whereas a colonist-hauled chain
converts people into logistics.

Two constraints on top:

- Job priority order only governs pool-side choices. Once a colonist is in a
  slot, priorities stop applying to them — a construction surge means actually
  unstaffing a workshop, not reordering a list and hoping.
- Supply failures must plateau, never spiral. A starved workshop flatlines its
  output; it must never flatline people. Colonists feed themselves regardless
  of task queues — "nothing punishes inattention" has to hold economically,
  not just at the wall.

Terraforming follows the same currency: it costs labour only. Leveling ground
is pool-worker tasks — no resource bill, just people-hours competing with
hauling, construction, and expansion. The world starts fairly flat, so
terraforming is an occasional convenience, not a standing tax.

## The threat model

The Wilds are home to foul monsters — orcs and trolls — visible and roaming,
never waves sent against the colony. Whether it is safe to work a patch of ground outside
is something you read off the map: no monster near here, right now. That keeps
the risk decision perceptual — you look, you don't react. Danger never
accumulates against the colony itself; it only matters where the player has
put people or unfinished wall.

**Orcs are fast and hit light; trolls are slow and hit hard.** Both kinds read
at a glance. Speed is what catches a fleeing worker, so orcs are the people-
threat: they arrive with little warning, but a repaired palisade can outlast
their gnawing. Trolls telegraph their approach from far away — nobody gets
caught by a troll who was paying attention — but when one reaches a palisade
it goes through it fast. Orcs threaten the crew; trolls threaten the race.

**You never fight them.** There is no military, no hunting, no clearing —
threats can only be avoided, and the wall is the only technology that turns
unsafe ground into safe ground. A threat is less an enemy than weather with
legs: something you plan around, not something you solve. That puts all the
design weight on threat behaviour being *readable* — territories, circuits,
speed, visible range — because reading them is the player's entire toolkit.

**They can wreck what isn't finished — and they will.** Threats are
aggressive: a palisade or unfinished wall that a threat notices gets attacked,
not merely bumped into. Finished stone cannot be touched. The counterplay is
labour, not force: repair the palisade, build faster, or abandon the push and
fall back behind the old wall. The read before a push is therefore not "whose
ground is this" but "how long until something notices" — distance to the
nearest threats is the price tag on every bite of land. A side effect that
resolves itself: you can never permanently wall a threat in, because anything
that would hold it isn't finished yet — it smashes back out through the
palisade.

**An attack ends only when the monster leaves.** Monsters run on schedules —
rhythms of roaming, lingering, and moving on — and nothing the player does
drives one away. A noticed palisade is attacked until the schedule pulls the
monster elsewhere, so a contested push is about outlasting: repair faster than
it wrecks, and hold until it goes. Watch a monster's rounds long enough and
you know when it will come and when it will leave — the schedule is what makes
an enemy you can't fight fair.

**Schedules show approximately; precision is buildable.** The map reveals a
monster's rhythm to some extent — enough to plan a cautious push — but not
exactly. Watchtowers and alarm systems sharpen the picture: more exact
schedules, earlier warning, a head start for fleeing workers. Both are
manned — the watcher is a slot, a pair of hands taken from the pool like any
workshop worker. Information is infrastructure, and it is bought with the
scarcest currency in the game: people.

**Danger scales outward.** The further from the starting ground, the denser
and faster the threats and the bigger their ranges. Since there are no fights,
"harder" never means tougher enemies — it means tighter windows and shorter
warning. Early bites are calm; the deep map is earned.

**Workers run, but can be caught.** A worker flees when a threat closes in and
dies only if actually caught — inattention alone is not a death sentence, but
a misjudged window can be. Threat speed relative to a fleeing worker is the
main difficulty dial. Deaths are permanent and are supposed to hurt: real
losses are the point of choosing risk. But a death is just the loss — no
mourning mechanics, no morale spiral. The colony is simply one pair of hands
smaller, and the labour model makes sure that's felt.

## Prior art: what Kubifaktorium actually does

Recorded because it shaped the labour model, and because half of it is easy to
misremember.

Confirmed: production is mediated by **filtered storage** rather than direct
building-to-building links — buildings dump output into storage and pull inputs
from storage, so the early economy is shaped by where you put stockpiles and
what each one accepts. Walking distance is the real early cost. Colonists have a
list of jobs worked in **priority order, left to right**, and skills grow with
repetition, so specialists beat generalists. Automation comes in tiers —
conveyor belts, mine carts on rails, ships/zeppelins between islands — plus
automated depots and inserters, and items that do not match an automatic
workshop's recipe get carried away by colonists.

Less certain: whether Kubifaktorium has a *distinctly named* carrier/hauler
profession. The job lists in community guides are production roles (farmer,
harvester, builder, well worker, shepherd). Hauling appears to exist as task
work generated by buildings and stockpiles and picked up by available colonists,
which is the model Castles adopts. The observation that workshop workers get
**locked into their building** while haulers and builders switch freely came from
play, not from documentation.

Sources: the Kubifaktorium Steam page and community discussions, the Fandom wiki
(FAQ and Strategies pages — both behind a Cloudflare challenge, so only search
excerpts were readable), and the patch notes.

## Decisions still open

None at concept level — the pillars, the labour model, and the threat model
are settled and all point at the same promise. What remains is tuning and
spec work: exact speeds and damage, schedule shapes, watch precision, chain
recipes, map generation. Those belong in specs, not here.

## Not in scope

No combat of any kind — colonists never fight, threats can never be killed.
No sieges or base-defense waves. No fail states that arrive faster than the
player can read them.

*Note: `mockup.html` and `mockup3d.html` predate this rewrite — they show the
old concentric-ring, gentle-Wilds reading of the game.*
