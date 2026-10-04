import mongoose, { Types, type ClientSession } from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/audit-log.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/loyalty.js";

async function expireForCustomer(customerId: string, now: Date, session: ClientSession) {
  const account = await LoyaltyAccount.findOne({ customer: customerId }).session(session);
  if (!account) return 0;
  const grants = await LoyaltyTransaction.find({
    account: account._id,
    type: "EARN",
    expiresAt: { $lte: now },
    expiredAt: { $exists: false },
    remainingPoints: { $gt: 0 },
  }).sort({ expiresAt: 1, createdAt: 1 }).session(session);
  if (!grants.length) return 0;

  const grantTotal = grants.reduce((sum, grant) => sum + (grant.remainingPoints ?? 0), 0);
  const expiredPoints = Math.min(account.pointsBalance, grantTotal);
  await LoyaltyTransaction.updateMany(
    { _id: { $in: grants.map((grant) => grant._id) }, expiredAt: { $exists: false } },
    { $set: { remainingPoints: 0, expiredAt: now } },
    { session },
  );
  if (!expiredPoints) return 0;
  account.pointsBalance -= expiredPoints;
  await account.save({ session });
  const referenceId = new Types.ObjectId();
  await LoyaltyTransaction.create([{
    account: account._id,
    customer: customerId,
    type: "EXPIRE",
    points: -expiredPoints,
    balanceAfter: account.pointsBalance,
    referenceType: "LoyaltyExpiryRun",
    referenceId,
    note: "Unused earned points expired",
  }], { session });
  await AuditLog.create([{
    actor: customerId,
    actorRole: "SYSTEM",
    action: "LOYALTY_POINTS_EXPIRED",
    resource: "LoyaltyAccount",
    resourceId: String(account._id),
    newValue: { points: -expiredPoints, balanceAfter: account.pointsBalance },
    requestId: `loyalty-expiry:${referenceId}`,
  }], { session });
  return expiredPoints;
}

export async function expireCustomerLoyaltyPoints(customerId: string, now = new Date(), existingSession?: ClientSession) {
  if (existingSession) return expireForCustomer(customerId, now, existingSession);
  const session = await mongoose.startSession();
  try {
    let expired = 0;
    await session.withTransaction(async () => { expired = await expireForCustomer(customerId, now, session); });
    return expired;
  } finally { await session.endSession(); }
}

export async function processExpiredLoyaltyPoints(now = new Date(), limit = 500) {
  const customers = await LoyaltyTransaction.distinct("customer", {
    type: "EARN", expiresAt: { $lte: now }, expiredAt: { $exists: false }, remainingPoints: { $gt: 0 },
  });
  let expiredPoints = 0;
  let processedCustomers = 0;
  for (const customer of customers.slice(0, limit)) {
    const expired = await expireCustomerLoyaltyPoints(String(customer), now);
    if (expired) { expiredPoints += expired; processedCustomers += 1; }
  }
  return { processedCustomers, expiredPoints };
}

export async function consumeEarnedLoyaltyPoints(accountId: Types.ObjectId, points: number, session: ClientSession) {
  let remaining = points;
  if (!remaining) return;
  const grants = await LoyaltyTransaction.find({
    account: accountId, type: "EARN", expiredAt: { $exists: false }, remainingPoints: { $gt: 0 },
  }).sort({ expiresAt: 1, createdAt: 1 }).session(session);
  for (const grant of grants) {
    if (!remaining) break;
    const used = Math.min(remaining, grant.remainingPoints ?? 0);
    if (!used) continue;
    await LoyaltyTransaction.updateOne({ _id: grant._id }, { $inc: { remainingPoints: -used } }, { session });
    remaining -= used;
  }
}

export function startLoyaltyExpiryWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processExpiredLoyaltyPoints();
      if (result.processedCustomers) console.info(JSON.stringify({ level: "info", event: "loyalty.expired", ...result }));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "loyalty.expiry_failed", error: error instanceof Error ? error.message : String(error) }));
    } finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), env.LOYALTY_EXPIRY_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
