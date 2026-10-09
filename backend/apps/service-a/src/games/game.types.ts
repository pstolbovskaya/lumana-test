import type { ObjectId } from 'mongodb';

export const GAMES_COLLECTION = 'games';

export const STEAMSPY_FIELDS = [
  'appid',
  'name',
  'developer',
  'publisher',
  'score_rank',
  'positive',
  'negative',
  'userscore',
  'owners',
  'average_forever',
  'average_2weeks',
  'median_forever',
  'median_2weeks',
  'price',
  'initialprice',
  'discount',
  'ccu',
] as const;

export type SteamSpyField = (typeof STEAMSPY_FIELDS)[number];
export type RawGame = Partial<Record<SteamSpyField, unknown>> & Record<string, unknown>;

export interface GameData {
  appid: number;
  name: string;
  developer: string | null;
  developerKey: string | null;
  publisher: string | null;
  publisherKey: string | null;
  positive: number;
  negative: number;
  reviewScore: number | null;
  ownersMin: number;
  ownersMax: number;
  averagePlaytime: number;
  medianPlaytime: number;
  priceCents: number | null;
  initialPriceCents: number | null;
  discountPercent: number;
  ccu: number;
  headerImageUrl: string;
  heroImageUrl: string;
}

export interface GameDocument extends GameData {
  _id: ObjectId;
  source: string;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}
