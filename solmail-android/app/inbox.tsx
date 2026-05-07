import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';
import { clearAuthSession, clearMobileToken } from '@/src/auth/session-store';
import { trpc } from '@/src/api/trpc';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { palette } from '@/constants/colors';

const FOLDER = {
  INBOX: 'inbox',
  STARRED: 'starred',
  DRAFT: 'draft',
  SENT: 'sent',
  ARCHIVE: 'archive',
  SNOOZED: 'snoozed',
  SPAM: 'spam',
  BIN: 'bin',
} as const;

type MailFolder = (typeof FOLDER)[keyof typeof FOLDER];

/**
 * "Starred" isn't a real folder on the backend — it's a label. List it across
 * every folder by sending labelIds=['STARRED'] and an empty folder hint.
 */
const LABEL_ONLY_FOLDERS: Record<string, string[]> = {
  [FOLDER.STARRED]: ['STARRED'],
};

type ThreadPreview = {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  snippet: string;
  dateIso: string;
  isUnread: boolean;
};

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(Math.max(Math.round(SCREEN_W * 0.78), 288), 320);

function formatCount(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return '';
  if (n === 0) return '';
  if (n > 999) return '999+';
  return String(n);
}

function statsByLabel(stats: { label?: string; count?: number }[] | undefined) {
  const map = new Map<string, number>();
  if (!stats) return map;
  for (const row of stats) {
    const key = row.label?.toLowerCase();
    if (key && typeof row.count === 'number') map.set(key, row.count);
  }
  return map;
}

function folderLabel(folder: MailFolder): string[] {
  switch (folder) {
    case FOLDER.INBOX:
      return ['inbox'];
    case FOLDER.DRAFT:
      return ['draft', 'drafts'];
    case FOLDER.SENT:
      return ['sent'];
    case FOLDER.ARCHIVE:
      return ['archive'];
    case FOLDER.SNOOZED:
      return ['snoozed'];
    case FOLDER.SPAM:
      return ['spam'];
    case FOLDER.BIN:
      return ['bin', 'trash'];
    default:
      return [folder];
  }
}

export default function InboxScreen() {
  const router = useRouter();
  const { account, disconnect } = useMobileWallet();
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<MailFolder>(FOLDER.INBOX);
  const [stats, setStats] = useState<{ label?: string; count?: number }[]>([]);
  const [connection, setConnection] = useState<{
    email: string;
    name: string | null;
    picture: string | null;
  } | null>(null);
  const [userLabels, setUserLabels] = useState<{ id: string; name: string }[]>([]);

  const walletAddress = useMemo(() => account?.publicKey.toBase58() || '', [account]);
  const countMap = useMemo(() => statsByLabel(stats), [stats]);

  const countFor = useCallback(
    (folder: MailFolder) => {
      for (const key of folderLabel(folder)) {
        const c = countMap.get(key);
        if (typeof c === 'number') return c;
      }
      return undefined;
    },
    [countMap],
  );

  const displayName = connection?.name?.trim() || connection?.email?.split('@')[0] || 'Account';
  const displayEmail = connection?.email || '';

  const loadSidebarData = useCallback(async () => {
    const [conn, countRows, labels] = await Promise.all([
      trpc.connections.getDefault.query(),
      trpc.mail.count.query(),
      trpc.labels.list.query().catch(() => [] as { id: string; name: string }[]),
    ]);
    if (conn) {
      setConnection({
        email: conn.email || '',
        name: conn.name ?? null,
        picture: conn.picture ?? null,
      });
    } else {
      setConnection(null);
    }
    setStats(Array.isArray(countRows) ? countRows : []);
    const typed = labels as { id: string; name: string; type?: string }[];
    const userOnly = typed
      .filter((l) => String(l.type ?? 'user').toLowerCase() === 'user')
      .map((l) => ({ id: l.id, name: l.name }));
    const systemName =
      /^(chat|sent|inbox|trash|spam|draft|starred|important|unread|all mail|promotions|social|updates|forums)$/i;
    const fallback =
      userOnly.length > 0
        ? userOnly
        : typed
            .filter((l) => l.name && !systemName.test(l.name.trim()))
            .map((l) => ({ id: l.id, name: l.name }));
    const unique = Array.from(
      new Map(fallback.map((l) => [l.name.toLowerCase(), l])).values(),
    ).filter((l) => !l.name.includes('/'));
    const rejected = unique.find((l) => l.name.toLowerCase() === 'rejected');
    const ordered = rejected
      ? [rejected, ...unique.filter((l) => l.name.toLowerCase() !== 'rejected')]
      : unique;
    setUserLabels(ordered.slice(0, 6));
  }, []);

  const loadThreads = useCallback(async (folder: MailFolder, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      setError(null);
      const labelOnlyIds = LABEL_ONLY_FOLDERS[folder];
      const queryArgs = labelOnlyIds
        ? {
            // Label-only views (e.g. Starred) span every folder.
            folder: '',
            maxResults: 35,
            cursor: '',
            q: '',
            labelIds: labelOnlyIds,
          }
        : { folder, maxResults: 35, cursor: '', q: '', labelIds: [] as string[] };
      const response = await trpc.mail.listThreads.query(queryArgs);
      const rawThreads = Array.isArray(response?.threads) ? response.threads : [];
      const details = await Promise.all(
        rawThreads.slice(0, 35).map(async (thread: Record<string, unknown>) => {
          const id = String(thread.id || '');
          if (!id) return null;
          try {
            const threadData = await trpc.mail.get.query({ id, forceFresh: false });
            const latest =
              threadData.latest || threadData.messages[threadData.messages.length - 1];
            const fromName =
              latest?.sender?.name ||
              latest?.sender?.email ||
              latest?.from?.text ||
              latest?.from?.address ||
              'Unknown';
            const fromEmail = latest?.sender?.email || latest?.from?.address || fromName;
            const subject = latest?.subject || '(no subject)';
            const snippet =
              (latest?.decodedBody || latest?.body || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || '';
            const dateRaw = latest?.internalDate || latest?.date || '';
            const dateIso =
              typeof dateRaw === 'string'
                ? dateRaw
                : dateRaw instanceof Date
                  ? dateRaw.toISOString()
                  : '';
            return {
              id,
              from: fromName,
              fromEmail,
              subject,
              snippet,
              dateIso,
              isUnread: Boolean(threadData.hasUnread),
            } as ThreadPreview;
          } catch {
            return {
              id,
              from: 'Unknown sender',
              fromEmail: 'unknown',
              subject: '(unable to load)',
              snippet: '',
              dateIso: '',
              isUnread: true,
            } as ThreadPreview;
          }
        }),
      );
      setThreads(details.filter((item): item is ThreadPreview => Boolean(item)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown inbox error');
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSidebarData();
  }, [loadSidebarData]);

  useEffect(() => {
    void loadThreads(activeFolder);
  }, [activeFolder, loadThreads]);

  /**
   * Refetch every time the inbox regains focus so archive/trash/send actions
   * from the thread/compose screens land here immediately. The initial mount
   * also fires this — that double-fetch is intentional cheap insurance against
   * stale-cache reads from the backend.
   */
  useFocusEffect(
    useCallback(() => {
      void loadSidebarData();
      void loadThreads(activeFolder, { silent: true });
    }, [activeFolder, loadSidebarData, loadThreads]),
  );

  /**
   * If the thread screen redirected back with a `refresh` marker (and
   * optionally a `removedId`), apply an optimistic local removal so the row
   * disappears immediately, then trigger a fresh listThreads call. The thread
   * may briefly reappear if the backend hasn't propagated the label change in
   * time — but tracking the removed id in a Set guards against that.
   */
  const focusParams = useLocalSearchParams<{ refresh?: string; removedId?: string }>();
  const refreshMarker = Array.isArray(focusParams.refresh)
    ? focusParams.refresh[0]
    : focusParams.refresh;
  const removedIdParam = Array.isArray(focusParams.removedId)
    ? focusParams.removedId[0]
    : focusParams.removedId;
  const [optimisticRemovedIds, setOptimisticRemovedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!refreshMarker) return;
    if (removedIdParam) {
      setOptimisticRemovedIds((prev) => {
        if (prev.has(removedIdParam)) return prev;
        const next = new Set(prev);
        next.add(removedIdParam);
        return next;
      });
      setThreads((prev) => prev.filter((t) => t.id !== removedIdParam));
    }
    void loadThreads(activeFolder, { silent: true });
    void loadSidebarData();
  }, [refreshMarker, removedIdParam, activeFolder, loadThreads, loadSidebarData]);

  /**
   * Background poll the inbox every 60s while the screen is focused AND the
   * app is foregrounded. We track focus + AppState in refs and start a single
   * interval; ticks no-op when either condition is false. Both fetches run
   * in parallel and are silent (no full-screen spinner).
   */
  const pollFocusedRef = useRef(false);
  const pollAppActiveRef = useRef(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      pollFocusedRef.current = true;
      return () => {
        pollFocusedRef.current = false;
      };
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      pollAppActiveRef.current = state === 'active';
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const POLL_MS = 60_000;
    const id = setInterval(() => {
      if (!pollFocusedRef.current || !pollAppActiveRef.current) return;
      void loadThreads(activeFolder, { silent: true });
      void loadSidebarData();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [activeFolder, loadThreads, loadSidebarData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadSidebarData(), loadThreads(activeFolder, { silent: true })]);
    } finally {
      setRefreshing(false);
    }
  }, [activeFolder, loadSidebarData, loadThreads]);

  const handleSignOut = async () => {
    await clearAuthSession();
    await clearMobileToken();
    await disconnect();
    router.replace('/');
  };

  const selectFolder = (folder: MailFolder) => {
    void Haptics.selectionAsync();
    setActiveFolder(folder);
    setOptimisticRemovedIds(new Set());
    setDrawerOpen(false);
  };

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = optimisticRemovedIds.size
      ? threads.filter((t) => !optimisticRemovedIds.has(t.id))
      : threads;
    if (!q) return filtered;
    return filtered.filter(
      (thread) =>
        thread.from.toLowerCase().includes(q) ||
        thread.subject.toLowerCase().includes(q) ||
        thread.snippet.toLowerCase().includes(q),
    );
  }, [query, threads, optimisticRemovedIds]);

  const formatCompactTime = (iso: string) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sameYear = date.getFullYear() === now.getFullYear();
    return sameYear
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  };

  const folderTitle =
    activeFolder === FOLDER.BIN
      ? 'Trash'
      : activeFolder === FOLDER.DRAFT
        ? 'Drafts'
        : activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1);

  const emptyState = !loading && !error && visibleThreads.length === 0;

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={styles.viewport}>
        <View style={styles.searchBar}>
          <Pressable
            hitSlop={10}
            style={styles.searchIcon}
            onPress={() => setDrawerOpen(true)}
          >
            <Feather name="menu" size={20} color={palette.textSecondary} />
          </Pressable>
          <TextInput
            placeholder={query ? '' : `Search in ${folderTitle.toLowerCase()}`}
            placeholderTextColor={palette.textFaint}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            returnKeyType="search"
          />
          <Pressable hitSlop={10} style={styles.searchIcon}>
            <Avatar
              seed={displayEmail || displayName}
              size={28}
              imageUri={connection?.picture}
            />
          </Pressable>
        </View>

        {activeFolder !== FOLDER.INBOX && (
          <View style={styles.folderStrip}>
            <Text style={styles.folderStripTitle}>{folderTitle}</Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <FlatList
          data={visibleThreads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            emptyState ? styles.listEmpty : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.textSecondary}
              colors={[palette.accentSoft]}
              progressBackgroundColor={palette.surfaceElevated}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.threadRow,
                pressed && styles.threadRowPressed,
              ]}
              onPress={() => router.push(`/thread/${item.id}`)}
            >
              <Avatar seed={item.fromEmail || item.from} size={40} />
              <View style={styles.threadMain}>
                <View style={styles.rowTop}>
                  <Text
                    style={[styles.threadFrom, item.isUnread && styles.threadFromUnread]}
                    numberOfLines={1}
                  >
                    {item.from}
                  </Text>
                  <Text
                    style={[styles.threadTime, item.isUnread && styles.threadTimeUnread]}
                  >
                    {formatCompactTime(item.dateIso)}
                  </Text>
                </View>
                <Text
                  style={[styles.threadSubject, item.isUnread && styles.threadSubjectUnread]}
                  numberOfLines={1}
                >
                  {item.subject}
                </Text>
                <Text style={styles.threadSnippet} numberOfLines={1}>
                  {item.snippet}
                </Text>
              </View>
              {item.isUnread && <View style={styles.unreadDot} />}
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.emptyWrap}>
                <ActivityIndicator size="small" color={palette.textMuted} />
              </View>
            ) : emptyState ? (
              <View style={styles.emptyWrap}>
                <Feather name="inbox" size={48} color={palette.textFaint} />
                <Text style={styles.emptyTitle}>No conversations</Text>
                <Text style={styles.emptyHint}>You&apos;re all caught up.</Text>
              </View>
            ) : null
          }
        />

        {!drawerOpen && (
          <Pressable
            style={styles.fab}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/compose');
            }}
          >
            <Feather name="edit-2" size={20} color="#fff" />
            <Text style={styles.fabLabel}>Compose</Text>
          </Pressable>
        )}
      </View>

      {drawerOpen && (
        <View style={styles.drawerOverlay} pointerEvents="box-none">
          <View style={[styles.drawerPanel, { width: DRAWER_WIDTH }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.drawerScroll}
            >
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerBrand}>SolMail</Text>
              </View>

              <View style={styles.drawerProfile}>
                <Avatar
                  seed={displayEmail || displayName}
                  imageUri={connection?.picture}
                  size={40}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.drawerName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {!!displayEmail && (
                    <Text style={styles.drawerEmail} numberOfLines={1}>
                      {displayEmail}
                    </Text>
                  )}
                </View>
              </View>

              <DrawerNavRow
                label="Inbox"
                icon="inbox"
                count={formatCount(countFor(FOLDER.INBOX))}
                active={activeFolder === FOLDER.INBOX}
                onPress={() => selectFolder(FOLDER.INBOX)}
              />
              <DrawerNavRow
                label="Starred"
                icon="star"
                count=""
                active={activeFolder === FOLDER.STARRED}
                onPress={() => selectFolder(FOLDER.STARRED)}
              />
              <DrawerNavRow
                label="Snoozed"
                icon="clock"
                count={formatCount(countFor(FOLDER.SNOOZED))}
                active={activeFolder === FOLDER.SNOOZED}
                onPress={() => selectFolder(FOLDER.SNOOZED)}
              />
              <DrawerNavRow
                label="Sent"
                icon="send"
                count={formatCount(countFor(FOLDER.SENT))}
                active={activeFolder === FOLDER.SENT}
                onPress={() => selectFolder(FOLDER.SENT)}
              />
              <DrawerNavRow
                label="Drafts"
                icon="file"
                count={formatCount(countFor(FOLDER.DRAFT))}
                active={activeFolder === FOLDER.DRAFT}
                onPress={() => selectFolder(FOLDER.DRAFT)}
              />
              <View style={styles.drawerDivider} />
              <DrawerNavRow
                label="Archive"
                icon="archive"
                count={formatCount(countFor(FOLDER.ARCHIVE))}
                active={activeFolder === FOLDER.ARCHIVE}
                onPress={() => selectFolder(FOLDER.ARCHIVE)}
              />
              <DrawerNavRow
                label="Spam"
                icon="alert-octagon"
                count={formatCount(countFor(FOLDER.SPAM))}
                active={activeFolder === FOLDER.SPAM}
                onPress={() => selectFolder(FOLDER.SPAM)}
              />
              <DrawerNavRow
                label="Trash"
                icon="trash-2"
                count={formatCount(countFor(FOLDER.BIN))}
                active={activeFolder === FOLDER.BIN}
                onPress={() => selectFolder(FOLDER.BIN)}
              />

              {userLabels.length > 0 && (
                <>
                  <View style={styles.drawerDivider} />
                  <Text style={styles.drawerSection}>Labels</Text>
                  {userLabels.map((lab) => (
                    <View key={lab.id} style={styles.drawerItem}>
                      <View style={styles.drawerItemLeft}>
                        <Feather name="bookmark" size={18} color={palette.textMuted} />
                        <Text style={styles.drawerItemText}>{lab.name}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={styles.drawerFooter}>
              {!!walletAddress && (
                <Pressable
                  onPress={() =>
                    void Linking.openURL(
                      `https://explorer.solana.com/address/${walletAddress}?cluster=devnet`,
                    )
                  }
                  hitSlop={4}
                >
                  <View style={styles.sessionRow}>
                    <Feather name="shield" size={11} color={palette.textFaint} />
                    <Text style={styles.walletLabel}>WALLET</Text>
                  </View>
                  <Text style={styles.walletAddrFull} selectable numberOfLines={1}>
                    {walletAddress}
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={() => handleSignOut()} hitSlop={6}>
                <Text style={styles.signOutLink}>Sign out</Text>
              </Pressable>
            </View>
          </View>
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
        </View>
      )}
    </SafeAreaView>
  );
}

function DrawerNavRow({
  label,
  icon,
  count,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  count: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.drawerItem, active && styles.drawerItemActive]}
    >
      <View style={styles.drawerItemLeft}>
        <Feather
          name={icon}
          size={18}
          color={active ? palette.accentSoft : palette.textMuted}
        />
        <Text style={active ? styles.drawerItemTextActive : styles.drawerItemText}>
          {label}
        </Text>
      </View>
      {!!count && (
        <Text style={active ? styles.drawerCountActive : styles.drawerCount}>{count}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.surface },
  viewport: { flex: 1, width: '100%' },
  searchBar: {
    margin: 8,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.surfaceElevated,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  searchIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 15,
    paddingVertical: 0,
  },
  folderStrip: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  folderStripTitle: {
    color: palette.textFaint,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  listContent: { paddingBottom: 96 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  threadRowPressed: { backgroundColor: palette.surfaceMuted },
  threadMain: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  threadFrom: {
    color: palette.textSecondary,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  threadFromUnread: { color: palette.textPrimary, fontWeight: '700' },
  threadTime: { color: palette.textMuted, fontSize: 12 },
  threadTimeUnread: { color: palette.accentSoft, fontWeight: '600' },
  threadSubject: {
    color: palette.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  threadSubjectUnread: { color: palette.textPrimary, fontWeight: '600' },
  threadSnippet: {
    color: palette.textMuted,
    fontSize: 13,
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.unread,
    marginTop: 18,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: palette.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  fabLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '600', marginTop: 8 },
  emptyHint: { color: palette.textMuted, fontSize: 13 },
  error: { color: palette.danger, fontSize: 13, marginTop: 8, marginHorizontal: 14 },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 50,
  },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  drawerPanel: {
    backgroundColor: palette.surface,
    borderRightWidth: 1,
    borderRightColor: palette.divider,
    maxHeight: '100%',
    paddingTop: 32,
  },
  drawerScroll: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, flexGrow: 1 },
  drawerHeader: { paddingHorizontal: 8, paddingBottom: 16 },
  drawerBrand: {
    color: palette.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  drawerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
    marginBottom: 8,
  },
  drawerName: { color: palette.textPrimary, fontSize: 15, fontWeight: '600' },
  drawerEmail: { color: palette.textMuted, fontSize: 12, marginTop: 2 },
  drawerSection: {
    color: palette.textFaint,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  drawerItem: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingRight: 16,
    borderRadius: 22,
    marginBottom: 1,
  },
  drawerItemActive: { backgroundColor: palette.accentBg },
  drawerItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  drawerItemText: { color: palette.textSecondary, fontSize: 14 },
  drawerItemTextActive: { color: palette.accentSoft, fontSize: 14, fontWeight: '700' },
  drawerCount: { color: palette.textMuted, fontSize: 12, fontWeight: '600' },
  drawerCountActive: { color: palette.accentSoft, fontSize: 12, fontWeight: '700' },
  drawerDivider: {
    height: 1,
    backgroundColor: palette.divider,
    marginVertical: 8,
    marginHorizontal: 12,
  },
  drawerFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: palette.divider,
    gap: 6,
  },
  walletHint: { color: palette.textFaint, fontSize: 11 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  walletLabel: {
    color: palette.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  walletBalance: { color: palette.accentSoft, fontSize: 10, fontWeight: '600', marginLeft: 'auto' },
  walletAddrFull: {
    color: palette.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  signOutLink: { color: palette.accentSoft, fontSize: 13, fontWeight: '600', paddingVertical: 4 },
});
