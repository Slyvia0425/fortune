/** Shape returned by GET /bazi/lunar-date (Python) and /api/bazi/lunar (Next). */
export interface LunarCheck {
  valid: boolean;
  solar_date: string | null;
  message: string | null;
}
