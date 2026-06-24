import { useState, useMemo, useCallback } from "react";
import { Card, Button, Dropdown, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useBattleStore } from "../../../store/battleStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { resolveTurn } from "../../../hooks/useResolveTurn";
import SearchbarToggle from "../../utility/searchbarToggle";
import { CRIT_SPEC_DEFS } from "../../../data/critSpecDefs";
import { getEligibleStrikeRider, getFeatureActions } from "../../../data/classFeatures";
import { getGatingFlatChecks } from "../../../utils/traitFlatChecks";
import AttackOptionsModal from "./AttackOptionsModal";
import ManipulateCheckModal from "./ManipulateCheckModal";

const cardStyle = { width: "100%", padding: "10px", marginBottom: "20px", height: "auto" };
const disabledMapStyle = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "100%", padding: "6px 12px", borderRadius: "999px",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
    color: "#888", fontSize: "13px", userSelect: "none", cursor: "default",
};
const getActionLabel = (item) => item;

//Fully self-contained: reads from stores and resolves turns without any props.
function ActionPanel() {
    const [resolving, setResolving] = useState(false);
    //When confirm-time attack choices apply (versatile damage type and/or a class strike rider like
    //Precise Strike), hold them here to show the unified Attack Options modal
    const [pendingOptions, setPendingOptions] = useState(null);
    //Pre-action flat checks a condition forces on this action (e.g. grabbed -> manipulate DC 5)
    const [pendingManipulate, setPendingManipulate] = useState(null);

    const action = useBattleStore(state => state.action);
    const target = useBattleStore(state => state.target);
    const parties = useBattleStore(state => state.parties);
    const autoMAP = useBattleStore(state => state.settings.autoMAP);
    const error = useBattleStore(state => state.error);
    const setSelectedAction = useBattleStore(state => state.setSelectedAction);
    const setChoosingAction = useBattleStore(state => state.setChoosingAction);
    const updateCharacterInList = useBattleStore(state => state.updateCharacterInList);
    const setError = useBattleStore(state => state.setError);
    const setLog = useBattleStore(state => state.setLog);
    const resetTargetMode = useBattleStore(state => state.resetTargetMode);
    const pendingNichePrompts = useBattleStore(state => state.pendingNichePrompts);
    const getLocalActionNames = useBattleStore(state => state.getLocalActionNames);

    const globalActionNames = useGameDataStore(state => state.globalActionNames);
    const globalEffects = useGameDataStore(state => state.globalEffects);
    const getActionTraits = useGameDataStore(state => state.getActionTraits);
    const spellData = useGameDataStore(state => state.spellData);
    const globalActions = useGameDataStore(state => state.globalActions);
    const featureActions = useGameDataStore(state => state.featureActions);
    const allItems = useGameDataStore(state => state.allItems);

    const { selected: selectedAction, targetType, choosing: choosingAction } = action;
    //allItems in deps: getActionTraits reads allItems internally; if it refreshes (e.g. after a rename) the result must update
    const traitProfile = useMemo(() => getActionTraits(selectedAction), [selectedAction, getActionTraits, allItems]);
    const { mapPenalty } = traitProfile;
    //Weapons always count as attacks (attack trait is required/unremovable): use selectedType as a direct fallback
    //instead of relying on allItems being fresh enough to resolve the weapon by name
    const countsAsAttack = action.selectedType === "weapon" || traitProfile.countsAsAttack;

    //Reaction grant-as-action hook: feature actions with actionCost "reaction" show a tag and don't
    //consume one of the 3 actions (handled in useResolveTurn). Triggered manually - no auto-detection.
    const isReactionAction = featureActions[selectedAction]?.actionCost === "reaction";

    const selectedWeaponObj = action.selectedType === "weapon"
        ? (allItems.weapons?.find(w => w.name === action.selected) ?? null)
        : null;
    const selectedWeaponGroup = selectedWeaponObj?.group ?? null;
    const critSpecDef = selectedWeaponGroup ? (CRIT_SPEC_DEFS[selectedWeaponGroup] ?? null) : null;
    const showCritSpec = action.selectedType === "weapon";

    //Memoize localStorage read: getLocalActionNames reparses JSON on every call
    //Use actor id as dep, not the object reference (new object every render)
    //Deletion cleanup is handled by cleanupBattleSession in useActionBuilder, no need to filter here
    const { selectedWeapons, selectedSpells } = useMemo(() => {
        return getLocalActionNames();
    }, [getLocalActionNames, target.activeActor?.id]);
    //Derive the live active actor (used for MAP and class-feature actions)
    const activeActorLive = target.activeActor
        ? (target.activeActor.side === "hero" ? parties.heroes : parties.foes).find(c => c.id === target.activeActor.id)
        : null;

    //Feature/style actions the active actor's class grants (Rage, Dirty Trick, ...); keep only those with
    //a real feature-action module - global bravado actions (Grapple/Trip) are already in globalActionNames
    const featureActionNames = useMemo(
        () => getFeatureActions(activeActorLive?.classOption).filter(n => featureActions[n]),
        [activeActorLive?.classOption, featureActions]
    );
    //Memoize merged list: avoids a new array reference on every render
    const allActionNames = useMemo(
        () => [...new Set([...selectedWeapons, ...selectedSpells, ...globalActionNames, ...featureActionNames])],
        [selectedWeapons, selectedSpells, globalActionNames, featureActionNames]
    );
    const activeActorMap = activeActorLive?.mapAttacks ?? 0;
    const setActiveActorMap = useCallback((value) => {
        if (!target.activeActor) return;
        updateCharacterInList(target.activeActor.side, target.activeActor.id, c => ({ ...c, mapAttacks: value }));
    }, [target.activeActor, updateCharacterInList]);

    //Crit spec is remembered on the actor, not the (per-select) action - so it survives action changes/turns
    const critSpecEnabled = activeActorLive?.critSpec ?? false;
    const setCritSpecForActor = useCallback((value) => {
        if (!target.activeActor) return;
        updateCharacterInList(target.activeActor.side, target.activeActor.id, c => ({ ...c, critSpec: value }));
    }, [target.activeActor, updateCharacterInList]);

    //Compute targetType and selectedType from game data and call the store setter
    const handleSelectAction = useCallback((actionName) => {
        const selectedType = selectedWeapons.includes(actionName) ? "weapon"
            : selectedSpells.includes(actionName) ? "spell"
            : "global_action";
        const resolvedTargetType =
            globalActions[actionName]?.targetType ||
            featureActions[actionName]?.targetType ||
            spellData.find(s => s.name === actionName)?.targetType ||
            "single";
        setSelectedAction(actionName, resolvedTargetType, selectedType);
        setChoosingAction(false);
    }, [selectedWeapons, selectedSpells, globalActions, featureActions, spellData, setSelectedAction, setChoosingAction]);

    //Confirm-time attack choices, all derived from the selected weapon + actor:
    //  - versatile: pick between the weapon's damage type and its versatile alternate
    //  - rider: a class strike rider (e.g. Swashbuckler Precise Strike) when the actor + weapon qualify
    const eligibleRider = useMemo(
        () => (selectedWeaponObj ? getEligibleStrikeRider(activeActorLive, selectedWeaponObj) : null),
        [activeActorLive, selectedWeaponObj]
    );
    const versatile = useMemo(() => {
        const alt = selectedWeaponObj?.traits?.find(t => t.name === "versatile")?.data?.damageType;
        const primary = selectedWeaponObj?.outcomes?.success?.effects?.find(e => e.type === "damage")?.damageType;
        if (!alt || !primary || alt === primary) return null;
        return { damageTypes: [primary, alt], default: primary };
    }, [selectedWeaponObj]);

    const doResolve = useCallback(async ({ damageType = null, riderOption = null } = {}) => {
        resetTargetMode();
        setResolving(true);
        try {
            await resolveTurn({
                versatileDamageType: damageType,
                strikeRider: riderOption ? { optionId: riderOption.id } : null,
                //Options like the Finisher spend a resource (e.g. panache). Spending is deferred to commit
                //(handled in applyPendingAction) so it's never wasted if a choose-mode outcome pick is cancelled.
                consume: riderOption?.consumesCondition ? { slug: riderOption.consumesCondition } : null,
            });
        } finally { setResolving(false); }
    }, [resetTargetMode]);

    //Raw trait names on the selected action (used for condition interactions like grabbed -> manipulate)
    const selectedActionTraits = useMemo(() => {
        const src = action.selectedType === "weapon" ? selectedWeaponObj
            : action.selectedType === "spell" ? allItems.spells?.find(s => s.name === action.selected)
            : (globalActions[action.selected] ?? featureActions[action.selected]);
        return (src?.traits ?? []).map(t => t.name ?? t);
    }, [action.selectedType, action.selected, selectedWeaponObj, allItems.spells, globalActions, featureActions]);

    //Flat checks a condition forces on this action (e.g. grabbed -> DC 5 on manipulate actions/spells)
    const gatingChecks = useMemo(
        () => getGatingFlatChecks(activeActorLive, action.selectedType, selectedActionTraits, globalEffects),
        [activeActorLive, action.selectedType, selectedActionTraits, globalEffects]
    );

    //After any pre-action flat check passes, fall through to the attack-options choices or resolve
    const proceedToResolve = useCallback(() => {
        if (versatile || eligibleRider) { setPendingOptions({ versatile, rider: eligibleRider }); return; }
        doResolve();
    }, [versatile, eligibleRider, doResolve]);

    const handleTurnCommence = useCallback(() => {
        const requiresTargets = targetType === "single" || targetType === "aoe";
        if (requiresTargets && target.selectedTargetCharacters.length === 0) {
            setError("Please select targets for this action.");
            return;
        }
        //A condition may force a flat check that can lose the action before anything else happens
        if (gatingChecks.length > 0) { setPendingManipulate(gatingChecks); return; }
        proceedToResolve();
    }, [targetType, target.selectedTargetCharacters, setError, gatingChecks, proceedToResolve]);

    const mapPenalties = [0, mapPenalty, mapPenalty * 2];
    const fmtPenalty = (p) => p === 0 ? "+0" : `-${p}`;
    const handleDropdownSelect = useCallback((val) => setActiveActorMap(Number(val)), [setActiveActorMap]);

    return (
        <Card style={cardStyle}>
            <Card.Body className="text-center">
                <h4>Actions</h4>

                {selectedAction && (
                    <p style={{ fontSize: "22px", color: "white" }}>
                        {selectedAction}
                        {isReactionAction && (
                            <span style={{ fontSize: "13px", marginLeft: "8px", color: "#9ad", verticalAlign: "middle" }}
                                title="Reaction - doesn't cost an action; trigger it manually when its trigger occurs">
                                ⟳ reaction
                            </span>
                        )}
                    </p>
                )}

                {!choosingAction ? (
                    <Button variant="outline-info" className="w-100 mb-3" onClick={() => setChoosingAction(true)}>
                        Select Action
                    </Button>
                ) : (
                    <SearchbarToggle
                        placeholder="Search actions..."
                        list={allActionNames}
                        getLabel={getActionLabel}
                        onSelect={handleSelectAction}
                        onBlur={() => setChoosingAction(false)}
                    />
                )}

                <div className="d-flex align-items-center gap-2 mb-3">
                    {!countsAsAttack ? (
                        <OverlayTrigger overlay={<Tooltip>MAP doesn't apply to this action</Tooltip>}>
                            <span style={disabledMapStyle}>
                                MAP: {fmtPenalty(mapPenalties[activeActorMap])}
                            </span>
                        </OverlayTrigger>
                    ) : autoMAP ? (
                        /* Auto-MAP owns the value (it steps up each attack), so show it read-only to avoid the dropdown silently disagreeing */
                        <OverlayTrigger overlay={<Tooltip>Auto-MAP is on - the penalty steps up automatically each attack. Turn it off in Settings to set MAP manually.</Tooltip>}>
                            <span style={disabledMapStyle}>
                                MAP: {fmtPenalty(mapPenalties[activeActorMap])} (auto)
                            </span>
                        </OverlayTrigger>
                    ) : (
                        <Dropdown className="flex-grow-1" onSelect={handleDropdownSelect}>
                            <Dropdown.Toggle variant="outline-warning" className="w-100" bsPrefix="btn">
                                MAP: {fmtPenalty(mapPenalties[activeActorMap])}
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                                {mapPenalties.map((penalty, idx) => (
                                    <Dropdown.Item key={idx} eventKey={String(idx)}>{fmtPenalty(penalty)}</Dropdown.Item>
                                ))}
                            </Dropdown.Menu>
                        </Dropdown>
                    )}
                </div>

                {showCritSpec && (
                    <div className="d-flex align-items-center justify-content-between mb-3 px-1">
                        <OverlayTrigger
                            trigger={["hover", "focus"]}
                            placement="top"
                            overlay={
                                <Tooltip id="crit-spec-tooltip">
                                    {critSpecDef
                                        ? <><strong>{selectedWeaponGroup} crit spec:</strong><br />{critSpecDef.description}</>
                                        : "No weapon group set - crit spec effect must be applied manually."
                                    }
                                </Tooltip>
                            }
                        >
                            <span style={{ cursor: "help" }}>Crit Spec</span>
                        </OverlayTrigger>
                        <input
                            type="checkbox"
                            id="crit-spec-toggle"
                            checked={critSpecEnabled}
                            onChange={e => setCritSpecForActor(e.target.checked)}
                            style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0, display: "block" }}
                        />
                    </div>
                )}

                <Button
                    variant="success"
                    className="w-100"
                    onClick={handleTurnCommence}
                    disabled={resolving || !target.activeActor || !selectedAction || pendingNichePrompts.length > 0}
                >
                    {resolving ? "Resolving..." : "Turn Commence!"}
                </Button>

                {error && <p className="text-danger mt-2">{error}</p>}

                {pendingManipulate && (
                    <ManipulateCheckModal
                        checks={pendingManipulate}
                        onPass={() => { setPendingManipulate(null); proceedToResolve(); }}
                        onFail={() => {
                            const dc = Math.max(...pendingManipulate.map(c => c.dc));
                            const src = pendingManipulate.map(c => c.source).join(", ");
                            const actorName = activeActorLive?.name ?? "Actor";
                            const msg = `Action lost - failed the DC ${dc} flat check from ${src}.`;
                            setPendingManipulate(null);
                            //Surface the lost action in the combat log, not just as an error notice
                            setLog({ lines: [{ name: `${actorName} -> ${selectedAction}`, body: msg }], mainLine: `${actorName} -> ${selectedAction}: ${msg}` });
                            setError(msg);
                        }}
                    />
                )}

                {pendingOptions && (
                    <AttackOptionsModal
                        versatile={pendingOptions.versatile}
                        rider={pendingOptions.rider}
                        onConfirm={(choices) => { setPendingOptions(null); doResolve(choices); }}
                        onCancel={() => setPendingOptions(null)}
                    />
                )}
            </Card.Body>
        </Card>
    );
}

export default ActionPanel;
