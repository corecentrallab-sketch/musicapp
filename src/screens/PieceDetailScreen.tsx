/**
 * PieceDetailScreen — shows piece info with share card functionality.
 * Navigated to from daily challenge, history, or recommendations.
 *
 * After practicing a piece for >2 minutes, prompts the user to share
 * their progress via the ShareCard component.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import type { DailyChallengePiece } from '../types';
import { ScoreViewer } from '../components/ScoreViewer';
import { ShareCard } from '../components/ShareCard';
import { CoachPracticeCard } from '../components/CoachPracticeCard';
import { StreakNudgeCard } from '../components/StreakNudgeCard';
import { PurchaseWebView } from '../components/PurchaseWebView';
import { useHardwareBack } from '../hooks/useHardwareBack';
import {
  addPracticeMinutes,
  recordPractice,
  getTodayPracticeMinutes,
} from '../services/storage';
import { getDisplayStreakLocal } from '../services/reinforcementStore';
import { recordPieceOpened } from '../services/medalStore';
import { refreshStreakNudge } from '../services/notifications';
import {
  resolveShareCardPreviewData,
  sharePreviewAccessibilityLabel,
} from '../services/shareCardShare';
import { scoreAudioDecision } from '../services/scoreAudioSource';
// THE zero-promise fallback copy (§E, bundle E): the honest no-score line and the
// next-step labels come from resultSurface.ts, so the card and promiseAudit's
// guard read the SAME words.
import {
  FIND_A_PIECE_LEVER_HINT,
  FIND_A_PIECE_LEVER_LABEL,
  HUM_IT_LEVER_HINT,
  HUM_IT_LEVER_LABEL,
  NO_HOSTED_SCORE_LINE,
} from '../services/resultSurface';
// The licensed-retailer SEARCH for a work's printed edition (owner Q2, ratified
// 10-02): the URL builder is searchExternal.ts — the one module allowed to build a
// retailer search link — and the block below opens it in THIS page's in-app shell.
import { externalSearchSection } from '../services/searchExternal';
import { SearchExternalSection } from '../components/SearchExternalSection';
// The sheet-music card for a piece with no score we may host but a licensed
// retailer link (a modern song opened from History — owner 10-01: "pressing the
// sheet-music card must take the user AUTOMATICALLY TO PURCHASE").
import { modernSheetCard } from '../services/historyPiece';
// THE money path: the primary (Sheet Music Direct) link, resolved from the map —
// never by naming a retailer key here.
import { primaryPurchaseUrl, secondaryPurchaseUrl } from '../services/purchaseCta';

interface PieceDetailScreenProps {
  piece: DailyChallengePiece;
  onBack: () => void;
  /**
   * The honest no-score state's next steps (bundle E, §E.2). Both are OPTIONAL:
   * a host that cannot reach the flow simply does not pass it, and the lever is
   * then not rendered at all — never a dead button (§E.1.1).
   */
  onHumIt?: () => void;
  onFindPiece?: () => void;
}

export const PieceDetailScreen: React.FC<PieceDetailScreenProps> = ({
  piece,
  onBack,
  onHumIt,
  onFindPiece,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [sharing, setSharing] = useState(false);
  const [showScoreViewer, setShowScoreViewer] = useState(false);
  const startedAt = useRef<number | null>(null);

  // Share-card state
  const [showShareCard, setShowShareCard] = useState(false);
  const [shareCardData, setShareCardData] = useState<{
    streak: number;
    practiceMinutes: number;
  }>({ streak: 0, practiceMinutes: 0 });

  // Track whether share prompt was already shown this session
  const sharePromptShown = useRef(false);

  // True while the coach is recording/scoring — keeps the outside-play nudge
  // card off the screen during a run (the engine's Nudge is playSafeOnly).
  const [coachActive, setCoachActive] = useState(false);

  /**
   * The ONE in-app retailer shell on this page (History dead-end sprint, owner
   * 10-01; single-CTA rule v31): only the sheet-music card opens it, so a piece
   * page has exactly one purchase action, exactly one WebView and one BACK rule.
   * Null = closed.
   */
  const [purchaseWebUrl, setPurchaseWebUrl] = useState<string | null>(null);

  const openInAppPurchase = useCallback((url: string | null | undefined) => {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return; // never open an empty page
    setPurchaseWebUrl(trimmed);
  }, []);

  const closeInAppPurchase = useCallback(() => setPurchaseWebUrl(null), []);

  /**
   * The piece's licensed purchase links, resolved in THIS order:
   *   • `primaryPurchaseUrl` — the PRIMARY retailer (Sheet Music Direct, the
   *     money path) unless only the backup exists; this is the sheet-music card's
   *     automatic destination and, for the coach card, the signal that this is a
   *     modern song (v31: the coach card opens nothing — one CTA per page);
   *   • `secondaryPurchaseUrl` — the other retailer, shown as the small
   *     "Try Musicnotes" line ONLY when it is a different page.
   * Both are the saved list's own URLs: nothing is built or guessed here.
   */
  const purchaseUrl = primaryPurchaseUrl(piece.purchaseUrls) ?? null;
  const secondaryPurchaseLink = secondaryPurchaseUrl(piece.purchaseUrls) ?? null;

  /**
   * The sheet-music card for a piece with NO curated score we may host but a
   * licensed link — a modern song opened from History. Null keeps today's honest
   * "coming soon" state (no card, no dead button).
   */
  const sheetCard = modernSheetCard(piece);
  const sheetCardUrl = sheetCard?.url ?? null;

  /**
   * The honest no-score state's own condition — the SAME one the sheet block's
   * final arm renders from, derived once so the words and the actions below can
   * never describe different states.
   */
  const showsHonestNoScoreState = !piece.sheetMusicUrl && !sheetCard;
  /**
   * The licensed-retailer SEARCH for this work's printed edition (owner Q2; §E.5
   * — the money path this bundle UNBLOCKS). Built by searchExternal.ts; the `1`
   * internal match is the piece in hand, so the section uses its honest
   * "also available from licensed retailers" subtitle rather than the
   * "not in our free library" one.
   */
  const printedArrangementSearch = externalSearchSection(piece.title, 1);

  useEffect(() => {
    if (!showScoreViewer) return;
    startedAt.current = Date.now();
    void recordPractice();
    return () => {
      const now = Date.now();
      const elapsedMinutes =
        (now - (startedAt.current ?? now)) / 60000;
      if (elapsedMinutes > 0) {
        void addPracticeMinutes(elapsedMinutes).then(() =>
          refreshStreakNudge(),
        );
      }
    };
  }, [showScoreViewer]);

  // ── The medals layer's opened-pieces ledger (owner-approved 08-25) ──
  // The 10-piece repertoire medal counts DISTINCT pieces the user actually
  // opened. Every route into a piece (Home, History, Find-a-Piece, the hum flow)
  // renders THIS screen, so the ledger is written once, here — never from a
  // screen that merely lists pieces.
  useEffect(() => {
    void recordPieceOpened(piece.id);
  }, [piece.id]);
  /**
   * When ScoreViewer closes, check if the user practiced long enough
   * to warrant a share prompt. Only shows once per session.
   */
  const handleCloseScoreViewer = useCallback(async () => {
    setShowScoreViewer(false);

    const elapsedMinutes =
      (Date.now() - (startedAt.current ?? Date.now())) / 60000;

    // Only prompt if they practiced > 2 minutes and haven't been asked yet
    if (elapsedMinutes >= 2 && !sharePromptShown.current) {
      sharePromptShown.current = true;

      // Small delay to let the modal dismiss animation finish
      setTimeout(async () => {
        // Streak comes from the practice-reinforcement engine (practice history),
        // never from the legacy counter — one source for every streak number.
        const [streakData, todayMinutes] = await Promise.all([
          getDisplayStreakLocal(),
          getTodayPracticeMinutes(),
        ]);

        Alert.alert(
          '🎵 Nice practice session!',
          'Share your progress?',
          [
            {
              text: 'Not now',
              style: 'cancel',
            },
            {
              text: 'Share',
              onPress: () => {
                setShareCardData({
                  streak: streakData.currentDays,
                  practiceMinutes: todayMinutes,
                });
                setShowShareCard(true);
              },
            },
          ],
          { cancelable: true },
        );
      }, 400);
    }
  }, []);

  const handleCloseShareCard = useCallback(() => {
    setShowShareCard(false);
  }, []);

  /**
   * The Share Preview card is tappable (owner rule: a card that looks tappable
   * must act). It opens the SAME full-screen ShareCard modal the post-practice
   * alert and the coach celebration use, populated from the same two sources —
   * it previews exactly the card that gets shared. Tapping never records
   * practice, never moves the streak, and never fires a share sheet by itself.
   */
  const handleOpenSharePreview = useCallback(async () => {
    // Honest fallbacks: a failed/no-history read still opens a truthful card
    // (0 days, 0 min today) rather than a dead tap or a NaN on the artwork.
    let streakDays: number | undefined;
    let todayMinutes: number | undefined;
    try {
      const [streakData, minutes] = await Promise.all([
        getDisplayStreakLocal(),
        getTodayPracticeMinutes(),
      ]);
      streakDays = streakData.currentDays;
      todayMinutes = minutes;
    } catch (e) {
      console.warn('[share] preview data unavailable', e);
    }

    setShareCardData(
      resolveShareCardPreviewData({ streakDays, todayMinutes }),
    );
    setShowShareCard(true);
  }, []);

  // Android hardware BACK (owner-reproduced on device, 09-23: "streak day →
  // featured piece → sheet music page → BACK → the app exits"). This page is an
  // IN-PLACE flow — Home / History / Find-a-Piece / the hum flow replace their
  // tab body with it, so the route never changes and nothing else consumes the
  // key. Without this handler the press reaches React Navigation, whose last
  // route is "Tabs" with nothing to pop, and the activity finishes.
  //
  // It unwinds ONE level: out of the score first (when the ScoreViewer modal is
  // up it consumes the press itself via onRequestClose, so this branch is the
  // belt-and-braces path), then back to whoever opened the piece. Returning true
  // is the "I consumed this press" signal — returning false would fall straight
  // through to the exiting behaviour this exists to prevent.
  // src/services/backExitContract.ts guards the whole class in the tier1 gate.
  useHardwareBack(() => {
    if (purchaseWebUrl) {
      // Belt-and-braces: the shell's Modal consumes BACK itself via
      // onRequestClose (inAppBrowserContract), so this branch is the same
      // transition if the press ever reaches here first.
      closeInAppPurchase();
      return true;
    }
    if (showScoreViewer) {
      void handleCloseScoreViewer();
      return true;
    }
    onBack();
    return true;
  });

  // Practice audio for the sheet viewer (RC-v28 fix acfb6a57): ONLY the piece's
  // OWN curated score audio ever plays. There is NO universal fallback — the old
  // code fell back to a bundled Für Elise preview for ANY public-domain piece, so
  // Air on the G String's Preview button played a different piece's music. With no
  // curated audio the viewer shows its honest "practice audio coming soon" hint
  // instead of a player (never another piece's recording). The decision and its
  // regression guard live in src/services/scoreAudioSource.ts.
  //
  // Computed here (unconditionally, like every hook above) because the viewer is
  // now an overlay inside the page body below — not a body-replacing early return.
  const scoreAudio = scoreAudioDecision(piece);

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const shareMessage = `I just played "${piece.title}" by ${piece.composer} on NoteSnap! 🎹\n\nDiscover sheet music for any song: [notesnap.app]`;

      if (Platform.OS === 'web') {
        // Web fallback — copy to clipboard concept
        Alert.alert('Share', shareMessage);
      } else {
        await Share.share({
          message: shareMessage,
          title: `🎵 ${piece.title} — NoteSnap`,
        });
      }
    } catch {
      // User cancelled — no action needed
    } finally {
      setSharing(false);
    }
  }, [piece]);

  const handleViewSheetMusic = () => {
    if (piece.sheetMusicUrl) {
      sharePromptShown.current = false; // Reset for this session
      setShowScoreViewer(true);
    }
  };

  const difficultyEmoji =
    piece.difficulty === 'Beginner'
      ? '🌱'
      : piece.difficulty === 'Intermediate'
      ? '🌿'
      : '🌳';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {/* Hero card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroEmoji}>🎼</Text>
        <Text style={styles.heroTitle}>{piece.title}</Text>
        <Text style={styles.heroComposer}>{piece.composer}</Text>

        <View style={styles.tags}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{piece.genre}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>
              {difficultyEmoji} {piece.difficulty}
            </Text>
          </View>
        </View>

        {piece.description && (
          <Text style={styles.description}>{piece.description}</Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {piece.sheetMusicUrl ? (
          <TouchableOpacity
            style={styles.viewSheetBtn}
            onPress={handleViewSheetMusic}
          >
            <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>
          </TouchableOpacity>
        ) : sheetCard ? (
          /* THE sheet-music card (owner 10-01, messages a/b/c). This piece has
             no score we may host — a modern song — but it was saved WITH the
             licensed retailer link, so the card carries the song's OWN header
             (title — official sheet music, then composer/artist · genre) and the
             WHOLE CARD is one press: no interstitial, no confirmation, straight
             to the retailer's page for that song inside our app shell. */
          <TouchableOpacity
            style={styles.sheetCardBtn}
            onPress={() => openInAppPurchase(sheetCardUrl)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Open the official sheet music for ${piece.title}`}
            accessibilityHint="Opens the licensed retailer page for this song"
          >
            <Text style={styles.sheetCardTitle}>{sheetCard.title}</Text>
            {sheetCard.subtitle ? (
              <Text style={styles.sheetCardSubtitle}>{sheetCard.subtitle}</Text>
            ) : null}
            <Text style={styles.sheetCardCta}>
              Tap to open the official sheet music →
            </Text>
            {/* The secondary retailer exists ONLY when it is a different page
                (owner-approved "Try Musicnotes" secondary CTA). A nested
                Touchable wins the responder, so this never triggers the card's
                own press. */}
            {secondaryPurchaseLink ? (
              <TouchableOpacity
                style={styles.sheetCardSecondary}
                onPress={() => openInAppPurchase(secondaryPurchaseLink)}
                accessibilityRole="button"
                accessibilityLabel={`Try Musicnotes for ${piece.title}`}
              >
                <Text style={styles.sheetCardSecondaryText}>
                  🎼 Try Musicnotes
                </Text>
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        ) : (
          /* THE HONEST FALLBACK (§E zero-promise, bundle E). We hold no score we
             may host for this piece, so the page says exactly that — and the real
             next paths follow it (the block below this card). The retired dashed
             box said a high-quality score was coming and to check back soon: it
             promised content we do not hold, in place of an action. A
             public-domain work never gets an invented purchase link either —
             `purchase_url: null` stays a hard rule. */
          <View style={styles.noScoreCard}>
            <Text style={styles.noScoreTitle}>
              🎼 No hosted score for this one
            </Text>
            <Text style={styles.noScoreText}>{NO_HOSTED_SCORE_LINE}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.shareBtn, sharing && styles.shareBtnDisabled]}
          onPress={handleShare}
          disabled={sharing}
        >
          <Text style={styles.shareText}>
            {sharing ? '⏳ Sharing...' : '📤 Share'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── THE NEXT REAL PATHS (rendered only in the honest state above) ──
          The same condition the card's final arm uses, so the words and the
          actions can never point at different states.

          • the licensed-retailer SEARCH for this work's printed edition, opened
            in this page's own in-app shell (owner Q2, ratified 10-02: a secondary
            retailer SEARCH is allowed, in-shell, and is never a primary purchase
            claim — where we host a free score, that stays the offer);
          • the hum route and the find-a-piece search, each rendered ONLY when its
            host wired the handler — a lever with no destination is not a lever.

          This block adds no purchase claim to a page that has one: it renders
          only when the page holds no purchase card at all. */}
      {showsHonestNoScoreState ? (
        <View>
          <SearchExternalSection
            section={printedArrangementSearch}
            onOpen={openInAppPurchase}
          />
          {onHumIt || onFindPiece ? (
            <View style={styles.leversBlock}>
              {onHumIt ? (
                <TouchableOpacity
                  style={styles.leverBtn}
                  onPress={onHumIt}
                  accessibilityRole="button"
                >
                  <Text style={styles.leverBtnText}>{HUM_IT_LEVER_LABEL}</Text>
                  <Text style={styles.leverBtnHint}>{HUM_IT_LEVER_HINT}</Text>
                </TouchableOpacity>
              ) : null}
              {onFindPiece ? (
                <TouchableOpacity
                  style={styles.leverBtn}
                  onPress={onFindPiece}
                  accessibilityRole="button"
                >
                  <Text style={styles.leverBtnText}>
                    {FIND_A_PIECE_LEVER_LABEL}
                  </Text>
                  <Text style={styles.leverBtnHint}>
                    {FIND_A_PIECE_LEVER_HINT}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Coached practice — the practice-coach MVP surface (slice 3).
          Lives on the piece screen (not Home): the sheet music, the loop/
          time-stretch player and this coach all belong to the piece in hand.
          The reference melody resolves from the catalog's abc when present,
          otherwise from the bundled public-domain seeds. A piece with NO melody
          we may use either says so in ONE honest line (a modern song — its
          licensed page is the sheet-music card above) or renders nothing at all
          (v31, owner 10-01). We never host a copyrighted melody, never fabricate
          one, and never promise one that is not coming.

          ONE PURCHASE ACTION PER PAGE (owner 10-01, "duplicate CTA box"): the
          coach card gets the licensed link as a SIGNAL ONLY, so it can tell a
          modern song apart — it is handed no opener and renders no buy button.
          The sheet-music card above is the page's single retailer CTA. */}
      <CoachPracticeCard
        pieceId={piece.id}
        title={piece.title}
        composer={piece.composer}
        abc={piece.abc}
        purchaseUrl={purchaseUrl}
        onSessionActiveChange={setCoachActive}
      />

      {/* Outside-play streak nudge (slice 2): low-weight, dismissible, hidden
          while a run is being recorded or scored. Copy comes from the engine's
          nudge payload — positive framing only. */}
      <StreakNudgeCard surface="piece-detail" hidden={coachActive} />

      {/* Share card preview — tappable. Opens the real ShareCard modal (the
          same one the post-practice alert and the coach celebration use), so
          the preview shows exactly the card that gets shared. It never fires a
          share sheet on its own. */}
      <TouchableOpacity
        style={styles.shareCard}
        onPress={handleOpenSharePreview}
        accessibilityRole="button"
        accessibilityLabel={sharePreviewAccessibilityLabel(piece.title)}
        accessibilityHint="Opens the share card so you can share it"
      >
        <Text style={styles.shareCardLabel}>Share Preview</Text>
        <View style={styles.shareCardInner}>
          <Text style={styles.shareCardPiece}>{piece.title}</Text>
          <Text style={styles.shareCardComposer}>{piece.composer}</Text>
          <View style={styles.shareCardDivider} />
          <Text style={styles.shareCardTagline}>
            I just played this on NoteSnap 🎹
          </Text>
          <Text style={styles.shareCardApp}>notesnap.app</Text>
        </View>
        <Text style={styles.shareCardCta}>Tap to open the share card →</Text>
      </TouchableOpacity>

      {/* Share progress card modal */}
      <ShareCard
        visible={showShareCard}
        title={piece.title}
        composer={piece.composer}
        genre={piece.genre}
        streak={shareCardData.streak}
        practiceMinutes={shareCardData.practiceMinutes}
        onClose={handleCloseShareCard}
      />
      </ScrollView>

      {/* Full-screen sheet-music viewer — an OVERLAY inside this always-mounted
          page body, never a body replacement (owner-reported blank page, v22 →
          v24: a viewer flag left true by a natively dismissed dialog left the
          host rendering an empty screen). Guarded by
          src/services/backExitContract.ts (the blank-return contract). */}
      {showScoreViewer && piece.sheetMusicUrl && (
        <ScoreViewer
          url={piece.sheetMusicUrl}
          title={piece.title}
          composer={piece.composer}
          onClose={handleCloseScoreViewer}
          audioSource={scoreAudio.source}
          audioLabel={scoreAudio.label}
        />
      )}

      {/* The page's ONE in-app retailer shell (owner 10-01): the sheet-music
          card is its only caller, so the browser, its BACK behaviour and the
          "← Back to NoteSnap" header are one implementation behind one purchase
          action, opened as a full-screen Modal over this page
          (src/components/PurchaseWebView.tsx — BACK returns to the piece page,
          never out of the app). */}
      {purchaseWebUrl && (
        <PurchaseWebView
          url={purchaseWebUrl}
          title={`${piece.title} — official sheet music`}
          onClose={closeInAppPurchase}
        />
      )}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 48,
  },
  backBtn: {
    marginBottom: 16,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  heroCard: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  heroEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  heroComposer: {
    fontSize: 16,
    color: '#a0a0b8',
    marginBottom: 14,
  },
  tags: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tag: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagText: {
    color: '#c0c0d0',
    fontSize: 13,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  viewSheetBtn: {
    flex: 1,
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  viewSheetText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  noScoreCard: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  noScoreTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  noScoreText: { color: '#a0a0b8', fontSize: 13, lineHeight: 19 },
  leversBlock: { marginHorizontal: 4, marginTop: 4 },
  leverBtn: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  leverBtnText: { color: '#4ecdc4', fontSize: 14, fontWeight: '700' },
  leverBtnHint: { color: '#a0a0b8', fontSize: 12, marginTop: 3, lineHeight: 17 },
  sheetCardBtn: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  sheetCardTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  sheetCardSubtitle: {
    color: '#c0c0d0',
    fontSize: 12,
    marginBottom: 6,
  },
  sheetCardCta: {
    color: '#4ecdc4',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetCardSecondary: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    alignItems: 'center',
  },
  sheetCardSecondaryText: {
    color: '#e94560',
    fontSize: 12,
    fontWeight: '700',
  },
  shareBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f3460',
  },
  shareBtnDisabled: {
    opacity: 0.6,
  },
  shareText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  shareCard: {
    marginTop: 28,
  },
  shareCardLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a0a0b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  shareCardInner: {
    backgroundColor: '#0f3460',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e94560',
  },
  shareCardPiece: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  shareCardComposer: {
    fontSize: 14,
    color: '#c0c0d0',
    marginBottom: 12,
  },
  shareCardDivider: {
    height: 1,
    width: '60%',
    backgroundColor: '#e94560',
    marginBottom: 12,
  },
  shareCardTagline: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 4,
  },
  shareCardApp: {
    fontSize: 13,
    color: '#e94560',
    fontWeight: '700',
  },
  shareCardCta: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#4ecdc4',
    textAlign: 'center',
  },
});
