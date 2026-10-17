/** Shape returned by GET /bazi/cities (Python) and /api/bazi/cities (Next). */
export interface CityHit {
  id: string;
  name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
  /** The other spelling that matched, when it is not the name (e.g. Urumqi for UEruemqi). */
  alias?: string | null;
}
