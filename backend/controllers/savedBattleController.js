import mongoose from "mongoose";
import SavedBattle from "../models/savedBattleModel.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

//Each user may keep this many saved battles at once; saving past the cap is rejected so the user
//deletes one deliberately rather than silently losing an old battle.
export const MAX_SAVED_BATTLES = 5;

//List metadata only (no heavy `data`) so the picker stays light; full data is fetched on load.
export const listSavedBattles = async (req, res) => {
    try {
        const battles = await SavedBattle.find({ ownerID: req.userID })
            .select("name createdAt updatedAt")
            .sort({ updatedAt: -1 })
            .lean();
        return res.json(battles);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to list saved battles" });
    }
};

export const getSavedBattle = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid battle ID" });
        const battle = await SavedBattle.findOne({ _id: req.params.id, ownerID: req.userID }).lean();
        if (!battle) return res.status(404).json({ message: "Saved battle not found" });
        return res.json(battle);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to load saved battle" });
    }
};

export const createSavedBattle = async (req, res) => {
    try {
        const { name, data } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: "A battle name is required" });
        if (!data || typeof data !== "object") return res.status(400).json({ message: "Battle data is required" });

        const count = await SavedBattle.countDocuments({ ownerID: req.userID });
        if (count >= MAX_SAVED_BATTLES) {
            return res.status(409).json({ message: `You can only keep ${MAX_SAVED_BATTLES} saved battles - delete one first.` });
        }
        const saved = await new SavedBattle({ ownerID: req.userID, name: name.trim(), data }).save();
        return res.status(201).json({ _id: saved._id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to save battle" });
    }
};

//Overwrite an existing slot (resaving a loaded battle) without consuming another of the 5 slots.
export const updateSavedBattle = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid battle ID" });
        const { name, data } = req.body;
        const fields = {};
        if (name && name.trim()) fields.name = name.trim();
        if (data && typeof data === "object") fields.data = data;
        if (Object.keys(fields).length === 0) return res.status(400).json({ message: "Nothing to update" });

        const updated = await SavedBattle.findOneAndUpdate(
            { _id: req.params.id, ownerID: req.userID },
            { $set: fields },
            { new: true, runValidators: true }
        ).select("name createdAt updatedAt");
        if (!updated) return res.status(404).json({ message: "Saved battle not found" });
        return res.json(updated);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to update saved battle" });
    }
};

export const deleteSavedBattle = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid battle ID" });
        const deleted = await SavedBattle.findOneAndDelete({ _id: req.params.id, ownerID: req.userID });
        if (!deleted) return res.status(404).json({ message: "Saved battle not found" });
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to delete saved battle" });
    }
};
