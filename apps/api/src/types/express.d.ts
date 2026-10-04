import type { Role } from "../lib/permissions.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: Role; storeIds: string[] };
      requestId: string;
    }
  }
}

export {};
