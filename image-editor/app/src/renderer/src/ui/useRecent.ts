import { useEffect, useState } from 'react';
import type { RecentItem } from '@shared/ipc-contract';
import { api, events } from '../lib/api';

/** The recent-files list (FR-GEN-08), refreshed whenever main reports a change. */
export function useRecent(): RecentItem[] {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    const refresh = () => void api.recent.list().then(setItems, () => undefined);
    refresh();
    return events.onRecentChanged(refresh);
  }, []);
  return items;
}
