import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { useMobileWallet } from '@/src/wallet/mobile-wallet-provider';
import { trpc } from '@/src/api/trpc';
import { Avatar } from '@/components/ui/avatar';
import { Chip } from '@/components/ui/chip';
import { EmailScoringModal } from '@/components/email-scoring-modal';
import { palette } from '@/constants/colors';

/** Anchor `register_and_claim` discriminator: sha256("global:register_and_claim")[0:8]. */
const REGISTER_AND_CLAIM_DISCRIMINATOR = Uint8Array.from([
  127, 144, 210, 98, 66, 165, 255, 139,
]);
/** 8 disc + Escrow account fields; status byte sits at index 128. */
const ESCROW_MIN_DATA_LEN = 130;
const ESCROW_STATUS_PENDING = 0;

type EscrowMeta = { senderPubkey: string; threadIdHex: string };

function getHeaderInsensitive(headers: Record<string, string> | undefined, canonical: string) {
  if (!headers) return undefined;
  const want = canonical.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want && typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** First message in the thread carrying SolMail escrow headers (for reply settlement). */
function findSolmailEscrowHeaders(messages: unknown[]): EscrowMeta | null {
  for (const msg of messages) {
    const h = (msg as { headers?: Record<string, string> }).headers;
    const tid = getHeaderInsensitive(h, 'X-Solmail-Thread-Id');
    const spk = getHeaderInsensitive(h, 'X-Solmail-Sender-Pubkey');
    if (!tid || !spk) continue;
    const hex = tid.replace(/^0x/i, '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) continue;
    try {
      new PublicKey(spk.trim());
    } catch {
      continue;
    }
    return { threadIdHex: hex.toLowerCase(), senderPubkey: spk.trim() };
  }
  return null;
}

function threadIdHexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parseRecipients(input: string) {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function recipientTokens(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip "Name <email>" → email-only label for a chip; fall back to raw token. */
function chipLabel(token: string): string {
  const angle = /<([^<>]+)>/.exec(token);
  if (angle?.[1]) return angle[1].trim();
  return token;
}

/** Strip HTML tags and normalize whitespace into a plain-text quote body. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Prefix every line of the source with `> ` for plain-text reply quoting. */
function quoteLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n');
}

/** Build the Gmail-web "Forwarded message" trailer to seed the body. */
function buildForwardBody(args: {
  fromName: string;
  fromEmail: string;
  date: string;
  subject: string;
  toList: string[];
  decodedBody: string;
}): string {
  const dateLabel = args.date ? new Date(args.date).toLocaleString() : '';
  const fromLine = args.fromEmail
    ? `${args.fromName} <${args.fromEmail}>`
    : args.fromName || '(unknown)';
  const toLine = args.toList.length ? args.toList.join(', ') : '—';
  const trailer =
    `\n\n---------- Forwarded message ----------\n` +
    `From: ${fromLine}\n` +
    (dateLabel ? `Date: ${dateLabel}\n` : '') +
    `Subject: ${args.subject || '(no subject)'}\n` +
    `To: ${toLine}\n\n` +
    htmlToPlain(args.decodedBody);
  return trailer;
}

/**
 * Gmail-style reply quote: empty space for the user, then a one-line
 * "On <date>, <name> <email> wrote:" lead-in, then the original body
 * with each line prefixed by `> `.
 */
function buildReplyBody(args: {
  fromName: string;
  fromEmail: string;
  date: string;
  decodedBody: string;
}): string {
  const dateLabel = args.date ? new Date(args.date).toLocaleString() : '';
  const fromLabel = args.fromEmail
    ? `${args.fromName} <${args.fromEmail}>`
    : args.fromName || '(unknown sender)';
  const lead = dateLabel
    ? `On ${dateLabel}, ${fromLabel} wrote:`
    : `${fromLabel} wrote:`;
  const quoted = quoteLines(htmlToPlain(args.decodedBody));
  // Three leading newlines = two visibly empty lines before the quote header,
  // making it clear that the user's reply belongs at the very top.
  return `\n\n\n${lead}\n${quoted}\n`;
}

type ReplySourceMessage = {
  sender: { email?: string };
  replyTo?: string;
  to: { email: string }[];
  cc?: { email: string }[] | null;
  bcc?: { email: string }[] | null;
};

/** Parse first email from Reply-To header (may be "Name <a@b>" or comma-separated list). */
function firstEmailFromHeader(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  const segments = raw.split(',');
  for (const segment of segments) {
    const t = segment.trim();
    if (!t) continue;
    const angle = /<([^<>]+)>/.exec(t);
    const inner = angle?.[1]?.trim().replace(/^mailto:/i, '');
    if (inner?.includes('@')) return inner.replace(/,$/, '').trim();
    const bare = t.replace(/^mailto:/i, '').replace(/^[('"]+|[)'"]+$/g, '').trim();
    const at = bare.match(/[^\s<>]+@[^\s<>]+/);
    if (at?.[0]) return at[0].replace(/,$/, '');
  }
  return null;
}

function normEmail(email: string) {
  return email.trim().toLowerCase().replace(/^mailto:/i, '');
}

function addToDeduped(bucket: string[], email: string) {
  const n = normEmail(email);
  if (!n.includes('@')) return;
  if (bucket.some((x) => normEmail(x) === n)) return;
  bucket.push(email.trim());
}

type ThreadLikeMessage = ReplySourceMessage & { receivedOn?: string };

/** Reply-all excluding current account; respondent (reply-to → sender) is always on To when they're not you. */
function buildReplyAllRecipients(
  latest: ReplySourceMessage,
  userEmailRaw: string,
  allMessagesDescending?: ThreadLikeMessage[],
) {
  const userEmail = normEmail(userEmailRaw);
  const structuredSender = latest.sender?.email?.trim() ?? '';
  const senderNorm = structuredSender ? normEmail(structuredSender) : '';
  const replyParsed = firstEmailFromHeader(latest.replyTo ?? null);

  const respondentNorm = replyParsed ? normEmail(replyParsed) : senderNorm;
  const respondentDisplay =
    replyParsed ??
    (structuredSender.includes('@')
      ? structuredSender
      : firstEmailFromHeader(structuredSender) ?? structuredSender);

  const to: string[] = [];
  const cc: string[] = [];
  const bcc: string[] = [];

  const shouldAddRespondent =
    respondentDisplay && respondentNorm && respondentNorm !== userEmail;
  if (shouldAddRespondent) addToDeduped(to, respondentDisplay);

  for (const recipient of latest.to ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = normEmail(email);
    if (normalized === userEmail) continue;
    if (respondentNorm && normalized === respondentNorm) continue;
    if (!to.some((t) => normEmail(t) === normalized)) addToDeduped(to, email);
  }
  for (const recipient of latest.cc ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = normEmail(email);
    if (normalized === userEmail) continue;
    if (respondentNorm && normalized === respondentNorm) continue;
    if (to.some((t) => normEmail(t) === normalized)) continue;
    if (!cc.some((c) => normEmail(c) === normalized)) addToDeduped(cc, email);
  }
  for (const recipient of latest.bcc ?? []) {
    const email = recipient?.email?.trim();
    if (!email) continue;
    const normalized = normEmail(email);
    if (normalized === userEmail) continue;
    if (respondentNorm && normalized === respondentNorm) continue;
    if (to.some((t) => normEmail(t) === normalized) || cc.some((c) => normEmail(c) === normalized)) {
      continue;
    }
    addToDeduped(bcc, email);
  }

  if (to.length === 0 && allMessagesDescending?.length) {
    const ts = (m: ThreadLikeMessage) => {
      const t = new Date(m.receivedOn ?? '').getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const desc = [...allMessagesDescending].sort((a, b) => ts(b) - ts(a));
    for (const m of desc) {
      const replyFirst = firstEmailFromHeader(m.replyTo ?? null);
      const structured = m.sender?.email?.trim() ?? '';
      const respondent = replyFirst ?? structured;
      const sn = normEmail(respondent);
      if (!sn.includes('@') || sn === userEmail) continue;
      addToDeduped(to, respondent.trim());
      break;
    }
  }

  return { to, cc, bcc };
}

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    replyThread?: string;
    replyMode?: string;
    forwardThread?: string;
  }>();
  const replyThreadRaw = params.replyThread;
  const forwardThreadRaw = params.forwardThread;
  const replyThreadId =
    typeof replyThreadRaw === 'string' ? replyThreadRaw : replyThreadRaw?.[0];
  const forwardThreadId =
    typeof forwardThreadRaw === 'string' ? forwardThreadRaw : forwardThreadRaw?.[0];
  const replyModeParam =
    typeof params.replyMode === 'string' ? params.replyMode : params.replyMode?.[0];
  const replyOnly = replyThreadId && replyModeParam !== 'replyAll';
  const isReply = Boolean(replyThreadId);
  const isForward = Boolean(forwardThreadId);
  const composeMode: 'new' | 'reply' | 'replyAll' | 'forward' = isForward
    ? 'forward'
    : isReply
      ? replyOnly
        ? 'reply'
        : 'replyAll'
      : 'new';

  const [toChips, setToChips] = useState<string[]>([]);
  const [ccChips, setCcChips] = useState<string[]>([]);
  const [bccChips, setBccChips] = useState<string[]>([]);
  const [toDraft, setToDraft] = useState('');
  const [ccDraft, setCcDraft] = useState('');
  const [bccDraft, setBccDraft] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodySelection, setBodySelection] = useState<{ start: number; end: number } | undefined>(
    undefined,
  );
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [replyPrefilling, setReplyPrefilling] = useState(false);
  const [fromEmail, setFromEmail] = useState<string>('');

  const replyEscrowMetaRef = useRef<EscrowMeta | null>(null);
  const threadMessagesRef = useRef<{ decodedBody: string; subject: string }[]>([]);
  const [scoringVisible, setScoringVisible] = useState(false);
  const [scoringPass, setScoringPass] = useState<boolean | undefined>(undefined);
  const { account, connect, signAndSendTransactions } = useMobileWallet();
  /** 0.0000001 SOL per email — tiny test amount on devnet. */
  const ESCROW_AMOUNT_SOL = 0.0000001;
  /** Floor balance the user's wallet must hold to pay escrow rent + fee. */
  const MIN_DEVNET_SOL = 0.000001;
  const rpcUrl = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const chain = process.env.EXPO_PUBLIC_SOLANA_CHAIN || 'solana:devnet';
  const escrowProgramId = new PublicKey(
    process.env.EXPO_PUBLIC_ESCROW_PROGRAM_ID || 'DQgzwnMGkmgB5kC92ES28Kgw9gqfcpSnXgy8ogjjLuvd',
  );
  const INIT_ESCROW_DISCRIMINATOR = Uint8Array.from([243, 160, 77, 153, 11, 92, 48, 209]);

  /**
   * Verify the user's main wallet (MWA) is authorized and has enough SOL,
   * triggering Seed Vault / Phantom auth on first call. Every escrow tx
   * signs through this wallet — popup per send is expected.
   */
  const ensureWalletWithSol = async () => {
    const activeAccount = account || (await connect());
    if (!chain.includes('devnet')) {
      throw new Error('Compose is restricted to devnet wallet flow right now.');
    }
    const connection = new Connection(rpcUrl, 'processed');
    const lamports = await connection.getBalance(activeAccount.publicKey);
    const balanceSol = lamports / LAMPORTS_PER_SOL;
    if (balanceSol < MIN_DEVNET_SOL) {
      throw new Error(
        `Need at least ${MIN_DEVNET_SOL} SOL on devnet to send. Wallet balance: ${balanceSol.toFixed(6)} SOL.`,
      );
    }
    return activeAccount;
  };

  /**
   * Sign + broadcast register_and_claim if the thread carries SolMail
   * headers AND the PDA is still pending. Pops the user's wallet for
   * a biometric/PIN approval — claimed lamports land in the wallet
   * via Anchor's `close = receiver`.
   */
  const claimReplyEscrowIfPending = async () => {
    const meta = replyEscrowMetaRef.current;
    if (!meta) return;
    const threadBytes = threadIdHexToBytes(meta.threadIdHex);
    if (!threadBytes) throw new Error('Invalid X-Solmail-Thread-Id header.');
    const senderPk = new PublicKey(meta.senderPubkey);
    const connection = new Connection(rpcUrl, 'confirmed');
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('escrow'), senderPk.toBuffer(), threadBytes],
      escrowProgramId,
    );
    const info = await connection.getAccountInfo(escrowPda, 'confirmed');
    if (!info || !info.owner.equals(escrowProgramId)) return;
    if (info.data.length < ESCROW_MIN_DATA_LEN) throw new Error('Escrow account data is invalid.');
    if (info.data[128] !== ESCROW_STATUS_PENDING) return;

    const receiver = (await ensureWalletWithSol()).publicKey;
    const data = new Uint8Array(8 + 32 + 32);
    data.set(REGISTER_AND_CLAIM_DISCRIMINATOR, 0);
    data.set(senderPk.toBuffer(), 8);
    data.set(threadBytes, 8 + 32);

    const ix = new TransactionInstruction({
      programId: escrowProgramId,
      keys: [
        { pubkey: receiver, isSigner: true, isWritable: true },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = receiver;
    const signatures = await signAndSendTransactions([tx]);
    const signature = signatures[0];
    if (!signature) throw new Error('No claim transaction signature returned by wallet.');
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );
  };

  /**
   * Initialize a fresh escrow PDA for an outgoing email, signed by the
   * user's main wallet. Pops Seed Vault / Phantom — every send asks for
   * approval. Returns the random thread_id hex + sender pubkey to set
   * on email headers.
   */
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
    if (!signature) throw new Error('No escrow transaction signature returned by wallet.');
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

  /** Add a chip from the in-progress draft (called on comma/blur/submit). */
  const commitDraft = (
    chips: string[],
    setChips: (v: string[]) => void,
    draft: string,
    setDraft: (v: string) => void,
  ) => {
    const tokens = recipientTokens(draft);
    if (!tokens.length) {
      setDraft('');
      return;
    }
    const merged = [...chips];
    for (const t of tokens) {
      if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
    }
    setChips(merged);
    setDraft('');
  };

  /** Detect a comma typed inside the draft and commit chips immediately. */
  const handleDraftChange = (
    chips: string[],
    setChips: (v: string[]) => void,
    setDraft: (v: string) => void,
  ) => (text: string) => {
    if (text.includes(',')) {
      const parts = text.split(',');
      const trailing = parts.pop() ?? '';
      const tokens = parts.map((s) => s.trim()).filter(Boolean);
      if (tokens.length) {
        const merged = [...chips];
        for (const t of tokens) {
          if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
        }
        setChips(merged);
      }
      setDraft(trailing);
    } else {
      setDraft(text);
    }
  };

  const removeChip = (
    chips: string[],
    setChips: (v: string[]) => void,
    index: number,
  ) => setChips(chips.filter((_, i) => i !== index));

  const subjectInputRef = useRef<TextInput>(null);
  const bodyInputRef = useRef<TextInput>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const conn = await trpc.connections.getDefault.query();
        if (!cancelled && conn?.email) setFromEmail(conn.email);
      } catch {
        // From line is informational; silent failure is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!replyThreadId && !forwardThreadId) return;
    let cancelled = false;
    const sourceThreadId = replyThreadId || forwardThreadId!;
    (async () => {
      try {
        setReplyPrefilling(true);
        setError(null);
        const [connection, thread] = await Promise.all([
          trpc.connections.getDefault.query().catch(() => null as { email?: string } | null),
          trpc.mail.get.query({ id: sourceThreadId, forceFresh: false }),
        ]);
        if (cancelled) return;
        // Missing connection email is non-fatal — proceed with empty self so
        // recipient extraction still runs (no self-dedup, but at least chips
        // populate). Previously this early-returned and left chips empty.
        const userEmail = connection?.email ?? '';

        const messages = thread.messages ?? [];
        // Replies need escrow header lookup so we can claim on send.
        replyEscrowMetaRef.current = isReply ? findSolmailEscrowHeaders(messages) : null;
        // Snapshot the thread for the quality-check call at send time.
        threadMessagesRef.current = isReply
          ? messages.map((m: { decodedBody?: string; body?: string; subject?: string }) => ({
              decodedBody: m.decodedBody || m.body || '',
              subject: m.subject || '',
            }))
          : [];
        const descSorted = [...messages].sort((a, b) => {
          const da = new Date((a as { receivedOn?: string }).receivedOn || 0).getTime();
          const db = new Date((b as { receivedOn?: string }).receivedOn || 0).getTime();
          return db - da;
        });
        const latest = thread.latest ?? descSorted[0];
        if (!latest) {
          setError('Could not load thread.');
          return;
        }

        const subj = (latest.subject || '').trim() || '(no subject)';

        if (isForward) {
          // Forward: clear recipients, prefix Fwd:, seed body with quoted original.
          setToChips([]);
          setCcChips([]);
          setBccChips([]);
          setShowCcBcc(false);
          setSubject(subj.toLowerCase().startsWith('fwd:') ? subj : `Fwd: ${subj}`);
          const sender = (latest as { sender?: { name?: string; email?: string } }).sender ?? {};
          const toList =
            ((latest as { to?: { name?: string; email?: string }[] }).to ?? [])
              .map((r) => (r.name ? `${r.name} <${r.email ?? ''}>` : r.email || ''))
              .filter(Boolean);
          const decoded =
            (latest as { decodedBody?: string; body?: string }).decodedBody ||
            (latest as { decodedBody?: string; body?: string }).body ||
            '';
          setBody(
            buildForwardBody({
              fromName: sender.name || sender.email || 'Unknown',
              fromEmail: sender.email || '',
              date: (latest as { receivedOn?: string }).receivedOn || '',
              subject: subj,
              toList,
              decodedBody: decoded,
            }),
          );
        } else {
          // Reply / Reply all
          const all = buildReplyAllRecipients(
            latest as ReplySourceMessage,
            userEmail,
            descSorted as ThreadLikeMessage[],
          );

          /**
           * Hard fallback so the To chip never ends up empty: if the builder
           * produced nothing (rare data shapes — outbound thread with no
           * historical inbound, missing sender, etc.), fall back to the
           * latest message's sender or first To recipient.
           */
          let toList = all.to;
          if (toList.length === 0) {
            const sender = (latest as { sender?: { email?: string } }).sender;
            const firstTo = (latest as { to?: { email?: string }[] }).to?.[0];
            const fallback = sender?.email || firstTo?.email;
            if (fallback) toList = [fallback];
          }

          if (replyOnly) {
            // Reply: just the respondent (first To from reply-all).
            setToChips(toList.slice(0, 1));
            setCcChips([]);
            setBccChips([]);
            setShowCcBcc(false);
          } else {
            setToChips(toList);
            setCcChips(all.cc);
            setBccChips(all.bcc);
            if (all.cc.length || all.bcc.length) setShowCcBcc(true);
          }

          // Quote the original below an empty space (Gmail mobile pattern).
          const sender = (latest as { sender?: { name?: string; email?: string } }).sender ?? {};
          const decoded =
            (latest as { decodedBody?: string; body?: string }).decodedBody ||
            (latest as { decodedBody?: string; body?: string }).body ||
            '';
          setBody(
            buildReplyBody({
              fromName: sender.name || sender.email || 'Unknown',
              fromEmail: sender.email || '',
              date: (latest as { receivedOn?: string }).receivedOn || '',
              decodedBody: decoded,
            }),
          );
          setSubject(subj.toLowerCase().startsWith('re:') ? subj : `Re: ${subj}`);
        }
      } catch (loadErr) {
        if (!cancelled) {
          setError(loadErr instanceof Error ? loadErr.message : 'Failed to load thread');
        }
      } finally {
        if (!cancelled) {
          setReplyPrefilling(false);
          /**
           * Force the cursor to the top so the user types ABOVE the quoted
           * history. setNativeProps was unreliable on Android — we now drive
           * the position through the controlled `selection` prop and release
           * it after a beat so the user can move the caret freely.
           */
          setBodySelection({ start: 0, end: 0 });
          setTimeout(() => bodyInputRef.current?.focus(), 60);
          setTimeout(() => setBodySelection(undefined), 600);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replyThreadId, forwardThreadId, isForward, isReply, replyOnly]);

  const handleSend = async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSending(true);
      setSendStatus('');
      setError(null);
      // Pull in any uncommitted text from each input as a final chip.
      const flushedTo = recipientTokens([...toChips, toDraft].filter(Boolean).join(','));
      const flushedCc = recipientTokens([...ccChips, ccDraft].filter(Boolean).join(','));
      const flushedBcc = recipientTokens([...bccChips, bccDraft].filter(Boolean).join(','));
      const recipients = parseRecipients(flushedTo.join(','));
      const ccRecipients = parseRecipients(flushedCc.join(','));
      const bccRecipients = parseRecipients(flushedBcc.join(','));
      if (!recipients.length) {
        setError('Add at least one recipient.');
        return;
      }

      /**
       * On-chain escrow step is signed by the user's main wallet via MWA —
       * Seed Vault on Seeker, Phantom/Solflare elsewhere. Every send pops
       * the wallet for biometric/PIN approval. New mail creates a fresh
       * escrow PDA + sets X-Solmail-* headers; reply auto-claims any
       * pending escrow PDA referenced in the thread headers (also a popup).
       */
      const headers: Record<string, string> = {};

      // Quick advisory quality check on replies — server makes the
      // authoritative escrow decision after send, so we proceed regardless
      // and only skip the on-chain claim popup when we already know fail.
      // Fail closed on errors to match the web composer: if scoring is
      // unreachable, skip the client claim and let the server agent decide.
      let replyPassed = false;
      if (isReply) {
        try {
          setSendStatus('Checking reply…');
          setScoringPass(undefined);
          setScoringVisible(true);
          const result = await trpc.mail.scoreEmail.mutate({
            replyContent: body,
            threadEmails:
              threadMessagesRef.current.length > 0 ? threadMessagesRef.current : undefined,
          });
          replyPassed = result.pass;
          setScoringPass(result.pass);
          console.log(
            `[scoring] ${result.pass ? 'PASS' : 'FAIL'} — score=${result.score}/100 (threshold 15)`,
          );
        } catch (scoreErr) {
          console.warn('[scoring] quality check failed (non-blocking):', scoreErr);
          setScoringVisible(false);
        }
      } else {
        // Non-reply sends don't have an escrow to claim, so skip the gate.
        replyPassed = true;
      }

      if (isReply) {
        if (replyEscrowMetaRef.current && replyPassed) {
          setSendStatus('Sign claim in wallet…');
          await claimReplyEscrowIfPending();
        }
      } else {
        setSendStatus('Sign escrow in wallet…');
        const activeAccount = await ensureWalletWithSol();
        const escrow = await createEscrowForEmail(activeAccount.publicKey);
        headers['X-Solmail-Sender-Pubkey'] = escrow.senderPubkey;
        headers['X-Solmail-Thread-Id'] = escrow.threadIdHex;
      }

      setSendStatus('Sending…');
      await trpc.mail.send.mutate({
        to: recipients,
        cc: ccRecipients.length ? ccRecipients : undefined,
        bcc: bccRecipients.length ? bccRecipients : undefined,
        subject: subject.trim() || '(no subject)',
        message: body,
        attachments: [],
        ...(isReply ? { threadId: replyThreadId } : {}),
        headers,
      });

      router.replace('/inbox');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send email');
    } finally {
      setSending(false);
      setSendStatus('');
    }
  };

  const headerTitle =
    composeMode === 'reply'
      ? 'Reply'
      : composeMode === 'replyAll'
        ? 'Reply all'
        : composeMode === 'forward'
          ? 'Forward'
          : 'Compose';
  const sendDisabled = sending || replyPrefilling;

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerIcon}>
            <Feather name="x" size={22} color={palette.textSecondary} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{headerTitle}</Text>
            {!!sendStatus && <Text style={styles.sendStatus}>{sendStatus}</Text>}
          </View>
          <Pressable
            hitSlop={10}
            onPress={handleSend}
            disabled={sendDisabled}
            style={[styles.headerIcon, sendDisabled && styles.iconDisabled]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={palette.accentSoft} />
            ) : (
              <Feather name="send" size={20} color={palette.accentSoft} />
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {replyPrefilling && (
            <View style={styles.prefillRow}>
              <ActivityIndicator size="small" color={palette.accentSoft} />
              <Text style={styles.prefillText}>Loading recipients…</Text>
            </View>
          )}

          {!!fromEmail && (
            <View style={styles.fromRow}>
              <Avatar seed={fromEmail} size={28} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fromLabel}>From</Text>
                <Text style={styles.fromValue} numberOfLines={1}>
                  {fromEmail}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>To</Text>
            <View style={styles.fieldGrow}>
              {toChips.length > 0 && (
                <View style={styles.chipsWrap}>
                  {toChips.map((token, i) => (
                    <Chip
                      key={`to-${i}-${token}`}
                      label={chipLabel(token)}
                      onRemove={() => removeChip(toChips, setToChips, i)}
                    />
                  ))}
                </View>
              )}
              <TextInput
                value={toDraft}
                onChangeText={handleDraftChange(toChips, setToChips, setToDraft)}
                onBlur={() => commitDraft(toChips, setToChips, toDraft, setToDraft)}
                onSubmitEditing={() => commitDraft(toChips, setToChips, toDraft, setToDraft)}
                placeholder={toChips.length === 0 ? 'Recipients' : 'Add recipient'}
                placeholderTextColor={palette.textFaint}
                style={styles.chipInput}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                blurOnSubmit={false}
              />
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => setShowCcBcc((v) => !v)}
              style={styles.ccToggle}
            >
              <Feather
                name={showCcBcc ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={palette.textMuted}
              />
            </Pressable>
          </View>

          {showCcBcc && (
            <>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Cc</Text>
                <View style={styles.fieldGrow}>
                  {ccChips.length > 0 && (
                    <View style={styles.chipsWrap}>
                      {ccChips.map((token, i) => (
                        <Chip
                          key={`cc-${i}-${token}`}
                          label={chipLabel(token)}
                          onRemove={() => removeChip(ccChips, setCcChips, i)}
                        />
                      ))}
                    </View>
                  )}
                  <TextInput
                    value={ccDraft}
                    onChangeText={handleDraftChange(ccChips, setCcChips, setCcDraft)}
                    onBlur={() => commitDraft(ccChips, setCcChips, ccDraft, setCcDraft)}
                    onSubmitEditing={() => commitDraft(ccChips, setCcChips, ccDraft, setCcDraft)}
                    placeholder={ccChips.length === 0 ? 'Add Cc' : ''}
                    placeholderTextColor={palette.textFaint}
                    style={styles.chipInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                </View>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Bcc</Text>
                <View style={styles.fieldGrow}>
                  {bccChips.length > 0 && (
                    <View style={styles.chipsWrap}>
                      {bccChips.map((token, i) => (
                        <Chip
                          key={`bcc-${i}-${token}`}
                          label={chipLabel(token)}
                          onRemove={() => removeChip(bccChips, setBccChips, i)}
                        />
                      ))}
                    </View>
                  )}
                  <TextInput
                    value={bccDraft}
                    onChangeText={handleDraftChange(bccChips, setBccChips, setBccDraft)}
                    onBlur={() => commitDraft(bccChips, setBccChips, bccDraft, setBccDraft)}
                    onSubmitEditing={() => commitDraft(bccChips, setBccChips, bccDraft, setBccDraft)}
                    placeholder={bccChips.length === 0 ? 'Add Bcc' : ''}
                    placeholderTextColor={palette.textFaint}
                    style={styles.chipInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                </View>
              </View>
            </>
          )}

          <View style={styles.fieldRow}>
            <TextInput
              ref={subjectInputRef}
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={palette.textFaint}
              style={[styles.fieldInput, styles.subjectInput]}
              returnKeyType="next"
              onSubmitEditing={() => bodyInputRef.current?.focus()}
            />
          </View>

          <TextInput
            ref={bodyInputRef}
            value={body}
            onChangeText={setBody}
            selection={bodySelection}
            placeholder="Compose email"
            placeholderTextColor={palette.textFaint}
            style={styles.body}
            multiline
            textAlignVertical="top"
          />

          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color={palette.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <EmailScoringModal
        visible={scoringVisible}
        onDismiss={() => setScoringVisible(false)}
        pass={scoringPass}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.surface },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDisabled: { opacity: 0.4 },
  titleWrap: { alignItems: 'center', flex: 1 },
  title: { color: palette.textPrimary, fontSize: 18, fontWeight: '600' },
  sendStatus: { color: palette.accentSoft, fontSize: 11, marginTop: 1 },
  form: { paddingBottom: 40 },
  prefillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  prefillText: { color: palette.accentSoft, fontSize: 13 },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  fromLabel: { color: palette.textFaint, fontSize: 11, letterSpacing: 0.4 },
  fromValue: { color: palette.textPrimary, fontSize: 14, marginTop: 1 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  fieldLabel: {
    color: palette.textFaint,
    fontSize: 13,
    width: 36,
  },
  fieldInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 15,
    paddingVertical: 12,
  },
  fieldGrow: {
    flex: 1,
    paddingVertical: 6,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  chipInput: {
    color: palette.textPrimary,
    fontSize: 15,
    paddingVertical: 6,
    minHeight: 32,
  },
  ccToggle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectInput: { fontWeight: '600' },
  body: {
    minHeight: 320,
    color: palette.textPrimary,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
    lineHeight: 22,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 4,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2a1a1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5a2a32',
  },
  errorText: { color: palette.danger, fontSize: 13, flex: 1 },
});
