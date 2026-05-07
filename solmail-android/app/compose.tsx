import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { trpc } from '@/src/api/trpc';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';

function parseRecipients(input: string) {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

type ReplySourceMessage = {
  sender: { email: string };
  replyTo?: string;
  to: { email: string }[];
  cc?: { email: string }[] | null;
  bcc?: { email: string }[] | null;
};

/** Matches web EmailComposer replyAll semantics (excluding current user addresses). */
function buildReplyAllRecipients(latest: ReplySourceMessage, userEmailRaw: string) {
  const userEmail = userEmailRaw.trim().toLowerCase();
  const senderEmail = latest.sender.email.trim().toLowerCase();
  const to: string[] = [];
  const cc: string[] = [];
  const bcc: string[] = [];

  if (senderEmail !== userEmail) {
    const primary = (latest.replyTo?.trim() || latest.sender.email).trim();
    if (primary) to.push(primary);
  }

  for (const recipient of latest.to ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = email.toLowerCase();
    if (normalized === userEmail || normalized === senderEmail) continue;
    if (!to.some((t) => t.toLowerCase() === normalized)) to.push(email);
  }

  for (const recipient of latest.cc ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = email.toLowerCase();
    if (normalized === userEmail) continue;
    if (to.some((t) => t.toLowerCase() === normalized)) continue;
    if (!cc.some((c) => c.toLowerCase() === normalized)) cc.push(email);
  }

  for (const recipient of latest.bcc ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = email.toLowerCase();
    if (normalized === userEmail) continue;
    if (
      to.some((t) => t.toLowerCase() === normalized) ||
      cc.some((c) => c.toLowerCase() === normalized)
    ) {
      continue;
    }
    bcc.push(email);
  }

  return { to, cc, bcc };
}

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ replyThread?: string }>();
  const replyThreadRaw = params.replyThread;
  const replyThreadId =
    typeof replyThreadRaw === 'string' ? replyThreadRaw : replyThreadRaw?.[0];

  const { account, connect, signAndSendTransactions } = useMobileWallet();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceLabel, setBalanceLabel] = useState('');
  const [replyPrefilling, setReplyPrefilling] = useState(false);

  const MIN_DEVNET_SOL = 0.000001;
  const ESCROW_AMOUNT_SOL = 0.0000001;
  const rpcUrl = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const chain = process.env.EXPO_PUBLIC_SOLANA_CHAIN || 'solana:devnet';
  const escrowProgramId = new PublicKey(
    process.env.EXPO_PUBLIC_ESCROW_PROGRAM_ID || 'DQgzwnMGkmgB5kC92ES28Kgw9gqfcpSnXgy8ogjjLuvd',
  );
  const INIT_ESCROW_DISCRIMINATOR = Uint8Array.from([243, 160, 77, 153, 11, 92, 48, 209]);

  useEffect(() => {
    if (!replyThreadId) return;
    let cancelled = false;
    (async () => {
      try {
        setReplyPrefilling(true);
        setError(null);
        const [connection, thread] = await Promise.all([
          trpc.connections.getDefault.query(),
          trpc.mail.get.query({ id: replyThreadId, forceFresh: false }),
        ]);
        if (cancelled || !connection?.email) return;

        const messages = thread.messages ?? [];
        let latest =
          thread.latest ??
          [...messages].sort((a, b) => {
            const da = new Date(a.receivedOn || 0).getTime();
            const db = new Date(b.receivedOn || 0).getTime();
            return db - da;
          })[0];

        if (!latest) {
          setError('Could not load thread to reply.');
          return;
        }

        const { to: toList, cc: ccList, bcc: bccList } = buildReplyAllRecipients(
          latest as ReplySourceMessage,
          connection.email,
        );
        setTo(toList.join(', '));
        setCc(ccList.join(', '));
        setBcc(bccList.join(', '));

        const subj = (latest.subject || '').trim() || '(no subject)';
        setSubject(subj.toLowerCase().startsWith('re:') ? subj : `Re: ${subj}`);
      } catch (replyErr) {
        if (!cancelled) {
          setError(replyErr instanceof Error ? replyErr.message : 'Failed to load reply');
        }
      } finally {
        if (!cancelled) setReplyPrefilling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replyThreadId]);

  const ensureWalletWithSol = async () => {
    const activeAccount = account || (await connect());
    if (!chain.includes('devnet')) {
      throw new Error('Compose is restricted to devnet wallet flow right now.');
    }
    const connection = new Connection(rpcUrl, 'processed');
    const lamports = await connection.getBalance(activeAccount.publicKey);
    const balanceSol = lamports / LAMPORTS_PER_SOL;
    setBalanceLabel(`${balanceSol.toFixed(6)} SOL`);
    if (balanceSol < MIN_DEVNET_SOL) {
      throw new Error(
        `Need at least ${MIN_DEVNET_SOL} SOL on devnet to send with SolMail escrow. Current balance: ${balanceSol.toFixed(6)} SOL.`,
      );
    }
    return activeAccount;
  };

  const createEscrowForEmail = async (senderPubkey: PublicKey) => {
    const connection = new Connection(rpcUrl, 'confirmed');
    const threadIdBytes = new Uint8Array(32);
    crypto.getRandomValues(threadIdBytes);
    const amountLamports = BigInt(Math.floor(ESCROW_AMOUNT_SOL * LAMPORTS_PER_SOL));

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('escrow'), senderPubkey.toBuffer(), threadIdBytes],
      escrowProgramId,
    );

    const data = new Uint8Array(8 + 32 + 8);
    data.set(INIT_ESCROW_DISCRIMINATOR, 0);
    data.set(threadIdBytes, 8);
    new DataView(data.buffer).setBigUint64(8 + 32, amountLamports, true);

    const ix = new TransactionInstruction({
      programId: escrowProgramId,
      keys: [
        { pubkey: senderPubkey, isSigner: true, isWritable: true },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = senderPubkey;

    const signatures = await signAndSendTransactions([tx]);
    const signature = signatures[0];
    if (!signature) {
      throw new Error('No escrow transaction signature returned by wallet.');
    }

    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    const escrowAccount = await connection.getAccountInfo(escrowPda, 'confirmed');
    if (!escrowAccount || !escrowAccount.owner.equals(escrowProgramId)) {
      throw new Error('Escrow account was not created on-chain.');
    }

    const threadIdHex = Array.from(threadIdBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      signature,
      threadIdHex,
      senderPubkey: senderPubkey.toBase58(),
    };
  };

  const handleSend = async () => {
    try {
      setSending(true);
      setError(null);
      const recipients = parseRecipients(to);
      const ccRecipients = parseRecipients(cc);
      const bccRecipients = parseRecipients(bcc);
      if (!recipients.length) {
        setError('Please add at least one recipient.');
        return;
      }
      const activeAccount = await ensureWalletWithSol();
      const escrow = await createEscrowForEmail(activeAccount.publicKey);
      await trpc.mail.send.mutate({
        to: recipients,
        cc: ccRecipients.length ? ccRecipients : undefined,
        bcc: bccRecipients.length ? bccRecipients : undefined,
        subject: subject.trim() || '(no subject)',
        message: body,
        attachments: [],
        threadId: replyThreadId || undefined,
        headers: {
          'X-Solmail-Sender-Pubkey': escrow.senderPubkey,
          'X-Solmail-Thread-Id': escrow.threadIdHex,
        },
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
        <Text style={styles.title}>{replyThreadId ? 'Reply all' : 'New email'}</Text>
        <Pressable onPress={handleSend} disabled={sending || replyPrefilling}>
          {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.headerAction}>Send</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.form}>
        {replyPrefilling && (
          <View style={styles.prefillRow}>
            <ActivityIndicator size="small" color="#6b9ef5" />
            <Text style={styles.prefillText}>Loading recipients…</Text>
          </View>
        )}
        <View style={styles.walletRow}>
          <Text style={styles.walletText}>
            Wallet: {account ? `${account.publicKey.toBase58().slice(0, 4)}...${account.publicKey.toBase58().slice(-4)}` : 'Not connected'}
          </Text>
          <Pressable style={styles.walletButton} onPress={() => void connect()}>
            <Text style={styles.walletButtonText}>{account ? 'Reconnect' : 'Connect'}</Text>
          </Pressable>
        </View>
        {!!balanceLabel && <Text style={styles.balance}>{balanceLabel}</Text>}
        <TextInput
          value={to}
          onChangeText={setTo}
          placeholder="To (comma-separated emails)"
          placeholderTextColor="#7f8898"
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          value={cc}
          onChangeText={setCc}
          placeholder="Cc (optional)"
          placeholderTextColor="#7f8898"
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          value={bcc}
          onChangeText={setBcc}
          placeholder="Bcc (optional)"
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
  prefillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefillText: { color: '#9fb6d6', fontSize: 13 },
  walletRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletText: { color: '#d7dbe3', fontSize: 12 },
  walletButton: {
    borderWidth: 1,
    borderColor: '#2d3444',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#151923',
  },
  walletButtonText: { color: '#6b9ef5', fontWeight: '700', fontSize: 12 },
  balance: { color: '#9fb6d6', fontSize: 12 },
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

