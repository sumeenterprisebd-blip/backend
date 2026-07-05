const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
});

counterSchema.statics.getNextSequence = async function (name) {
    const counter = await this.findOneAndUpdate(
        { name },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return counter.seq;
};

module.exports = mongoose.model("Counter", counterSchema);
