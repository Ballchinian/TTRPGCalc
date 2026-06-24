import { useState, useEffect } from "react";
import { Modal, Button, Form, Spinner } from "react-bootstrap";
import { listSavedBattles, createSavedBattle, updateSavedBattle } from "../../SavedBattles/savedBattlesApi";
import { serializeCurrentBattle } from "../../SavedBattles/battleSnapshot";
import { useBattleStore } from "../../../store/battleStore";

//Mirror of the backend cap (MAX_SAVED_BATTLES); saving past it is also rejected server-side.
const MAX_SAVED = 5;
//Sentinel target meaning "create a new slot" rather than overwrite an existing battle id.
const NEW_SLOT = "__new__";
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "");

/*
    Save dialog launched from the Recap. Saving lives here (in the simulator) rather than in Saved
    Battles, which is now management-only. One name field plus a "save to" picker handles every case:
    a new slot, or overwriting any existing one. The target defaults to the slot this battle was
    loaded from (loadedBattle), so resaving a loaded battle is one click; picking a slot prefills
    its name (editable) so an overwrite keeps the old name unless you rename it.
*/
function SaveBattleModal({ show, onHide, onSaved }) {
    const loadedBattle = useBattleStore(s => s.loadedBattle);
    const setLoadedBattle = useBattleStore(s => s.setLoadedBattle);

    const [battles, setBattles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [target, setTarget] = useState(NEW_SLOT); //NEW_SLOT or an existing battle _id
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const full = battles.length >= MAX_SAVED;

    //Reload the slot list each time the dialog opens and pick a sensible default target: the loaded
    //slot if it still exists, else a new slot, else (when full) the first slot.
    useEffect(() => {
        if (!show) return;
        let cancelled = false;
        (async () => {
            setLoading(true); setError("");
            try {
                const list = await listSavedBattles();
                if (cancelled) return;
                setBattles(list);
                const loadedSlot = loadedBattle && list.find(b => b._id === loadedBattle.id);
                if (loadedSlot) {
                    setTarget(loadedSlot._id);
                    setName(loadedSlot.name);
                } else if (list.length >= MAX_SAVED) {
                    setTarget(list[0]._id);
                    setName(list[0].name);
                } else {
                    setTarget(NEW_SLOT);
                    setName(loadedBattle?.name ?? "");
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [show, loadedBattle]);

    //Picking a target prefills the name: a slot's existing name (editable), or blank for a new slot.
    const chooseTarget = (value) => {
        setTarget(value);
        setName(value === NEW_SLOT ? "" : (battles.find(b => b._id === value)?.name ?? ""));
    };

    const handleSave = async () => {
        setError("");
        if (!name.trim()) { setError("Give the battle a name first."); return; }
        setBusy(true);
        try {
            const data = serializeCurrentBattle();
            if (target === NEW_SLOT) {
                const created = await createSavedBattle(name.trim(), data);
                setLoadedBattle({ id: created._id, name: created.name });
            } else {
                const updated = await updateSavedBattle(target, { name: name.trim(), data });
                setLoadedBattle({ id: target, name: updated.name });
            }
            onSaved?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const saveLabel = target === NEW_SLOT
        ? "Save as new"
        : `Overwrite "${battles.find(b => b._id === target)?.name ?? ""}"`;

    return (
        <Modal show={show} onHide={onHide} centered>
            <Modal.Header closeButton closeVariant="white" className="bg-dark text-white border-secondary">
                <Modal.Title>Save Battle</Modal.Title>
            </Modal.Header>
            <Modal.Body className="bg-dark text-white">
                {error && <div className="alert alert-danger py-2">{error}</div>}
                {loading ? (
                    <Spinner animation="border" size="sm" />
                ) : (
                    <>
                        <Form.Group className="mb-3">
                            <Form.Label className="small text-muted mb-1">Name</Form.Label>
                            <Form.Control
                                placeholder="Battle name (e.g. 'Goblin ambush - greatsword build')"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                                autoFocus
                            />
                        </Form.Group>

                        <Form.Label className="small text-muted mb-1">Save to</Form.Label>
                        <div className="d-flex flex-column gap-1">
                            <Form.Check
                                type="radio"
                                id="save-target-new"
                                name="save-target"
                                checked={target === NEW_SLOT}
                                disabled={full}
                                onChange={() => chooseTarget(NEW_SLOT)}
                                label={
                                    <span>
                                        New slot{" "}
                                        <span className="text-muted small">
                                            ({battles.length}/{MAX_SAVED} used{full ? " - full, overwrite one below" : ""})
                                        </span>
                                    </span>
                                }
                            />
                            {battles.map(b => (
                                <Form.Check
                                    key={b._id}
                                    type="radio"
                                    id={`save-target-${b._id}`}
                                    name="save-target"
                                    checked={target === b._id}
                                    onChange={() => chooseTarget(b._id)}
                                    label={
                                        <span>
                                            {b.name}
                                            {loadedBattle?.id === b._id && <span className="badge bg-secondary ms-2">loaded</span>}
                                            <span className="text-muted small ms-2">{fmtDate(b.updatedAt || b.createdAt)}</span>
                                        </span>
                                    }
                                />
                            ))}
                        </div>
                    </>
                )}
            </Modal.Body>
            <Modal.Footer className="bg-dark border-secondary">
                <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
                <Button variant="success" onClick={handleSave} disabled={busy || loading}>
                    {busy ? "Saving..." : saveLabel}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

export default SaveBattleModal;
