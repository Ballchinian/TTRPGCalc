# TTRPG Combat Calculator

A web app for building tabletop RPG characters and running fights with them. You make your characters, give them weapons and spells, drop them into two parties, and play out an encounter turn by turn. The server does the actual rules work — the damage, conditions, saves, runes, and class features — so the numbers land the way the book says they should. You get a combat log and a round-by-round recap of how it all went.

## Features

- Character builder: HP, AC, saves, skills, resistances, weaknesses, immunities, a class option, and a portrait you can upload and crop
- Weapon and spell builder with traits, runes, critical specialization, versatile damage, saving throws, healing, and conditions
- Import straight from Pathbuilder 2e (export code or pasted JSON) or Foundry VTT
- Turn-based battle simulator: two parties, initiative tracking, action economy, and the multiple attack penalty
- Three ways to resolve an action: averaged, rolled, or pick the outcome yourself
- The PF2e rules that actually matter in a fight: resistance, weakness, immunity, the condition hierarchy, basic saves, persistent damage, off-guard, temporary HP
- Class features and stances: Rage, Panache and Finishers, Sneak Attack, Hunt Prey, and more
- Combat log, round-by-round recap, and a heads-up on conditions about to expire
- Up to five saved battles per account
- Accounts with proper session handling and email password reset

Endpoint docs live in [ENDPOINTS.md](./ENDPOINTS.md).

## How it works

The server has the final say. The frontend never works out what an action does — it just sends who's acting, who they're hitting, and which action they picked. The backend looks the action back up from the database (so a client can't sneak in made-up effects), applies the bonuses and conditions, rolls or averages the dice, and hands back the updated combatants, a formatted log, and per-target stats.

Every action runs through the same steps:

1. Apply the actor's offensive bonuses and each target's defensive ones.
2. Turn the action into per-target effects: damage, healing, conditions, temp HP.
3. Resolve each effect against the target's resistances, weaknesses, and immunities.
4. Layer on class-feature riders (precision damage, stance bonuses) and critical specialization.
5. Build the log and stats, and return the updated combatants.

### Resolution modes

You choose how the dice get handled, per action.

| Mode | What it does |
| --- | --- |
| Average | Deterministic expected values. The quickest way to weigh up two options. |
| Luck | Rolls real dice, down to the per-die results you see in the hover breakdown. |
| Choose | You call the outcome (crit success, success, failure, crit failure) for each target, and the effects for that outcome get applied. |

### Damage

Damage follows the PF2e order: add weakness, subtract resistance, then clamp at zero so a hit never heals. Immunity skips all of that and zeroes the damage outright. Type matching ignores case.

## Conditions and durations

Conditions sit on each combatant with a value (when one applies) and a duration that decides when they fall off. The engine enforces the condition hierarchy, so a worse condition removes and suppresses the lighter ones it covers. Restrained, for instance, takes grabbed and immobilized off the combatant, and trying to add either back is ignored while restrained is still there.

| Duration | When it ends |
| --- | --- |
| `manual` | Only when you remove it |
| `decrement` | Drops by one at end of turn, gone at zero |
| `rounds` | After a set number of rounds |
| `endOfRound` | At the end of the current round |
| `endOfNextTurn` | At the end of the applying actor's next turn |
| `startOfTargetTurn` | At the start of the affected creature's turn |
| `flatCheck` | When a recovery flat check passes |

Off-guard is tracked by where it came from. It sticks around as long as anything granting it (prone, grabbed, restrained, and so on) is still active, and clears once the last source is gone.

Persistent damage lands at the end of each round, adjusted for resistance and weakness, followed by a recovery flat check (DC 15 by default). The same damage type doesn't stack — it keeps the higher value.

## Runes and item bonuses

Weapon and armour runes live on the item and get folded into the right rolls during resolution, so you can still see what they're contributing instead of it vanishing into one lump number.

| Rune | What it does |
| --- | --- |
| Potency | Item bonus to attack rolls (rank 0 to 3) |
| Striking | Extra weapon damage dice (striking, greater, major) |
| Resilient | Item bonus to saves (rank 0 to 3), folded in during the fight |

## Class features

A character can take one class option, which hands them extra actions, a stance, or conditional Strike damage. Features are plain data in a single registry, so the resolver and the UI both read from the same place.

| Class | Feature |
| --- | --- |
| Swashbuckler | Panache, Precise Strike, and Finishers (Rascal, Braggart, Gymnast, Fencer, Battledancer, Wit) |
| Barbarian | Rage: temp HP plus extra melee and unarmed Strike damage |
| Rogue | Sneak Attack: precision dice against an off-guard target |
| Ranger | Hunt Prey and the Precision hunter's edge |
| Investigator | Devise a Stratagem: precision dice on your next Strike |
| Thaumaturge | Exploit Vulnerability |
| Inventor | Overdrive |
| Magus | Arcane Cascade stance |
| Bard | Courageous Anthem for allies |

Everyone, whatever their class, can Grapple, Trip, Demoralize, Stand, and Escape.

## Accounts

Accounts use short-lived access tokens with rotating refresh tokens.

- Passwords are hashed with bcrypt.
- The access token is a JWT kept in memory and good for 15 minutes.
- The refresh token lives in an httpOnly cookie for 7 days and rotates on every refresh. Only a hash of it is stored, so a database leak can't be turned into a hijacked session.
- Password resets go out by email with a single-use, time-limited token, and finishing a reset logs out every active session.
- The auth and import routes are rate limited.

## Running a battle

You add characters to a battle as **heroes** or **foes**, and duplicate names get sorted out automatically. The whole battle (parties, round, initiative, and settings) is saved locally and tied to whoever's logged in.

Initiative can be rolled off Perception, rolled on a flat d20, or just dragged into whatever order you want. Ties go to the higher Perception, then a coin flip.

On a turn you choose an actor, an action, and the targets, then resolve. Action economy and the multiple attack penalty are tracked for you, and you can switch that off if you'd rather. Run someone out of actions and initiative moves on to the next combatant.

Ending the round ticks every duration, applies persistent damage and its recovery checks, clears spent conditions, and gives everyone their actions back. Lost actions from slowed and stunned get applied here too.

Every action you resolve goes into a round-by-round recap with the damage, healing, and condition changes. Save a battle (up to five) and you can load it back later.

## Tech stack

- **Frontend:** React 19, Vite, Zustand, React Router, Bootstrap
- **Backend:** Node.js, Express, MongoDB with Mongoose, JSON Web Tokens, Cloudinary
- **Tests:** Node's built-in test runner on the backend, Vitest on the frontend

## A typical session

1. Build or import your characters.
2. Give them weapons and spells in the Action Builder.
3. Add them to a battle as heroes and foes.
4. Roll initiative.
5. On each turn, pick an actor, an action, and the targets.
6. Resolve, and let the engine handle damage, conditions, and class-feature effects.
7. End the round to tick durations and deal persistent damage.
8. Read the recap, and save the battle if you want to come back to it.