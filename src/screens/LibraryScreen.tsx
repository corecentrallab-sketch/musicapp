import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import type { LibraryItem } from '../types';
import type { RootStackParamList } from '../types';
import {
  getLibraryItems,
  importDocumentAsset,
  kindLabel,
  readAbcText,
  removeLibraryItem,
  renameLibraryItem,
} from '../services/libraryStore';
import { SampleBadge } from '../components/SampleBadge';
import { AddMusicSheet } from '../components/AddMusicSheet';
import { LibraryHeaderActions } from '../components/LibraryHeaderActions';
import { FindPieceScreen } from './FindPieceScreen';
import {
  friendlyCloudError,
  sendItemToCloud,
  shareLibraryItem,
} from '../services/cloudSync';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_ICONS: Record<LibraryItem['kind'], keyof typeof Ionicons.glyphMap> = {
  pdf: 'document-text',
  musicxml: 'musical-note',
  midi: 'musical-notes',
  guitarpro: 'albums',
  scanned: 'images',
  abc: 'create',
};

/**
 * Kinds the app can actually OPEN today. PDF and scanned scores have viewers
 * (PdfViewer / ScannedViewer), and an ABC score opens in the notation editor
 * (NotationEditorScreen), which renders it and can transpose it. MusicXML, MIDI
 * and Guitar Pro import fine but their rendering/playback is still to come, so
 * their rows must not promise an open — they carry a "Soon" badge instead of the
 * chevron (the same honest treatment Find-a-Piece's badges use).
 */
function isOpenableKind(kind: LibraryItem['kind']): boolean {
  return kind === 'pdf' || kind === 'scanned' || kind === 'abc';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const LibraryScreen: React.FC = () => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<LibraryItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /**
   * THE SCORE TEXT of every saved ABC item, by id (UX round 1 step 1, owner 10-18
   * item 5). A row can only say "Sample · 4-bar excerpt" if it has read the score
   * — the label is derived from the score itself, so there is nothing to show
   * before the file has been read. A file that cannot be read simply shows no
   * badge (never a wrong one), which is also the honest state for a scanned page:
   * an image has no bar count to state.
   */
  const [abcTexts, setAbcTexts] = useState<Record<string, string>>({});
  /**
   * DESIGNER SPEC §2 — THE ONE "+ ADD MUSIC" SHEET. The state lives here (not in the
   * header) because the sheet's "Upload File" row must run THIS screen's existing
   * import and then refresh THIS list; the header button only opens it.
   */
  const [addMusicOpen, setAddMusicOpen] = useState(false);
  /**
   * Row 3's destination: the app's ONE search surface, `FindPieceScreen`, mounted in
   * place exactly as Home and ScanScore mount it (browse state = the free catalog).
   */
  const [showLibrarySearch, setShowLibrarySearch] = useState(false);

  const reload = useCallback(async () => {
    const list = await getLibraryItems();
    setItems(list);
    const texts: Record<string, string> = {};
    for (const item of list) {
      if (item.kind !== 'abc' || !item.fileUri) continue;
      try {
        texts[item.id] = await readAbcText(item);
      } catch {
        // Unreadable or empty: no badge for this row, and no claim about it.
      }
    }
    setAbcTexts(texts);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [items]
  );

  // ─── Import (document picker) ──────────────────────────────

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }
      const asset = result.assets[0];
      const item = await importDocumentAsset(asset);
      await reload();
      Alert.alert(
        'Imported',
        `"${item.title}" was added to your library (${kindLabel(item.kind)}).`
      );
    } catch (e) {
      Alert.alert(
        'Import failed',
        e instanceof Error ? e.message : 'The file could not be imported.'
      );
    }
  }, [reload]);

  // ─── The "+ Add music" sheet (designer spec §2) ────────────
  //
  // ONE entry point in this header, and each of its three rows opens a flow the app
  // ALREADY has — nothing is re-implemented behind the sheet:
  //   1. Scan Live Score       → the ScanScore screen (camera → scan → save)
  //   2. Upload File           → handleImport above (DocumentPicker → libraryStore)
  //   3. Browse Online Library → FindPieceScreen, the app's one catalog search

  const openAddMusic = useCallback(() => setAddMusicOpen(true), []);
  const closeAddMusic = useCallback(() => setAddMusicOpen(false), []);

  /** Row 1 — the existing camera/scan flow. */
  const handleAddMusicScan = useCallback(() => {
    setAddMusicOpen(false);
    navigation.navigate('ScanScore');
  }, [navigation]);

  /** Row 2 — the existing file import (the button this sheet replaced). */
  const handleAddMusicUpload = useCallback(() => {
    setAddMusicOpen(false);
    handleImport();
  }, [handleImport]);

  /** Row 3 — the existing catalog search, in its browse state. */
  const handleAddMusicBrowse = useCallback(() => {
    setAddMusicOpen(false);
    setShowLibrarySearch(true);
  }, []);

  /**
   * THE HEADER IS OWNED HERE (not by the tab navigator) so the one `+` and the sheet
   * it opens share a single owner — and the Library can pass the open handler
   * straight through. The navigator no longer wires a Library `headerRight` at all,
   * so a second `+` cannot appear.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <LibraryHeaderActions onOpenAddMusic={openAddMusic} />,
    });
  }, [navigation, openAddMusic]);

  // ─── Item actions ──────────────────────────────────────────


  const openItem = useCallback(
    (item: LibraryItem) => {
      if (item.kind === 'pdf') {
        navigation.navigate('PdfViewer', { itemId: item.id });
      } else if (item.kind === 'scanned') {
        navigation.navigate('ScannedViewer', { itemId: item.id });
      } else if (item.kind === 'abc') {
        // ABC scores open in the notation editor: it renders the score and can
        // transpose it into a new key (saving a new copy).
        navigation.navigate('NotationEditor', { itemId: item.id });
      } else {
        // Rendering/playback of these formats arrives later; the file is
        // stored and will be openable via the share/export path.
        Alert.alert(
          kindLabel(item.kind),
          'This file is saved in your library. Rendering and playback for this format are coming soon.'
        );
      }
    },
    [navigation]
  );

  const showItemMenu = useCallback(
    (item: LibraryItem) => {
      Alert.alert(item.title, 'Library item options', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: () => {
            setRenameValue(item.title);
            setRenameTarget(item);
          },
        },
        {
          text: 'Send to cloud',
          onPress: async () => {
            try {
              const queued = await sendItemToCloud(item.id);
              if (!queued) {
                Alert.alert(
                  'No cloud service connected',
                  'Connect Dropbox or Google Drive first — tap the cloud icon at the top of the Library to open Cloud Sync.'
                );
                return;
              }
              Alert.alert(
                'Queued for upload',
                `"${item.title}" will upload on the next Sync Now (open Cloud Sync from the cloud icon above).`
              );
            } catch (e) {
              Alert.alert('Could not queue item', friendlyCloudError(e));
            }
          },
        },
        {
          text: 'Share',
          onPress: async () => {
            try {
              await shareLibraryItem(item);
            } catch (e) {
              Alert.alert('Share failed', friendlyCloudError(e));
            }
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete item',
              `Remove "${item.title}" from your library?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await removeLibraryItem(item.id);
                    await reload();
                  },
                },
              ]
            );
          },
        },
      ]);
    },
    [reload]
  );

  const confirmRename = useCallback(async () => {
    if (!renameTarget) return;
    await renameLibraryItem(renameTarget.id, renameValue);
    setRenameTarget(null);
    await reload();
  }, [renameTarget, renameValue, reload]);

  // ─── Render ────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: LibraryItem }) => (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => openItem(item)}
        onLongPress={() => showItemMenu(item)}
        accessibilityRole="button"
        accessibilityLabel={
          isOpenableKind(item.kind)
            ? `${item.title}, ${kindLabel(item.kind)}`
            : `${item.title}, ${kindLabel(item.kind)} — preview coming soon`
        }
      >
        <View style={styles.rowIcon}>
          {item.kind === 'scanned' && item.thumbnailUri ? (
            <Image
              source={{ uri: item.thumbnailUri }}
              style={styles.thumbnail}
            />
          ) : (
            <Ionicons
              name={KIND_ICONS[item.kind]}
              size={24}
              color={theme.accent}
            />
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {kindLabel(item.kind)}
            {item.pageCount > 0 ? ` · ${item.pageCount} pages` : ''}
            {formatBytes(item.sizeBytes)
              ? ` · ${formatBytes(item.sizeBytes)}`
              : ''}
          </Text>
          {/* A saved ABC score that is really a short excerpt says so on its row.
              The Library cannot check the catalog, so the badge passes no
              `libraryState` and makes no claim about what else we hold. */}
          <SampleBadge abc={abcTexts[item.id]} style={styles.rowBadge} />
        </View>
        <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
        {isOpenableKind(item.kind) ? (
          <Ionicons name="chevron-forward" size={16} color={theme.subtext} />
        ) : (
          <Text style={[styles.badge, styles.badgeSoon]}>Soon</Text>
        )}
      </Pressable>
    ),
    [abcTexts, openItem, showItemMenu]
  );

  // Row 3's destination: the EXISTING catalog search, in place (its browse state is
  // the free public-domain catalog), exactly as Home and ScanScore mount it.
  if (showLibrarySearch) {
    return <FindPieceScreen onClose={() => setShowLibrarySearch(false)} />;
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptySubtitle}>Loading your library…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎼</Text>
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptySubtitle}>
            Import a PDF, MusicXML, MIDI or Guitar Pro file, or scan a paper
            score with your camera. Files are stored on your device and work
            offline. Transposed copies you save from the Notation editor land
            here too.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Rename modal (cross-platform, since Alert.prompt is iOS-only) */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename item</Text>
            <TextInput
              style={styles.modalInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholder="Title"
              placeholderTextColor={theme.subtext}
              onSubmitEditing={confirmRename}
              returnKeyType="done"
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalButton}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={styles.modalButtonCancel}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={confirmRename}
                disabled={!renameValue.trim()}
              >
                <Text style={styles.modalButtonSave}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* THE ONE "+ ADD MUSIC" SHEET (designer spec §2) — the three rows that every
          add/import affordance in the app collapses into. */}
      <AddMusicSheet
        visible={addMusicOpen}
        onScanLiveScore={handleAddMusicScan}
        onUploadFile={handleAddMusicUpload}
        onBrowseOnlineLibrary={handleAddMusicBrowse}
        onClose={closeAddMusic}
      />
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  rowPressed: {
    backgroundColor: '#16213e',
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: '#eaeaff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowMeta: {
    color: '#8a8ab0',
    fontSize: 13,
    marginTop: 2,
  },
  rowBadge: {
    marginTop: 6,
  },
  rowDate: {
    color: '#5a5a80',
    fontSize: 12,
  },
  /* "Soon" badge for a row whose format has no viewer yet — the honest stand-in
     for a chevron that promised an open the tap cannot deliver (same badge
     treatment as Find-a-Piece). */
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  badgeSoon: {
    color: '#8a8aa3',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#eaeaff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#8a8ab0',
    textAlign: 'center',
    lineHeight: 22,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: {
    color: '#eaeaff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 8,
    color: '#eaeaff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalButtonConfirm: {
    backgroundColor: '#e94560',
  },
  modalButtonCancel: {
    color: '#a0a0b8',
    fontSize: 15,
    fontWeight: '600',
  },
  modalButtonSave: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
