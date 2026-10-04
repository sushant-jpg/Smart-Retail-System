import { realtime } from "../lib/realtime.js";
import { Notification } from "../models/notification.js";
import { User } from "../models/user.js";

export async function notifyLowStock(input: { storeId: string; productId: string; productName: string; availableQuantity: number; reorderLevel: number }) {
  const recipients = await User.find({ role: "STORE_MANAGER", storeIds: input.storeId, status: "ACTIVE" }).select("_id").lean();
  for (const recipient of recipients) {
    const existing = await Notification.exists({
      recipient: recipient._id, type: "LOW_STOCK", readAt: { $exists: false },
      "data.storeId": input.storeId, "data.productId": input.productId,
    });
    if (existing) continue;
    const notification = await Notification.create({
      recipient: recipient._id, type: "LOW_STOCK", title: "Low stock requires attention",
      message: `${input.productName} has ${input.availableQuantity} units remaining.`, data: input,
    });
    realtime.publish({ userId: String(recipient._id), name: "notification.created", payload: notification.toObject() as Record<string, unknown> });
  }
  realtime.publish({ room: `store:${input.storeId}`, name: "stock.low", payload: input });
}
