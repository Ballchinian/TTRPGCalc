import { useState } from "react";
import { Modal, Form, Button, ButtonGroup } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../auth";
import { BACKEND_BASE_URL } from "../../config";
import { parsePathbuilder } from "../../utils/pathbuilderImport";
import { parseFoundry } from "../../utils/foundryImport";

//Imports a character from a Pathbuilder 2e or Foundry VTT export. Pathbuilder supports a reference
//code (fetched through the backend proxy, since pathbuilder2e.com sends no CORS headers) or pasting/
//uploading the exported JSON; Foundry is paste/upload only (exported via right-click -> Export Data).
//On success it navigates to the new-character form prefilled via router state - nothing is saved
//until the user reviews and submits that form. Foundry omits a single attack-bonus total, so
//strHit/dexHit are derived from level + ability + the weapon proficiency chosen here.
const PROFICIENCIES = ["untrained", "trained", "expert", "master", "legendary"];

function ImportCharacterModal({ show, onHide }) {
    const navigate = useNavigate();
    const [source, setSource] = useState("pathbuilder"); //"pathbuilder" | "foundry"
    const [method, setMethod] = useState("code"); //"code" | "paste"
    const [code, setCode] = useState("");
    const [jsonText, setJsonText] = useState("");
    const [martialRank, setMartialRank] = useState("expert"); //weapon proficiency for Foundry attack derivation
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const reset = () => { setCode(""); setJsonText(""); setError(""); setLoading(false); };
    const close = () => { reset(); onHide(); };

    //Hand the already-mapped result to the existing new-character form via router state
    const goToForm = (imported) => {
        close();
        navigate("/character-selection/character-design/newCharacterIdentifier", { state: { imported } });
    };

    //Switching source: Foundry only supports paste/upload, so force that method off the code path
    const changeSource = (next) => {
        setSource(next);
        setError("");
        if (next === "foundry") setMethod("paste");
    };

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try { setJsonText(await file.text()); setError(""); }
        catch { setError("Couldn't read that file."); }
    };

    //Parse a pasted/fetched payload into the shared import shape based on the chosen source
    const mapPayload = (payload) =>
        source === "foundry" ? parseFoundry(payload, { martialRank }) : parsePathbuilder(payload);

    const handleImport = async () => {
        setError("");
        if (source === "pathbuilder" && method === "code") {
            const trimmed = code.trim();
            if (!/^\d{4,8}$/.test(trimmed)) {
                setError("Enter the numeric code Pathbuilder shows after 'Export to JSON'.");
                return;
            }
            setLoading(true);
            try {
                const res = await apiFetch(`${BACKEND_BASE_URL}/import/pathbuilder/${trimmed}`, { method: "GET" });
                if (!res) { setError("Session expired. Please refresh."); return; }
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(body.message || "Import failed. Try pasting the exported JSON instead.");
                    return;
                }
                goToForm(parsePathbuilder(await res.json()));
            } catch (err) {
                console.error("Pathbuilder code import failed:", err);
                setError(err.message || "Import failed. Try pasting the exported JSON instead.");
            } finally {
                setLoading(false);
            }
        } else {
            if (!jsonText.trim()) { setError("Paste the exported JSON, or choose a .json file."); return; }
            try {
                goToForm(mapPayload(JSON.parse(jsonText)));
            } catch (err) {
                console.error("Import failed:", err);
                setError(err instanceof SyntaxError ? "That isn't valid JSON. Copy the full export and try again." : (err.message || "Couldn't read that character."));
            }
        }
    };

    return (
        <Modal show={show} onHide={close} centered>
            <Modal.Header closeButton className="bg-dark text-white border-secondary">
                <Modal.Title>Import character</Modal.Title>
            </Modal.Header>
            <Modal.Body className="bg-dark text-white">

                <p className="text-muted small mb-2">Source</p>
                <ButtonGroup className="mb-3 w-100">
                    <Button variant={source === "pathbuilder" ? "primary" : "outline-secondary"} onClick={() => changeSource("pathbuilder")}>
                        Pathbuilder 2e
                    </Button>
                    <Button variant={source === "foundry" ? "primary" : "outline-secondary"} onClick={() => changeSource("foundry")}>
                        Foundry VTT
                    </Button>
                </ButtonGroup>

                {source === "pathbuilder" && (
                    <>
                        <p className="text-muted small mb-2">Method</p>
                        <div className="d-flex gap-3 mb-3">
                            <Form.Check
                                type="radio" id="import-method-code" label="Reference code"
                                checked={method === "code"} onChange={() => { setMethod("code"); setError(""); }}
                            />
                            <Form.Check
                                type="radio" id="import-method-paste" label="Paste / upload JSON"
                                checked={method === "paste"} onChange={() => { setMethod("paste"); setError(""); }}
                            />
                        </div>
                    </>
                )}

                {source === "foundry" && (
                    <Form.Group className="mb-3">
                        <Form.Label className="small">
                            Weapon proficiency (used to estimate your attack bonus - adjust on the next screen):
                        </Form.Label>
                        <Form.Select value={martialRank} onChange={e => setMartialRank(e.target.value)}>
                            {PROFICIENCIES.map(p => (
                                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                            ))}
                        </Form.Select>
                    </Form.Group>
                )}

                {source === "pathbuilder" && method === "code" ? (
                    <Form.Group>
                        <Form.Label className="small">
                            In Pathbuilder: <em>Export -> Export to JSON</em>, then enter the number it gives you.
                        </Form.Label>
                        <Form.Control
                            type="text" inputMode="numeric" placeholder="e.g. 163111"
                            value={code} onChange={e => setCode(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleImport(); }}
                        />
                    </Form.Group>
                ) : (
                    <Form.Group>
                        <Form.Label className="small">
                            {source === "foundry"
                                ? "In Foundry: right-click the actor -> Export Data. Paste that JSON, or choose the .json file:"
                                : "Paste the exported JSON, or choose a .json file:"}
                        </Form.Label>
                        <Form.Control
                            as="textarea" rows={5}
                            placeholder={source === "foundry" ? '{ "name": "...", "type": "character", "system": { ... } }' : '{ "success": true, "build": { ... } }'}
                            value={jsonText} onChange={e => setJsonText(e.target.value)}
                            style={{ fontFamily: "monospace", fontSize: "12px" }}
                        />
                        <Form.Control type="file" accept="application/json,.json" className="mt-2" onChange={handleFile} />
                    </Form.Group>
                )}

                {error && <div className="text-danger mt-3 small">{error}</div>}

            </Modal.Body>
            <Modal.Footer className="bg-dark border-secondary">
                <Button variant="outline-secondary" onClick={close} disabled={loading}>Cancel</Button>
                <Button variant="success" onClick={handleImport} disabled={loading}>
                    {loading ? "Importing..." : "Import"}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

export default ImportCharacterModal;
