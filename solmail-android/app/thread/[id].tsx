import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { trpc } from '@/src/api/trpc';
import { Avatar } from '@/components/ui/avatar';
import { palette } from '@/constants/colors';

type Recipient = { name?: string; email?: string };

type MessageItem = {
  id: string;
  fromName: string;
  fromEmail: string;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  html: string;
  decodedBody: string;
  snippet: string;
  date: string;
};

/**
 * Wrap the email HTML in a self-styled document so the WebView renders it on
 * a dark background with sane typography. Injected JS reports the document
 * height back to RN so each card sizes itself to its content (no inner scroll).
 */
function buildEmailDoc(innerHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=2"/>
  <style>
    html, body { margin:0; padding:0; background:#12151c; color:#e8edf6;
      font: 15px/1.55 -apple-system, Roboto, "Helvetica Neue", sans-serif;
      word-wrap: break-word; overflow-wrap: anywhere; }
    body { padding: 4px 2px 8px; }
    a { color:#6b9ef5; }
    blockquote { border-left:3px solid #2d3444; margin:8px 0; padding:4px 10px; color:#a4adbd; }
    pre, code { background:#0f1117; color:#e6edfa; border-radius:6px; padding:2px 6px; }
    img, video, iframe { max-width:100% !important; height:auto !important; }
    table { max-width:100% !important; }
    * { max-width: 100%; }
  </style></head><body>${innerHtml}<script>
    (function () {
      function report() {
        var h = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          document.documentElement.offsetHeight,
          document.body.offsetHeight
        );
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'height', value: h }));
        }
      }
      window.addEventListener('load', function () { setTimeout(report, 0); setTimeout(report, 200); });
      var ro = new ResizeObserver(function () { report(); });
      ro.observe(document.documentElement);
      document.querySelectorAll('img').forEach(function (img) {
        img.addEventListener('load', report);
        img.addEventListener('error', report);
      });
    })();
  </script></body></html>`;
}

function formatTime(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullTime(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function recipientLabel(r: Recipient) {
  return r.name?.trim() || r.email?.trim() || '';
}

function shortRecipientLabel(r: Recipient, selfEmail?: string) {
  const email = r.email?.trim().toLowerCase();
  if (selfEmail && email && email === selfEmail.toLowerCase()) return 'me';
  return r.name?.trim() || r.email?.trim() || '';
}

export default function ThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHeaders, setShowHeaders] = useState<Set<string>>(new Set());
  const [topSubject, setTopSubject] = useState<string>('');
  const [labels, setLabels] = useState<string[]>([]);
  const [selfEmail, setSelfEmail] = useState<string>('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bodyHeights, setBodyHeights] = useState<Record<string, number>>({});

  const isStarred = labels.includes('STARRED');
  const isInTrash = labels.includes('TRASH');

  const loadThread = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [data, conn] = await Promise.all([
        trpc.mail.get.query({ id, forceFresh: false }),
        trpc.connections.getDefault.query().catch(() => null as { email?: string } | null),
      ]);
      if (conn?.email) setSelfEmail(conn.email);

      const escapeText = (value: string) =>
        `<div style="white-space:pre-wrap;">${value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</div>`;

      const mapped = await Promise.all(
        (data.messages || []).map(async (msg: Record<string, unknown>) => {
          const sender = msg.sender as Recipient | undefined;
          const fromObj = msg.from as { text?: string; address?: string } | undefined;
          const fromName =
            sender?.name || sender?.email || fromObj?.text || fromObj?.address || 'Unknown';
          const fromEmail = sender?.email || fromObj?.address || '';
          const to = (msg.to as Recipient[] | undefined) ?? [];
          const cc = (msg.cc as Recipient[] | null | undefined) ?? [];
          const bcc = (msg.bcc as Recipient[] | null | undefined) ?? [];

          const subject = (msg.subject as string | undefined) || '(no subject)';

          /**
           * Prefer the server-sanitized processedHtml when present (mail router
           * runs DOMPurify before sending). Fall back to body / decodedBody, and
           * only re-call processEmailContent if we have raw HTML and nothing
           * sanitized yet — this avoids extra round-trips.
           */
          const processedHtml = (msg.processedHtml as string | undefined)?.trim() || '';
          const body = (msg.body as string | undefined)?.trim() || '';
          const decoded = (msg.decodedBody as string | undefined)?.trim() || '';
          let html = processedHtml;
          if (!html && (body || decoded)) {
            const candidate = body || decoded;
            try {
              const processed = await trpc.mail.processEmailContent.mutate({
                html: candidate,
                shouldLoadImages: false,
                theme: 'dark',
              });
              html = (processed?.processedHtml || '').trim();
            } catch {
              html = candidate;
            }
          }
          if (!html) {
            html = escapeText('(empty message)');
          } else if (!/[<>]/.test(html)) {
            html = escapeText(html);
          }

          const snippet = (decoded || body)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);

          return {
            id: String(msg.id || Math.random()),
            fromName,
            fromEmail,
            to,
            cc: cc ?? [],
            bcc: bcc ?? [],
            subject,
            html,
            decodedBody: decoded || body,
            snippet,
            date: (
              (msg.internalDate as string | undefined) ||
              (msg.date as string | undefined) ||
              (msg.receivedOn as string | undefined) ||
              ''
            ).trim(),
          } as MessageItem;
        }),
      );

      const sorted = [...mapped].sort((a, b) => {
        const da = new Date(a.date || 0).getTime();
        const db = new Date(b.date || 0).getTime();
        return da - db;
      });
      setMessages(sorted);
      setTopSubject(sorted[0]?.subject || '(no subject)');
      const last = sorted[sorted.length - 1];
      if (last) setExpanded(new Set([last.id]));

      const threadLabels = (data.labels as { id?: string; name?: string }[] | undefined) ?? [];
      setLabels(threadLabels.map((l) => (l.id || l.name || '').toUpperCase()).filter(Boolean));

      // Auto mark-as-read on open (Gmail behavior).
      if (data.hasUnread) {
        trpc.mail.markAsRead.mutate({ ids: [id] }).catch(() => undefined);
      }
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : 'Unknown thread error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const toggleMessage = (mid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  };

  const toggleHeaders = (mid: string) => {
    setShowHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  };

  const goCompose = (params: Record<string, string>) =>
    router.push({ pathname: '/compose', params });

  const goReply = () => {
    if (!id) return;
    void Haptics.selectionAsync();
    goCompose({ replyThread: String(id), replyMode: 'reply' });
  };
  const goReplyAll = () => {
    if (!id) return;
    void Haptics.selectionAsync();
    goCompose({ replyThread: String(id), replyMode: 'replyAll' });
  };
  const goForward = () => {
    if (!id) return;
    void Haptics.selectionAsync();
    goCompose({ forwardThread: String(id) });
  };

  const runMutation = async (
    label: string,
    action: () => Promise<unknown>,
    afterSuccess: 'back' | 'reload',
  ) => {
    if (!id || busyAction) return;
    setBusyAction(label);
    setActionError(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await action();
      if (afterSuccess === 'back') {
        /**
         * Pass `removedId` so the inbox can drop the thread from its local list
         * immediately — Gmail's modifyLabels reflects almost instantly via
         * rawListThreads, but a tiny propagation delay can make the row linger
         * for one render. The `refresh` ping forces a fresh listThreads call.
         */
        router.replace({
          pathname: '/inbox',
          params: { refresh: String(Date.now()), removedId: String(id) },
        });
      } else {
        await loadThread();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `${label} failed`;
      setActionError(`${label}: ${message}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleArchive = () =>
    runMutation(
      'archive',
      () =>
        trpc.mail.modifyLabels.mutate({
          threadId: [String(id)],
          addLabels: [],
          removeLabels: ['INBOX'],
        }),
      'back',
    );

  const handleTrash = () => {
    if (isInTrash) {
      // Already in trash — second tap permanently deletes.
      Alert.alert('Delete forever?', 'This thread will be permanently deleted.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            runMutation('delete', () => trpc.mail.delete.mutate({ id: String(id) }), 'back'),
        },
      ]);
    } else {
      void runMutation('trash', () => trpc.mail.bulkDelete.mutate({ ids: [String(id)] }), 'back');
    }
  };

  const handleStar = () =>
    runMutation('star', () => trpc.mail.toggleStar.mutate({ ids: [String(id)] }), 'reload');

  const handleMarkUnread = () =>
    runMutation('unread', () => trpc.mail.markAsUnread.mutate({ ids: [String(id)] }), 'back');

  const handleMoveToSpam = () =>
    runMutation(
      'spam',
      () =>
        trpc.mail.modifyLabels.mutate({
          threadId: [String(id)],
          addLabels: ['SPAM'],
          removeLabels: ['INBOX'],
        }),
      'back',
    );

  const handleMute = () =>
    runMutation('mute', () => trpc.mail.bulkMute.mutate({ ids: [String(id)] }), 'back');

  const handleRestoreFromTrash = () =>
    runMutation(
      'restore',
      () =>
        trpc.mail.modifyLabels.mutate({
          threadId: [String(id)],
          addLabels: ['INBOX'],
          removeLabels: ['TRASH'],
        }),
      'back',
    );

  const openMore = () => {
    void Haptics.selectionAsync();
    setMenuOpen(true);
  };

  const runMenuItem = (fn: () => unknown) => {
    setMenuOpen(false);
    setTimeout(() => {
      void fn();
    }, 80);
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} style={styles.headerIcon} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={palette.textSecondary} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={8}
            style={styles.headerIcon}
            onPress={handleArchive}
            disabled={!!busyAction || loading || !!error}
          >
            <Feather
              name="archive"
              size={20}
              color={busyAction ? palette.textFaint : palette.textSecondary}
            />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.headerIcon}
            onPress={handleTrash}
            disabled={!!busyAction || loading || !!error}
          >
            <Feather
              name="trash-2"
              size={20}
              color={busyAction ? palette.textFaint : palette.textSecondary}
            />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.headerIcon}
            onPress={handleStar}
            disabled={!!busyAction || loading || !!error}
          >
            <Feather
              name="star"
              size={20}
              color={isStarred ? palette.star : palette.textSecondary}
            />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.headerIcon}
            onPress={openMore}
            disabled={!!busyAction || loading || !!error}
          >
            <Feather name="more-vertical" size={20} color={palette.textSecondary} />
          </Pressable>
        </View>

        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
            <View style={styles.menuBackdrop}>
              <TouchableWithoutFeedback>
                <View style={styles.menuPopover}>
                  {isInTrash && (
                    <MenuItem
                      icon="inbox"
                      label="Move to Inbox"
                      onPress={() => runMenuItem(handleRestoreFromTrash)}
                    />
                  )}
                  <MenuItem
                    icon="mail"
                    label="Mark as unread"
                    onPress={() => runMenuItem(handleMarkUnread)}
                  />
                  <MenuItem
                    icon="alert-octagon"
                    label="Move to Spam"
                    onPress={() => runMenuItem(handleMoveToSpam)}
                  />
                  <MenuItem
                    icon="bell-off"
                    label="Mute"
                    onPress={() => runMenuItem(handleMute)}
                  />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {!!actionError && (
          <View style={styles.actionErrorBanner}>
            <Feather name="alert-circle" size={14} color={palette.danger} />
            <Text style={styles.actionErrorText} numberOfLines={2}>
              {actionError}
            </Text>
            <Pressable hitSlop={6} onPress={() => setActionError(null)}>
              <Feather name="x" size={14} color={palette.textMuted} />
            </Pressable>
          </View>
        )}
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={palette.textMuted} />
        </View>
      )}
      {error && (
        <View style={styles.center}>
          <Feather name="alert-circle" size={24} color={palette.danger} />
          <Text style={styles.error}>Failed to load thread</Text>
          <Text style={styles.errorDetail}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.subjectRow}>
            <Text style={styles.subjectTitle}>{topSubject}</Text>
            {isStarred && <Feather name="star" size={16} color={palette.star} />}
          </View>

          {messages.map((message, idx) => {
            const isExpanded = expanded.has(message.id);
            const headersOpen = showHeaders.has(message.id);
            const isLatest = idx === messages.length - 1;
            const toLine = message.to
              .slice(0, 3)
              .map((r) => shortRecipientLabel(r, selfEmail))
              .filter(Boolean)
              .join(', ');
            const extraTo = message.to.length > 3 ? `, +${message.to.length - 3}` : '';
            return (
              <View
                key={message.id}
                style={[styles.messageCard, !isExpanded && styles.messageCardCollapsed]}
              >
                <Pressable
                  onPress={() => (isExpanded && isLatest ? null : toggleMessage(message.id))}
                  style={styles.messageHeader}
                >
                  <Avatar seed={message.fromEmail || message.fromName} size={36} />
                  <View style={styles.messageMeta}>
                    <View style={styles.messageMetaTop}>
                      <Text style={styles.messageFrom} numberOfLines={1}>
                        {message.fromName}
                      </Text>
                      <Text style={styles.messageDate}>{formatTime(message.date)}</Text>
                    </View>
                    {isExpanded ? (
                      <Pressable
                        onPress={() => toggleHeaders(message.id)}
                        style={styles.messageToRow}
                      >
                        <Text style={styles.messageTo} numberOfLines={1}>
                          to {toLine || '—'}
                          {extraTo}
                        </Text>
                        <Feather
                          name={headersOpen ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={palette.textMuted}
                        />
                      </Pressable>
                    ) : (
                      <Text style={styles.messageSnippet} numberOfLines={1}>
                        {message.snippet}
                      </Text>
                    )}
                  </View>
                </Pressable>

                {isExpanded && headersOpen && (
                  <View style={styles.headersBlock}>
                    <HeaderLine label="From" value={`${message.fromName} <${message.fromEmail}>`} />
                    <HeaderLine
                      label="To"
                      value={message.to.map(recipientLabel).filter(Boolean).join(', ') || '—'}
                    />
                    {message.cc.length > 0 && (
                      <HeaderLine
                        label="Cc"
                        value={message.cc.map(recipientLabel).filter(Boolean).join(', ')}
                      />
                    )}
                    {message.bcc.length > 0 && (
                      <HeaderLine
                        label="Bcc"
                        value={message.bcc.map(recipientLabel).filter(Boolean).join(', ')}
                      />
                    )}
                    <HeaderLine label="Date" value={formatFullTime(message.date)} />
                  </View>
                )}

                {isExpanded && (
                  <View style={styles.messageBody}>
                    <WebView
                      originWhitelist={['*']}
                      source={{ html: buildEmailDoc(message.html), baseUrl: 'about:blank' }}
                      style={[
                        styles.webview,
                        { height: Math.max(bodyHeights[message.id] ?? 80, 60) },
                      ]}
                      scrollEnabled={false}
                      javaScriptEnabled
                      domStorageEnabled
                      onMessage={(event) => {
                        try {
                          const parsed = JSON.parse(event.nativeEvent.data) as {
                            kind?: string;
                            value?: number;
                          };
                          if (parsed.kind === 'height' && typeof parsed.value === 'number') {
                            setBodyHeights((prev) =>
                              prev[message.id] === parsed.value
                                ? prev
                                : { ...prev, [message.id]: Math.ceil(parsed.value!) },
                            );
                          }
                        } catch {
                          // ignore non-JSON postMessage payloads
                        }
                      }}
                      androidLayerType="hardware"
                      setSupportMultipleWindows={false}
                    />
                  </View>
                )}
              </View>
            );
          })}

          <View style={{ height: 96 }} />
        </ScrollView>
      )}

      {!loading && !error && (
        <View style={styles.bottomBar}>
          <Pressable style={styles.replyAction} onPress={goReply} disabled={!!busyAction}>
            <Feather name="corner-up-left" size={16} color={palette.textPrimary} />
            <Text style={styles.replyActionText}>Reply</Text>
          </Pressable>
          <Pressable style={styles.replyAction} onPress={goReplyAll} disabled={!!busyAction}>
            <Feather name="users" size={16} color={palette.textPrimary} />
            <Text style={styles.replyActionText}>Reply all</Text>
          </Pressable>
          <Pressable style={styles.replyAction} onPress={goForward} disabled={!!busyAction}>
            <Feather name="corner-up-right" size={16} color={palette.textPrimary} />
            <Text style={styles.replyActionText}>Forward</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function HeaderLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.headerLineRow}>
      <Text style={styles.headerLineLabel}>{label}</Text>
      <Text style={styles.headerLineValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
    >
      <Feather name={icon} size={18} color={palette.textSecondary} />
      <Text style={styles.menuItemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.surface },
  header: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  error: { color: palette.danger, fontSize: 15, fontWeight: '600', marginTop: 4 },
  errorDetail: { color: palette.textMuted, fontSize: 12, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  subjectTitle: {
    color: palette.textPrimary,
    fontSize: 22,
    fontWeight: '600',
    flex: 1,
    lineHeight: 30,
  },
  messageCard: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: palette.divider,
  },
  messageCardCollapsed: { backgroundColor: 'transparent', borderColor: palette.divider },
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  messageMeta: { flex: 1, minWidth: 0 },
  messageMetaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  messageFrom: { color: palette.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },
  messageDate: { color: palette.textMuted, fontSize: 12 },
  messageToRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  messageTo: { color: palette.textMuted, fontSize: 12, flexShrink: 1 },
  messageSnippet: { color: palette.textMuted, fontSize: 13, marginTop: 2 },
  headersBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: palette.divider,
    gap: 4,
  },
  headerLineRow: { flexDirection: 'row', gap: 8 },
  headerLineLabel: { color: palette.textFaint, fontSize: 11, width: 36, fontWeight: '600' },
  headerLineValue: { color: palette.textSecondary, fontSize: 12, flex: 1 },
  messageBody: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.divider,
  },
  webview: {
    backgroundColor: 'transparent',
    width: '100%',
  },
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: palette.surfaceElevated,
    borderRadius: 28,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: 1,
    borderColor: palette.border,
  },
  replyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  replyActionText: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingTop: 56,
    paddingRight: 8,
    alignItems: 'flex-end',
  },
  menuPopover: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: 12,
    minWidth: 200,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemPressed: { backgroundColor: palette.surfaceHover },
  menuItemText: { color: palette.textPrimary, fontSize: 14 },
  actionErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 4,
    padding: 10,
    backgroundColor: '#2a1a1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5a2a32',
  },
  actionErrorText: { color: palette.danger, fontSize: 12, flex: 1 },
});
