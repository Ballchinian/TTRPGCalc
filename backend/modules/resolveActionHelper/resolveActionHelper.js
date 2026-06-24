import applyStatChanges from "./statResolution.js";
import { logFormatter } from "./logFormatter.js";
import { collectStats } from "./statsCollector.js";
import { damageResolution, healingResolution, conditionResolution, applyDamageModifiers, getDamageModInfo } from "./actionResolution.js";
import { formatAction } from "./formatAction.js";
import { sumOfDiceDetailed, avgOfDice, sumOfDice } from "../../utility/diceUtils.js";
import { applyDamageToPools, grantTempHP } from "../../utility/hpPools.js";
import { MULTIPLIER_TABLE, BASIC_SAVE_MULTIPLIER_TABLE } from "../../data/outcomeDefs.js";

/*
    options.lite (used by the Rotation Lab's Monte-Carlo loop) skips the per-call log + stats
    collection, which the simulator doesn't need - it reads damage from the returned HP deltas.
    Keeps the HP/condition mutations intact so a scripted sequence still resolves correctly.
*/
export const resolveActionHelper = (tempActiveActor, tempTargetCharacters, action, diceMode, offensiveBonuses, characterDefensiveBonuses, options = {}) => {

    //Step 1: Apply bonuses and effects to the characters
    const adjustedTargetCharacters = tempTargetCharacters.map(tempTargetCharacter => {
        const defensiveBonuses = characterDefensiveBonuses[tempTargetCharacter.sourceID] || {};
        return applyStatChanges(defensiveBonuses, tempTargetCharacter);
    });
    const adjustedActiveActor = applyStatChanges(offensiveBonuses, tempActiveActor);

    //Step 2: Get the action into a format to resolve
    const { entries: actionInfo, newMapAttacks } = formatAction(diceMode, adjustedActiveActor, adjustedTargetCharacters, action);

    //Step 3: Resolve the action itself (damage, healing, conditions)
    let mutableActiveActor = newMapAttacks !== null
        ? { ...adjustedActiveActor, mapAttacks: newMapAttacks }
        : adjustedActiveActor;
    const updatedChars = Object.fromEntries(adjustedTargetCharacters.map(c => [c.id, c]));

    actionInfo.forEach(target => {
        let affectedChar = updatedChars[target.id];
        //Don't early-return: activeActor-targeted effects (e.g. Stand) still need to run even when affectedChar is absent
        const prevHealth = affectedChar?.stats.currentHealth ?? 0;

        target.effects.forEach(effect => {
            switch (effect.type) {
                case "damage": {
                    if (!affectedChar) break;
                    //Persistent damage creates a condition handled below; no immediate HP loss on application (PF2e rule)
                    if (effect.category === "persistent") break;
                    if (diceMode === "luck") {
                        //Roll dice and capture individual results for the hover tooltip.
                        //effect.multiplier may be undefined for automatic actions; default to 1x.
                        const detailed = sumOfDiceDetailed(effect.number, effect.multiplier ?? 1);
                        effect._diceRolls = detailed.rolls;
                        effect._bonusRolls = detailed.bonusRolls;
                        effect._diceModifier = effect.number.modifier;
                        effect._diceMultiplier = detailed.multiplier;
                        const modified = applyDamageModifiers(detailed.total, effect.damageType, affectedChar);
                        effect._rawDamage = modified;
                        effect._damageModifiers = getDamageModInfo(detailed.total, effect.damageType, affectedChar);
                        //Temp HP (e.g. from Rage) absorbs damage before real HP
                        affectedChar = { ...affectedChar, stats: { ...affectedChar.stats, ...applyDamageToPools(affectedChar.stats, modified) } };
                    } else {
                        //Avg/choose: always deterministic.
                        //avgMultiplier is set by formatAction for roll-based actions; fall back to effect.multiplier ?? 1 for automatic.
                        const avgMult = effect.avgMultiplier !== undefined ? effect.avgMultiplier : (effect.multiplier ?? 1);
                        const rawAvg = avgOfDice(effect.number, avgMult);
                        effect._rawDamage = applyDamageModifiers(rawAvg, effect.damageType, affectedChar);
                        effect._damageModifiers = getDamageModInfo(rawAvg, effect.damageType, affectedChar);
                        //Temp HP (e.g. from Rage) absorbs damage before real HP
                        affectedChar = { ...affectedChar, stats: { ...affectedChar.stats, ...applyDamageToPools(affectedChar.stats, effect._rawDamage) } };
                    }
                    updatedChars[target.id] = affectedChar;
                    break;
                }
                case "healing": {
                    if (!affectedChar) break;
                    const maxHealth = affectedChar.stats.maxHealth ?? affectedChar.stats.attributes?.hp ?? 0;
                    if (diceMode === "luck") {
                        //Roll dice and capture individual results for the hover tooltip.
                        //effect.multiplier may be undefined for automatic actions; default to 1x.
                        const detailed = sumOfDiceDetailed(effect.number, effect.multiplier ?? 1);
                        effect._diceRolls = detailed.rolls;
                        effect._bonusRolls = detailed.bonusRolls;
                        effect._diceModifier = effect.number.modifier;
                        effect._diceMultiplier = detailed.multiplier;
                        effect._rawHealing = Math.max(0, detailed.total);
                        affectedChar = { ...affectedChar, stats: { ...affectedChar.stats, currentHealth: Math.min(maxHealth, Math.max(0, affectedChar.stats.currentHealth + detailed.total)) } };
                    } else {
                        //Avg/choose: always deterministic.
                        const avgMult = effect.avgMultiplier !== undefined ? effect.avgMultiplier : (effect.multiplier ?? 1);
                        effect._rawHealing = avgOfDice(effect.number, avgMult);
                        affectedChar = { ...affectedChar, stats: { ...affectedChar.stats, currentHealth: Math.min(maxHealth, Math.max(0, affectedChar.stats.currentHealth + effect._rawHealing)) } };
                    }
                    updatedChars[target.id] = affectedChar;
                    break;
                }
                case "addCondition":
                case "removeCondition":
                    if (effect.target === "activeActor") {
                        [mutableActiveActor] = conditionResolution([mutableActiveActor], effect);
                    } else {
                        if (!affectedChar) break;
                        [affectedChar] = conditionResolution([affectedChar], effect);
                        updatedChars[target.id] = affectedChar;
                    }
                    break;
                case "tempHP":
                    //Grant temporary HP (e.g. Barbarian Rage). Doesn't stack - keeps the higher pool.
                    if (effect.target === "activeActor") {
                        mutableActiveActor = { ...mutableActiveActor, stats: grantTempHP(mutableActiveActor.stats, effect.value) };
                    } else if (affectedChar) {
                        affectedChar = { ...affectedChar, stats: grantTempHP(affectedChar.stats, effect.value) };
                        updatedChars[target.id] = affectedChar;
                    }
                    break;
            }
        });

        if (affectedChar) {
            target.resolvedDamage = Math.max(0, prevHealth - affectedChar.stats.currentHealth);
            //Sum uncapped damage/healing per target so frontend can compute theoretical HP for ignoreHP recap
            target.rawDamage = target.effects.filter(e => e.type === "damage").reduce((s, e) => s + (e._rawDamage ?? 0), 0);
            target.rawHealing = target.effects.filter(e => e.type === "healing").reduce((s, e) => s + (e._rawHealing ?? 0), 0);

            //Patch luck-mode avgDamage with resistance-adjusted expected value so luckDelta is not
            //skewed by the modifier amount on every roll (raw avgDamage is computed in formatAction
            //before the target's resistances/weaknesses/immunities are known)
            if (target.totalAvgMultiplier !== undefined && target.avgDamage !== undefined && target.outcomeEffects) {
                const baseKey = target.reverseOutcome ? "failure" : "success";
                const baseEffects = (target.outcomeEffects[baseKey]?.effects ?? []).filter(e => e.type === "damage");
                target.avgDamage = Math.round(
                    baseEffects.reduce((sum, e) => sum + applyDamageModifiers(avgOfDice(e.number, target.totalAvgMultiplier), e.damageType, affectedChar), 0)
                );
            }

            //Annotate outcomeEffects with resistance-adjusted _rawDamage so the log outcomes popup
            //shows correct values (including elemental null-multiplier effects and resistances)
            if (target.outcomeEffects) {
                const multTable = target.reverseOutcome ? BASIC_SAVE_MULTIPLIER_TABLE : MULTIPLIER_TABLE;
                target.outcomeEffects = Object.fromEntries(
                    Object.entries(target.outcomeEffects).map(([key, outcomeData]) => [
                        key,
                        {
                            ...outcomeData,
                            effects: (outcomeData?.effects ?? []).map(eff => {
                                if (eff.type !== "damage") return eff;
                                const mult = eff.multiplier != null ? eff.multiplier : (multTable[key] ?? 1);
                                const raw = avgOfDice(eff.number, mult);
                                return { ...eff, _rawDamage: applyDamageModifiers(raw, eff.damageType, affectedChar), _damageModifiers: getDamageModInfo(raw, eff.damageType, affectedChar) };
                            })
                        }
                    ])
                );
            }

            //Auto-apply persistent damage conditions from effects with category "persistent"
            //Immune targets skip entirely; resistance/weakness handled each round by endRound
            for (const e of target.effects.filter(ef => ef.type === "damage" && ef.category === "persistent" && ef.damageType)) {
                const type = e.damageType.toLowerCase().trim();
                if ((affectedChar.immunities ?? []).some(i => i.toLowerCase() === type)) continue;
                const mult = diceMode === "luck" ? (e.multiplier ?? 1) : 1;
                //Luck mode: roll actual dice; avg/choose: use average
                const amount = diceMode === "luck"
                    ? Math.max(1, sumOfDice(e.number, mult))
                    : Math.max(1, Math.round(avgOfDice(e.number, mult)));
                const fullName = `persistent ${type}`;
                const existing = (affectedChar.effects || []).find(ef => ef.slug === fullName);
                if (existing) {
                    //PF2e: same damage type doesn't stack - keep the higher amount
                    if (amount > existing.value) {
                        affectedChar = { ...affectedChar, effects: (affectedChar.effects || []).map(ef =>
                            ef.slug === fullName ? { ...ef, value: amount } : ef
                        )};
                        updatedChars[target.id] = affectedChar;
                    }
                } else {
                    affectedChar = { ...affectedChar, effects: [...(affectedChar.effects || []),
                        { slug: fullName, value: amount, damageType: type, duration: { type: "flatCheck", ...(e.recoveryDC ? { dc: e.recoveryDC } : {}) } }
                    ]};
                    updatedChars[target.id] = affectedChar;
                }
            }
        }
    });

    const resolvedTargetCharacters = adjustedTargetCharacters.map(c => updatedChars[c.id]);

    //For choose mode, collect pre-resolved outcomes per target so frontend can apply the chosen one
    let pendingOutcomes = null;
    if (diceMode === "choose") {
        const chooseEntries = actionInfo.filter(e => e.isChooseMode);
        if (chooseEntries.length > 0) {
            pendingOutcomes = chooseEntries.map(e => {
                const charRef = adjustedTargetCharacters.find(c => c.id === e.id);
                //Apply resistance/weakness/immunity to precomputed resolvedValues per outcome
                const resolvedOutcomes = {};
                const multTable = e.reverseOutcome ? BASIC_SAVE_MULTIPLIER_TABLE : MULTIPLIER_TABLE;
                Object.entries(e.resolvedOutcomes ?? {}).forEach(([key, effects]) => {
                    //Apply resistance/weakness/immunity to precomputed resolvedValues
                    const adjusted = effects.map(eff => {
                        if (eff.type !== "damage" || eff.resolvedValue == null) return eff;
                        return { ...eff, resolvedValue: applyDamageModifiers(eff.resolvedValue, eff.damageType, charRef ?? {}) };
                    });
                    //Add persistent condition effects for outcomes that deal damage
                    const tableMult = multTable[key] ?? 0;
                    const persistAdd = tableMult > 0
                        ? effects
                            .filter(eff => eff.type === "damage" && eff.category === "persistent" && eff.damageType)
                            .flatMap(eff => {
                                const type = eff.damageType.toLowerCase().trim();
                                if ((charRef?.immunities ?? []).some(i => i.toLowerCase() === type)) return [];
                                //Respect explicit multiplier:1 on crit-spec effects so they don't get 2* for criticalSuccess
                                const mult = eff.multiplier != null ? eff.multiplier : tableMult;
                                if (mult <= 0) return [];
                                const amount = Math.max(1, Math.round(avgOfDice(eff.number, mult)));
                                return [{ type: "addCondition", condition: `persistent ${type}`, adjustBy: amount, damageType: type, duration: { type: "flatCheck", ...(eff.recoveryDC ? { dc: eff.recoveryDC } : {}) } }];
                            })
                        : [];
                    resolvedOutcomes[key] = persistAdd.length > 0 ? [...adjusted, ...persistAdd] : adjusted;
                });
                return { id: e.id, side: charRef?.side, name: e.name, resolvedOutcomes };
            });
        }
    }

    //Uncapped damage/healing dealt per target (sum of resistance-adjusted _rawDamage / _rawHealing,
    //ignoring remaining HP) - lets the Rotation Lab report true output and net-of-healing totals.
    const rawDamageByTarget = {};
    const rawHealingByTarget = {};
    actionInfo.forEach(t => {
        if (t.id == null) return;
        if (t.rawDamage) rawDamageByTarget[t.id] = (rawDamageByTarget[t.id] ?? 0) + t.rawDamage;
        if (t.rawHealing) rawHealingByTarget[t.id] = (rawHealingByTarget[t.id] ?? 0) + t.rawHealing;
    });

    //Step 4: Format logs and collect stats for the frontend (skipped in lite mode for the sim's hot loop)
    const log = options.lite ? null : logFormatter(actionInfo, diceMode);
    const actionStats = options.lite ? null : collectStats(actionInfo, diceMode, adjustedTargetCharacters, adjustedActiveActor);
    return { updatedActiveActor: mutableActiveActor, updatedTargetCharacters: resolvedTargetCharacters, log, pendingOutcomes, actionStats, rawDamageByTarget, rawHealingByTarget };
};
