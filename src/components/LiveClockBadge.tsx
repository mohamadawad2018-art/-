import React, { useEffect, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { formatGregorianParts } from '../store';

export const LiveClockBadge: React.FC = () => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { weekday, dateNumeric, time12 } = formatGregorianParts(now);

  return (
    <div
      aria-label="اليوم والتاريخ والساعة"
      className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <Calendar className="h-3.5 w-3.5 text-[#38608f] dark:text-[#78a8de] shrink-0" />
        <span className="font-bold text-slate-900 dark:text-slate-100">
          {weekday}
        </span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="font-num font-semibold" dir="ltr">
          {dateNumeric} م
        </span>
      </div>
      <span className="text-slate-300 dark:text-slate-600">|</span>
      <div className="flex items-center gap-1 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="font-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
          {time12}
        </span>
      </div>
    </div>
  );
};
