import { RANGED_GROUPS } from "./weaponGroups.js";

//Declarative registry of optional class abilities a character can take. Each entry describes
//everything the resolver and UI need, so adding a new class (e.g. rogue sneak attack, barbarian
//rage) is mostly a data entry rather than new plumbing. Two pipelines consume this (see
//modules/classFeatures/classFeatureResolution.js):
//  - grantOnOutcome: a bravado/skill action that, on the listed outcomes, grants a condition.
//  - strikeRider:    conditional bonus ("precision") damage gated by a condition + a weapon filter,
//                    chosen at confirm-time. `consumesCondition` removes the resource (e.g. finisher).
export const CLASS_FEATURES = {
    swashbuckler: {
        label: "Swashbuckler",
        styles: {
            rascal:       { label: "Rascal",       bravadoActions: ["Dirty Trick", "Tumble Through"] },
            braggart:     { label: "Braggart",     bravadoActions: ["Demoralize"] },
            gymnast:      { label: "Gymnast",      bravadoActions: ["Grapple", "Trip", "Shove"] },
            fencer:       { label: "Fencer",       bravadoActions: ["Feint", "Create a Diversion"] },
            battledancer: { label: "Battledancer", bravadoActions: ["Perform"] },
            wit:          { label: "Wit",          bravadoActions: ["Bon Mot"] },
        },
        configFields: [
            { key: "preciseStrike", label: "Precise Strike (precision dmg)", type: "number", default: 2 },
            { key: "finisherDice",  label: "Finisher dice",                  type: "dmgDie", default: "2d6" },
        ],
        grantOnOutcome: {
            outcomes: ["success", "criticalSuccess"],
            condition: "panache",
            target: "activeActor",
            duration: { type: "manual" },
        },
        strikeRider: {
            requiresCondition: "panache",
            //Any matching clause qualifies the weapon (finesse melee, or agile/finesse unarmed)
            weaponFilter: [
                { traitsAny: ["finesse"], melee: true },
                { group: "brawling", traitsAny: ["agile", "finesse"] },
            ],
            options: [
                { id: "preciseStrike", label: "Precise Strike",          default: true, damage: { from: "preciseStrike", kind: "flat" } },
                { id: "normal",        label: "Normal",                  damage: null },
                { id: "finisher",      label: "Precise Strike Finisher", damage: { from: "finisherDice", kind: "dice" }, consumesCondition: "panache" },
            ],
        },
    },
    barbarian: {
        label: "Barbarian",
        //Grants the Rage action (self-buff: temp HP + the rage Strike-damage condition). Config drives
        //the per-character numbers, hydrated into the action at resolution via "$key" tokens.
        grantsActions: ["Rage"],
        configFields: [
            { key: "rageDamage", label: "Rage damage (melee/unarmed)", type: "number", default: 2 },
            { key: "rageTempHP", label: "Rage temporary HP",           type: "number", default: 12 },
        ],
    },
    rogue: {
        label: "Rogue",
        //Sneak Attack: precision dice vs an off-guard target, with an agile/finesse melee or unarmed
        //weapon or any ranged weapon. Passive (no granted action) - an autoRider gated by the target.
        configFields: [
            { key: "sneakDice", label: "Sneak Attack dice", type: "dmgDie", default: "1d6" },
        ],
        autoRiders: [
            {
                id: "sneakAttack",
                label: "Sneak Attack",
                requiresTargetCondition: "off-guard",
                weaponFilter: [
                    { traitsAny: ["agile", "finesse"], melee: true },
                    { ranged: true },
                ],
                damage: { from: "sneakDice", kind: "dice" },
                category: "precision",
            },
        ],
    },
    thaumaturge: {
        label: "Thaumaturge",
        grantsActions: ["Exploit Vulnerability"],
        configFields: [
            { key: "exploitDamage", label: "Exploit Vulnerability damage", type: "number", default: 2 },
        ],
        autoRiders: [
            {
                id: "exploit",
                label: "Exploit Vulnerability",
                requiresTargetCondition: "exploited-vulnerability",
                weaponFilter: "allStrikes",
                damage: { from: "exploitDamage", kind: "flat" },
                category: "untyped",
            },
        ],
    },
    ranger: {
        label: "Ranger",
        grantsActions: ["Hunt Prey"],
        //Only the Precision hunter's edge is modeled: extra damage on the first Strike each turn vs prey.
        configFields: [
            { key: "precisionDie", label: "Precision edge dice", type: "dmgDie", default: "1d8" },
        ],
        autoRiders: [
            {
                id: "precisionEdge",
                label: "Precision",
                requiresTargetCondition: "hunted-prey",
                weaponFilter: "allStrikes",
                onlyFirstAttack: true,
                damage: { from: "precisionDie", kind: "dice" },
                category: "precision",
            },
        ],
    },
    investigator: {
        label: "Investigator",
        //Devise a Stratagem applies the `devised` effect (precision d6s on your next Strike).
        grantsActions: ["Devise a Stratagem"],
        configFields: [
            { key: "strategicDice", label: "Strategic Strike dice (d6)", type: "number", default: 1 },
        ],
    },
    inventor: {
        label: "Inventor",
        //Overdrive applies the `overdrive` effect (extra Strike damage).
        grantsActions: ["Overdrive"],
        configFields: [
            { key: "overdriveDamage", label: "Overdrive damage", type: "number", default: 2 },
        ],
    },
    magus: {
        label: "Magus",
        //Arcane Cascade applies the `arcane-cascade` stance (extra Strike damage).
        grantsActions: ["Arcane Cascade"],
        configFields: [
            { key: "cascadeDamage", label: "Arcane Cascade damage", type: "number", default: 1 },
        ],
    },
    bard: {
        label: "Bard",
        //Courageous Anthem applies inspired-courage (+1 status attack & +1 status Strike damage) to allies.
        grantsActions: ["Courageous Anthem"],
    },
};

const featureOf = (classOption) => (classOption?.feature ? CLASS_FEATURES[classOption.feature] : null);

//Bravado actions for the character's chosen feature + style
export function getBravadoActions(classOption) {
    const f = featureOf(classOption);
    if (!f?.styles || !classOption.style) return [];
    return f.styles[classOption.style]?.bravadoActions ?? [];
}

//All actions the character's feature/style grants beyond the global actions: feature-level
//grantsActions (e.g. Barbarian Rage) plus the chosen style's bravado actions (e.g. Rascal -> Dirty
//Trick, Tumble Through). Global bravado actions (Grapple/Trip/Demoralize) are included here but are
//already available to everyone, so the frontend dedupes them against the global list.
export function getFeatureActions(classOption) {
    const f = featureOf(classOption);
    if (!f) return [];
    return [...new Set([...(f.grantsActions ?? []), ...getBravadoActions(classOption)])];
}

//Server-side gate: true if the actor's class option grants the named feature action
export function actorHasFeatureAction(classOption, actionName) {
    return getFeatureActions(classOption).includes(actionName);
}

//The grant spec to inject if `actionName` is a bravado action for this character, else null
export function getGrantForAction(classOption, actionName) {
    const f = featureOf(classOption);
    if (!f?.grantOnOutcome) return null;
    return getBravadoActions(classOption).includes(actionName) ? f.grantOnOutcome : null;
}

export function getStrikeRider(classOption) {
    return featureOf(classOption)?.strikeRider ?? null;
}

//Auto strike-riders: always-on conditional Strike damage with no confirm modal, gated by an actor
//or target condition (e.g. Rogue Sneak Attack vs off-guard, Thaumaturge vs exploited, Ranger
//precision edge vs hunted prey). Returns [] when the feature defines none.
export function getAutoRiders(classOption) {
    return featureOf(classOption)?.autoRiders ?? [];
}

//True if a weapon { group, traits:[{name}] } satisfies a single filter clause
function weaponMatchesClause(clause, weapon) {
    const group = weapon?.group ?? "";
    const traitNames = (weapon?.traits ?? []).map(t => t.name);
    if (clause.melee && RANGED_GROUPS.has(group)) return false;
    if (clause.ranged && !RANGED_GROUPS.has(group)) return false;
    if (clause.group && group !== clause.group) return false;
    if (clause.traitsAny && !clause.traitsAny.some(t => traitNames.includes(t))) return false;
    return true;
}

//True if the weapon qualifies for the rider (any clause matches)
export function weaponMatchesFilter(rider, weapon) {
    return (rider?.weaponFilter ?? []).some(clause => weaponMatchesClause(clause, weapon));
}

//Match a weapon against an augment filter: the string "allStrikes" (or a missing filter) matches any
//weapon; otherwise an array of clauses where any matching clause qualifies (same as weaponFilter).
export function weaponMatchesAugmentFilter(filter, weapon) {
    if (!filter || filter === "allStrikes") return true;
    return (Array.isArray(filter) ? filter : []).some(clause => weaponMatchesClause(clause, weapon));
}

//Resolve a chosen rider option to a concrete damage descriptor using the character's config, or null.
//Returns { kind:"flat", value } | { kind:"dice", numRolled, diceRolled } | null (for "normal").
export function resolveRiderDamage(classOption, option, parseDmgDie) {
    if (!option?.damage) return null;
    const cfg = classOption?.config ?? {};
    if (option.damage.kind === "flat") {
        const value = Number(cfg[option.damage.from]);
        return Number.isFinite(value) && value > 0 ? { kind: "flat", value } : null;
    }
    //dice: config holds either {numRolled,diceRolled} or a "XdY" string
    const raw = cfg[option.damage.from];
    if (raw && typeof raw === "object" && raw.numRolled > 0 && raw.diceRolled > 0) {
        return { kind: "dice", numRolled: raw.numRolled, diceRolled: raw.diceRolled };
    }
    if (typeof raw === "string" && parseDmgDie) {
        const parsed = parseDmgDie(raw);
        if (!parsed?.errors) return { kind: "dice", numRolled: parsed.numRolled, diceRolled: parsed.diceRolled };
    }
    return null;
}
