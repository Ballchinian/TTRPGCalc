import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Form, Table, Spinner, Row, Col } from "react-bootstrap";
import { listSavedBattles, getSavedBattle, deleteSavedBattle } from "./savedBattlesApi";
import { restoreBattle, summarizeRecap } from "./battleSnapshot";
import { useBattleStore } from "../../store/battleStore";

const MAX_SAVED = 5;
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "");

//The headline metrics shown for each battle in the compare view
const METRICS = [
    { key: "rounds", label: "Rounds" },
    { key: "actions", label: "Actions taken" },
    { key: "totalDamage", label: "Total damage (both sides)" },
    { key: "heroDamage", label: "Hero party damage" },
    { key: "foeDamage", label: "Foe party damage" },
    { key: "conditionDamage", label: "Damage added by conditions" },
    { key: "offGuardDamage", label: "Off-guard contribution" },
    { key: "critSpecDamage", label: "Crit-spec damage" },
    { key: "kills", label: "Kills" },
];

function SavedBattles() {
    const navigate = useNavigate();
    const [battles, setBattles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    //Detach the loaded-battle tag if the slot it points at gets deleted, so a later Save won't try to
    //overwrite a battle that no longer exists.
    const loadedBattle = useBattleStore(state => state.loadedBattle);
    const setLoadedBattle = useBattleStore(state => state.setLoadedBattle);

    //Compare state: two selected ids and their fetched summaries
    const [aId, setAId] = useState("");
    const [bId, setBId] = useState("");
    const [comparison, setComparison] = useState(null); //{ a:{name,summary}, b:{name,summary} }
    const [comparing, setComparing] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setBattles(await listSavedBattles());
            setError("");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const handleLoad = async (id) => {
        setError("");
        setBusy(true);
        try {
            const battle = await getSavedBattle(id);
            restoreBattle(battle.data, { id: battle._id, name: battle.name });
            navigate("/battle-calculator/battle-simulator");
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    const handleDelete = async (id) => {
        setError("");
        setBusy(true);
        try {
            await deleteSavedBattle(id);
            if (loadedBattle?.id === id) setLoadedBattle(null);
            if (aId === id) setAId("");
            if (bId === id) setBId("");
            setComparison(null);
            await refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleCompare = async () => {
        setError("");
        if (!aId || !bId || aId === bId) { setError("Pick two different battles to compare."); return; }
        setComparing(true);
        try {
            const [a, b] = await Promise.all([getSavedBattle(aId), getSavedBattle(bId)]);
            setComparison({
                a: { name: a.name, summary: summarizeRecap(a.data?.recap, a.data?.battle?.parties) },
                b: { name: b.name, summary: summarizeRecap(b.data?.recap, b.data?.battle?.parties) },
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setComparing(false);
        }
    };

    const conditionNames = comparison
        ? [...new Set([...Object.keys(comparison.a.summary.byCondition), ...Object.keys(comparison.b.summary.byCondition)])]
        : [];

    return (
        <div className="container py-4" style={{ maxWidth: "900px" }}>
            <h2 className="mb-3">Saved Battles</h2>

            {error && <div className="alert alert-danger py-2">{error}</div>}

            <p className="text-muted">Save battles from the simulator's Recap. Here you can load, compare, and delete them.</p>

            {/* Saved list */}
            <Card className="mb-4">
                <Card.Body>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <h5 className="mb-0">Your battles</h5>
                        <span className="text-muted small">{battles.length}/{MAX_SAVED} slots used</span>
                    </div>
                    {loading ? (
                        <Spinner animation="border" size="sm" />
                    ) : battles.length === 0 ? (
                        <div className="text-muted">No saved battles yet.</div>
                    ) : (
                        <Table hover responsive variant="dark" className="align-middle mb-0">
                            <thead>
                                <tr><th>Name</th><th>Saved</th><th className="text-end">Actions</th></tr>
                            </thead>
                            <tbody>
                                {battles.map(b => (
                                    <tr key={b._id}>
                                        <td>{b.name}</td>
                                        <td className="text-muted small">{fmtDate(b.updatedAt || b.createdAt)}</td>
                                        <td className="text-end">
                                            <Button size="sm" variant="outline-success" className="me-2" disabled={busy} onClick={() => handleLoad(b._id)}>Load</Button>
                                            <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => handleDelete(b._id)}>Delete</Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card.Body>
            </Card>

            {/* Compare */}
            <Card>
                <Card.Body>
                    <h5 className="mb-3">Compare two battles</h5>
                    <Row className="g-2 align-items-end">
                        <Col>
                            <Form.Label className="small text-muted mb-1">Battle A</Form.Label>
                            <Form.Select value={aId} onChange={e => setAId(e.target.value)}>
                                <option value="">-- select --</option>
                                {battles.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                            </Form.Select>
                        </Col>
                        <Col>
                            <Form.Label className="small text-muted mb-1">Battle B</Form.Label>
                            <Form.Select value={bId} onChange={e => setBId(e.target.value)}>
                                <option value="">-- select --</option>
                                {battles.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                            </Form.Select>
                        </Col>
                        <Col xs="auto">
                            <Button variant="success" onClick={handleCompare} disabled={comparing || battles.length < 2}>
                                {comparing ? "Comparing..." : "Compare"}
                            </Button>
                        </Col>
                    </Row>

                    {comparison && (
                        <Table bordered responsive variant="dark" className="mt-4 mb-0">
                            <thead>
                                <tr>
                                    <th>Metric</th>
                                    <th className="text-end">{comparison.a.name}</th>
                                    <th className="text-end">{comparison.b.name}</th>
                                    <th className="text-end">Δ (B - A)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {METRICS.map(m => {
                                    const av = comparison.a.summary[m.key] ?? 0;
                                    const bv = comparison.b.summary[m.key] ?? 0;
                                    const diff = bv - av;
                                    return (
                                        <tr key={m.key}>
                                            <td>{m.label}</td>
                                            <td className="text-end">{av}</td>
                                            <td className="text-end">{bv}</td>
                                            <td className="text-end" style={{ color: diff > 0 ? "#5fbf6b" : diff < 0 ? "var(--app-danger)" : undefined }}>
                                                {diff > 0 ? "+" : ""}{diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {conditionNames.length > 0 && (
                                    <tr><td colSpan={4} className="text-muted small pt-3">Damage added per condition</td></tr>
                                )}
                                {conditionNames.map(cond => {
                                    const av = comparison.a.summary.byCondition[cond] ?? 0;
                                    const bv = comparison.b.summary.byCondition[cond] ?? 0;
                                    const diff = bv - av;
                                    return (
                                        <tr key={cond}>
                                            <td className="text-capitalize ps-4">{cond}</td>
                                            <td className="text-end">{av}</td>
                                            <td className="text-end">{bv}</td>
                                            <td className="text-end" style={{ color: diff > 0 ? "#5fbf6b" : diff < 0 ? "var(--app-danger)" : undefined }}>
                                                {diff > 0 ? "+" : ""}{diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                </Card.Body>
            </Card>
        </div>
    );
}

export default SavedBattles;
