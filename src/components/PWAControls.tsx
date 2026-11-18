import React, { useEffect, useState } from 'react';
import { CloudOff, Download, RefreshCw, Share2, Wifi } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const useOnlineStatus = (): boolean => {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
};

export const PWAInstallButton: React.FC<{ notify?: (msg: string) => void }> = ({
  notify,
}) => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((navigator as { standalone?: boolean }).standalone)
      : false
  );
  const [iosHintOpen, setIosHintOpen] = useState(false);

  const isIos =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      notify?.('تم تثبيت التطبيق على الجهاز للعمل السريع والأوفلاين');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [notify]);

  if (isStandalone) return null;

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={async () => {
          await deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            setDeferredPrompt(null);
          }
        }}
        className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#38608f]/40 bg-[#38608f]/10 px-3 py-1.5 text-xs font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0] whitespace-nowrap shrink-0"
      >
        <Download className="h-3.5 w-3.5" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIos) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setIosHintOpen((v) => !v)}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>تثبيت على الآيفون</span>
        </button>
        {iosHintOpen && (
          <div className="absolute left-0 top-11 z-40 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            اضغط على زر المشاركة أسفل المتصفح ثم اختر{' '}
            <strong>إضافة إلى الشاشة الرئيسية</strong> للعمل كتطبيق كامل بدون نت.
          </div>
        )}
      </div>
    );
  }

  return null;
};

interface ConnectivitySyncBadgeProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  hasGoogleToken: boolean;
  trustedEmail?: string | null;
  onSyncNow?: () => void;
}

export const ConnectivitySyncBadge: React.FC<ConnectivitySyncBadgeProps> = ({
  isOnline,
  pendingCount,
  isSyncing,
  hasGoogleToken,
  trustedEmail,
  onSyncNow,
}) => {
  if (!isOnline) {
    return (
      <div
        className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 whitespace-nowrap shrink-0"
        title="جميع العمليات محفوظة محلياً وستنتقل تلقائياً لـ Google Sheets فور توفر الإنترنت"
      >
        <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-num">
          وضع أوفلاين
          {pendingCount > 0 ? ` · ${pendingCount} بانتظار النت` : ' · حفظ محلي'}
        </span>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <button
        type="button"
        onClick={onSyncNow}
        disabled={isSyncing || (!hasGoogleToken && !trustedEmail)}
        className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#38608f]/40 bg-[#38608f]/10 px-2.5 py-1.5 text-xs font-semibold text-[#38608f] transition-colors hover:bg-[#38608f]/20 disabled:opacity-60 dark:border-[#78a8de]/40 dark:bg-[#38608f]/25 dark:text-[#98c1f0] whitespace-nowrap shrink-0"
        title={
          hasGoogleToken || trustedEmail
            ? 'اضغط لمزامنة العمليات المعلقة الآن'
            : 'اربط حساب المالك لمرة واحدة من تبويب Google Sheets لمزامنة البيانات المعلقة'
        }
      >
        <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
        <span className="font-num">
          {isSyncing
            ? 'جاري رفع البيانات...'
            : `بانتظار المزامنة (${pendingCount})`}
        </span>
      </button>
    );
  }

  return (
    <div
      className="hidden sm:flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-nowrap shrink-0"
      title={trustedEmail ? `حساب المالك الموثوق: ${trustedEmail}` : undefined}
    >
      <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>
        {isSyncing
          ? 'جاري المزامنة...'
          : hasGoogleToken
            ? 'متصل ومربوط بـ Sheets'
            : trustedEmail
              ? 'متصل (حساب موثوق)'
              : 'متصل'}
      </span>
    </div>
  );
};
