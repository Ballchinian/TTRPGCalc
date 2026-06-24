import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createBattleCharacter, applyRenames, resolveDisplayName, foldResilientSaves } from './battleStoreUtils';
import { OFF_GUARD } from '../data/effectNames';
import { applyDamageToPools } from '../utils/hpPools';

const defaultState = {
    //Which user the persisted battle belongs to, so another account doesn't load it (see claimForUser)
    ownerUserID: null,
    parties: { heroes: [], foes: [] },
    target: { mode: null, activeActor: null, selectedTargetCharacters: [] },
    action: { selected: "", selectedType: "", targetType: "", choosing: false },
    settings: {
        diceMode: "avg",
        autoActions: true,
        autoMAP: true,
        autoDecrementConditions: true,
        ignoreHP: false,
        showDamageModifiers: true,
        capOverkill: false,
    },
    round: 1,
    log: {},
    error: "",
    pendingAction: null,
    pendingNichePrompts: [],
    expiringConditions: [],
    persistCheckResults: [],
    /*
        Initiative order. `order` is the rolled/arranged turn list ([] = not rolled), each entry
        { side, id, sourceID, name, perception, roll, total }; `turnIndex` points at whose turn it is.
        Battle data - persists and resets with the battle.
    */
    initiative: { order: [], turnIndex: 0 },
    /*
        { id, name } of the saved-battle slot this battle was loaded from (or was last saved into),
        so the Save dialog can default to updating that slot rather than making the user guess which
        one to overwrite. null for a fresh battle that has never been saved.
    */
    loadedBattle: null,
};


export const useBattleStore = create(
    persist(
        (set, get) => ({
            ...defaultState,

            //Character management

            addHero: (char) => set(state => {
                const { displayName, renames } = resolveDisplayName(char.characterName, state.parties.heroes, state.parties.foes);
                const { heroes, foes } = applyRenames(state.parties, renames);
                return { parties: { ...state.parties, heroes: [...heroes, createBattleCharacter(char, "hero", displayName)], foes } };
            }),

            addFoe: (char) => set(state => {
                const { displayName, renames } = resolveDisplayName(char.characterName, state.parties.heroes, state.parties.foes);
                const { heroes, foes } = applyRenames(state.parties, renames);
                return { parties: { ...state.parties, foes: [...foes, createBattleCharacter(char, "foe", displayName)], heroes } };
            }),

            //Applies an updater function to a specific character; also keeps selectedTargetCharacters in sync
            updateCharacterInList: (side, id, updater) => set(state => {
                const key = side === "hero" ? "heroes" : "foes";
                const updatedList = state.parties[key].map(c => c.id === id ? updater(c) : c);
                const syncedTargets = state.target.selectedTargetCharacters.map(t =>
                    t.id === id && t.side === side ? (updatedList.find(c => c.id === id) || t) : t
                );
                return {
                    parties: { ...state.parties, [key]: updatedList },
                    target: { ...state.target, selectedTargetCharacters: syncedTargets },
                };
            }),

            deleteCharacterFromList: (side, id) => set(state => {
                const key = side === "hero" ? "heroes" : "foes";
                const nextTarget = { ...state.target };
                if (nextTarget.activeActor?.id === id) nextTarget.activeActor = null;
                nextTarget.selectedTargetCharacters = (nextTarget.selectedTargetCharacters || []).filter(t => t.id !== id);
                return {
                    parties: { ...state.parties, [key]: state.parties[key].filter(c => c.id !== id) },
                    target: nextTarget,
                };
            }),

            //Round management

            endRound: () => set(state => {
                //Apply resistance/weakness/immunity to a raw damage value (mirrors backend actionResolution)
                const applyMods = (raw, damageType, char) => {
                    if (!damageType || raw <= 0) return raw;
                    const t = damageType.toLowerCase();
                    if ((char.immunities ?? []).some(i => i.toLowerCase() === t)) return 0;
                    const res = (char.resistances ?? []).find(r => r.damageType.toLowerCase() === t);
                    const wk  = (char.weaknesses  ?? []).find(w => w.damageType.toLowerCase() === t);
                    let dmg = res ? Math.max(0, raw - res.value) : raw;
                    if (wk) dmg += wk.value;
                    return dmg;
                };

                //Collected across all characters; accessible by processChar via closure
                const allFlatCheckResults = [];

                const processChar = (char) => {
                    //Apply persistent damage first, then handle flat checks and effect cleanup
                    let workChar = char;
                    if (state.settings.autoDecrementConditions) {
                        const persistEffects = (char.effects || []).filter(e => e.slug.startsWith("persistent ") && e.value > 0);
                        if (persistEffects.length > 0) {
                            const persistTotal = persistEffects.reduce((sum, e) => {
                                const type = e.damageType ?? e.slug.replace("persistent ", "");
                                return sum + applyMods(e.value, type, char);
                            }, 0);
                            if (persistTotal > 0) {
                                //Temp HP absorbs persistent damage before real HP
                                workChar = { ...char, stats: { ...char.stats, ...applyDamageToPools(char.stats, persistTotal) } };
                            }

                            //Roll the recovery flat check (default DC 15, or the effect's custom dc)
                            const toRemove = new Set();
                            persistEffects
                                .filter(e => e.duration?.type === "flatCheck")
                                .forEach(e => {
                                    const dc = e.duration?.dc ?? 15;
                                    const roll = Math.floor(Math.random() * 20) + 1;
                                    const recovered = roll >= dc;
                                    allFlatCheckResults.push({
                                        charName: char.name,
                                        effectName: e.slug,
                                        amount: e.value,
                                        damageType: e.damageType ?? e.slug.replace("persistent ", ""),
                                        dc,
                                        roll,
                                        recovered,
                                    });
                                    if (recovered) toRemove.add(e.slug);
                                });
                            if (toRemove.size > 0) {
                                workChar = { ...workChar, effects: (workChar.effects || []).filter(ef => !toRemove.has(ef.slug)) };
                            }
                        }
                    }

                    const filteredEffects = state.settings.autoDecrementConditions
                        ? workChar.effects
                            .map(e => {
                                if (e.duration?.type === "decrement") return { ...e, value: e.value - 1 };
                                if (e.duration?.type === "rounds") return { ...e, duration: { ...e.duration, remaining: (e.duration.remaining ?? 1) - 1 } };
                                return e;
                            })
                            .filter(e => {
                                if (e.duration?.type === "endOfRound")    return false;
                                if (e.duration?.type === "currentTurn")   return false; //also clears at round end
                                if (e.duration?.type === "decrement")     return e.value > 0;
                                if (e.duration?.type === "rounds")        return (e.duration.remaining ?? 0) > 0;
                                if (e.duration?.type === "endOfNextTurn") return true;
                                if (e.duration?.type === "startOfTargetTurn") return true; //expires on the target's turn, handled in selectTarget
                                if (e.duration?.type === "manual")        return true;
                                if (e.duration?.type === "flatCheck")     return true; //stays until flat check succeeds
                                return false; //unknown type, drop rather than accumulate forever
                            })
                        : workChar.effects;

                    //Sync offGuardSources: drop any condition source that the filter removed. "manual" is a
                    //player-toggled source with no backing effect, so it persists until the player clears it.
                    const keptNames = new Set(filteredEffects.map(e => e.slug));
                    const newSources = (workChar.offGuardSources || []).filter(src => src === "manual" || keptNames.has(src));
                    const finalEffects = newSources.length === 0
                        ? filteredEffects.filter(e => e.slug !== OFF_GUARD)
                        : filteredEffects;

                    //Start-of-turn action loss from stunned/slowed. PF2e: the two don't stack - 
                    //lose the higher value, then stunned reduces by the actions lost while slowed persists.
                    let actionsRemaining = [true, true, true];
                    let updatedFinalEffects = finalEffects;
                    const stunnedVal = finalEffects.find(e => e.slug === "stunned")?.value ?? 0;
                    const slowedVal = finalEffects.find(e => e.slug === "slowed")?.value ?? 0;
                    const actionsLost = Math.min(Math.max(stunnedVal, slowedVal), 3);
                    if (actionsLost > 0) {
                        for (let i = 0; i < actionsLost; i++) {
                            const idx = actionsRemaining.lastIndexOf(true);
                            if (idx !== -1) actionsRemaining[idx] = false;
                        }
                        if (stunnedVal > 0) {
                            const newStunned = stunnedVal - actionsLost;
                            updatedFinalEffects = newStunned <= 0
                                ? finalEffects.filter(e => e.slug !== "stunned")
                                : finalEffects.map(e => e.slug === "stunned" ? { ...e, value: newStunned } : e);
                        }
                    }

                    return {
                        ...workChar,
                        actionsRemaining,
                        mapAttacks: 0,
                        effects: updatedFinalEffects,
                        offGuardSources: newSources,
                    };
                };
                return {
                    round: (state.round ?? 1) + 1,
                    log: {},
                    error: "",
                    pendingAction: null,
                    parties: {
                        heroes: state.parties.heroes.map(processChar),
                        foes: state.parties.foes.map(processChar),
                    },
                    persistCheckResults: allFlatCheckResults,
                };
            }),

            clearPersistChecks: () => set({ persistCheckResults: [] }),

            //Initiative

            //Builds the turn order from the current parties. mode "avg" sorts by raw Perception; "luck"
            //rolls d20+Perception for each. ("choose" is driven by the tracker UI via setInitiativeOrder.)
            //Ties break on higher Perception, then a coin flip - mirroring PF2e's "higher modifier wins".
            rollInitiative: (mode) => set(state => {
                const everyone = [...state.parties.heroes, ...state.parties.foes];
                if (everyone.length === 0) return {};
                const entries = everyone.map(c => {
                    const perception = c.stats?.perception ?? 0;
                    const roll = mode === "luck" ? Math.floor(Math.random() * 20) + 1 : null;
                    const total = mode === "luck" ? roll + perception : perception;
                    return { side: c.side, id: c.id, sourceID: c.sourceID, name: c.name, perception, roll, total };
                });
                entries.sort((a, b) => (b.total - a.total) || (b.perception - a.perception) || (Math.random() - 0.5));
                const first = entries[0];
                return {
                    initiative: { order: entries, turnIndex: 0 },
                    target: { ...state.target, activeActor: first ? { side: first.side, id: first.id, sourceID: first.sourceID } : state.target.activeActor },
                };
            }),

            //Replace the order outright (used by Choose mode and after a manual edit)
            setInitiativeOrder: (order) => set(state => ({
                initiative: { order, turnIndex: 0 },
                target: { ...state.target, activeActor: order[0] ? { side: order[0].side, id: order[0].id, sourceID: order[0].sourceID } : state.target.activeActor },
            })),

            //Drag-to-reorder: move an entry, keeping the same creature highlighted as the current turn
            reorderInitiative: (from, to) => set(state => {
                const order = [...state.initiative.order];
                if (from < 0 || to < 0 || from >= order.length || to >= order.length) return {};
                const currentId = order[state.initiative.turnIndex]?.id;
                const [moved] = order.splice(from, 1);
                order.splice(to, 0, moved);
                const turnIndex = Math.max(0, order.findIndex(e => e.id === currentId));
                return { initiative: { order, turnIndex } };
            }),

            clearInitiative: () => set({ initiative: { order: [], turnIndex: 0 } }),

            //Jump to a specific combatant's turn (click an entry in the tracker)
            setCurrentTurn: (index) => set(state => {
                const cur = state.initiative.order[index];
                if (!cur) return {};
                return {
                    initiative: { ...state.initiative, turnIndex: index },
                    target: { ...state.target, activeActor: { side: cur.side, id: cur.id, sourceID: cur.sourceID } },
                };
            }),

            //Advance to the next combatant; wrapping past the last ends the round (ticks durations and
            //refreshes everyone's actions via endRound). Sets the new combatant as the active actor.
            nextTurn: () => {
                const { initiative } = get();
                const { order, turnIndex } = initiative;
                if (order.length === 0) return;
                const isWrap = turnIndex + 1 >= order.length;
                if (isWrap) get().endRound();
                set(state => {
                    const nextIndex = isWrap ? 0 : turnIndex + 1;
                    const cur = state.initiative.order[nextIndex];
                    return {
                        initiative: { ...state.initiative, turnIndex: nextIndex },
                        target: { ...state.target, activeActor: cur ? { side: cur.side, id: cur.id, sourceID: cur.sourceID } : state.target.activeActor },
                    };
                });
            },

            //Settings

            updateSetting: (key, value) => set(state => {
                const settings = { ...state.settings, [key]: value };
                //Switching dice mode clears the log since results are mode-specific
                return { settings, ...(key === "diceMode" && { log: {} }) };
            }),

            //Target and action selection

            toggleTargetActiveActor: () => set(state => ({
                //MAP is NOT reset here, it persists across reselections of the same actor
                //within a round, only resetting when a DIFFERENT actor takes a turn or at endRound
                action: { selected: "", selectedType: "", targetType: "", choosing: false },
                target: {
                    mode: state.target.mode === "activeActor" ? null : "activeActor",
                    activeActor: null,
                    selectedTargetCharacters: [],
                },
            })),

            toggleTargetCharacters: () => set(state => ({
                target: {
                    ...state.target,
                    mode: state.target.mode === "targetCharacters" ? null : "targetCharacters",
                    //Intentionally do NOT clear selectedTargetCharacters, exiting select mode keeps your picks
                },
            })),

            //Handles clicks on character cards for both activeActor and target selection modes
            selectTarget: (side, id, sourceID) => set(state => {
                const { selectedTargetCharacters, mode } = state.target;
                if (!mode) return {};

                const charList = side === "hero" ? state.parties.heroes : state.parties.foes;
                const selectedChar = charList.find(c => c.id === id);

                if (mode === "activeActor") {
                    const prev = state.target.activeActor;
                    const isSameActor = prev && prev.id === id;
                    let updatedParties = state.parties;

                    if (!isSameActor) {
                        //Reset MAP on the previous actor when switching to a DIFFERENT actor
                        if (prev) {
                            const key = prev.side === "hero" ? "heroes" : "foes";
                            updatedParties = {
                                ...updatedParties,
                                [key]: updatedParties[key].map(c => c.id === prev.id ? { ...c, mapAttacks: 0 } : c),
                            };
                        }
                        //Clear "currentTurn" conditions from all characters, they belong to the previous actor's turn
                        const clearCurrent = char => ({
                            ...char,
                            effects: (char.effects || []).filter(e => e.duration?.type !== "currentTurn"),
                        });
                        updatedParties = {
                            heroes: updatedParties.heroes.map(clearCurrent),
                            foes: updatedParties.foes.map(clearCurrent),
                        };
                    }

                    //Check for endOfNextTurn conditions, only when auto condition tracking is on
                    //Only triggers on a subsequent round (appliedRound < currentRound)
                    const newActorId = selectedChar?.id || id;
                    const expiringConditions = [];
                    if (state.settings.autoDecrementConditions) {
                        ["heroes", "foes"].forEach(k => {
                            updatedParties[k].forEach(char => {
                                (char.effects || []).forEach(effect => {
                                    if (effect.duration?.type === "endOfNextTurn" &&
                                        effect.duration.actorId === newActorId &&
                                        effect.duration.appliedRound < state.round) {
                                        expiringConditions.push({ charId: char.id, charName: char.name, charSide: char.side, effectName: effect.slug, effectNumber: effect.value, actorName: effect.duration.actorName });
                                    }
                                    //startOfTargetTurn expires at the start of the AFFLICTED creature's turn
                                    if (effect.duration?.type === "startOfTargetTurn" &&
                                        char.id === newActorId &&
                                        (effect.duration.appliedRound ?? state.round) < state.round) {
                                        expiringConditions.push({ charId: char.id, charName: char.name, charSide: char.side, effectName: effect.slug, effectNumber: effect.value, actorName: char.name });
                                    }
                                });
                            });
                        });
                    }
                    return {
                        parties: updatedParties,
                        target: { ...state.target, activeActor: selectedChar || { side, id, sourceID }, mode: null },
                        expiringConditions,
                    };
                }

                if (mode === "targetCharacters") {
                    const alreadySelected = selectedTargetCharacters.find(c => c.side === side && c.id === id);
                    if (alreadySelected) {
                        return { target: { ...state.target, selectedTargetCharacters: selectedTargetCharacters.filter(c => !(c.side === side && c.id === id)) } };
                    }
                    //Single target: always replace rather than append so reentering mode cant stack targets
                    const base = state.action.targetType === "single" ? [] : selectedTargetCharacters;
                    const newTargets = [...base, selectedChar || { side, id, sourceID }];
                    const exitMode = state.action.targetType === "single";
                    return { target: { ...state.target, selectedTargetCharacters: newTargets, mode: exitMode ? null : state.target.mode } };
                }

                return {};
            }),

            //actionName: selected name; targetType: precomputed by caller; selectedType: "weapon"|"spell"|"global_action"
            setSelectedAction: (selected, targetType, selectedType = "") => set(state => {
                const prevTargetType = state.action.targetType;
                //Clear targets when: going to self (auto-targets actor), or downgrading aoe->single
                //(aoe may have multiple targets selected; single only allows one)
                //Upgrading single->aoe or keeping the same type preserves the existing selection.
                const clearTargets =
                    targetType === "self" ||
                    (prevTargetType === "aoe" && targetType === "single");
                return {
                    action: { ...state.action, selected, selectedType, targetType },
                    target: {
                        ...state.target,
                        mode: null,
                        selectedTargetCharacters: clearTargets ? [] : state.target.selectedTargetCharacters,
                    },
                };
            }),

            setChoosingAction: (choosing) => set(state => ({ action: { ...state.action, choosing } })),

            //Log & error

            setLog: (log) => set({ log }),
            setError: (error) => set({ error }),
            setPendingAction: (data) => set({ pendingAction: data }),
            clearPendingAction: () => set({ pendingAction: null }),
            addNichePrompt: (prompt) => set(state => ({ pendingNichePrompts: [...state.pendingNichePrompts, prompt] })),
            resolveNichePrompt: () => set(state => ({ pendingNichePrompts: state.pendingNichePrompts.slice(1) })),

            //Remove one entry from the expiring notification; if action is "remove" also strips the condition from the character
            dismissExpiringCondition: (charId, effectName, action) => set(state => {
                const remaining = state.expiringConditions.filter(e => !(e.charId === charId && e.effectName === effectName));
                if (action !== "remove") return { expiringConditions: remaining };
                const entry = state.expiringConditions.find(e => e.charId === charId && e.effectName === effectName);
                if (!entry) return { expiringConditions: remaining };
                const key = entry.charSide === "hero" ? "heroes" : "foes";
                if (!state.parties[key].some(c => c.id === charId)) return { expiringConditions: remaining };
                const updatedList = state.parties[key].map(c => {
                    if (c.id !== charId) return c;
                    //Drop the dismissed condition and remove it as an off-guard source
                    const newSources = (c.offGuardSources || []).filter(src => src !== effectName);
                    const existingOffGuard = (c.effects || []).find(e => e.slug === OFF_GUARD);
                    let newEffects = (c.effects || []).filter(e => e.slug !== effectName && e.slug !== OFF_GUARD);
                    //Off-guard persists as long as another condition still grants it (e.g. prone, grabbed);
                    //only strip it once no sources remain. This keeps the rule in the store, not the UI.
                    if (newSources.length > 0) {
                        newEffects = [...newEffects, existingOffGuard ?? { slug: OFF_GUARD, value: 1, duration: { type: "manual" } }];
                    }
                    return { ...c, effects: newEffects, offGuardSources: newSources };
                });
                const syncedTargets = state.target.selectedTargetCharacters.map(t =>
                    t.id === charId && t.side === entry.charSide ? (updatedList.find(c => c.id === charId) || t) : t
                );
                return {
                    parties: { ...state.parties, [key]: updatedList },
                    target: { ...state.target, selectedTargetCharacters: syncedTargets },
                    expiringConditions: remaining,
                };
            }),

            //Clears error and exits target mode, called just before resolving a turn
            resetTargetMode: () => set(state => ({ target: { ...state.target, mode: null }, error: "" })),

            //Action economy

            canSpendActions: (ref, cost) => {
                const char = get().getCharByRef(ref);
                if (!char) return false;
                return char.actionsRemaining.filter(Boolean).length >= cost;
            },

            spendActions: ({ side, id }, cost) => {
                get().updateCharacterInList(side, id, c => {
                    const next = [...c.actionsRemaining];
                    for (let i = 0; i < cost; i++) {
                        const idx = next.lastIndexOf(true);
                        if (idx !== -1) next[idx] = false;
                    }
                    return { ...c, actionsRemaining: next };
                });
                //Initiative auto-advance: when the combatant whose turn it is runs out of actions, move to
                //the next one. Deliberately does NOT wrap - ending the round (which ticks durations via
                //endRound) stays a manual "Next turn"/"End Round" press, so it never fires mid-resolution.
                const { initiative } = get();
                const cur = initiative.order[initiative.turnIndex];
                if (cur && cur.side === side && cur.id === id && initiative.turnIndex + 1 < initiative.order.length) {
                    const char = get().getCharByRef({ side, id });
                    if (char && char.actionsRemaining.filter(Boolean).length === 0) get().setCurrentTurn(initiative.turnIndex + 1);
                }
            },

            //Utilities

            getCharByRef: (ref) => {
                if (!ref) return null;
                const { parties } = get();
                const list = ref.side === "hero" ? parties.heroes : parties.foes;
                return list.find(c => c.id === ref.id) || null;
            },

            //Reads weapon/spell selections for the active actor from battleSession localStorage key
            getLocalActionNames: () => {
                const { target, parties } = get();
                const activeActor = target.activeActor
                    ? (target.activeActor.side === "hero" ? parties.heroes : parties.foes)
                        .find(c => c.id === target.activeActor.id)
                    : null;
                try {
                    const session = JSON.parse(localStorage.getItem("battleSession") || "{}");
                    const actorSession = session?.[activeActor?.sourceID];
                    return {
                        selectedWeapons: Array.isArray(actorSession?.selectedWeapons) ? actorSession.selectedWeapons : [],
                        selectedSpells:  Array.isArray(actorSession?.selectedSpells)  ? actorSession.selectedSpells  : [],
                    };
                } catch (err) {
                    console.warn("Failed to parse battleSession:", err);
                    return { selectedWeapons: [], selectedSpells: [] };
                }
            },

            //Updates base stats for all persisted party members from fresh DB data, preserving live battle state
            syncPartyStats: (freshChars) => set(state => {
                const bySourceID = Object.fromEntries(freshChars.map(c => [c._id, c]));
                const syncChar = (char) => {
                    const fresh = bySourceID[char.sourceID];
                    if (!fresh) return char;
                    return {
                        ...char,
                        stats: {
                            ...foldResilientSaves(fresh.stats),
                            maxHealth: fresh.stats.attributes?.hp ?? char.stats.maxHealth ?? 0,
                            currentHealth: char.stats.currentHealth,
                            tempHP: char.stats.tempHP ?? 0, //preserve live temp HP across a character edit
                        },
                        resistances: fresh.resistances ?? [],
                        weaknesses: fresh.weaknesses ?? [],
                        immunities: fresh.immunities ?? [],
                        classOption: fresh.classOption ?? char.classOption ?? null,
                    };
                };
                return {
                    parties: {
                        heroes: state.parties.heroes.map(syncChar),
                        foes:   state.parties.foes.map(syncChar),
                    },
                };
            }),

            //Records which saved-battle slot the live battle belongs to (set on Load and after a Save).
            //Pass null to detach (e.g. when the loaded slot is deleted) so the next Save starts fresh.
            setLoadedBattle: (loadedBattle) => set({ loadedBattle }),

            //Used by "New Encounter", clears recap is handled by recapStore
            resetRound: () => set({ round: 1 }),

            //Claims the persisted battle for a user on login. Only wipes it when a DIFFERENT user owned
            //it (prevents one account loading another's battle); the same user keeps their battle.
            //Returns true if the battle was reset, so the caller can also clear the recap.
            claimForUser: (userID) => {
                const prev = get().ownerUserID;
                const changed = !!prev && !!userID && prev !== userID;
                if (changed) get().resetBattle();
                set({ ownerUserID: userID });
                return changed;
            },

            //Resets all battle state except settings; recap clearing is handled by recapStore
            resetBattle: () => set({
                parties: { heroes: [], foes: [] },
                target: { mode: null, activeActor: null, selectedTargetCharacters: [] },
                action: { selected: "", selectedType: "", targetType: "", choosing: false },
                round: 1,
                log: {},
                error: "",
                pendingAction: null,
                pendingNichePrompts: [],
                expiringConditions: [],
                persistCheckResults: [],
                initiative: { order: [], turnIndex: 0 },
                loadedBattle: null,
            }),
        }),
        {
            //_v2: bumped when the stored shape changed (Foundry-aligned outcome keys, damage
            //category, slug/value conditions, namespaced stats) - discards incompatible old state
            name: 'battleData_v2',
            //version 1 migration: the Rotation Lab / Action Builder was removed - coerce its dice mode
            //back to "avg" and drop the stale actionBuilder plan data from any persisted battle.
            version: 1,
            migrate: (persisted) => {
                if (!persisted) return persisted;
                if (persisted.settings?.diceMode === "actionBuilder") {
                    persisted.settings = { ...persisted.settings, diceMode: "avg" };
                }
                delete persisted.actionBuilder;
                return persisted;
            },
            //Only persist the state shape, not the action functions
            partialize: (state) => ({
                ownerUserID: state.ownerUserID,
                parties: state.parties,
                target: {
                    activeActor: state.target.activeActor,
                    selectedTargetCharacters: state.target.selectedTargetCharacters,
                    //mode excluded: UI selection mode that must reset on reload
                },
                action: {
                    selected: state.action.selected,
                    selectedType: state.action.selectedType,
                    targetType: state.action.targetType,
                    //choosing excluded: transient search-picker visibility flag
                },
                settings: state.settings,
                round: state.round,
                //Initiative order is battle data - persist it with the battle
                initiative: state.initiative,
                //Which saved slot this battle came from, so Save still defaults correctly after a reload
                loadedBattle: state.loadedBattle,
                //log, error, pendingAction, expiringConditions, persistCheckResults excluded: transient UI state
            }),
        }
    )
);
