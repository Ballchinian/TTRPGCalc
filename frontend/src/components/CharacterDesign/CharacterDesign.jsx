import { CardBody, Card, Button, Row, Col, OverlayTrigger, Tooltip } from "react-bootstrap";
import Form from "react-bootstrap/Form";
import { useState, useEffect, useRef } from "react";
import "./CharacterDesign.css";
import CharacterSkills from "./CharacterSkills/CharacterSkills";
import { DamageModifiers } from "./DamageModifiers";
import ImportWeaponsModal from "./ImportWeaponsModal";
import ImageCropModal from "./ImageCropModal";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import newCharacterPicture from "../../images/characterImages/blank character.png";
import { apiFetch } from '../../auth';
import { BACKEND_BASE_URL } from "../../config";
import { useGameDataStore } from '../../store/gameDataStore';
import { useBattleStore } from '../../store/battleStore';
import { CLASS_FEATURES, getFeatureConfigFields } from '../../data/classFeatures';
import parseDmgDie from '../ActionBuilder/utill/parseDmgDie';

//A dmgDie config field stores {numRolled,diceRolled} but the form edits an "XdY" string
const dmgDieToString = (d) => (d && d.numRolled ? `${d.numRolled}d${d.diceRolled}` : "");

//Build the form's class-config from a feature id + stored config (defaults when missing)
const buildClassConfig = (featureId, stored = {}) => {
    const cfg = {};
    getFeatureConfigFields(featureId).forEach(f => {
        const v = stored[f.key];
        cfg[f.key] = f.type === "dmgDie"
            ? (v ? dmgDieToString(v) : (f.default ?? ""))
            : (v ?? f.default ?? 0);
    });
    return cfg;
};

//Human-readable overrides for stats whose names don't read well from camelCase
const STAT_LABELS = {
    ac: "AC", dc: "Spell DC", health: "Health",
    str: "STR Mod", strHit: "STR Hit", dexHit: "DEX Hit",
};

const STAT_TOOLTIPS = {
    str: "Your Strength modifier (e.g. enter 3 for +3). Automatically added to melee weapon damage rolls. Does not affect attack rolls, enter your full melee attack bonus in STR Hit.",
    strHit: "Your total melee attack bonus, compared against the target's AC. Enter the final value already including proficiency, level, and your STR modifier. This simulator does not compute it for you.",
    dexHit: "Your total ranged attack bonus, compared against the target's AC. Also used for finesse weapons when higher than STR Hit. Enter the final value including all bonuses.",
};

//The form keeps stats flat for simple inputs; the stored model is namespaced (Foundry-aligned:
//attributes / saves / perception / skills). Map between the two only at the load/save boundary.
const toNamespacedStats = (flat) => {
    const { perception = 0, ...skills } = flat.skills ?? {};
    return {
        attributes: { ac: flat.ac, dc: flat.dc, hp: flat.health, str: flat.str, strHit: flat.strHit, dexHit: flat.dexHit, resilient: flat.resilient ?? 0 },
        saves: { fortitude: flat.fortitude, reflex: flat.reflex, will: flat.will },
        perception,
        skills,
    };
};
const fromNamespacedStats = (stats) => {
    const a = stats?.attributes ?? {};
    const s = stats?.saves ?? {};
    return {
        ac: a.ac ?? 0, dc: a.dc ?? 0, str: a.str ?? 0, strHit: a.strHit ?? 0, dexHit: a.dexHit ?? 0,
        health: a.hp ?? 0, resilient: a.resilient ?? 0,
        fortitude: s.fortitude ?? 0, reflex: s.reflex ?? 0, will: s.will ?? 0,
        skills: { perception: stats?.perception ?? 0, ...(stats?.skills ?? {}) },
    };
};

//Form's default flat stats - extracted so the unmount auto-save can rebuild the "loaded" snapshot
//through the exact same merge the form uses, making an unchanged character compare equal.
const DEFAULT_CHARACTER_STATS = {
    ac: 0, dc: 0, str: 0, strHit: 0, dexHit: 0, health: 0, resilient: 0, reflex: 0, fortitude: 0, will: 0,
    skills: {
        perception: 0, acrobatics: 0, athletics: 0, arcana: 0, crafting: 0, deception: 0, diplomacy: 0,
        intimidation: 0, medicine: 0, nature: 0, occultism: 0, performance: 0, religion: 0, society: 0,
        stealth: 0, survival: 0, thievery: 0,
    },
};

//Builds the exact PUT/POST body from the editable form values. Shared by the explicit save button and
//the auto-save-on-leave so both produce byte-identical payloads (lets us diff to skip no-op saves).
function buildCharacterPayload(src) {
    let classOption = null;
    if (src.classFeature) {
        const config = {};
        getFeatureConfigFields(src.classFeature).forEach(f => {
            const v = src.classConfig[f.key];
            if (f.type === "dmgDie") {
                const parsed = parseDmgDie(String(v ?? ""));
                if (!parsed.errors) config[f.key] = { numRolled: parsed.numRolled, diceRolled: parsed.diceRolled };
            } else {
                config[f.key] = Number(v) || 0;
            }
        });
        classOption = { feature: src.classFeature, style: src.classStyle || undefined, config };
    }
    return {
        characterName: src.characterName,
        stats: toNamespacedStats(src.characterStats),
        image: src.imgUrl,
        resistances: src.resistances,
        weaknesses: src.weaknesses,
        immunities: src.immunities,
        classOption,
    };
}

//Auto-save guard: a non-empty name, all-numeric stats, and no name collision with another character
function isCharacterSaveable(src, characterID) {
    if (!src.characterName || src.characterName.trim() === "") return false;
    const numericBad = ([, v]) => v === "" || isNaN(v);
    if (Object.entries(src.characterStats).some(([k, v]) => k !== "skills" && numericBad([k, v]))) return false;
    if (Object.entries(src.characterStats.skills).some(numericBad)) return false;
    const dup = (src.characterStorage ?? []).some(c =>
        c && c._id !== characterID && c.characterName?.toLowerCase() === src.characterName.trim().toLowerCase());
    return !dup;
}

function CharacterDesign() {
    const navigate = useNavigate();
    const location = useLocation();
    //Pathbuilder import payload passed from the import modal via router state (new characters only)
    const imported = location.state?.imported;

    //From url
    const { characterID } = useParams();
    const isNew = characterID === "newCharacterIdentifier";

    //Weapons parsed from a Pathbuilder import, offered after the new character is saved
    const [pendingWeapons, setPendingWeapons] = useState(isNew && imported ? (imported.weapons ?? []) : []);
    const [importStrMod, setImportStrMod] = useState(isNew && imported ? (imported.flatStats?.str ?? 0) : 0);
    const [showWeaponsModal, setShowWeaponsModal] = useState(false);

    //Confirmation States
    const [editNameVis, setEditNameVis] = useState(!isNew); //If new character, show form immediately
    const [uploading, setUploading] = useState(false);
    const [errors, setErrors] = useState({});
    const [editingSkills, setEditingSkills] = useState(false);

    //Show preview of image before upload
    const [previewUrl, setPreviewUrl] = useState("");
    //Revoke the previous blob URL when previewUrl changes or on unmount
    useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
    //Object URL of the file currently being cropped (drives the crop modal); null when closed
    const [cropSrc, setCropSrc] = useState(null);
    const [characterStorage, setCharacterStorage] = useState([]);

    //Damage modifiers
    const [resistances, setResistances] = useState([]);
    const [weaknesses, setWeaknesses] = useState([]);
    const [immunities, setImmunities] = useState([]);
    const damageTypes = useGameDataStore(state => state.damageTypes);

    //Optional class ability (e.g. Swashbuckler), driven by the classFeatures registry
    const [classFeature, setClassFeature] = useState("");
    const [classStyle, setClassStyle] = useState("");
    const [classConfig, setClassConfig] = useState({}); //raw form values (numbers + dmgDie strings)
    const handleFeatureChange = (feature) => {
        setClassFeature(feature);
        setClassStyle("");
        setClassConfig(feature ? buildClassConfig(feature) : {});
    };

    //Info that will be essential for character
    const [characterName, setCharacterName] = useState("");
    const [imgUrl, setImgUrl] = useState("");
    const [characterStats, setCharacterStats] = useState(DEFAULT_CHARACTER_STATS);

    //Auto-save-on-leave plumbing (existing characters only). latestRef mirrors the current editable
    //values each render; loadedSnapshotRef holds the payload of what was loaded so we can skip no-op
    //saves; skipAutoSaveRef suppresses the unmount save after an explicit save or for new characters.
    const latestRef = useRef(null);
    const loadedSnapshotRef = useRef(null);
    const skipAutoSaveRef = useRef(isNew);

    //Initialises characterStorage to find existing characters for duplication reasons
    useEffect(() => {
        const fetchCharacters = async () => {
            try {
                const res = await apiFetch(`${BACKEND_BASE_URL}/characters`, { method: "GET" });
                if (!res) return;
                const data = await res.json();
                setCharacterStorage(data);
                //If its an existing character
                if (!isNew) {
                    //Finds the character from the backend and sets the stats and image
                    const char = data.find(c => c._id === characterID);
                    if (char) {
                        setCharacterName(char.characterName);
                        const flat = fromNamespacedStats(char.stats);
                        setCharacterStats(prev => ({ ...prev, ...flat, skills: { ...prev.skills, ...flat.skills } }));
                        setImgUrl(char.image);
                        setResistances(char.resistances ?? []);
                        setWeaknesses(char.weaknesses ?? []);
                        setImmunities(char.immunities ?? []);
                        const hasFeature = char.classOption?.feature && CLASS_FEATURES[char.classOption.feature];
                        if (hasFeature) {
                            setClassFeature(char.classOption.feature);
                            setClassStyle(char.classOption.style ?? "");
                            setClassConfig(buildClassConfig(char.classOption.feature, char.classOption.config ?? {}));
                        }
                        //Snapshot the loaded character as a payload (built through the same merge the form
                        //uses) so the auto-save-on-leave can tell whether the user actually changed anything.
                        loadedSnapshotRef.current = JSON.stringify(buildCharacterPayload({
                            characterName: char.characterName,
                            characterStats: { ...DEFAULT_CHARACTER_STATS, ...flat, skills: { ...DEFAULT_CHARACTER_STATS.skills, ...flat.skills } },
                            imgUrl: char.image,
                            resistances: char.resistances ?? [],
                            weaknesses: char.weaknesses ?? [],
                            immunities: char.immunities ?? [],
                            classFeature: hasFeature ? char.classOption.feature : "",
                            classStyle: hasFeature ? (char.classOption.style ?? "") : "",
                            classConfig: hasFeature ? buildClassConfig(char.classOption.feature, char.classOption.config ?? {}) : {},
                        }));
                    }
                }
            } catch (err) {
                console.error(err);
            }
        };
        fetchCharacters();
    }, [characterID, isNew]);

    //Seed the form from a Pathbuilder or Foundry import (new characters only). The user reviews every
    //value here before saving - the import never writes to the backend directly. Damage modifiers and
    //the class option arrive only from imports that supply them - Foundry, or Pathbuilder for the modelled classes.
    useEffect(() => {
        if (!isNew || !imported) return;
        setCharacterName(imported.characterName ?? "");
        const flat = imported.flatStats ?? {};
        setCharacterStats(prev => ({ ...prev, ...flat, skills: { ...prev.skills, ...(flat.skills ?? {}) } }));
        if (imported.resistances) setResistances(imported.resistances);
        if (imported.weaknesses) setWeaknesses(imported.weaknesses);
        if (imported.immunities) setImmunities(imported.immunities);
        if (imported.classOption?.feature && CLASS_FEATURES[imported.classOption.feature]) {
            setClassFeature(imported.classOption.feature);
            setClassStyle(imported.classOption.style ?? "");
            setClassConfig(buildClassConfig(imported.classOption.feature, imported.classOption.config ?? {}));
        }
    }, [isNew, imported]);

    //Auto-save on leave: navigating away (e.g. a navbar link) unmounts this route. For existing
    //characters we persist any valid change here so edits aren't silently lost - without it the only
    //way to keep changes was the explicit button. Runs once on unmount; best-effort and fire-and-forget
    //(the component is gone, so it only touches the global stores, never React state).
    useEffect(() => {
        return () => {
            if (skipAutoSaveRef.current) return;
            const src = latestRef.current;
            const snapshot = loadedSnapshotRef.current;
            if (!src || !snapshot || !isCharacterSaveable(src, characterID)) return;
            const payload = buildCharacterPayload(src);
            if (JSON.stringify(payload) === snapshot) return; //nothing changed - skip the write
            (async () => {
                try {
                    const res = await apiFetch(`${BACKEND_BASE_URL}/characters/${characterID}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    if (!res || !res.ok) return;
                    const updated = await res.json();
                    useGameDataStore.getState().upsertCharacter(updated);
                    useBattleStore.getState().syncPartyStats([updated]);
                    //Edited stats invalidate any saved battle bonuses for this character
                    const battleSession = JSON.parse(localStorage.getItem("battleSession") || "{}");
                    delete battleSession[characterID];
                    localStorage.setItem("battleSession", JSON.stringify(battleSession));
                } catch { /* best-effort autosave; nothing to surface once unmounted */ }
            })();
        };
    }, [characterID]);


    //For all the different fields not including characterName or skills
    function handleStatChange(e) {
        const { name, value } = e.target;
        setCharacterStats(prev => ({ ...prev, [name]: Number(value) }));
    }

    async function handleChangeCharacter() {
        if (uploading) {
            alert("Please wait, image is still uploading...");
            return;
        }

        const newErrors = {};

        //For stats not including skills
        Object.entries(characterStats).forEach(([key, value]) => {
            if (value === "" || isNaN(value)) {
                //skills is included in characterStats, must be iterated through separately
                if (key !== "skills") {
                    newErrors[key] = `${key} must be a number!`;
                }
            }
        });

        //For skills under skills
        Object.entries(characterStats.skills).forEach(([key, value]) => {
            if (value === "" || isNaN(value)) {
                newErrors[key] = `${key} must be a number!`;
            }
        });

        if (!characterName || characterName.trim() === "") {
            newErrors.characterName = "Character name is required.";
        }
        if (characterStorage.length > 0) {
            const isDuplicate = characterStorage.some(
                c =>
                    c &&
                    c.characterName.toLowerCase() === characterName.trim().toLowerCase() &&
                    c._id !== characterID
            );
            if (isDuplicate) newErrors.duplicate = "A character with this name already exists.";
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }
        setErrors({});
        //Build the request body (dmgDie fields -> {numRolled,diceRolled}); shared with the auto-save
        const characterData = buildCharacterPayload({
            characterName, characterStats, imgUrl, resistances, weaknesses, immunities, classFeature, classStyle, classConfig,
        });
        try {
            //Decides to make a character if new, if not then edit it
            if (isNew) {
                const res = await apiFetch(`${BACKEND_BASE_URL}/characters`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(characterData)
                });
                if (!res.ok) { setErrors({ server: "Failed to save character. Please try again." }); return; }
                const saved = await res.json();
                setCharacterStorage(prev => [...prev, saved]);
                //Add to the shared store so the new character is immediately selectable in the
                //battle's Add Hero/Add Foe lists without a page reload (game data fetches only once)
                useGameDataStore.getState().upsertCharacter(saved);
            } else {
                const res = await apiFetch(`${BACKEND_BASE_URL}/characters/${characterID}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(characterData)
                });
                if (!res.ok) { setErrors({ server: "Failed to update character. Please try again." }); return; }
                const updated = await res.json();

                //Update local storage array by matching the old name
                setCharacterStorage(prev =>
                    prev.map(c => c._id === characterID ? updated : c)
                );

                //Sync the fresh stats into gameDataStore and any existing battle snapshot immediately
                useGameDataStore.getState().upsertCharacter(updated);
                useBattleStore.getState().syncPartyStats([updated]);

                //Edited stats invalidate any saved battle bonuses for this character
                try {
                    const battleSession = JSON.parse(localStorage.getItem("battleSession") || "{}");
                    delete battleSession[characterID];
                    localStorage.setItem("battleSession", JSON.stringify(battleSession));
                } catch { /* corrupt session data, leave as-is */ }
            }
            //Saved successfully - the upcoming navigation must not trigger the unmount auto-save
            skipAutoSaveRef.current = true;
            //Imported weapons: offer to add them as Actions before leaving; otherwise go straight back
            if (isNew && pendingWeapons.length > 0) {
                setShowWeaponsModal(true);
            } else {
                navigate("/character-selection");
            }
        } catch (err) {
            console.error(err);
            setErrors({ server: "An unexpected error occurred." });
        }
    };

    //Picking a file opens the crop modal rather than uploading straight away - the user frames the
    //portrait to the card's 4:5 ratio first. Reset the input value so repicking the same file fires.
    function handleImageSelect(e) {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        setCropSrc(URL.createObjectURL(file));
    }

    function cancelCrop() {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(null);
    }

    //Receives the already-cropped 4:5 blob from the crop modal and uploads it as the portrait.
    async function uploadCroppedImage(blob) {
        cancelCrop();

        //Show local preview immediately
        const localPreview = URL.createObjectURL(blob);
        setPreviewUrl(localPreview);

        //Start loading
        setUploading(true);

        const formData = new FormData();
        formData.append("image", blob, "portrait.png");

        try {
            const res = await apiFetch(`${BACKEND_BASE_URL}/characters/upload`, {
                method: "POST",
                body: formData,
            });
            if (!res) { setErrors({ server: "Session expired. Please refresh." }); return; }
            if (!res.ok) { setErrors({ server: "Image upload failed. Please try again." }); return; }
            const data = await res.json();

            setImgUrl(data.url);
            //Remove preview once we have a hosted URL
            setPreviewUrl("");
        } catch (err) {
            console.error("Error uploading image:", err);
            setErrors(prev => ({ ...prev, server: "Image upload failed. Please try again." }));
            setPreviewUrl("");
        } finally {
            setUploading(false);
        }
    }
    
    //For loading html forms
    const renderStatForms = stat => {
        const label = STAT_LABELS[stat] ?? stat.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
        const tooltip = STAT_TOOLTIPS[stat];
        const labelEl = tooltip ? (
            <OverlayTrigger placement="top" overlay={<Tooltip>{tooltip}</Tooltip>}>
                <span style={{ borderBottom: "1px dotted currentColor", cursor: "help" }}>{label}</span>
            </OverlayTrigger>
        ) : label;
        return (
            <div>
                <p style={{ marginBottom: "4px" }}>{labelEl}</p>
                <Form.Control
                    type="number"
                    name={stat}
                    value={characterStats[stat] ?? 0}
                    onChange={handleStatChange}
                />
                {errors[stat] && (<div className="text-danger">{errors[stat]}</div>)}
            </div>
        );
    };

    //Mirror the current editable values for the unmount auto-save (avoids stale-closure reads)
    latestRef.current = { characterName, characterStats, imgUrl, resistances, weaknesses, immunities, classFeature, classStyle, classConfig, characterStorage };

    return (
        <div className="character-design d-flex flex-column align-items-center" style={{ marginTop: "6vh", width: "100%", paddingTop: "24px", paddingBottom: "24px" }}>

            {!editingSkills && (
            <div style={{ width: "100%", maxWidth: "880px" }}>
              {/* Compact card grid - identity, class option, stats and defenses wrap side by side */}
              <Row className="g-3 justify-content-center">

                {/* Identity - name, portrait, image upload */}
                <Col xs="auto">
                  <Card style={{ width: "200px" }}>
                    <CardBody className="text-center">
                    {editNameVis ? (
                        <h1 style={{ cursor: "pointer" }} onClick={() => setEditNameVis(false)}>
                            {characterName}
                        </h1>
                    ) : (
                        <Form.Control
                            type="text"
                            value={characterName}
                            onChange={(e) => setCharacterName(e.target.value)}
                            onBlur={() => { if (characterName.trim() !== "") setEditNameVis(true); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && characterName.trim() !== "") setEditNameVis(true); }}
                            autoFocus
                        />
                    )}

                    {errors.characterName && (<div className="text-danger">{errors.characterName}</div>)}
                    {errors.duplicate && (<div className="text-danger">{errors.duplicate}</div>)}
                    {errors.server && (<div className="text-danger mt-2">{errors.server}</div>)}

                    {/* Uploaded/cropped images are 4:5 (see ImageCropModal), so they fill the 160x200
                        frame with `cover`. The placeholder isn't 4:5, so show it whole with `contain`
                        instead of cropping it. A framed background keeps both looking intentional. */}
                    <img
                        style={{
                            width: "160px", height: "200px", marginTop: "12px",
                            objectFit: (previewUrl || imgUrl) ? "cover" : "contain",
                            borderRadius: "8px", background: "#0d2547",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                        }}
                        src={previewUrl || imgUrl || newCharacterPicture}
                        alt="Character"
                    />

                    {uploading && (<div className="text-warning mt-2">Uploading image...</div>)}

                    {/* Custom file button: the native control squished its "Choose file"/filename text in
                        this narrow card, so hide it and drive it from a full-width, always-readable label. */}
                    <div className="mt-2">
                        <Form.Label className="btn btn-outline-primary btn-sm w-100 mb-0">
                            Choose Image
                            <Form.Control type="file" accept="image/*" onChange={handleImageSelect} className="d-none" />
                        </Form.Label>
                    </div>
                    </CardBody>
                  </Card>
                </Col>

                {/*Class Option - driven by the classFeatures registry (adding a feature there surfaces it here)*/}
                <Col xs="auto">
                    <Card style={{ width: "220px" }}>
                        <CardBody>
                            <h3 className="text-center">Class Option</h3>
                            <Form.Group className="mb-2">
                                <Form.Label>Ability</Form.Label>
                                <Form.Select value={classFeature} onChange={e => handleFeatureChange(e.target.value)}>
                                    <option value="">-- None --</option>
                                    {Object.entries(CLASS_FEATURES).map(([id, f]) => (
                                        <option key={id} value={id}>{f.label}</option>
                                    ))}
                                </Form.Select>
                            </Form.Group>
                            {classFeature && CLASS_FEATURES[classFeature].styles && (
                                <Form.Group className="mb-2">
                                    <Form.Label>Style</Form.Label>
                                    <Form.Select value={classStyle} onChange={e => setClassStyle(e.target.value)}>
                                        <option value="">-- Select style --</option>
                                        {Object.entries(CLASS_FEATURES[classFeature].styles).map(([id, s]) => (
                                            <option key={id} value={id}>{s.label}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                            )}
                            {classFeature && getFeatureConfigFields(classFeature).map(f => (
                                <Form.Group className="mb-2" key={f.key}>
                                    <Form.Label>{f.label}</Form.Label>
                                    <Form.Control
                                        type={f.type === "number" ? "number" : "text"}
                                        value={classConfig[f.key] ?? ""}
                                        placeholder={f.type === "dmgDie" ? "e.g. 2d6" : ""}
                                        onChange={e => setClassConfig(prev => ({ ...prev, [f.key]: e.target.value }))}
                                    />
                                </Form.Group>
                            ))}
                        </CardBody>
                    </Card>
                </Col>

                {/* Stats + Defenses - separate cards in the same wrapping grid */}
                    <Col xs="auto">
                        <Card style={{ width: "200px" }}>
                            <CardBody>
                                <h3 className="text-center">Stats</h3>
                                {renderStatForms("str")}
                                {renderStatForms("strHit")}
                                {renderStatForms("dexHit")}
                                {renderStatForms("dc")}
                            </CardBody>
                        </Card>
                    </Col>
                    <Col xs="auto">
                        <Card style={{ width: "200px" }}>
                            <CardBody>
                                <h3 className="text-center">Defenses</h3>
                                {renderStatForms("ac")}
                                {renderStatForms("health")}
                                {renderStatForms("fortitude")}
                                {renderStatForms("reflex")}
                                {renderStatForms("will")}
                                <div>
                                    <p style={{ marginBottom: "4px" }}>Resilient Rune</p>
                                    <Form.Control as="select" name="resilient" value={characterStats.resilient ?? 0} onChange={handleStatChange}>
                                        <option value={0}>None</option>
                                        <option value={1}>+1 saves</option>
                                        <option value={2}>+2 saves</option>
                                        <option value={3}>+3 saves</option>
                                    </Form.Control>
                                </div>
                            </CardBody>
                        </Card>
                    </Col>
              </Row>

                {/* Damage modifiers - full-width row beneath, given room to spread out */}
                <div className="mx-auto mt-3 mb-2" style={{ maxWidth: "720px" }}>
                    <DamageModifiers
                        damageTypes={damageTypes}
                        resistances={resistances}
                        setResistances={setResistances}
                        weaknesses={weaknesses}
                        setWeaknesses={setWeaknesses}
                        immunities={immunities}
                        setImmunities={setImmunities}
                    />
                </div>

            </div>
            )}

            {/*Skills section*/}
            <div style={{width:"100%"}}>
                {/*Shows upon edit skills being pressed*/}
                {editingSkills && (
                    <CharacterSkills
                        
                        skills={characterStats.skills}
                        setSkills={(newSkills) => setCharacterStats((prev) => ({ ...prev, skills: newSkills }))}
                        setEditingSkills={setEditingSkills}
                    />
                )}
            </div>

            {/*Edit skills + save, grouped and centered*/}
            <div className="d-flex justify-content-center gap-3 mt-4 mb-5">
                {!editingSkills && (
                    <Button variant="secondary" onClick={() => setEditingSkills(prev => !prev)}>
                        ↪ Edit Skills
                    </Button>
                )}
                <Button style={{ minWidth: "180px" }} variant="success" onClick={handleChangeCharacter}>
                    {isNew ? '✔️ New Character' : '✔️ Edit Character'}
                </Button>
            </div>

            {/*Crop the chosen portrait to the card's 4:5 ratio before uploading*/}
            {cropSrc && (
                <ImageCropModal src={cropSrc} onCancel={cancelCrop} onConfirm={uploadCroppedImage} />
            )}

            {/*After saving an imported character, offer to add its weapons to the arsenal*/}
            {showWeaponsModal && (
                <ImportWeaponsModal
                    weapons={pendingWeapons}
                    strMod={importStrMod}
                    onDone={() => { setShowWeaponsModal(false); navigate("/character-selection"); }}
                />
            )}

        </div>
    );
}

export default CharacterDesign;
