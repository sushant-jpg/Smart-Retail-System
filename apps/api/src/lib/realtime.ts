import { EventEmitter } from "node:events";

export type RealtimeEvent = {
  room?: string;
  userId?: string;
  name: "inventory.updated" | "sale.completed" | "stock.low" | "order.updated" | "refund.updated" | "notification.created";
  payload: Record<string, unknown>;
};

class RealtimeBus extends EventEmitter {
  publish(event: RealtimeEvent) {
    this.emit("event", event);
  }
}

export const realtime = new RealtimeBus();
