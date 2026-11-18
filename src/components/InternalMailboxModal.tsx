import React, { useMemo, useState } from 'react';
import {
  CheckCheck,
  Inbox,
  Mail,
  Reply,
  Search,
  Send,
} from 'lucide-react';
import {
  addLog,
  canUserSeeMessage,
  fullDate,
  getUserStoreIds,
  matchesQuery,
} from '../store';
import type { InternalMessage, PosDatabase, User } from '../types';
import { Modal } from './Modals';

interface InternalMailboxModalProps {
  db: PosDatabase;
  upd: (fn: (draft: PosDatabase) => PosDatabase) => void;
  user: User;
  allowedStoreIds: number[];
  activeStoreId?: number;
  notify: (msg: string) => void;
  onClose: () => void;
}

type MailTab = 'inbox' | 'sent' | 'compose';
type ComposeTargetMode =
  | 'user'
  | 'store_staff'
  | 'all_managers'
  | 'all_employees'
  | 'all';

export const InternalMailboxModal: React.FC<InternalMailboxModalProps> = ({
  db,
  upd,
  user,
  allowedStoreIds,
  activeStoreId,
  notify,
  onClose,
}) => {
  const [mailTab, setMailTab] = useState<MailTab>('inbox');
  const [query, setQuery] = useState('');
  const [selectedMsgId, setSelectedMsgId] = useState<number | null>(null);

  // Compose state
  const [targetMode, setTargetMode] = useState<ComposeTargetMode>('user');
  const [recipientUserId, setRecipientUserId] = useState<string>('');
  const [targetStoreId, setTargetStoreId] = useState<number>(
    activeStoreId ?? allowedStoreIds[0] ?? db.stores[0]?.id ?? 1
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important'>('normal');
  const [replyToId, setReplyToId] = useState<number | undefined>(undefined);

  const getStoreName = (id?: number) =>
    id !== undefined
      ? db.stores.find((s) => s.id === id)?.name ?? 'فرع'
      : 'جميع الفروع';

  const accessibleStores = useMemo(
    () => db.stores.filter((s) => allowedStoreIds.includes(s.id)),
    [db.stores, allowedStoreIds]
  );

  // Possible individual recipients based on sender role
  const availableRecipients = useMemo(() => {
    return db.users.filter((u) => {
      if (u.id === user.id) return false;
      if (user.owner) return true;
      if (user.role === 'manager') {
        if (u.owner || u.role === 'manager') return true;
        const uStores = getUserStoreIds(u, db.stores);
        return uStores.some((sid) => allowedStoreIds.includes(sid));
      }
      // Employee can message Owner, Managers, or colleagues in their assigned branch(es)
      if (u.owner) return true;
      const uStores = getUserStoreIds(u, db.stores);
      return uStores.some((sid) => allowedStoreIds.includes(sid));
    });
  }, [db.users, db.stores, user, allowedStoreIds]);

  const effectiveRecipientId = useMemo(() => {
    if (
      recipientUserId &&
      availableRecipients.some((u) => String(u.id) === recipientUserId)
    ) {
      return Number(recipientUserId);
    }
    return availableRecipients[0]?.id ?? 0;
  }, [recipientUserId, availableRecipients]);

  const inboxMessages = useMemo(() => {
    return (db.messages ?? [])
      .filter(
        (m) =>
          m.senderId !== user.id &&
          canUserSeeMessage(m, user, allowedStoreIds) &&
          (!query.trim() ||
            matchesQuery(`${m.subject} ${m.body} ${m.senderName}`, query))
      )
      .slice()
      .sort((a, b) => b.ts - a.ts);
  }, [db.messages, user, allowedStoreIds, query]);

  const sentMessages = useMemo(() => {
    return (db.messages ?? [])
      .filter(
        (m) =>
          m.senderId === user.id &&
          (!query.trim() ||
            matchesQuery(
              `${m.subject} ${m.body} ${m.recipientName ?? ''}`,
              query
            ))
      )
      .slice()
      .sort((a, b) => b.ts - a.ts);
  }, [db.messages, user.id, query]);

  const unreadInboxCount = useMemo(
    () =>
      (db.messages ?? []).filter(
        (m) =>
          m.senderId !== user.id &&
          canUserSeeMessage(m, user, allowedStoreIds) &&
          !m.readByUserIds.includes(user.id)
      ).length,
    [db.messages, user, allowedStoreIds]
  );

  const openMessage = (msg: InternalMessage) => {
    setSelectedMsgId(msg.id);
    if (msg.senderId !== user.id && !msg.readByUserIds.includes(user.id)) {
      upd((d) => {
        const target = (d.messages ?? []).find((x) => x.id === msg.id);
        if (target && !target.readByUserIds.includes(user.id)) {
          target.readByUserIds = [...target.readByUserIds, user.id];
        }
        return d;
      });
    }
  };

  const markAllInboxRead = () => {
    const unreadIds = new Set(
      inboxMessages
        .filter((m) => !m.readByUserIds.includes(user.id))
        .map((m) => m.id)
    );
    if (unreadIds.size === 0) return;
    upd((d) => {
      (d.messages ?? []).forEach((m) => {
        if (unreadIds.has(m.id) && !m.readByUserIds.includes(user.id)) {
          m.readByUserIds = [...m.readByUserIds, user.id];
        }
      });
      return d;
    });
    notify('تم تحديد جميع الرسائل الواردة كمقروءة');
  };

  const startReply = (msg: InternalMessage) => {
    setTargetMode('user');
    setRecipientUserId(String(msg.senderId));
    setSubject(
      msg.subject.startsWith('رد:') ? msg.subject : `رد: ${msg.subject}`
    );
    setBody('');
    setReplyToId(msg.id);
    setPriority('normal');
    setMailTab('compose');
  };

  const describeRecipient = (m: InternalMessage): string => {
    switch (m.recipientType) {
      case 'all':
        return 'جميع المستخدمين';
      case 'all_managers':
        return 'جميع المدراء';
      case 'all_employees':
        return 'جميع الموظفين';
      case 'store_staff':
        return `موظفي ${getStoreName(m.storeId)}`;
      case 'user':
      default:
        return m.recipientName || 'مستلم محدد';
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSubject = subject.trim();
    const cleanBody = body.trim();
    if (!cleanSubject) {
      notify('أدخل عنوان الرسالة');
      return;
    }
    if (!cleanBody) {
      notify('اكتب نص الرسالة');
      return;
    }
    if (targetMode === 'user' && !effectiveRecipientId) {
      notify('اختر المستلم أولاً');
      return;
    }

    const targetUser =
      targetMode === 'user'
        ? db.users.find((u) => u.id === effectiveRecipientId)
        : undefined;

    const msgStoreId =
      targetMode === 'store_staff'
        ? targetStoreId
        : activeStoreId ?? (targetUser?.storeIds?.[0] ?? targetUser?.storeId);

    upd((d) => {
      if (!Array.isArray(d.messages)) d.messages = [];
      const newMsg: InternalMessage = {
        id: d.nid++,
        senderId: user.id,
        senderName: user.name,
        senderRole: user.owner ? 'owner' : user.role,
        recipientType: targetMode,
        recipientUserId: targetMode === 'user' ? targetUser?.id : undefined,
        recipientName: targetMode === 'user' ? targetUser?.name : undefined,
        storeId: msgStoreId,
        subject: cleanSubject,
        body: cleanBody,
        priority,
        replyToId,
        ts: Date.now(),
        readByUserIds: [user.id],
      };
      d.messages.unshift(newMsg);
      d.messages = d.messages.slice(0, 300);

      addLog(
        d,
        user.name,
        `رسالة داخلية إلى ${describeRecipient(newMsg)}: ${cleanSubject}`,
        msgStoreId,
        {
          category: 'message',
          title: 'رسالة بريد داخلي',
          important: priority === 'important',
        }
      );
      return d;
    });

    notify('تم إرسال الرسالة بنجاح');
    setSubject('');
    setBody('');
    setReplyToId(undefined);
    setPriority('normal');
    setMailTab('sent');
  };

  const displayedList = mailTab === 'inbox' ? inboxMessages : sentMessages;
  const selectedMsg =
    displayedList.find((m) => m.id === selectedMsgId) ??
    displayedList[0] ??
    null;

  return (
    <Modal
      title="صندوق الرسائل والبريد الداخلي للنظام"
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Top Bar: Tabs + Search + Mark All Read */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => {
                setMailTab('inbox');
                setSelectedMsgId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                mailTab === 'inbox'
                  ? 'bg-[#38608f] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Inbox className="h-3.5 w-3.5" />
              <span className="font-num">
                الوارد{unreadInboxCount > 0 ? ` (${unreadInboxCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMailTab('sent');
                setSelectedMsgId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                mailTab === 'sent'
                  ? 'bg-[#38608f] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              <span className="font-num">المرسل ({sentMessages.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setReplyToId(undefined);
                setMailTab('compose');
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                mailTab === 'compose'
                  ? 'bg-emerald-600 text-white'
                  : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40'
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>رسالة جديدة</span>
            </button>
          </div>

          {mailTab !== 'compose' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="بحث في الرسائل..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-xs focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              {mailTab === 'inbox' && unreadInboxCount > 0 && (
                <button
                  type="button"
                  onClick={markAllInboxRead}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
                >
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>قراءة الكل</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Compose Form */}
        {mailTab === 'compose' ? (
          <form
            onSubmit={handleSendMessage}
            className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/70"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  نوع الإرسال
                </label>
                <select
                  value={targetMode}
                  onChange={(e) =>
                    setTargetMode(e.target.value as ComposeTargetMode)
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="user">رسالة خاصة لشخص محدد</option>
                  {(user.owner || user.role === 'manager') && (
                    <>
                      <option value="store_staff">طاقم فرع محدد</option>
                      <option value="all_employees">جميع الموظفين</option>
                    </>
                  )}
                  {user.owner && (
                    <>
                      <option value="all_managers">جميع المدراء</option>
                      <option value="all">تعميم للجميع (مدراء وموظفون)</option>
                    </>
                  )}
                </select>
              </div>

              {targetMode === 'user' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    اختر المستلم
                  </label>
                  <select
                    value={effectiveRecipientId}
                    onChange={(e) => setRecipientUserId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {availableRecipients.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} (
                        {u.owner ? 'مالك' : u.role === 'manager' ? 'مدير' : 'موظف'}
                        )
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetMode === 'store_staff' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    اختر الفرع المستهدف
                  </label>
                  <select
                    value={targetStoreId}
                    onChange={(e) => setTargetStoreId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {accessibleStores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  عنوان الرسالة
                </label>
                <input
                  placeholder="مثال: تنبيه بخصوص جرد المساء / تعليمات تسعير..."
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  الأهمية
                </label>
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as 'normal' | 'important')
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="normal">عادية</option>
                  <option value="important">مهمة / عاجلة</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                نص الرسالة
              </label>
              <textarea
                rows={4}
                placeholder="اكتب رسالتك بوضوح هنا..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#38608f] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMailTab('inbox')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" />
                <span>إرسال الرسالة</span>
              </button>
            </div>
          </form>
        ) : displayedList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {mailTab === 'inbox'
              ? 'صندوق الوارد فارغ حالياً'
              : 'لم تقم بإرسال أي رسائل داخلية بعد'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Message List */}
            <div className="md:col-span-5 max-h-[380px] space-y-1.5 overflow-y-auto pl-1">
              {displayedList.map((m) => {
                const isUnread =
                  mailTab === 'inbox' && !m.readByUserIds.includes(user.id);
                const isActive = selectedMsg?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => openMessage(m)}
                    className={`w-full rounded-xl border p-3 text-right transition-colors ${
                      isActive
                        ? 'border-[#38608f] bg-[#38608f]/10 dark:border-[#6aa0db] dark:bg-[#38608f]/20'
                        : isUnread
                          ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/30'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-bold text-slate-900 dark:text-slate-100">
                        {mailTab === 'inbox'
                          ? m.senderName
                          : `إلى: ${describeRecipient(m)}`}
                      </span>
                      <span className="font-num text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {fullDate(m.ts)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs font-semibold text-[#38608f] dark:text-[#98c1f0]">
                      {m.priority === 'important' ? 'مهم · ' : ''}
                      {m.subject}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {m.body}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Selected Message Reader */}
            <div className="md:col-span-7 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              {selectedMsg ? (
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                          {selectedMsg.subject}
                        </h3>
                        {selectedMsg.priority === 'important' && (
                          <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                            رسالة مهمة
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          من:{' '}
                          <strong className="text-slate-800 dark:text-slate-200">
                            {selectedMsg.senderName}
                          </strong>{' '}
                          (
                          {selectedMsg.senderRole === 'owner'
                            ? 'مالك'
                            : selectedMsg.senderRole === 'manager'
                              ? 'مدير'
                              : 'موظف'}
                          )
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>إلى: {describeRecipient(selectedMsg)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-num">{fullDate(selectedMsg.ts)}</span>
                      </div>
                    </div>

                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                      {selectedMsg.body}
                    </div>
                  </div>

                  {selectedMsg.senderId !== user.id && (
                    <div className="flex justify-end border-t border-slate-200 pt-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => startReply(selectedMsg)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#38608f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d4f77] whitespace-nowrap"
                      >
                        <Reply className="h-3.5 w-3.5" />
                        <span>رد على {selectedMsg.senderName}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="py-12 text-center text-xs text-slate-400">
                  اختر رسالة من القائمة لقراءتها
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
