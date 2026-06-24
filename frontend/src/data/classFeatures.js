import { RANGED_GROUPS } from "./weaponGroups";

//Frontend mirror of backend/data/classFeatures.js - drives the Character Design "Class Option" card
//and the confirm-time strike-rider modal. Keep the two files in sync (same shape; the backend copy
//additionally resolves the injected damage). See that file for the full rationale.
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
        strikeRider: {
            requiresCondition: "panache",
            weaponFilter: [
                { traitsAny: ["finesse"], melee: true },
                { group: "brawling", traitsAny: ["agile", "finesse"] },
            ],
            options: [
                { id: "preciseStrike", label: "Precise Strike",          default: true, requiresCondition: "panache" },
                { id: "normal",        label: "Normal" },
                { id: "finisher",      label: "Precise Strike Finisher", consumesCondition: "panache", requiresCondition: "panache" },
            ],
        },
    },
    barbarian: {
        label: "Barbarian",
        grantsActions: ["Rage"],
        configFields: [
            { key: "rageDamage", label: "Rage damage (melee/unarmed)", type: "number", default: 2 },
            { key: "rageTempHP", label: "Rage temporary HP",           type: "number", default: 12 },
        ],
    },
    //These classes use backend-only autoRiders/conditions for their Strike damage; the frontend mirror
    //only needs the config fields (for Character Design) and grantsActions (for getFeatureActions).
    rogue: {
        label: "Rogue",
        configFields: [
            { key: "sneakDice", label: "Sneak Attack dice", type: "dmgDie", default: "1d6" },
        ],
    },
    thaumaturge: {
        label: "Thaumaturge",
        grantsActions: ["Exploit Vulnerability"],
        configFields: [
            { key: "exploitDamage", label: "Exploit Vulnerability damage", type: "number", default: 2 },
        ],
    },
    ranger: {
        label: "Ranger",
        grantsActions: ["Hunt Prey"],
        configFields: [
            { key: "precisionDie", label: "Precision edge dice", type: "dmgDie", default: "1d8" },
        ],
    },
    investigator: {
        label: "Investigator",
        grantsActions: ["Devise a Stratagem"],
        configFields: [
            { key: "strategicDice", label: "Strategic Strike dice (d6)", type: "number", default: 1 },
        ],
    },
    inventor: {
        label: "Inventor",
        grantsActions: ["Overdrive"],
        configFields: [
            { key: "overdriveDamage", label: "Overdrive damage", type: "number", default: 2 },
        ],
    },
    magus: {
        label: "Magus",
        grantsActions: ["Arcane Cascade"],
        configFields: [
            { key: "cascadeDamage", label: "Arcane Cascade damage", type: "number", default: 1 },
        ],
    },
    bard: {
        label: "Bard",
        grantsActions: ["Courageous Anthem"],
    },
};

const featureOf = (classOption) => (classOption?.feature ? CLASS_FEATURES[classOption.feature] : null);

export const getFeatureConfigFields = (featureId) => CLASS_FEATURES[featureId]?.configFields ?? [];
export const getStrikeRider = (classOption) => featureOf(classOption)?.strikeRider ?? null;

//Names of feature/style actions this character gains (Barbarian Rage, Rascal Dirty Trick/Tumble
//Through, ...). The action panel merges these into the list and dedupes against the global actions.
export function getFeatureActions(classOption) {
    const f = featureOf(classOption);
    if (!f) return [];
    const fromStyle = (f.styles && classOption?.style) ? (f.styles[classOption.style]?.bravadoActions ?? []) : [];
    return [...new Set([...(f.grantsActions ?? []), ...fromStyle])];
}

function weaponMatchesClause(clause, weapon) {
    const group = weapon?.group ?? "";
    const traitNames = (weapon?.traits ?? []).map(t => t.name);
    if (clause.melee && RANGED_GROUPS.has(group)) return false;
    if (clause.ranged && !RANGED_GROUPS.has(group)) return false;
    if (clause.group && group !== clause.group) return false;
    if (clause.traitsAny && !clause.traitsAny.some(t => traitNames.includes(t))) return false;
    return true;
}

export const weaponMatchesFilter = (rider, weapon) =>
    (rider?.weaponFilter ?? []).some(clause => weaponMatchesClause(clause, weapon));

//Returns the rider only when the actor can actually make a choice with it: the weapon qualifies AND
//at least two options are currently available. An option is available when it has no requiresCondition
//or the actor has that condition (e.g. panache). Without panache the only option left is the plain
//Strike, so there's nothing to choose - we return null and the action resolves without a prompt.
//Returns the narrowed rider (available options only) so the modal never shows an unpickable choice.
export function getEligibleStrikeRider(actor, weapon) {
    const rider = getStrikeRider(actor?.classOption);
    if (!rider || !weapon) return null;
    if (!weaponMatchesFilter(rider, weapon)) return null;
    const actorConditions = (actor?.effects ?? []).map(e => e.slug);
    const available = rider.options.filter(o => !o.requiresCondition || actorConditions.includes(o.requiresCondition));
    if (available.length < 2) return null;
    return { ...rider, options: available };
}
