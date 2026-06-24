import { useState } from "react";
import { Form, Row, Col, OverlayTrigger, Tooltip, Button, Modal, ButtonGroup } from "react-bootstrap";
import SpellActionTypeController from "./SpellActionTypeController";
import SpellTraitController from "./SpellTraitController";
import AddDamage from "./AddDamage";
import { SPELL_TRADITIONS } from "../../../data/spellTraditions";

//Static tier lists defined at module level to avoid recreating them on every render
const AC_TIERS = [
    { identity: "criticalSuccess", label: "Crit Success" },
    { identity: "success", label: "Success" },
    { identity: "failure", label: "Failure" },
    { identity: "criticalFailure", label: "Crit Failure" },
];

//Save rolls use target's POV: criticalFailure = failed badly (max damage), criticalSuccess = resisted (no damage)
const SAVE_TIERS = [
    { identity: "criticalFailure", label: "Crit Failure" },
    { identity: "failure", label: "Failure" },
    { identity: "success", label: "Success" },
    { identity: "criticalSuccess", label: "Crit Success" },
];

function SpellForm({ spellData, setSpellData, traitDefs, handleSpellChange, handleTraditionToggle, handleSaveTypeChange, handleActionClick, setEffectsByTier, errors }) {
    const { basicSave, check, targetType, outcomes, actionCost, tradition } = spellData;
    //Derive which pips are active from actionCost; no need for a separate constant since it's 3 elements
    const actionCostArray = [0, 1, 2].map(i => i < actionCost);
    const [open, setOpen] = useState(false);

    function handleBasicDamageConfirm(damageData) {
        //Target's POV: crit failure = target failed badly = double, crit success = target resisted = no damage
        setEffectsByTier({
            criticalFailure: [{ ...damageData, multiplier: 2 }],
            failure: [{ ...damageData, multiplier: 1 }],
            success: [{ ...damageData, multiplier: 0.5 }],
            criticalSuccess: [],
        });
        setOpen(false);
    }

    return (
        <div>
            {/* Basic Save Toggle, hidden for automatic spells */}
            {check.targetStat !== "none" && <Form.Group as={Row} className="mb-4">
                <Col>
                    <Form.Label style={{ textAlign: "center", width: "100%" }}>
                        <OverlayTrigger
                            placement="top"
                            overlay={
                                <Tooltip>
                                    Marks this spell as a basic save. Use "Set Basic Damage" to auto-fill standard PF2e scaling: Crit Failure *2, Failure *1, Success *0.5, Crit Success *0.
                                </Tooltip>
                            }
                        >
                            <span>Basic Spell ?</span>
                        </OverlayTrigger>
                    </Form.Label>
                    <Form.Check
                        style={{ textAlign: "start", marginLeft: "5px" }}
                        type="switch"
                        id="basicSave"
                        name="basicSave"
                        checked={basicSave}
                        onChange={handleSpellChange}
                    />
                </Col>

                {basicSave && (
                    <Col>
                        <Form.Label style={{ textAlign: "center", width: "100%" }}>Basic Damage</Form.Label>
                        <Button
                            style={{ width: "100%", padding: "4px 8px", fontSize: "0.85rem" }}
                            variant="primary"
                            onClick={() => setOpen(true)}
                        >
                            Set Basic Damage
                        </Button>
                        <Modal show={open} onHide={() => setOpen(false)}>
                            <Modal.Body>
                                <AddDamage
                                    onConfirm={handleBasicDamageConfirm}
                                    onCancel={() => setOpen(false)}
                                />
                            </Modal.Body>
                        </Modal>
                    </Col>
                )}
            </Form.Group>}

            {/* Action Point Cost */}
            <Form.Group>
                <Form.Label style={{ textAlign: "center", width: "100%" }}>Action Point Cost</Form.Label>
                <div className="d-flex justify-content-center mb-4">
                    {actionCostArray.map((active, i) => (
                        <div
                            key={i}
                            onClick={() => handleActionClick(i)}
                            style={{
                                width: "20px",
                                height: "20px",
                                margin: "5px",
                                backgroundColor: active ? "limegreen" : "gray",
                                cursor: "pointer",
                            }}
                        />
                    ))}
                </div>
            </Form.Group>

            {/* Save Type and Targeting */}
            <Form.Group as={Row} className="mb-4">
                <Col md={6}>
                    <Form.Label>Save Type</Form.Label>
                    <Form.Control
                        as="select"
                        name="targetStat"
                        value={check.targetStat}
                        onChange={handleSaveTypeChange}
                    >
                        {["none", "ac", "will", "reflex", "fortitude"].map(type => (
                            <option key={type} value={type}>
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                            </option>
                        ))}
                    </Form.Control>
                </Col>
                <Col md={6}>
                    <Form.Label>Target</Form.Label>
                    <Form.Control
                        as="select"
                        name="targetType"
                        value={targetType}
                        onChange={handleSpellChange}
                    >
                        {["self", "single", "aoe"].map(type => (
                            <option key={type} value={type}>
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                            </option>
                        ))}
                    </Form.Control>
                </Col>
            </Form.Group>

            {/* Tradition */}
            <Form.Group className="mb-4">
                <Form.Label>Tradition</Form.Label>
                <div>
                    <ButtonGroup>
                        {SPELL_TRADITIONS.map(t => (
                            <Button
                                key={t}
                                size="sm"
                                variant={tradition.includes(t) ? "primary" : "outline-secondary"}
                                onClick={() => handleTraditionToggle(t)}
                            >
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                            </Button>
                        ))}
                    </ButtonGroup>
                </div>
            </Form.Group>

            {/* Traits - lets a spell carry any PF2e trait so condition gates (manipulate/concentrate/...) fire on it */}
            <Form.Group className="mb-4">
                <Form.Label>Traits</Form.Label>
                <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                    <SpellTraitController spellData={spellData} setSpellData={setSpellData} traitDefs={traitDefs} />
                </ul>
            </Form.Group>

            {/* Effects: single guaranteed section for automatic spells, full tier list otherwise */}
            <Form.Group as={Row}>
                <Col>
                    {check.targetStat === "none" ? (
                        <>
                            <Form.Label style={{ textAlign: "center", width: "100%", margin: "0" }}>Guaranteed Effects</Form.Label>
                            <ol style={{ paddingLeft: "1rem" }}>
                                <SpellActionTypeController
                                    identity="success"
                                    label="Effects"
                                    effectsByTier={outcomes}
                                    setEffectsByTier={setEffectsByTier}
                                />
                            </ol>
                        </>
                    ) : (
                        <>
                            <Form.Label style={{ textAlign: "center", width: "100%", margin: "0" }}>Effects by Save Result</Form.Label>
                            <div className="text-muted text-center mb-2" style={{ fontSize: "0.8em" }}>
                                {check.targetStat === "ac"
                                    ? "Crit Success = critical hit, Success = hit, Failure/Crit Failure = miss."
                                    : "Target's save result. Crit Failure = failed badly (max damage). Crit Success = resisted fully (no damage)."
                                }
                            </div>
                            <ol style={{ paddingLeft: "1rem" }}>
                                {(check.targetStat === "ac" ? AC_TIERS : SAVE_TIERS).map(({ identity, label }) => (
                                    <SpellActionTypeController
                                        key={identity}
                                        identity={identity}
                                        label={label}
                                        effectsByTier={outcomes}
                                        setEffectsByTier={setEffectsByTier}
                                    />
                                ))}
                            </ol>
                        </>
                    )}
                    {errors.effects && <div className="text-danger">{errors.effects}</div>}
                </Col>
            </Form.Group>
        </div>
    );
}

export default SpellForm;
