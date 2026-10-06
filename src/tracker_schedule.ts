import type { Env } from './types';

// Starts the spirit-tracker scrape workflow at fixed Pacific times. GitHub's own `schedule:`
// fired 2-5 h late and dropped ~31% of triggers (measured 2026-09-14..10-05), so the tracker
// workflow is dispatch-only and this Worker cron is its clock. The cron fires at :25 and :48
// every hour; matching on Pacific wall time makes it DST-proof (the one cost: 02:48 does not
// exist on the spring-forward day, so that small run is skipped once a year).
//
// Lead times come from measured run durations so the email lands on the hour:
// big ~30 min, small ~10 min, email job ~1 min.
const TRACKER_SLOTS: Record<string, { mode: 'big' | 'small'; vpn: boolean }> = {
  '23:25': { mode: 'big', vpn: false },
  '11:25': { mode: 'big', vpn: false },
  '02:48': { mode: 'small', vpn: true },
  '05:48': { mode: 'small', vpn: true },
  '08:48': { mode: 'small', vpn: true },
  '14:48': { mode: 'small', vpn: true },
  '17:48': { mode: 'small', vpn: true },
  '20:48': { mode: 'small', vpn: true },
};

const PACIFIC_HHMM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function trackerSlotFor(scheduledTimeMs: number): { mode: 'big' | 'small'; vpn: boolean } | null {
  return TRACKER_SLOTS[PACIFIC_HHMM.format(new Date(scheduledTimeMs))] ?? null;
}

// Fire-and-forget: one request, no retries, no KV. A failed dispatch only skips that slot.
export async function dispatchTrackerRun(scheduledTimeMs: number, env: Env): Promise<void> {
  const slot = trackerSlotFor(scheduledTimeMs);
  console.log(`tracker cron: pacific=${PACIFIC_HHMM.format(new Date(scheduledTimeMs))} slot=${slot === null ? 'none' : slot.mode} tokenLen=${env.GH_DISPATCH_TOKEN?.length ?? 'unset'}`);
  if (slot === null) return;

  const res = await fetch(
    'https://api.github.com/repos/brennanwilkes/spirit-tracker/actions/workflows/cron_tracker.yaml/dispatches',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'spirit-tracker-api',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { mode: slot.mode, vpn: String(slot.vpn) } }),
    },
  );
  if (res.status !== 204) {
    throw new Error(`tracker dispatch (${slot.mode}) failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  console.log(`tracker dispatch ok: mode=${slot.mode} vpn=${slot.vpn}`);
}
