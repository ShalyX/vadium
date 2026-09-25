// Deterministic inputs for the operator-run risk publisher. All times are Unix seconds.
const calendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short',
  hour: '2-digit', minute: '2-digit',
});

export function localParts(timestamp) {
  const parts = Object.fromEntries(calendar.formatToParts(new Date(timestamp * 1000)).map(({ type, value }) => [type, value]));
  return { dow: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function freshnessBps(ageSeconds, graceSeconds = 90 * 60, maxAgeSeconds = 6 * 60 * 60) {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || maxAgeSeconds <= graceSeconds) return 0;
  if (ageSeconds <= graceSeconds) return 10_000;
  if (ageSeconds >= maxAgeSeconds) return 0;
  return Math.round(10_000 * (maxAgeSeconds - ageSeconds) / (maxAgeSeconds - graceSeconds));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trailingVolume(rows, asOf, windowSeconds) {
  return rows.reduce((sum, [time, , volume = 0]) =>
    time > asOf - windowSeconds && time <= asOf && Number.isFinite(volume) && volume > 0 ? sum + volume : sum, 0);
}

export function liquidityAt(rows, asOf, { windowSeconds = 6 * 3600, lookbackWeeks = 8, minBaseline = 3 } = {}) {
  const slot = localParts(asOf);
  const oldest = asOf - lookbackWeeks * 7 * 86400;
  const baselines = [];
  for (const [time] of rows) {
    if (time < oldest || time >= asOf) continue;
    const candidate = localParts(time);
    if (candidate.dow === slot.dow && candidate.hour === slot.hour && candidate.minute === slot.minute) {
      const volume = trailingVolume(rows, time, windowSeconds);
      if (volume > 0) baselines.push(volume);
    }
  }
  const volumeUsd = trailingVolume(rows, asOf, windowSeconds);
  if (baselines.length < minBaseline) {
    return { scoreBps: 0, volumeUsd, baselineUsd: null, baselineCount: baselines.length };
  }
  const baselineUsd = median(baselines);
  return {
    scoreBps: Math.round(Math.max(0, Math.min(20_000, 10_000 * volumeUsd / baselineUsd))),
    volumeUsd, baselineUsd, baselineCount: baselines.length,
  };
}
