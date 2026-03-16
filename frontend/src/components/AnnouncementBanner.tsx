// src/components/AnnouncementBanner.tsx
import { useEffect, useState, useCallback } from 'react';
import { getStoredToken } from '../services/optionlabApi';
import { getAppStatus, Announcement } from '../services/optionlabApi';

const POLL_MS = 5 * 60 * 1000; // 5 minutes
const DISMISSED_KEY = 'optionlab_dismissed_announcements';

function getDismissed(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function saveDismissed(ids: Set<number>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids])); } catch {}
}

const TYPE_STYLES: Record<string, { bar: string; icon: string; label: string }> = {
  critical: { bar: 'bg-red-600 border-red-500',   icon: '🚨', label: 'text-red-100' },
  warning:  { bar: 'bg-amber-600 border-amber-500', icon: '⚠️', label: 'text-amber-100' },
  info:     { bar: 'bg-blue-700 border-blue-600',  icon: 'ℹ️', label: 'text-blue-100' },
};

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);

  const fetchAnnouncements = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    const result = await getAppStatus(token);
    if (!result.success || !result.announcements?.length) return;
    const dismissed = getDismissed();
    setItems(result.announcements.filter(a => !dismissed.has(a.id)));
  }, []);

  useEffect(() => {
    fetchAnnouncements();
    const t = setInterval(fetchAnnouncements, POLL_MS);
    return () => clearInterval(t);
  }, [fetchAnnouncements]);

  const dismiss = (id: number) => {
    const d = getDismissed();
    d.add(id);
    saveDismissed(d);
    setItems(prev => prev.filter(a => a.id !== id));
  };

  if (!items.length) return null;

  return (
    <div className="absolute top-0 left-0 right-0 z-50 flex flex-col gap-px">
      {items.map(a => {
        const s = TYPE_STYLES[a.type] ?? TYPE_STYLES.info;
        return (
          <div
            key={a.id}
            className={`flex items-center gap-3 px-4 py-2 border-b text-sm ${s.bar}`}
          >
            <span className="text-base leading-none">{s.icon}</span>
            <div className="flex-1 min-w-0">
              <span className={`font-semibold mr-2 ${s.label}`}>{a.title}</span>
              <span className="text-white/90">{a.body}</span>
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="ml-2 text-white/60 hover:text-white text-lg leading-none shrink-0"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}