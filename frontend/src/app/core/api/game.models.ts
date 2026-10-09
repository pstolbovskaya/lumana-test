export interface CheapSharkDealDto {
  internalName?: string;
  title: string;
  dealID: string;
  storeID: string;
  gameID: string;
  salePrice: string;
  normalPrice: string;
  isOnSale: string;
  savings: string;
  metacriticScore: string;
  steamRatingText: string | null;
  steamRatingPercent: string;
  steamRatingCount: string;
  steamAppID: string | null;
  releaseDate: number;
  lastChange?: number;
  dealRating: string;
  thumb: string;
}

export interface Game {
  id: string;
  cheapSharkId: string;
  steamAppId: string | null;
  title: string;
  dealId: string;
  storeId: string;
  salePrice: number;
  normalPrice: number;
  savings: number;
  isOnSale: boolean;
  metacriticScore: number | null;
  steamRatingText: string | null;
  steamRatingPercent: number | null;
  steamRatingCount: number | null;
  releaseYear: number | null;
  thumb: string | null;
}

export interface SearchPage {
  query: string;
  page: number;
  items: Game[];
  totalPages: number;
}
