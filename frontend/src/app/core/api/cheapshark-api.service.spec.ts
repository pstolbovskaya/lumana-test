import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CheapSharkApiService } from './cheapshark-api.service';
import { dealDto } from './game.fixtures';
import { SearchPage } from './game.models';

describe('CheapSharkApiService', () => {
  let api: CheapSharkApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CheapSharkApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests a 0-based page, maps every deal row and reads total pages from the header', () => {
    let result: SearchPage | undefined;
    api.search('c++ witcher', 2).subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url === 'https://www.cheapshark.com/api/1.0/deals');
    expect(req.request.urlWithParams).toContain('title=c%2B%2B%20witcher');
    expect(req.request.params.get('pageNumber')).toBe('1');
    expect(req.request.cache).toBe('no-store');
    req.flush(
      [
        dealDto({ dealID: 'x', salePrice: '20' }),
        dealDto({ dealID: 'y', salePrice: '15' }),
        dealDto({ gameID: '7', steamAppID: null }),
      ],
      { headers: { 'X-Total-Page-Count': '4' } },
    );
    expect(result?.page).toBe(2);
    expect(result?.totalPages).toBe(5);
    expect(result?.items.map((g) => [g.id, g.dealId])).toEqual([
      ['steam:292030', 'x'],
      ['steam:292030', 'y'],
      ['cs:7', 'deal-1'],
    ]);
  });

  it('returns an empty page for nonsense queries', () => {
    let result: SearchPage | undefined;
    api.search('xqzzvv', 1).subscribe((r) => (result = r));
    http.expectOne(() => true).flush([], { headers: { 'X-Total-Page-Count': '0' } });
    expect(result?.items).toEqual([]);
    expect(result?.totalPages).toBe(0);
  });
});
