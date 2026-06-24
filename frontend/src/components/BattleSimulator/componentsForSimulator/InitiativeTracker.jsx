import { useState } from "react";
import { useBattleStore } from "../../../store/battleStore";

/*
    Initiative tracker. The roll method follows the current dice mode:
      - avg:    place everyone by raw Perception (deterministic)
      - luck:   everyone rolls d20 + Perception
      - choose: a prompt overlay lets you pick the order one combatant at a time (or switch method)
    Once rolled the order is drag-to-reorder, each row is clickable to jump to that turn, and "Next
    turn" advances (auto-advances when the active combatant runs out of actions). Wrapping past the
    last combatant ends the round.
*/

const panelStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "10px", marginBottom: "20px", textAlign: "left" };
const titleStyle = { fontSize: "0.9rem", fontWeight: 600 };
const subStyle = { fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", margin: "2px 0 8px" };
const rowBase = { display: "flex", alignItems: "center", gap: "6px", padding: "4px 6px", borderRadius: "5px", fontSize: "0.82rem", marginBottom: "3px", cursor: "pointer", userSelect: "none" };
const handleStyle = { cursor: "grab", opacity: 0.5, fontSize: "0.8rem" };
const totalStyle = { marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.6)", fontSize: "0.78rem" };
const btnRow = { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" };

//Fixed prompt overlay for Choose mode - matches the niche-prompt aesthetic
const overlayStyle = { position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)", zIndex: 1055, backgroundColor: "var(--app-panel)", border: "1px solid rgba(120,160,220,0.5)", borderRadius: "8px", padding: "14px 16px", minWidth: "340px", maxWidth: "460px", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" };

function InitiativeTracker() {
    const order = useBattleStore(s => s.initiative.order);
    const turnIndex = useBattleStore(s => s.initiative.turnIndex);
    const diceMode = useBattleStore(s => s.settings.diceMode);
    const parties = useBattleStore(s => s.parties);
    const rollInitiative = useBattleStore(s => s.rollInitiative);
    const setInitiativeOrder = useBattleStore(s => s.setInitiativeOrder);
    const reorderInitiative = useBattleStore(s => s.reorderInitiative);
    const setCurrentTurn = useBattleStore(s => s.setCurrentTurn);
    const nextTurn = useBattleStore(s => s.nextTurn);
    const clearInitiative = useBattleStore(s => s.clearInitiative);

    //Choose-mode build state: an array of picked combatants, or null when not building
    const [picking, setPicking] = useState(null);
    const [dragIndex, setDragIndex] = useState(null);

    //Live lookup so we can grey out the dead and combatants removed since the roll
    const liveById = new Map([...parties.heroes, ...parties.foes].map(c => [c.id, c]));
    const everyone = [...parties.heroes, ...parties.foes];

    const startRoll = () => {
        if (diceMode === "choose") setPicking([]);
        else rollInitiative(diceMode);
    };

    //Build an order entry from a live character (Choose mode appends these in click order)
    const entryFor = (c) => ({ side: c.side, id: c.id, sourceID: c.sourceID, name: c.name, perception: c.stats?.perception ?? 0, roll: null, total: c.stats?.perception ?? 0 });

    const pick = (c) => {
        const next = [...picking, entryFor(c)];
        if (next.length >= everyone.length) { setInitiativeOrder(next); setPicking(null); }
        else setPicking(next);
    };

    const onDrop = (toIndex) => {
        if (dragIndex !== null && dragIndex !== toIndex) reorderInitiative(dragIndex, toIndex);
        setDragIndex(null);
    };

    return (
        <div style={panelStyle}>
            <div className="d-flex justify-content-between align-items-center">
                <span style={titleStyle}>Initiative</span>
                <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>{diceMode} mode</span>
            </div>

            {order.length === 0 ? (
                <>
                    <div style={subStyle}>Roll to set the turn order from each combatant's Perception.</div>
                    <button type="button" className="btn btn-sm btn-outline-info w-100" onClick={startRoll} disabled={everyone.length === 0}>
                        Roll Initiative
                    </button>
                </>
            ) : (
                <>
                    <div style={subStyle}>Drag to reorder · click a row to jump to that turn.</div>
                    {order.map((e, i) => {
                        const live = liveById.get(e.id);
                        const dead = live && (live.stats?.currentHealth ?? 1) <= 0;
                        const missing = !live;
                        const isCurrent = i === turnIndex;
                        return (
                            <div
                                key={e.id}
                                draggable={!missing}
                                onDragStart={() => setDragIndex(i)}
                                onDragOver={ev => ev.preventDefault()}
                                onDrop={() => onDrop(i)}
                                onClick={() => !missing && setCurrentTurn(i)}
                                style={{
                                    ...rowBase,
                                    background: isCurrent ? "rgba(90,150,220,0.25)" : "transparent",
                                    border: isCurrent ? "1px solid rgba(120,170,230,0.6)" : "1px solid transparent",
                                    opacity: missing ? 0.35 : dead ? 0.5 : 1,
                                    textDecoration: dead || missing ? "line-through" : "none",
                                    cursor: missing ? "default" : "pointer",
                                }}
                                title={missing ? "Removed from the battle - reroll to refresh" : dead ? "Down" : ""}
                            >
                                <span style={handleStyle}>≡</span>
                                <span style={{ width: "16px", color: "rgba(255,255,255,0.4)" }}>{i + 1}</span>
                                {isCurrent && <span style={{ color: "rgba(120,180,240,0.95)" }}>▶</span>}
                                <span>{e.name}</span>
                                <span style={totalStyle}>
                                    {e.roll != null ? `${e.roll}+${e.perception} = ${e.total}` : `Per ${e.perception >= 0 ? "+" : ""}${e.perception}`}
                                </span>
                            </div>
                        );
                    })}
                    <div style={btnRow}>
                        <button type="button" className="btn btn-sm btn-info flex-grow-1" onClick={nextTurn}>Next turn ▶</button>
                        <button type="button" className="btn btn-sm btn-outline-light" onClick={startRoll} title="Re-roll initiative">↻</button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearInitiative} title="Clear initiative">✕</button>
                    </div>
                </>
            )}

            {/* Choose-mode pick-one-by-one overlay */}
            {picking !== null && (
                <div style={overlayStyle}>
                    <div style={{ ...titleStyle, color: "rgba(150,190,240,0.95)" }}>Choose initiative order</div>
                    <div style={subStyle}>Pick each combatant in turn order ({picking.length}/{everyone.length}). Or switch method:</div>

                    <div className="d-flex gap-2 mb-2">
                        <button type="button" className="btn btn-sm btn-outline-info" onClick={() => { setPicking(null); rollInitiative("avg"); }}>Use Avg order</button>
                        <button type="button" className="btn btn-sm btn-outline-info" onClick={() => { setPicking(null); rollInitiative("luck"); }}>Use Luck order</button>
                    </div>

                    {picking.length > 0 && (
                        <div style={{ fontSize: "0.8rem", marginBottom: "8px" }}>
                            {picking.map((p, i) => <div key={p.id} style={{ color: "rgba(255,255,255,0.75)" }}>{i + 1}. {p.name}</div>)}
                        </div>
                    )}

                    <div className="d-flex flex-wrap gap-2">
                        {everyone.filter(c => !picking.some(p => p.id === c.id)).map(c => (
                            <button key={c.id} type="button" className="btn btn-sm btn-outline-light" onClick={() => pick(c)}>
                                {c.name} <span style={{ opacity: 0.5 }}>({c.stats?.perception >= 0 ? "+" : ""}{c.stats?.perception ?? 0})</span>
                            </button>
                        ))}
                    </div>

                    <div style={btnRow}>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPicking(null)}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default InitiativeTracker;
