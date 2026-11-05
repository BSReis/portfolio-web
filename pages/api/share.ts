import { del, get, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import * as LZString from "lz-string";
import { decodePortfolioShare } from "../../src/utils/sharePortfolio";

const MAX_PAYLOAD_LENGTH = 60_000;
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_ID_PATTERN = /^[a-f0-9]{32}$/;
const PERIOD_COUNT = 7;

type ShareRequest = {
  payload?: unknown;
};

type StoredShare = {
  version: 1;
  payload: string;
  expiresAt: number;
};

function isValidSharePayload(payload: string): boolean {
  if (!payload || payload.length > MAX_PAYLOAD_LENGTH) return false;
  if (payload.startsWith("1.")) return decodePortfolioShare(payload) !== null;
  if (!payload.startsWith("4.")) return false;
  try {
    const decoded = LZString.decompressFromEncodedURIComponent(
      payload.slice(2),
    );
    if (!decoded) return false;
    const value = JSON.parse(decoded) as Record<string, unknown>;
    return (
      value.v === 2 &&
      value.q === 1 &&
      typeof value.n === "string" &&
      typeof value.d === "string" &&
      typeof value.c === "string" &&
      Array.isArray(value.p) &&
      value.p.length > 0 &&
      value.p.length <= 100 &&
      Array.isArray(value.r) &&
      value.r.length === PERIOD_COUNT
    );
  } catch {
    return false;
  }
}

const sharePath = (id: string) => `portfolio-shares/${id}.json`;

export const config = {
  api: { bodyParser: { sizeLimit: "80kb" } },
};

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "POST") {
    const payload = (request.body as ShareRequest | undefined)?.payload;
    if (typeof payload !== "string" || !isValidSharePayload(payload))
      return response
        .status(400)
        .json({ error: "Invalid portfolio snapshot." });

    const id = randomBytes(16).toString("hex");
    const record: StoredShare = {
      version: 1,
      payload,
      expiresAt: Date.now() + SHARE_TTL_MS,
    };
    try {
      await put(sharePath(id), JSON.stringify(record), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return response.status(201).json({ id, expiresAt: record.expiresAt });
    } catch {
      return response
        .status(503)
        .json({ error: "Portfolio sharing storage is unavailable." });
    }
  }

  if (request.method === "GET") {
    const id = request.query.id;
    if (typeof id !== "string" || !SHARE_ID_PATTERN.test(id))
      return response.status(400).json({ error: "Invalid share ID." });

    try {
      const blob = await get(sharePath(id), {
        access: "private",
        useCache: false,
      });
      if (!blob || blob.statusCode !== 200 || !blob.stream)
        return response
          .status(404)
          .json({ error: "Shared portfolio not found." });

      const record = JSON.parse(
        await new Response(blob.stream).text(),
      ) as StoredShare;
      if (
        record.version !== 1 ||
        typeof record.payload !== "string" ||
        !Number.isSafeInteger(record.expiresAt)
      )
        return response
          .status(404)
          .json({ error: "Shared portfolio not found." });
      if (record.expiresAt <= Date.now()) {
        await del(sharePath(id)).catch(() => {});
        return response
          .status(410)
          .json({ error: "This share link has expired." });
      }
      if (!isValidSharePayload(record.payload))
        return response
          .status(404)
          .json({ error: "Shared portfolio not found." });
      return response.status(200).json({ payload: record.payload });
    } catch {
      return response
        .status(503)
        .json({ error: "Portfolio sharing storage is unavailable." });
    }
  }

  response.setHeader("Allow", "GET, POST");
  return response.status(405).json({ error: "Method not allowed." });
}
