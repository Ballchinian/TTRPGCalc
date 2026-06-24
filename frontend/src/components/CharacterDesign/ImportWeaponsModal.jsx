import { useState } from "react";
import { apiFetch } from "../../auth";
import { BACKEND_BASE_URL } from "../../config";
import { useGameDataStore } from "../../store/gameDataStore";
import { WEAPON_GROUPS, RANGED_GROUPS } from "../../data/weaponGroups";

//Confirmation popup (styled like the crit-spec NichePromptPanel) shown after an imported character
//is saved. Lets the user pick which Pathbuilder weapons to add to their arsenal as weapon Actions,
//correcting the best-effort weapon group (which drives critical specialisation). Builds the exact
//same Action payload as WeaponBuilder so imported weapons behave identically to hand-built ones.

const backdropStyle = { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 1051 };
const cardStyle = {
    position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
    zIndex: 1052, backgroundColor: "var(--app-panel)", border: "1px solid rgba(180,120,60,0.5)",
    borderRadius: "8px", padding: "16px 18px", width: "min(560px, 92vw)",
    maxHeight: "82vh", overflowY: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
};
const titleStyle = { color: "rgba(220,160,60,0.95)", fontWeight: 600, fontSize: "16px", marginBottom: "2px" };
const subStyle = { color: "rgba(255,255,255,0.45)", fontSize: "12px", marginBottom: "12px" };
const rowStyle = { display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.08)" };
const selectStyle = {
    padding: "3px 6px", fontSize: "12px", backgroundColor: "#2a2a3e", color: "white",
    border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px",
};
const dmgStyle = { color: "rgba(255,255,255,0.5)", fontSize: "11px", minWidth: "92px", textAlign: "right" };
const btnRowStyle = { display: "flex", gap: "8px", marginTop: "14px", justifyContent: "flex-end" };
const addBtnStyle = { padding: "6px 16px", fontSize: "13px", backgroundColor: "rgba(180,120,40,0.9)", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" };
const addBtnDisabled = { ...addBtnStyle, opacity: 0.4, cursor: "default" };
const skipBtnStyle = { padding: "6px 16px", fontSize: "13px", backgroundColor: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px", cursor: "pointer" };

//Builds the weapon Action payload (mirrors WeaponBuilder.handleSaveWeapon). The potency/striking runes
//are stored as fields (the resolver applies them); Pathbuilder's flat damageBonus includes the ability
//mod for melee, so subtract STR for melee groups - the resolver reinjects it.
function buildPayload(w, strMod) {
    const group = w.group || "";
    const ranged = RANGED_GROUPS.has(group);
    const modifier = w.damageBonus == null ? 0 : (ranged ? w.damageBonus : w.damageBonus - strMod);
    const number = { numRolled: w.numRolled, diceRolled: w.diceRolled, modifier };
    const traits = [{ name: "attack", label: "Attack" }, ...(ranged ? [{ name: "ranged", label: "Ranged" }] : [])];
    return {
        name: w.name,
        type: "roll",
        category: "weapon",
        group: group || undefined,
        potency: w.potency || 0,
        striking: w.striking || 0,
        traits,
        targetType: "single",
        actionCost: 1,
        check: { targetStat: "ac", actorStat: ranged ? "dexHit" : "strHit" },
        outcomes: {
            criticalSuccess: { effects: [{ type: "damage", damageType: w.damageType, number, multiplier: 2 }] },
            success: { effects: [{ type: "damage", damageType: w.damageType, number }] },
            failure: { effects: [] },
            criticalFailure: { effects: [] },
        },
    };
}

//Returns a name not already in `taken`, appending "(imported)" / "(imported N)" on collision
function uniqueName(name, taken) {
    if (!taken.has(name.toLowerCase())) return name;
    let candidate = `${name} (imported)`;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = `${name} (imported ${n++})`;
    return candidate;
}

function ImportWeaponsModal({ weapons, strMod, onDone }) {
    //rows carry an editable group + include flag on top of the parsed descriptor
    const [rows, setRows] = useState(() => weapons.map(w => ({ ...w, include: true })));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const selectedCount = rows.filter(r => r.include).length;

    const setRow = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

    const handleAdd = async () => {
        const chosen = rows.filter(r => r.include);
        if (chosen.length === 0) { onDone(0); return; }
        setBusy(true);
        setError("");
        try {
            //Fetch current weapon names so imports don't silently duplicate an existing arsenal entry
            const taken = new Set();
            const existing = await apiFetch(`${BACKEND_BASE_URL}/actions`);
            if (existing?.ok) {
                const data = await existing.json();
                (data.weapons || []).forEach(w => taken.add(String(w.name).toLowerCase()));
            }

            let added = 0;
            for (const w of chosen) {
                const name = uniqueName(w.name, taken);
                const res = await apiFetch(`${BACKEND_BASE_URL}/actions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildPayload({ ...w, name }, strMod)),
                });
                if (res?.ok) { taken.add(name.toLowerCase()); added++; }
            }

            await useGameDataStore.getState().refreshItems();
            if (added < chosen.length) {
                setError(`Added ${added} of ${chosen.length}. Some weapons couldn't be saved - you can add them manually in the Action Builder.`);
                setBusy(false);
                return;
            }
            onDone(added);
        } catch (err) {
            console.error("Importing weapons failed:", err);
            setError("Couldn't add weapons. You can still add them manually in the Action Builder.");
            setBusy(false);
        }
    };

    return (
        <>
            <div style={backdropStyle} />
            <div style={cardStyle}>
                <div style={titleStyle}>Add weapons from this character?</div>
                <div style={subStyle}>
                    These weapons came from the import. Pick which to add to your arsenal and confirm the
                    weapon group (it sets critical specialisation and melee vs. ranged).
                </div>

                {rows.map((w, i) => (
                    <div key={i} style={rowStyle}>
                        <input
                            type="checkbox" checked={w.include}
                            onChange={e => setRow(i, { include: e.target.checked })}
                        />
                        <span style={{ flex: 1, fontSize: "14px", color: "white", opacity: w.include ? 1 : 0.5 }}>
                            {w.name}
                        </span>
                        <select style={selectStyle} value={w.group} onChange={e => setRow(i, { group: e.target.value })}>
                            <option value="">-- Group (none) --</option>
                            {WEAPON_GROUPS.map(g => (
                                <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                            ))}
                        </select>
                        <span style={dmgStyle}>
                            {w.numRolled + (w.striking || 0)}d{w.diceRolled} {w.damageType.toLowerCase()}
                            {w.potency ? ` · +${w.potency}` : ""}
                        </span>
                    </div>
                ))}

                {error && <div className="text-warning mt-3" style={{ fontSize: "12px" }}>{error}</div>}

                <div style={btnRowStyle}>
                    <button style={skipBtnStyle} onClick={() => onDone(0)} disabled={busy}>Skip</button>
                    <button
                        style={busy || selectedCount === 0 ? addBtnDisabled : addBtnStyle}
                        onClick={handleAdd} disabled={busy || selectedCount === 0}
                    >
                        {busy ? "Adding..." : `Add ${selectedCount} weapon${selectedCount === 1 ? "" : "s"}`}
                    </button>
                </div>
            </div>
        </>
    );
}

export default ImportWeaponsModal;
