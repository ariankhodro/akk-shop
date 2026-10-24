import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, trim: true, maxlength: 120, default: "Unknown admin" },
    actorRole: { type: String, trim: true, maxlength: 40, default: "" },
    action: { type: String, required: true, trim: true, maxlength: 120 },
    targetType: { type: String, required: true, trim: true, maxlength: 80 },
    targetId: { type: String, trim: true, maxlength: 80, default: "" },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, trim: true, maxlength: 64, default: "" },
    userAgent: { type: String, trim: true, maxlength: 256, default: "" },
    requestMethod: { type: String, trim: true, maxlength: 12, default: "" },
    requestPath: { type: String, trim: true, maxlength: 300, default: "" },
    requestId: { type: String, trim: true, maxlength: 160, default: "" },
    requestHost: { type: String, trim: true, maxlength: 200, default: "" },
    requestOrigin: { type: String, trim: true, maxlength: 200, default: "" },
    refererPath: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
