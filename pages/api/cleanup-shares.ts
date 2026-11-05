import { del, list } from "@vercel/blob";
import type { NextApiRequest, NextApiResponse } from "next";

const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_PREFIX = "portfolio-shares/";

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.authorization !== `Bearer ${cronSecret}`)
    return response.status(401).json({ error: "Unauthorized." });
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  try {
    const expiresBefore = Date.now() - SHARE_TTL_MS;
    let cursor: string | undefined;
    let deleted = 0;
    do {
      const page = await list({ prefix: SHARE_PREFIX, limit: 1000, cursor });
      const expired = page.blobs
        .filter((blob) => blob.uploadedAt.getTime() <= expiresBefore)
        .map((blob) => blob.pathname);
      if (expired.length) {
        await del(expired);
        deleted += expired.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return response.status(200).json({ deleted });
  } catch {
    return response.status(503).json({ error: "Share cleanup is unavailable." });
  }
}