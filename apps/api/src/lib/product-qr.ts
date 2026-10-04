import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./app-error.js";

const signature = (version: number, publicId: string) =>
  createHmac("sha256", env.QR_SIGNING_SECRET).update(`${version}:${publicId}`).digest("base64url").slice(0, 22);

export const createProductQrPayload = (version: number, publicId: string) =>
  `sr:v${version}:${publicId}:${signature(version, publicId)}`;

export function parseProductQrPayload(payload: string) {
  const match = /^sr:v(\d+):([a-zA-Z0-9_-]{8,100}):([a-zA-Z0-9_-]{22})$/.exec(payload);
  if (!match?.[1] || !match[2] || !match[3]) throw new AppError(422, "QR_INVALID", "QR code is malformed");
  const version = Number(match[1]);
  if (version !== 1) throw new AppError(422, "QR_VERSION_UNSUPPORTED", "QR code version is not supported");
  const expected = Buffer.from(signature(version, match[2]));
  const actual = Buffer.from(match[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new AppError(422, "QR_SIGNATURE_INVALID", "QR code signature is invalid");
  return { version, publicId: match[2] };
}
