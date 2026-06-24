//Maps a Pathbuilder 2e export ("build" object, from the 6-digit code API or a downloaded
//.json) onto this app's character shape. Pathbuilder ships final totals for AC and per-weapon
//attack (used verbatim); saves/skills/perception are computed from ability scores + proficiency
//ranks by the fixed PF2e formula. The result prefills the editable CharacterDesign form, so the
//user reviews every number before saving - nothing is written silently.
import { RANGED_GROUPS } from "../data/weaponGroups";
import { CLASS_FEATURES } from "../data/classFeatures";

//Map a Pathbuilder class onto this app's class-feature option (only the modelled classes have one).
//Style (e.g. a Swashbuckler's Braggart) is detected from build.specials when it's listed there; config
//fields are left at their CLASS_FEATURES defaults for the user to confirm on the review form.
function parseClassOption(build) {
    const feature = String(build?.class || "").trim().toLowerCase();
    const def = CLASS_FEATURES[feature];
    if (!def) return null;
    let style;
    if (def.styles) {
        const specials = (Array.isArray(build?.specials) ? build.specials : []).map(s => String(s).toLowerCase());
        style = Object.entries(def.styles).find(([, s]) => specials.includes(s.label.toLowerCase()))?.[0];
    }
    return { feature, ...(style ? { style } : {}), config: {} };
}

//Ability score (e.g. 18) -> modifier (+4)
const mod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);

//PF2e: trained or better adds level + proficiency bonus + ability; untrained is ability only
//(no level). Pathbuilder stores proficiency as the bonus 0/2/4/6/8 (untrained..legendary).
const statTotal = (profBonus, abilityMod, level) => {
    const pb = Number(profBonus) || 0;
    return pb > 0 ? level + pb + abilityMod : abilityMod;
};

//Each skill's key ability, for converting Pathbuilder proficiency ranks into final modifiers
const SKILL_ABILITY = {
    acrobatics: "dex", arcana: "int", athletics: "str", crafting: "int",
    deception: "cha", diplomacy: "cha", intimidation: "cha", medicine: "wis",
    nature: "wis", occultism: "int", performance: "cha", religion: "wis",
    society: "int", stealth: "dex", survival: "wis", thievery: "dex",
};

//Pathbuilder damageType codes -> this app's capitalised DAMAGE_TYPES
const DMG_LETTER = { b: "Bludgeoning", p: "Piercing", s: "Slashing" };

//Best-effort weapon name -> PF2e weapon group (drives critical specialisation and melee/ranged).
//Not present in the Pathbuilder JSON, so this is a convenience default; the import popup lets the
//user correct the group per weapon. Unknown weapons fall back to "" (group None, treated as melee).
const WEAPON_GROUP_BY_NAME = {
    //sword
    longsword: "sword", shortsword: "sword", greatsword: "sword", "bastard sword": "sword",
    rapier: "sword", scimitar: "sword", falchion: "sword", "dueling sword": "sword", katana: "sword",
    //knife
    dagger: "knife", kukri: "knife", "main-gauche": "knife", sai: "knife", dogslicer: "knife",
    //axe
    battleaxe: "axe", "battle axe": "axe", hatchet: "axe", greataxe: "axe", "dwarven waraxe": "axe",
    //club / mace
    club: "club", greatclub: "club", mace: "club", "light mace": "club", morningstar: "club", sap: "club",
    //hammer
    warhammer: "hammer", "light hammer": "hammer", maul: "hammer",
    //spear
    spear: "spear", longspear: "spear", shortspear: "spear", trident: "spear",
    //polearm
    glaive: "polearm", halberd: "polearm", guisarme: "polearm", naginata: "polearm", ranseur: "polearm",
    //flail
    flail: "flail", "spiked chain": "flail", whip: "flail", nunchaku: "flail",
    //pick
    pick: "pick", "light pick": "pick", greatpick: "pick",
    //brawling (unarmed-ish)
    fist: "brawling", gauntlet: "brawling", "spiked gauntlet": "brawling",
    //bow (ranged)
    longbow: "bow", shortbow: "bow", "composite longbow": "bow", "composite shortbow": "bow",
    //crossbow (ranged)
    crossbow: "crossbow", "heavy crossbow": "crossbow", "hand crossbow": "crossbow", "repeating crossbow": "crossbow",
    //dart / sling (ranged)
    dart: "dart", javelin: "dart", sling: "sling", "halfling sling staff": "sling",
};

//Striking rune -> number of weapon damage dice
const strikingDice = (str) => {
    const s = String(str || "").toLowerCase();
    if (s.includes("major")) return 4;
    if (s.includes("greater")) return 3;
    if (s.includes("striking")) return 2;
    return 1;
};

//Resilient rune on worn armour -> rune rank 0-3 (stored on the character, folds into saves in battle)
const resilientRank = (res) => {
    const s = String(res || "").toLowerCase();
    if (s.includes("major")) return 3;
    if (s.includes("greater")) return 2;
    if (s.includes("resilient")) return 1;
    return 0;
};

const clampRune = (v) => Math.max(0, Math.min(3, Number(v) || 0));

const guessGroup = (name) => WEAPON_GROUP_BY_NAME[String(name || "").trim().toLowerCase()] || "";

const dieFaces = (die) => {
    const m = String(die || "").match(/d(\d+)/i);
    return m ? Number(m[1]) : 4;
};

const damageTypeFromCode = (code) => {
    //Modular weapons may store "B/P/S"; take the first listed type
    const first = String(code || "").trim().toLowerCase().split(/[\/,]/)[0];
    return DMG_LETTER[first] ?? "Slashing";
};

//payload: the parsed JSON (either the full { success, build } wrapper or a bare build object)
//Returns { characterName, flatStats, weapons } where flatStats matches CharacterDesign's flat form
//shape and weapons is a list of descriptors for the import confirmation popup.
export function parsePathbuilder(payload) {
    const build = payload?.build ?? payload;
    if (!build || typeof build !== "object" || !build.abilities) {
        throw new Error("This doesn't look like a Pathbuilder export (no character data found).");
    }

    const level = Number(build.level) || 1;
    const A = build.abilities || {};
    const m = {
        str: mod(A.str), dex: mod(A.dex), con: mod(A.con),
        int: mod(A.int), wis: mod(A.wis), cha: mod(A.cha),
    };
    const P = build.proficiencies || {};
    const attrs = build.attributes || {};

    //HP from its components (Pathbuilder doesn't store a single total)
    const health =
        (Number(attrs.ancestryhp) || 0) +
        (Number(attrs.classhp) || 0) * level +
        (Number(attrs.bonushp) || 0) +
        (Number(attrs.bonushpPerLevel) || 0) * level +
        m.con * level;

    //Resilient rune rank from the worn armour, stored separately on the character sheet
    const resilient = (build.armor || []).reduce(
        (best, a) => (a?.worn ? Math.max(best, resilientRank(a.res)) : best), 0);

    //DC: a spellcaster's spell DC (10 + level + prof + casting ability) when present, otherwise the
    //martial class DC (10 + level + class-DC prof + key ability) so e.g. a Swashbuckler imports its DC.
    let dc = 0;
    const casters = build.spellCasters || [];
    const caster = casters.find(c => (Number(c?.proficiency) || 0) > 0) || casters[0];
    if (caster) {
        dc = 10 + level + (Number(caster.proficiency) || 0) + mod(A[caster.ability] ?? 10);
    } else {
        const classProf = Number(P.classDC) || 0;
        if (classProf > 0) dc = 10 + level + classProf + (m[build.keyability] ?? 0);
    }

    //AC and per-weapon attack are final totals straight from Pathbuilder
    const ac = Number(build.acTotal?.acTotal) || 0;

    const rawWeapons = Array.isArray(build.weapons) ? build.weapons : [];
    let strHit = null, dexHit = null;
    const weapons = rawWeapons.map(w => {
        const group = guessGroup(w.name);
        const ranged = group ? RANGED_GROUPS.has(group) : false;
        const potency = clampRune(w.pot);
        //strHit/dexHit hold the attack bonus WITHOUT the weapon's potency rune - the rune lives on the
        //weapon and the resolver adds it back, so the bonus's source stays visible.
        const attack = Number(w.attack);
        if (Number.isFinite(attack)) {
            const base = attack - potency;
            if (ranged) dexHit = dexHit == null ? base : Math.max(dexHit, base);
            else strHit = strHit == null ? base : Math.max(strHit, base);
        }
        return {
            name: w.name || "Imported Weapon",
            group,
            damageType: damageTypeFromCode(w.damageType),
            //Pathbuilder weapons list a single base die; the striking rune adds the extra dice separately
            numRolled: 1,
            diceRolled: dieFaces(w.die),
            striking: Math.max(0, strikingDice(w.str) - 1),
            potency,
            //Flat damage bonus from Pathbuilder INCLUDES the ability mod for melee. The import popup
            //subtracts STR for melee groups (the engine reinjects it) so STR isn't double-counted.
            damageBonus: Number.isFinite(Number(w.damageBonus)) ? Number(w.damageBonus) : null,
        };
    });

    const flatStats = {
        ac,
        dc,
        str: m.str,
        strHit: strHit ?? 0,
        dexHit: dexHit ?? 0,
        health,
        //Resilient rune kept separate from base saves (the resolver folds it in during battle)
        resilient,
        fortitude: statTotal(P.fortitude, m.con, level),
        reflex: statTotal(P.reflex, m.dex, level),
        will: statTotal(P.will, m.wis, level),
        skills: {
            perception: statTotal(P.perception, m.wis, level),
            ...Object.fromEntries(
                Object.entries(SKILL_ABILITY).map(([skill, abil]) =>
                    [skill, statTotal(P[skill], m[abil], level)])
            ),
        },
    };

    return { characterName: build.name || "Imported Character", flatStats, weapons, classOption: parseClassOption(build) };
}
