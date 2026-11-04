export interface PortfolioSnapshot {
  v: 1;
  name: string;
  date: string;
  positions: Array<{ symbol: string; name: string; weight: number }>;
}

export interface SharePositionValue {
  symbol: string;
  name: string;
  value: number;
}

export const DEFAULT_PUBLIC_SHARE_URL = "https://portfolio-web-dhqc.vercel.app/share.html";

const MAX_LINK_LENGTH = 12000;

export function createPortfolioSnapshot(
  name: string,
  positions: readonly SharePositionValue[],
  date = new Date().toISOString(),
): PortfolioSnapshot {
  if (!positions.length || positions.length > 100)
    throw new Error("Share between 1 and 100 positions.");
  if (positions.some((position) => !Number.isFinite(position.value) || position.value < 0))
    throw new Error("Current prices and exchange rates are required for every position.");
  const total = positions.reduce((sum, position) => sum + position.value, 0);
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("There are no positions to share.");
  const allocations = positions.filter((position) => position.value > 0).map((position) => {
    const points = position.value / total * 10000;
    return { position, points: Math.floor(points), remainder: points - Math.floor(points) };
  });
  const remaining = 10000 - allocations.reduce((sum, allocation) => sum + allocation.points, 0);
  [...allocations].sort((left, right) => right.remainder - left.remainder)
    .slice(0, remaining).forEach((allocation) => { allocation.points += 1; });
  allocations.sort((left, right) => right.points - left.points);
  const snapshot = readPortfolioSnapshot({
    v: 1, name: name.trim().slice(0, 80), date,
    positions: allocations.map(({ position, points }) => ({
      symbol: position.symbol, name: position.name, weight: points / 100,
    })),
  });
  if (!snapshot) throw new Error("The portfolio snapshot is invalid.");
  return snapshot;
}

export function readPortfolioSnapshot(value: unknown): PortfolioSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1 || typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.length > 80)
    return null;
  if (typeof candidate.date !== "string" || !Number.isFinite(Date.parse(candidate.date))) return null;
  if (!Array.isArray(candidate.positions) || !candidate.positions.length || candidate.positions.length > 100)
    return null;
  const positions: PortfolioSnapshot["positions"] = [];
  for (const value of candidate.positions) {
    if (!value || typeof value !== "object") return null;
    const position = value as Record<string, unknown>;
    if (typeof position.symbol !== "string" || !position.symbol.trim() || position.symbol.length > 40 ||
      typeof position.name !== "string" || !position.name.trim() || position.name.length > 120 ||
      typeof position.weight !== "number" || !Number.isFinite(position.weight) ||
      position.weight < 0 || position.weight > 100 ||
      Math.abs(position.weight * 100 - Math.round(position.weight * 100)) > 0.000001)
      return null;
    positions.push({ symbol: position.symbol, name: position.name, weight: position.weight });
  }
  if (Math.abs(positions.reduce((sum, position) => sum + position.weight, 0) - 100) > 0.001)
    return null;
  if (new Set(positions.map((position) => position.symbol)).size !== positions.length) return null;
  return { v: 1, name: candidate.name, date: new Date(candidate.date).toISOString(), positions };
}

export function encodePortfolioShare(snapshot: PortfolioSnapshot): string {
  const safe = readPortfolioSnapshot(snapshot);
  if (!safe) throw new Error("The portfolio snapshot is invalid.");
  const encoded = encodeURIComponent(JSON.stringify(safe));
  if (encoded.length > MAX_LINK_LENGTH) throw new Error("The portfolio is too large for a share link.");
  return encoded;
}

export function decodePortfolioShare(encoded: string): PortfolioSnapshot | null {
  if (encoded.length > MAX_LINK_LENGTH) return null;
  try {
    return readPortfolioSnapshot(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return null;
  }
}

export function portfolioShareUrl(pageUrl: string, snapshot: PortfolioSnapshot): string {
  let url: URL;
  try {
    url = new URL(pageUrl.trim());
  } catch {
    throw new Error("Set the public share page URL in Settings first.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP or HTTPS share page without credentials.");
  url.search = "";
  url.hash = `d=${encodePortfolioShare(snapshot)}`;
  if (url.toString().length > MAX_LINK_LENGTH)
    throw new Error("The portfolio is too large for a share link.");
  return url.toString();
}
