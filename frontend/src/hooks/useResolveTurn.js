import { useBattleStore } from '../store/battleStore';
import { useGameDataStore } from '../store/gameDataStore';
import { apiFetch } from '../auth';
import { BACKEND_BASE_URL } from '../config';
import { applyPendingAction } from '../utils/applyPendingAction';
import { queueCritSpecPrompts } from '../utils/critSpecPrompts';

//Encapsulates the full async turn-resolution pipeline.
//Uses getState() so it always reads the latest values, not stale closure values.
//Plain function (not a hook): no React hooks used internally.
//Confirm-time attack choices from the Attack Options modal:
//  strikeRider: optional { optionId } for a class strike rider (e.g. Swashbuckler Precise Strike)
//  versatileDamageType: optional damage type chosen for a versatile weapon
//  consume: optional { slug } resource the chosen option spends (e.g. panache via a Finisher); spent
//           on commit (not now) so cancelling a choose-mode outcome pick never wastes it.
//Both are validated server-side against the actor's class option / weapon.
export async function resolveTurn({ strikeRider = null, versatileDamageType = null, consume = null } = {}) {
    const {
        target, action, settings, round, parties,
        updateCharacterInList, setLog, setError,
        canSpendActions, spendActions, getCharByRef, setPendingAction,
    } = useBattleStore.getState();
    const { allItems, spellData, featureActions } = useGameDataStore.getState();

    setError("");

    //Validation
    const activeActor = getCharByRef(target.activeActor);
    //Always read fresh character data from parties, selectedTargetCharacters are
    //selection-state snapshots and go stale after endRound or other store updates
    const targetCharacters = (target.selectedTargetCharacters || []).map(t => {
        const list = t.side === "hero" ? parties.heroes : parties.foes;
        return list.find(c => c.id === t.id) || t;
    });

    if (!activeActor)                                              { setError("Please select an active actor");   return; }
    if (!targetCharacters.length && action.targetType !== "self") { setError("Please select target characters"); return; }
    if (!action.selected)                                         { setError("No action selected");              return; }

    //Action economy: compute cost here for the gate check; actual spend happens after API confirms.
    //Feature actions can declare actionCost "reaction" (grant-as-action hook) - a reaction doesn't
    //consume one of the 3 actions, so it costs 0 here (a dedicated reaction tracker is future work).
    const featureCost = featureActions?.[action.selected]?.actionCost;
    const actionCost = !settings.autoActions
        ? (featureCost === "reaction" ? 0
           : (allItems.weapons?.find(w => w.name === action.selected)?.actionCost ??
              spellData.find(s => s.name === action.selected)?.actionCost ??
              (typeof featureCost === "number" ? featureCost
               : (action.selectedType === "global_action" || !action.selectedType ? 1 : 0))))
        : 0;

    if (!settings.autoActions && !canSpendActions(target.activeActor, actionCost)) {
        setError("No actions left to spend");
        return;
    }

    //Build action payload
    let actionData = null;
    let actionType = action.selectedType || null;
    if (actionType === "weapon") {
        actionData = allItems.weapons?.find(w => w.name === action.selected) ?? null;
    } else if (actionType === "spell") {
        actionData = allItems.spells?.find(s => s.name === action.selected) ?? null;
    }
    //Weapon/spell must resolve to an object; if not found, refresh allItems once before giving up
    if ((actionType === "weapon" || actionType === "spell") && !actionData) {
        await useGameDataStore.getState().refreshItems();
        const { allItems: fresh } = useGameDataStore.getState();
        actionData = actionType === "weapon"
            ? (fresh.weapons?.find(w => w.name === action.selected) ?? null)
            : (fresh.spells?.find(s => s.name === action.selected) ?? null);
    }
    if ((actionType === "weapon" || actionType === "spell") && !actionData) {
        setError(`Could not find action data for "${action.selected}". Try reselecting the action.`);
        return;
    }
    if (!actionData) { actionData = action.selected; }
    if (!actionType) { actionType = "global_action"; }

    //Crit spec is a per-character toggle now (activeActor.critSpec), remembered across actions/turns.
    const critSpecGroup = activeActor?.critSpec && actionType === "weapon"
        ? (allItems.weapons?.find(w => w.name === action.selected)?.group ?? null)
        : null;
    //Weapon damage dice drive the axe crit spec (it deals the rolled weapon dice to an adjacent creature).
    //The striking rune's extra dice are stored separately on the weapon, so fold them in here too.
    const critSpecWeaponDice = (() => {
        if (!critSpecGroup) return null;
        const base = actionData?.outcomes?.success?.effects?.find(e => e.type === "damage")?.number ?? null;
        if (!base) return null;
        const striking = actionData?.striking ?? 0;
        return striking ? { ...base, numRolled: (base.numRolled ?? 0) + striking } : base;
    })();

    const battleSession = (() => {
        try { return JSON.parse(localStorage.getItem("battleSession") || "{}"); }
        catch (err) { console.warn("Failed to parse battleSession:", err); return {}; }
    })();
    const offensiveBonuses = battleSession?.[activeActor.sourceID]?.offensiveBonuses ?? {};
    const characterDefensiveBonuses = targetCharacters.reduce((acc, t) => {
        acc[t.sourceID] = battleSession?.[t.sourceID]?.defensiveBonuses ?? {};
        return acc;
    }, {});

    //Capture pre-action snapshot for recap
    const targetsBefore = targetCharacters.map(t => ({
        id: t.id,
        name: t.name,
        side: t.side,
        stats: { currentHealth: t.stats?.currentHealth ?? 0 },
        effects: (t.effects ?? []).map(e => ({ slug: e.slug, value: e.value })),
    }));
    const actorEffectsBefore = (activeActor.effects ?? []).map(e => ({ slug: e.slug, value: e.value }));
    const currentRound = round ?? 1;

    //Resolve with backend
    try {
        const res = await apiFetch(`${BACKEND_BASE_URL}/battles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                activeActor,
                targetCharacters,
                action: { actionData, actionType },
                diceMode: settings.diceMode,
                offensiveBonuses,
                characterDefensiveBonuses,
                critSpecGroup,
                strikeRider,
                versatileDamageType,
            }),
        });

        //apiFetch returns undefined when the session expires and redirects to login
        if (!res) { setError("Session expired. Please refresh the page."); return; }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            setError(err.error || "Failed to resolve action");
            return;
        }

        const data = await res.json();

        if (!data?.updatedActiveActor || !Array.isArray(data?.updatedTargetCharacters)) {
            setError("Invalid response from server");
            return;
        }

        //Restore base stats but keep the updated currentHealth
        const preserveHP = (updated, c) => settings.ignoreHP
            ? { ...updated.stats, currentHealth: c.stats.currentHealth }
            : updated.stats;

        //Spend actions only after the API confirms the turn resolved successfully.
        //Re-read activeActor ref from store: the user could have changed it during the await.
        const freshActorRef = useBattleStore.getState().target.activeActor;
        if (!settings.autoActions) spendActions(freshActorRef ?? target.activeActor, actionCost);

        //Active actor always updates, MAP may have changed even in choose mode
        updateCharacterInList(data.updatedActiveActor.side, data.updatedActiveActor.id, c => ({
            ...c,
            ...data.updatedActiveActor,
            stats: preserveHP(data.updatedActiveActor, c),
            actionsRemaining: c.actionsRemaining,
            mapAttacks: settings.autoMAP ? data.updatedActiveActor.mapAttacks : c.mapAttacks,
        }));

        const recapContext = {
            actorName: activeActor.name,
            actorId: activeActor.id,
            actionName: action.selected,
            actorEffects: actorEffectsBefore,
            targetsBefore,
            round: currentRound,
            actionStats: data.actionStats ?? {},
        };

        //Resource the chosen option spends, applied on commit (see applyPendingAction)
        const consumeOnCommit = consume?.slug ? { side: activeActor.side, id: activeActor.id, slug: consume.slug } : null;

        //All modes route through pendingAction: auto modes apply immediately, choose waits for user
        if (data.pendingOutcomes) {
            //Carry crit spec context so applyPendingAction can queue prompts once outcomes are chosen
            setPendingAction({ mode: "choose", perTarget: data.pendingOutcomes, recapContext, chosenOutcomes: {}, ignoreHP: settings.ignoreHP, critSpecGroup, critSpecWeaponDice, consume: consumeOnCommit });
        } else {
            setPendingAction({ mode: "auto", updatedTargets: data.updatedTargetCharacters, ignoreHP: settings.ignoreHP, recapContext, consume: consumeOnCommit });
            applyPendingAction();

            //Queue any crit spec prompts (saves, axe adjacent damage) for critically-hit targets.
            //Choose mode is handled in applyPendingAction after the user picks outcomes.
            if (critSpecGroup) {
                const crittedIds = targetCharacters
                    .filter(t => {
                        const ro = data.actionStats?.[t.id]?.rollOutcome;
                        //luck: real dice roll; avg: most likely outcome
                        return ro?.outcomeKey === "criticalSuccess" || ro?.avgOutcomeKey === "criticalSuccess";
                    })
                    .map(t => t.id);
                queueCritSpecPrompts({ group: critSpecGroup, crittedIds, diceMode: settings.diceMode, actor: activeActor, weaponDice: critSpecWeaponDice, recapContext });
            }
        }

        setLog(data.log || {});

    } catch (err) {
        console.error("Turn resolution failed:", err);
        setError("An unexpected error occurred while resolving the action");
    }
}
