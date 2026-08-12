import React, { useCallback, useMemo, useState } from 'react';
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
  removeLibraryItem,
  renameLibraryItem,
} from '../services/libraryStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_ICONS: Record<LibraryItem['kind'], keyof typeof Ionicons.glyphMap> = {
  pdf: 'document-text',
  musicxml: 'musical-note',
  midi: 'musical-notes',
  guitarpro: 'albums',
  scanned: 'images',
};

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
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<LibraryItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = useCallback(async () => {
    const list = await getLibraryItems();
    setItems(list);
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
      setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }, [reload]);

  // ─── Item actions ──────────────────────────────────────────

  const openItem = useCallback(
    (item: LibraryItem) => {
      if (item.kind === 'pdf') {
        navigation.navigate('PdfViewer', { itemId: item.id });
      } else if (item.kind === 'scanned') {
        navigation.navigate('ScannedViewer', { itemId: item.id });
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
        accessibilityLabel={`${item.title}, ${kindLabel(item.kind)}`}
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
              color="#e94560"
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
        </View>
        <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
        <Ionicons name="chevron-forward" size={16} color="#4a4a6a" />
      </Pressable>
    ),
    [openItem, showItemMenu]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptySubtitle}>Loading your library…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonPrimary,
            pressed && styles.rowPressed,
          ]}
          onPress={handleImport}
          disabled={busy}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.actionButtonTextPrimary}>Import file</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonSecondary,
            pressed && styles.rowPressed,
          ]}
          onPress={() => navigation.navigate('ScanScore')}
          disabled={busy}
        >
          <Ionicons name="camera" size={18} color="#e94560" />
          <Text style={styles.actionButtonTextSecondary}>Scan score</Text>
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎼</Text>
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptySubtitle}>
            Import a PDF, MusicXML, MIDI or Guitar Pro file, or scan a paper
            score with your camera. Files are stored on your device and work
            offline.
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
              placeholderTextColor="#6a6a8a"
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonPrimary: {
    backgroundColor: '#e94560',
  },
  actionButtonSecondary: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#e94560',
  },
  actionButtonTextPrimary: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  actionButtonTextSecondary: {
    color: '#e94560',
    fontWeight: '700',
    fontSize: 15,
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
  rowDate: {
    color: '#5a5a80',
    fontSize: 12,
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
