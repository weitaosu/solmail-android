import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { trpc } from '@/src/api/trpc';

function parseRecipients(input: string) {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

export default function ComposeScreen() {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    try {
      setSending(true);
      setError(null);
      const recipients = parseRecipients(to);
      if (!recipients.length) {
        setError('Please add at least one recipient.');
        return;
      }
      await trpc.mail.send.mutate({
        to: recipients,
        subject: subject.trim() || '(no subject)',
        message: body,
        attachments: [],
        headers: {},
      });
      router.replace('/inbox');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New email</Text>
        <Pressable onPress={handleSend} disabled={sending}>
          {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.headerAction}>Send</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.form}>
        <TextInput
          value={to}
          onChangeText={setTo}
          placeholder="To (comma-separated emails)"
          placeholderTextColor="#7f8898"
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
          placeholderTextColor="#7f8898"
          style={styles.input}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Write your message..."
          placeholderTextColor="#7f8898"
          style={styles.body}
          multiline
          textAlignVertical="top"
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d11' },
  header: {
    paddingTop: 56,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f2a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#f4f7fc', fontSize: 18, fontWeight: '700' },
  headerAction: { color: '#6b9ef5', fontSize: 15, fontWeight: '700' },
  form: { padding: 14, gap: 10 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252b38',
    backgroundColor: '#151923',
    color: '#d7dbe3',
    paddingHorizontal: 12,
  },
  body: {
    minHeight: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252b38',
    backgroundColor: '#151923',
    color: '#d7dbe3',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { color: '#ff9b9b', fontSize: 13, marginTop: 6 },
});

