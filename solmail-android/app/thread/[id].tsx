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
        const mapped = (data.messages || []).map((msg: Record<string, unknown>) => ({
          id: String(msg.id || Math.random()),
          from:
            (msg.from as { text?: string; address?: string } | undefined)?.text ||
            (msg.from as { text?: string; address?: string } | undefined)?.address ||
            'Unknown sender',
          subject: (msg.subject as string | undefined) || '(no subject)',
          html: ((msg.decodedBody as string | undefined) || (msg.body as string | undefined) || '').trim(),
          date: ((msg.internalDate as string | undefined) || (msg.date as string | undefined) || '').trim(),
        }));
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
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Thread
        </Text>
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
  container: { flex: 1, backgroundColor: '#0e0e11' },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222228',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#1f7de8', borderRadius: 6 },
  backText: { color: '#fff', fontWeight: '700' },
  headerTitle: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', flex: 1 },
  meta: { color: '#f2b990', fontSize: 14, margin: 16 },
  error: { color: '#ff9b9b', fontSize: 13, margin: 16 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  messageCard: { backgroundColor: '#17171c', borderRadius: 10, padding: 12 },
  from: { color: '#9bc7ff', fontSize: 12, marginBottom: 2 },
  subject: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  date: { color: '#7f7f88', fontSize: 11, marginTop: 2, marginBottom: 8 },
  body: { backgroundColor: '#0f1014', borderRadius: 8, padding: 10 },
  emptyBody: { color: '#9a9aa3' },
});

