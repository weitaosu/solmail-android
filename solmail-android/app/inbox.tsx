import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
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

/**
 * Web-style category filters — Gmail-only. Match the dropdown in
 * Zero/apps/mail/components/mail/mail.tsx (CategoryDropdown).
 */
type CategoryKey = 'important' | 'all' | 'personal' | 'updates' | 'promotions' | 'unread';
const CATEGORIES: { key: CategoryKey; label: string; labelIds: string[]; tint: string }[] = [
  { key: 'all', label: 'All Mail', labelIds: [], tint: '#006FFE' },
  { key: 'important', label: 'Important', labelIds: ['IMPORTANT'], tint: '#F59E0D' },
  { key: 'personal', label: 'Personal', labelIds: ['CATEGORY_PERSONAL'], tint: '#39AE4A' },
  { key: 'updates', label: 'Updates', labelIds: ['CATEGORY_UPDATES'], tint: '#8B5CF6' },
  { key: 'promotions', label: 'Promotions', labelIds: ['CATEGORY_PROMOTIONS'], tint: '#F43F5E' },
  { key: 'unread', label: 'Unread', labelIds: ['UNREAD'], tint: '#FF4800' },
];

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
  const [categoryKey, setCategoryKey] = useState<CategoryKey>('all');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const progressOpacity = useRef(new Animated.Value(0)).current;

  const isGmail = (connection?.email || '').toLowerCase().endsWith('@gmail.com');
  const activeCategory = CATEGORIES.find((c) => c.key === categoryKey) ?? CATEGORIES[0]!;

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

  const loadThreads = useCallback(
    async (
      folder: MailFolder,
      opts?: { silent?: boolean; categoryLabelIds?: string[] },
    ) => {
    try {
      if (!opts?.silent) setLoading(true);
      setError(null);
      const labelOnlyIds = LABEL_ONLY_FOLDERS[folder];
      const extra = opts?.categoryLabelIds ?? [];
      const queryArgs = labelOnlyIds
        ? {
            // Label-only views (e.g. Starred) span every folder.
            folder: '',
            maxResults: 35,
            cursor: '',
            q: '',
            labelIds: [...labelOnlyIds, ...extra],
          }
        : {
            folder,
            maxResults: 35,
            cursor: '',
            q: '',
            labelIds: extra,
          };
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
    void loadThreads(activeFolder, { categoryLabelIds: activeCategory.labelIds });
  }, [activeFolder, categoryKey, loadThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Refetch every time the inbox regains focus so archive/trash/send actions
   * from the thread/compose screens land here immediately. The initial mount
   * also fires this — that double-fetch is intentional cheap insurance against
   * stale-cache reads from the backend.
   */
  useFocusEffect(
    useCallback(() => {
      void loadSidebarData();
      void loadThreads(activeFolder, { silent: true, categoryLabelIds: activeCategory.labelIds });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFolder, categoryKey, loadSidebarData, loadThreads]),
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
    void loadThreads(activeFolder, { silent: true, categoryLabelIds: activeCategory.labelIds });
    void loadSidebarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      void loadThreads(activeFolder, { silent: true, categoryLabelIds: activeCategory.labelIds });
      void loadSidebarData();
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, loadThreads, loadSidebarData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadSidebarData(),
        loadThreads(activeFolder, { silent: true, categoryLabelIds: activeCategory.labelIds }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [activeFolder, loadSidebarData, loadThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror web's progress bar: fade in while a fetch is active, fade out when idle.
  useEffect(() => {
    Animated.timing(progressOpacity, {
      toValue: loading || refreshing ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [loading, refreshing, progressOpacity]);

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
        <View style={styles.topBar}>
          <Pressable
            hitSlop={10}
            style={styles.drawerToggle}
            onPress={() => setDrawerOpen(true)}
          >
            <Feather name="menu" size={20} color={palette.textSecondary} />
          </Pressable>

          <View style={styles.searchPill}>
            <Feather name="search" size={14} color={palette.textFaint} />
            <TextInput
              placeholder="Search"
              placeholderTextColor={palette.textFaint}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {!!query && (
              <Pressable hitSlop={6} onPress={() => setQuery('')} style={styles.clearBtn}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            )}
          </View>

          {isGmail && activeFolder === FOLDER.INBOX && (
            <Pressable
              style={styles.iconBtn}
              hitSlop={6}
              onPress={() => setCategoryMenuOpen(true)}
            >
              <Feather
                name="filter"
                size={16}
                color={categoryKey === 'all' ? palette.textFaint : activeCategory.tint}
              />
            </Pressable>
          )}

          <Pressable
            style={styles.iconBtn}
            hitSlop={6}
            onPress={() => void handleRefresh()}
          >
            <Feather name="refresh-cw" size={16} color={palette.textFaint} />
          </Pressable>
        </View>

        <Animated.View
          style={[
            styles.progressBar,
            { backgroundColor: activeCategory.tint, opacity: progressOpacity },
          ]}
        />

        {activeFolder !== FOLDER.INBOX && (
          <View style={styles.folderStrip}>
            <Text style={styles.folderStripTitle}>{folderTitle}</Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Category dropdown — web's CategoryDropdown ported to a Modal popover. */}
        <Modal
          visible={categoryMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setCategoryMenuOpen(false)}
        >
          <TouchableWithoutFeedback onPress={() => setCategoryMenuOpen(false)}>
            <View style={styles.menuBackdrop}>
              <TouchableWithoutFeedback>
                <View style={styles.menuPopover}>
                  {CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat.key}
                      onPress={() => {
                        setCategoryKey(cat.key);
                        setCategoryMenuOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.menuItem,
                        pressed && styles.menuItemPressed,
                      ]}
                    >
                      <View style={[styles.menuDot, { backgroundColor: cat.tint }]} />
                      <Text style={styles.menuItemText}>{cat.label}</Text>
                      {categoryKey === cat.key && (
                        <Feather name="check" size={14} color={palette.accentSoft} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

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
                !item.isUnread && styles.threadRowRead,
              ]}
              onPress={() => router.push(`/thread/${item.id}`)}
            >
              {item.isUnread ? (
                <View style={styles.unreadDot} />
              ) : (
                <View style={styles.unreadDotPlaceholder} />
              )}
              <Avatar seed={item.fromEmail || item.from} size={32} />
              <View style={styles.threadMain}>
                <View style={styles.rowTop}>
                  <Text
                    style={[styles.threadFrom, item.isUnread && styles.threadFromUnread]}
                    numberOfLines={1}
                  >
                    {item.from}
                  </Text>
                  <Text style={styles.threadTime}>{formatCompactTime(item.dateIso)}</Text>
                </View>
                <Text
                  style={[styles.threadSubject, item.isUnread && styles.threadSubjectUnread]}
                  numberOfLines={1}
                >
                  {item.subject}
                </Text>
                {!!item.snippet && (
                  <Text style={styles.threadSnippet} numberOfLines={2}>
                    {item.snippet}
                  </Text>
                )}
              </View>
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
                <Text style={styles.emptyTitle}>It&apos;s empty here</Text>
                <Text style={styles.emptyHint}>
                  {query ? 'Search for another email' : 'You\'re all caught up.'}
                </Text>
                {!!query && (
                  <Pressable hitSlop={6} onPress={() => setQuery('')}>
                    <Text style={styles.emptyClear}>Clear filters</Text>
                  </Pressable>
                )}
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
                <View style={styles.walletBlock}>
                  <View style={styles.sessionRow}>
                    <Feather name="shield" size={12} color={palette.textFaint} />
                    <Text style={styles.walletLabel}>WALLET</Text>
                    <Pressable
                      hitSlop={6}
                      onPress={() =>
                        void Linking.openURL(
                          `https://explorer.solana.com/address/${walletAddress}?cluster=devnet`,
                        )
                      }
                      style={styles.walletExplorerBtn}
                    >
                      <Feather name="external-link" size={11} color={palette.accentSoft} />
                      <Text style={styles.walletExplorerText}>Explorer</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.walletAddrFull} selectable>
                    {walletAddress}
                  </Text>
                </View>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  drawerToggle: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPill: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 13,
    paddingVertical: 0,
  },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  clearText: { color: palette.textFaint, fontSize: 11 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: { height: 2, width: '100%' },
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
  listContent: { paddingBottom: 96, paddingTop: 4 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 4,
    marginVertical: 2,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 10,
  },
  threadRowRead: { opacity: 0.6 },
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
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  threadFromUnread: { color: palette.textPrimary, fontWeight: '700' },
  threadTime: { color: palette.textMuted, fontSize: 12 },
  threadSubject: {
    color: palette.textMuted,
    fontSize: 13,
    marginTop: 1,
  },
  threadSubjectUnread: { color: palette.textPrimary, fontWeight: '600' },
  threadSnippet: {
    color: palette.textMuted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.unread,
    marginTop: 12,
  },
  unreadDotPlaceholder: {
    width: 6,
    height: 6,
    marginTop: 12,
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
  emptyTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '500', marginTop: 8 },
  emptyHint: { color: palette.textMuted, fontSize: 14 },
  emptyClear: {
    color: palette.accentSoft,
    fontSize: 13,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
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
  drawerScroll: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 12, flexGrow: 1 },
  drawerHeader: { paddingHorizontal: 8, paddingBottom: 12 },
  drawerBrand: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  drawerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
    marginBottom: 8,
  },
  drawerName: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
  drawerEmail: { color: palette.textMuted, fontSize: 11, marginTop: 1 },
  drawerSection: {
    color: palette.textMuted,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  drawerItem: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingRight: 14,
    borderRadius: 6,
    marginBottom: 1,
  },
  drawerItemActive: { backgroundColor: palette.surfaceHover },
  drawerItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drawerItemText: { color: palette.textSecondary, fontSize: 13 },
  drawerItemTextActive: { color: palette.textPrimary, fontSize: 13, fontWeight: '500' },
  drawerCount: { color: palette.textMuted, fontSize: 12 },
  drawerCountActive: { color: palette.textMuted, fontSize: 12 },
  drawerDivider: {
    height: 1,
    backgroundColor: palette.divider,
    marginVertical: 6,
    marginHorizontal: 12,
  },
  drawerFooter: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: palette.divider,
    gap: 6,
  },
  walletBlock: {
    paddingVertical: 6,
    gap: 4,
  },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  walletLabel: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    flex: 1,
  },
  walletExplorerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  walletExplorerText: {
    color: palette.accentSoft,
    fontSize: 11,
    fontWeight: '600',
  },
  walletAddrFull: {
    color: palette.textPrimary,
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  signOutLink: { color: palette.accentSoft, fontSize: 13, fontWeight: '600', paddingVertical: 4 },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingTop: 56,
    paddingRight: 8,
    alignItems: 'flex-end',
  },
  menuPopover: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: 10,
    minWidth: 180,
    paddingVertical: 4,
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
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemPressed: { backgroundColor: palette.surfaceHover },
  menuItemText: { color: palette.textPrimary, fontSize: 13, flex: 1 },
  menuDot: { width: 8, height: 8, borderRadius: 4 },
});
