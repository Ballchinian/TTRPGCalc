//Maps a Foundry VTT PF2e actor export (right-click actor -> Export Data -> .json) onto this app's
//character shape. Foundry ships final totals for AC, saves, perception and skills (used verbatim),
//but it computes attack bonuses per-strike rather than storing one number - so strHit/dexHit are
//derived from level + ability mod + a weapon proficiency the user picks in the import dialog. The
//result prefills the editable CharacterDesign form, so the user reviews every number before saving.

//PF2e proficiency bonus by rank (untrained adds nothing and no level)
const PROF_BONUS = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };

const cap = (s) => {
    const t = String(s ?? "").trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

//Our skill name -> the keys Foundry might use (full names in v5+, three-letter abbreviations before that)
const SKILL_KEYS = {
    acrobatics: ["acrobatics", "acr"], arcana: ["arcana", "arc"], athletics: ["athletics", "ath"],
    crafting: ["crafting", "cra"], deception: ["deception", "dec"], diplomacy: ["diplomacy", "dip"],
    intimidation: ["intimidation", "itm"], medicine: ["medicine", "med"], nature: ["nature", "nat"],
    occultism: ["occultism", "occ"], performance: ["performance", "prf"], religion: ["religion", "rel"],
    society: ["society", "soc"], stealth: ["stealth", "ste"], survival: ["survival", "sur"], thievery: ["thievery", "thi"],
};

//Ability modifier: newer PF2e stores `.mod` directly; older stored a score in `.value`
function abilityMod(abilities, key) {
    const a = abilities?.[key];
    if (!a) return 0;
    if (typeof a.mod === "number") return a.mod;
    if (typeof a.value === "number") return Math.floor((a.value - 10) / 2);
    return 0;
}

function skillValue(skills, keys) {
    for (const k of keys) {
        const v = skills?.[k]?.value;
        if (typeof v === "number") return v;
    }
    return 0;
}

//Foundry resistances/weaknesses are [{ type, value }]; immunities are [{ type }] (or bare strings)
const mapDmgList = (list) =>
    (Array.isArray(list) ? list : [])
        .map(e => ({ damageType: cap(e?.type), value: Number(e?.value) || 0 }))
        .filter(e => e.damageType);

//payload: the exported actor object (or a wrapper with `.actor`)
//options.martialRank: "untrained" | "trained" | "expert" | "master" | "legendary"
//Returns the shared import shape { characterName, flatStats, weapons, resistances, weaknesses, immunities, classOption }
export function parseFoundry(payload, options = {}) {
    const actor = payload?.system ? payload : (payload?.actor ?? payload);
    const system = actor?.system;
    if (!system || !system.abilities) {
        throw new Error("This doesn't look like a Foundry PF2e actor export (no system.abilities found).");
    }

    const profBonus = PROF_BONUS[options.martialRank] ?? PROF_BONUS.trained;
    const level = Number(system.details?.level?.value) || 1;
    const strMod = abilityMod(system.abilities, "str");
    const dexMod = abilityMod(system.abilities, "dex");
    //Attack total = ability mod + level + proficiency bonus (trained+); ability-only when untrained
    const deriveHit = (abMod) => (profBonus > 0 ? level + profBonus + abMod : abMod);

    const items = Array.isArray(actor.items) ? actor.items : [];
    //Spell DC from the first spellcasting entry, if any (martials have none -> 0)
    const caster = items.find(i => i.type === "spellcastingEntry");
    const casterDc = caster?.system?.spelldc?.value ?? caster?.system?.statistic?.dc?.value;

    const saves = system.saves || {};
    const skills = system.skills || {};

    //Foundry save/perception/skill totals already fold in the resilient rune, so it stays 0 here
    const flatStats = {
        ac: Number(system.attributes?.ac?.value) || 0,
        dc: typeof casterDc === "number" ? casterDc : 0,
        str: strMod,
        strHit: deriveHit(strMod),
        dexHit: deriveHit(dexMod),
        health: Number(system.attributes?.hp?.max) || 0,
        resilient: 0,
        fortitude: Number(saves.fortitude?.value) || 0,
        reflex: Number(saves.reflex?.value) || 0,
        will: Number(saves.will?.value) || 0,
        skills: {
            perception: Number(system.perception?.value ?? system.attributes?.perception?.value) || 0,
            ...Object.fromEntries(Object.entries(SKILL_KEYS).map(([name, keys]) => [name, skillValue(skills, keys)])),
        },
    };

    const immunities = (Array.isArray(system.attributes?.immunities) ? system.attributes.immunities : [])
        .map(e => cap(typeof e === "string" ? e : e?.type))
        .filter(Boolean);

    //Class item -> our class-feature id when it's one of the supported combat classes (validated in the form)
    const classItem = items.find(i => i.type === "class");
    const feature = classItem ? String(classItem.name || "").trim().toLowerCase() : "";
    const classOption = feature ? { feature, config: {} } : null;

    return {
        characterName: actor.name || "Imported Character",
        flatStats,
        weapons: [], //Foundry weapon items carry runes/traits we don't map yet - add the arsenal manually for now
        resistances: mapDmgList(system.attributes?.resistances),
        weaknesses: mapDmgList(system.attributes?.weaknesses),
        immunities,
        classOption,
    };
}
