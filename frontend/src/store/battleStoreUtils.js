import blankPicture from '../images/characterImages/blank character.png';

//Folds the resilient rune (attributes.resilient) into the three saves so every battle consumer
//(resolver, crit-spec prompts, UI) sees the effective save. Kept separate on the stored model so the
//character sheet can show base saves + the rune. Idempotent only on BASE stats - always call with the
//stored character's stats, never a battle char's already-folded stats.
export function foldResilientSaves(stats) {
    const res = stats?.attributes?.resilient ?? 0;
    if (!res || !stats?.saves) return stats;
    return {
        ...stats,
        saves: {
            ...stats.saves,
            fortitude: (stats.saves.fortitude ?? 0) + res,
            reflex: (stats.saves.reflex ?? 0) + res,
            will: (stats.saves.will ?? 0) + res,
        },
    };
}

export function createBattleCharacter(char, side, displayName) {
    return {
        id: `${char.characterName}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sourceID: char._id,
        baseName: char.characterName,
        name: displayName ?? char.characterName,
        image: char.image || blankPicture,
        side,
        effects: [],
        offGuardSources: [],
        mapAttacks: 0,
        //Critical-specialization toggle, remembered per character for the whole battle (a fighter always
        //has it, a wizard never does) instead of resetting on every action select.
        critSpec: false,
        actionsRemaining: [true, true, true],
        stats: {
            ...foldResilientSaves(char.stats),
            //Optional chaining guards against pre-namespacing characters so they degrade to 0 HP
            //(prompting a resave) instead of crashing the battle UI
            maxHealth: char.stats.attributes?.hp ?? 0,
            currentHealth: char.stats.attributes?.hp ?? 0,
        },
        resistances: char.resistances ?? [],
        weaknesses: char.weaknesses ?? [],
        immunities: char.immunities ?? [],
        classOption: char.classOption ?? null,
    };
}

export function applyRenames(parties, renames) {
    let { heroes, foes } = parties;
    renames.forEach(r => {
        if (r.side === "hero") heroes = heroes.map(c => c.id === r.id ? { ...c, name: r.name } : c);
        else foes = foes.map(c => c.id === r.id ? { ...c, name: r.name } : c);
    });
    return { heroes, foes };
}

export function resolveDisplayName(charName, heroes, foes) {
    const sameBase = [...heroes, ...foes].filter(c => c.baseName === charName);
    if (sameBase.length === 0) return { displayName: charName, renames: [] };

    const highestNum = sameBase.reduce((max, c) => {
        const m = c.name.match(/ (\d+)$/);
        return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);

    if (highestNum === 0) {
        //All existing entries are unnumbered, rename every one of them sequentially
        return {
            displayName: `${charName} ${sameBase.length + 1}`,
            renames: sameBase.map((c, i) => ({ id: c.id, side: c.side, name: `${charName} ${i + 1}` })),
        };
    }
    return { displayName: `${charName} ${highestNum + 1}`, renames: [] };
}
