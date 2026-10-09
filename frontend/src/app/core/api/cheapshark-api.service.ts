import { HttpClient, HttpParameterCodec, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  CHEAPSHARK_BASE_URL,
  SEARCH_PAGE_SIZE,
  TOTAL_PAGES_HEADER,
  buildDealsParams,
  parseTotalPages,
} from './cheapshark-query';
import { toGame } from './game-mapping';
import { CheapSharkDealDto, SearchPage } from './game.models';

class StrictParamCodec implements HttpParameterCodec {
  encodeKey = encodeURIComponent;
  encodeValue = encodeURIComponent;
  decodeKey = decodeURIComponent;
  decodeValue = decodeURIComponent;
}

const CODEC = new StrictParamCodec();

@Injectable({ providedIn: 'root' })
export class CheapSharkApiService {
  private readonly http = inject(HttpClient);

  search(query: string, page: number, pageSize = SEARCH_PAGE_SIZE): Observable<SearchPage> {
    let params = new HttpParams({ encoder: CODEC });
    for (const [key, value] of buildDealsParams(query, page, pageSize)) {
      params = params.append(key, value);
    }
    return this.http
      .get<CheapSharkDealDto[]>(`${CHEAPSHARK_BASE_URL}/deals`, { params, observe: 'response', cache: 'no-store' })
      .pipe(
        map((res) => {
          const rows = Array.isArray(res.body) ? res.body : [];
          return {
            query,
            page,
            items: rows.map(toGame),
            totalPages: parseTotalPages(res.headers.get(TOTAL_PAGES_HEADER), page, rows.length, pageSize),
          };
        }),
      );
  }
}
