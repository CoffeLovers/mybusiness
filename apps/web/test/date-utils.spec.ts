import { describe, expect, it } from 'vitest';
import { detectPreset, formatBucketLabel, getPresetDates } from '../lib/date-utils';

describe('date-utils', () => {
  const ref = new Date('2026-10-30T12:00:00.000Z');

  it('calcula preset de 30 días correctamente', () => {
    const dates = getPresetDates('30d', ref);
    expect(dates.to).toBe('2026-10-30');
    expect(dates.from).toBe('2026-10-01');
  });

  it('calcula preset de 90 días correctamente', () => {
    const dates = getPresetDates('90d', ref);
    expect(dates.to).toBe('2026-10-30');
    expect(dates.from).toBe('2026-08-02');
  });

  it('calcula preset de año actual (ytd) correctamente', () => {
    const dates = getPresetDates('ytd', ref);
    expect(dates.to).toBe('2026-10-30');
    expect(dates.from).toBe('2026-01-01');
  });

  it('detecta preset coincidente o custom', () => {
    expect(detectPreset('2026-10-01', '2026-10-30', ref)).toBe('30d');
    expect(detectPreset('2026-08-02', '2026-10-30', ref)).toBe('90d');
    expect(detectPreset('2026-01-01', '2026-10-30', ref)).toBe('ytd');
    expect(detectPreset('2026-05-01', '2026-05-15', ref)).toBe('custom');
  });

  it('formatea etiquetas de bucket diarias y mensuales', () => {
    const dailyLabel = formatBucketLabel('2026-10-15', false, 'es-ES');
    expect(dailyLabel.toLowerCase()).toContain('15');
    expect(dailyLabel.toLowerCase()).toContain('oct');

    const monthlyLabel = formatBucketLabel('2026-01-01', true, 'es-ES');
    expect(monthlyLabel.toLowerCase()).toContain('2026');
  });
});
