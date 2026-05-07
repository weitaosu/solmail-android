import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import RenderHtml from 'react-native-render-html';
import { trpc } from '@/src/api/trpc';

type MessageItem = {
  id: string;
  from: string;
  subject: string;
  html: string;
  date: string;
};

export default function ThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const { width } = useWindowDimensions();

  useEffect(() => {
    const loadThread = async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError(null);
        const data = await trpc.mail.get.query({ id, forceFresh: false });
        const toHtml = (value: string) =>
          `<div style="white-space:pre-wrap;line-height:1.55;color:#e8edf6;">${value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</div>`;
        const mapped = await Promise.all(
          (data.messages || []).map(async (msg: Record<string, unknown>) => {
            const from =
              (msg.sender as { name?: string; email?: string } | undefined)?.name ||
              (msg.sender as { name?: string; email?: string } | undefined)?.email ||
              (msg.from as { text?: string; address?: string } | undefined)?.text ||
              (msg.from as { text?: string; address?: string } | undefined)?.address ||
              'Unknown sender';
            const subject = (msg.subject as string | undefined) || '(no subject)';
            const rawHtml =
              (msg.decodedBody as string | undefined) ||
              (msg.body as string | undefined) ||
              (msg.processedHtml as string | undefined) ||
              '';

            let html = '';
            if (rawHtml.trim()) {
              try {
                const processed = await trpc.mail.processEmailContent.mutate({
                  html: rawHtml,
                  shouldLoadImages: false,
                  theme: 'dark',
                });
                html = (processed?.processedHtml || '').trim();
              } catch {
                html = rawHtml.trim();
              }
            }

            if (!html) {
              html = toHtml('No content');
            } else if (!/[<>]/.test(html)) {
              html = toHtml(html);
            }

            return {
              id: String(msg.id || Math.random()),
              from,
              subject,
              html,
              date: (
                (msg.internalDate as string | undefined) ||
                (msg.date as string | undefined) ||
                ''
              ).trim(),
            } as MessageItem;
          }),
        );
        setMessages(mapped);
      } catch (threadError) {
        setError(threadError instanceof Error ? threadError.message : 'Unknown thread error');
      } finally {
        setLoading(false);
      }
    };

    void loadThread();
  }, [id]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Text style={styles.iconText}>×</Text>
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Text style={styles.iconText}>‹</Text>
          </Pressable>
          <Pressable style={styles.iconButton}>
            <Text style={styles.iconText}>›</Text>
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          <Pressable style={styles.replyAllButton}>
            <Text style={styles.replyAllText}>Reply all</Text>
          </Pressable>
          <Pressable style={styles.iconButton}>
            <Text style={styles.iconText}>🗑</Text>
          </Pressable>
        </View>
      </View>

      {loading && <Text style={styles.meta}>Loading thread...</Text>}
      {error && <Text style={styles.error}>Failed to load thread: {error}</Text>}

      <ScrollView contentContainerStyle={styles.content}>
        {!loading &&
          !error &&
          messages.map((message) => (
            <View key={message.id} style={styles.messageCard}>
              <Text style={styles.from}>{message.from}</Text>
              <Text style={styles.subject}>{message.subject}</Text>
              <View style={styles.tagRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>🏷</Text></View>
                <View style={styles.badge}><Text style={styles.badgeText}>⚡</Text></View>
              </View>
              {!!message.date && <Text style={styles.date}>{new Date(message.date).toLocaleString()}</Text>}
              <View style={styles.body}>
                {message.html ? (
                  <RenderHtml contentWidth={width - 72} source={{ html: message.html }} />
                ) : (
                  <Text style={styles.emptyBody}>No content</Text>
                )}
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d11' },
  header: {
    paddingTop: 54,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#151923',
    borderWidth: 1,
    borderColor: '#252b38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: '#d6dbe6', fontSize: 14, fontWeight: '700' },
  replyAllButton: {
    height: 32,
    borderRadius: 9,
    backgroundColor: '#1f2532',
    borderWidth: 1,
    borderColor: '#2d3444',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAllText: { color: '#f1f4fb', fontWeight: '700', fontSize: 13 },
  meta: { color: '#f2b990', fontSize: 14, margin: 16 },
  error: { color: '#ff9b9b', fontSize: 13, margin: 16 },
  content: { padding: 12, gap: 12, paddingBottom: 28 },
  messageCard: { backgroundColor: '#12151c', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#232936' },
  from: { color: '#f3f6fc', fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subject: { color: '#f5f5f5', fontSize: 35, fontWeight: '700', marginBottom: 8 },
  tagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badge: { backgroundColor: '#212938', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: '#dbe2f2', fontSize: 12 },
  date: { color: '#7f7f88', fontSize: 12, marginTop: 2, marginBottom: 8 },
  body: { backgroundColor: '#0f1117', borderRadius: 10, padding: 8, overflow: 'hidden' },
  emptyBody: { color: '#9a9aa3' },
});

