import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';
import { clearAuthSession, clearMobileToken } from '@/src/auth/session-store';
import { trpc } from '@/src/api/trpc';
import { Feather } from '@expo/vector-icons';

const FOLDER = {
  INBOX: 'inbox',
  DRAFT: 'draft',
  SENT: 'sent',
  ARCHIVE: 'archive',
  SNOOZED: 'snoozed',
  SPAM: 'spam',
  BIN: 'bin',
} as const;

type MailFolder = (typeof FOLDER)[keyof typeof FOLDER];

type ThreadPreview = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  dateIso: string;
  isUnread: boolean;
  avatar: string;
};

/** Pixel 7 class width (~412 logical); drawer matches web mail overlay proportions */
const SCREEN_W = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(Math.max(Math.round(SCREEN_W * 0.72), 288), 320);

function formatCount(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US');
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
  const { account, disconnect, signIn } = useMobileWallet();
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [refreshingMeta, setRefreshingMeta] = useState(false);

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
  const displayEmail = connection?.email || '—';

  const loadSidebarData = useCallback(async () => {
    setRefreshingMeta(true);
    try {
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
    } finally {
      setRefreshingMeta(false);
    }
  }, []);

  const loadThreads = useCallback(async (folder: MailFolder) => {
    try {
      setLoading(true);
      setError(null);
      const response = await trpc.mail.listThreads.query({
        folder,
        maxResults: 35,
        cursor: '',
        q: '',
        labelIds: [],
      });
      const rawThreads = Array.isArray(response?.threads) ? response.threads : [];
      const details = await Promise.all(
        rawThreads.slice(0, 35).map(async (thread: Record<string, unknown>) => {
          const id = String(thread.id || '');
          if (!id) return null;
          try {
            const threadData = await trpc.mail.get.query({ id, forceFresh: false });
            const latest =
              threadData.latest || threadData.messages[threadData.messages.length - 1];
            const from =
              latest?.sender?.name ||
              latest?.sender?.email ||
              latest?.from?.text ||
              latest?.from?.address ||
              'Unknown sender';
            const subject = latest?.subject || '(no subject)';
            const snippet =
              (latest?.decodedBody || latest?.body || '').replace(/<[^>]*>/g, ' ').trim() ||
              'No preview';
            const dateRaw = latest?.internalDate || latest?.date || '';
            const dateIso =
              typeof dateRaw === 'string'
                ? dateRaw
                : dateRaw instanceof Date
                  ? dateRaw.toISOString()
                  : '';
            return {
              id,
              from,
              subject,
              snippet,
              dateIso,
              isUnread: Boolean(threadData.hasUnread),
              avatar: (from || 'U').trim().charAt(0).toUpperCase(),
            } as ThreadPreview;
          } catch {
            return {
              id,
              from: 'Unknown sender',
              subject: '(unable to load)',
              snippet: '',
              dateIso: '',
              isUnread: true,
              avatar: 'U',
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

  const handleRefresh = () => {
    void loadSidebarData();
    void loadThreads(activeFolder);
  };

  const handleSignOut = async () => {
    await clearAuthSession();
    await clearMobileToken();
    await disconnect();
    router.replace('/');
  };

  const selectFolder = (folder: MailFolder) => {
    setActiveFolder(folder);
    setDrawerOpen(false);
  };

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (thread) =>
        thread.from.toLowerCase().includes(q) ||
        thread.subject.toLowerCase().includes(q) ||
        thread.snippet.toLowerCase().includes(q),
    );
  }, [query, threads]);

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
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const folderTitle =
    activeFolder === FOLDER.BIN
      ? 'Trash'
      : activeFolder === FOLDER.DRAFT
        ? 'Drafts'
        : activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1);

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={[styles.viewport, { maxWidth: SCREEN_W }]}>
        <View style={styles.topBar}>
          <Pressable style={styles.iconButton} onPress={() => setDrawerOpen(true)}>
            <Feather name="menu" size={20} color="#cfd3db" />
          </Pressable>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color="#8f95a3" />
            <TextInput
              placeholder="Search"
              placeholderTextColor="#8f95a3"
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
            />
          </View>
          <Pressable style={styles.categoryButton}>
            <Text style={styles.categoryText}>Categories</Text>
            <Feather name="chevron-down" size={14} color="#cfd3db" />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={handleRefresh} disabled={refreshingMeta}>
            {refreshingMeta ? (
              <ActivityIndicator size="small" color="#cfd3db" />
            ) : (
              <Feather name="rotate-cw" size={16} color="#cfd3db" />
            )}
          </Pressable>
        </View>

        <View style={styles.folderStrip}>
          <Text style={styles.folderStripTitle}>{folderTitle}</Text>
        </View>

        {loading && <Text style={styles.meta}>Loading…</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <FlatList
          data={visibleThreads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.threadRow} onPress={() => router.push(`/thread/${item.id}`)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.avatar}</Text>
              </View>
              <View style={styles.threadMain}>
                <View style={styles.rowTop}>
                  <Text style={styles.threadFrom} numberOfLines={1}>
                    {item.from}
                  </Text>
                  <View style={styles.timeWrap}>
                    {item.isUnread && <View style={styles.unreadDot} />}
                    <Text style={styles.threadTime}>{formatCompactTime(item.dateIso)}</Text>
                  </View>
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
            </Pressable>
          )}
          ListEmptyComponent={
            !loading && !error ? <Text style={styles.meta}>No messages</Text> : null
          }
        />

        {!drawerOpen && (
          <Pressable style={styles.fab} onPress={() => router.push('/compose')}>
            <Feather name="edit-2" size={18} color="#e8eef8" />
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
              <View style={styles.drawerTopRow}>
                {connection?.picture?.startsWith('http') ? (
                  <Image source={{ uri: connection.picture }} style={styles.drawerAvatarImg} />
                ) : (
                  <View style={styles.drawerAvatar}>
                    <Text style={styles.drawerAvatarText}>
                      {displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Pressable style={styles.drawerSmallIcon}>
                  <Feather name="plus" size={15} color="#cfd3db" />
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable style={styles.drawerSmallIcon}>
                  <Feather name="more-horizontal" size={17} color="#cfd3db" />
                </Pressable>
              </View>

              <Text style={styles.drawerName} numberOfLines={2}>
                {displayName}
              </Text>
              <Text style={styles.drawerEmail} numberOfLines={1}>
                {displayEmail}
              </Text>

              <Pressable style={styles.newMailButton} onPress={() => router.push('/compose')}>
                <Feather name="edit-2" size={14} color="#e7efff" />
                <Text style={styles.newMailButtonText}>New email</Text>
              </Pressable>

              <Text style={styles.drawerSection}>Core</Text>
              <DrawerNavRow
                label="Inbox"
                icon="inbox"
                count={formatCount(countFor(FOLDER.INBOX))}
                active={activeFolder === FOLDER.INBOX}
                onPress={() => selectFolder(FOLDER.INBOX)}
              />
              <DrawerNavRow
                label="Drafts"
                icon="folder"
                count={formatCount(countFor(FOLDER.DRAFT))}
                active={activeFolder === FOLDER.DRAFT}
                onPress={() => selectFolder(FOLDER.DRAFT)}
              />
              <DrawerNavRow
                label="Sent"
                icon="send"
                count={formatCount(countFor(FOLDER.SENT))}
                active={activeFolder === FOLDER.SENT}
                onPress={() => selectFolder(FOLDER.SENT)}
              />

              <Text style={styles.drawerSection}>Management</Text>
              <DrawerNavRow
                label="Archive"
                icon="archive"
                count={formatCount(countFor(FOLDER.ARCHIVE))}
                active={activeFolder === FOLDER.ARCHIVE}
                onPress={() => selectFolder(FOLDER.ARCHIVE)}
              />
              <DrawerNavRow
                label="Snoozed"
                icon="clock"
                count={formatCount(countFor(FOLDER.SNOOZED))}
                active={activeFolder === FOLDER.SNOOZED}
                onPress={() => selectFolder(FOLDER.SNOOZED)}
              />
              <DrawerNavRow
                label="Spam"
                icon="alert-circle"
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
                  <View style={styles.drawerLabelsRow}>
                    <Text style={styles.drawerSection}>Labels</Text>
                    <Pressable>
                      <Feather name="plus" size={15} color="#9ea7b8" />
                    </Pressable>
                  </View>
                  {userLabels.map((lab) => (
                    <View key={lab.id} style={styles.drawerItem}>
                      <View style={styles.drawerItemLeft}>
                        <Feather name="bookmark" size={15} color="#9ea7b8" />
                        <Text style={styles.drawerItemText}>{lab.name}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={styles.drawerFooter}>
              <Pressable style={styles.drawerBottom} onPress={() => void signIn()}>
                <Feather name="shield" size={15} color="#d9e3f3" />
                <Text style={styles.drawerWallet}>Connect Wallet</Text>
              </Pressable>
              {!!walletAddress && (
                <Text style={styles.walletHint} numberOfLines={1}>
                  {walletAddress}
                </Text>
              )}
              <Pressable onPress={() => handleSignOut()}>
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
      style={[styles.drawerItem, active ? styles.drawerItemActive : null]}
    >
      <View style={styles.drawerItemLeft}>
        <Feather name={icon} size={15} color={active ? '#d9e3f3' : '#9ea7b8'} />
        <Text style={active ? styles.drawerItemTextActive : styles.drawerItemText}>{label}</Text>
      </View>
      <Text style={styles.drawerCount}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#0b0d11',
    alignSelf: 'center',
    width: '100%',
  },
  viewport: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  folderStrip: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  folderStripTitle: {
    color: '#727d90',
    fontSize: 13,
    fontWeight: '600',
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151923',
    borderWidth: 1,
    borderColor: '#212735',
  },
  searchWrap: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    backgroundColor: '#151923',
    borderWidth: 1,
    borderColor: '#212735',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchInput: {
    flex: 1,
    color: '#d7dbe3',
    fontSize: 14,
  },
  categoryButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#151923',
    borderWidth: 1,
    borderColor: '#212735',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryText: { color: '#cfd3db', fontSize: 12, fontWeight: '600' },
  listContent: { paddingBottom: 24, paddingTop: 2 },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f2a',
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2a2e38',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarText: { color: '#cfd3db', fontWeight: '700', fontSize: 15 },
  threadMain: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  threadFrom: { color: '#f1f3f7', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 },
  timeWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1877f2',
  },
  threadTime: { color: '#959cac', fontSize: 12, fontWeight: '500' },
  threadSubject: { color: '#d8dde8', fontSize: 13, marginTop: 1 },
  threadSubjectUnread: { color: '#eef2fb', fontWeight: '700' },
  threadSnippet: { color: '#9ca4b4', fontSize: 12, marginTop: 1 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 28,
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#151923',
    borderWidth: 1,
    borderColor: '#283041',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  meta: { color: '#aeb4c0', fontSize: 14, marginTop: 8, marginHorizontal: 14 },
  error: { color: '#ff9b9b', fontSize: 13, marginTop: 8, marginHorizontal: 14 },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 50,
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawerPanel: {
    backgroundColor: '#0b0d11',
    borderRightWidth: 1,
    borderRightColor: '#222733',
    maxHeight: '100%',
  },
  drawerScroll: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    flexGrow: 1,
  },
  drawerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  drawerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2c3342',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerAvatarImg: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  drawerAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  drawerSmallIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#171c28',
    borderWidth: 1,
    borderColor: '#252b38',
  },
  drawerName: { color: '#f4f7fc', fontSize: 22, fontWeight: '700' },
  drawerEmail: { color: '#a4adbd', fontSize: 14, marginTop: 4, marginBottom: 14 },
  newMailButton: {
    height: 38,
    borderRadius: 10,
    backgroundColor: '#006ffe',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  newMailButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  drawerSection: { color: '#727d90', fontSize: 12, marginBottom: 8, marginTop: 8, letterSpacing: 0.4 },
  drawerItem: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 2,
  },
  drawerItemActive: {
    backgroundColor: '#1d222d',
  },
  drawerItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drawerItemText: { color: '#d1d7e2', fontSize: 16 },
  drawerItemTextActive: { color: '#eaf1ff', fontSize: 16, fontWeight: '700' },
  drawerCount: { color: '#c4cad7', fontSize: 14, fontWeight: '600' },
  drawerLabelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  drawerFooter: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1f2a',
    gap: 8,
  },
  drawerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  drawerWallet: { color: '#dbe2f2', fontSize: 15, fontWeight: '600' },
  walletHint: { color: '#5c6475', fontSize: 11 },
  signOutLink: { color: '#6b9ef5', fontSize: 13, paddingVertical: 4 },
});
