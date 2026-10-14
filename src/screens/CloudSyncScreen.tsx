/**
 * CloudSyncScreen — Phase 4b.
 *
 * Brings sheet music in from the user's cloud storage, and (when the owner has
 * supplied OAuth app keys) connects Dropbox / Google Drive for the pull/push sync
 * engine.
 *
 * v39 fix 2 (owner 10-11) — TWO CHANGES, both about telling the truth:
 *   • THE COPY. The hero used to end with "Sync merges by file name and size — two
 *     way, last-wins on conflict", which described a reconciliation this build does
 *     not run. Every sentence now comes from services/cloudImport.ts, where the
 *     claims are guarded, and the merge behaviour the owner asked for is stated as
 *     the separate window it is (not built).
 *   • THE CARDS. Connector rows only worked with app keys in the build, so with no
 *     keys the cards under the sync section did nothing at all. Each card now leads
 *     with a REAL action — "Import from Dropbox" / "Import from Google Drive" opens
 *     the phone's own file picker and copies the picked scores into the Library
 *     (services/cloudImportDevice.ts). The key-based connector, when configured,
 *     stays available as an extra.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CloudProvider } from '../services/oauthStore';
import {
  connectDropbox,
  disconnectDropbox,
  isDropboxConfigured,
} from '../services/dropbox';
import {
  connectGDrive,
  disconnectGDrive,
  isGDriveConfigured,
} from '../services/gdrive';
import {
  friendlyCloudError,
  getLastSyncedAt,
  providerConnected,
  syncCloud,
} from '../services/cloudSync';
import {
  CLOUD_CONNECTOR_CONFIGURED_LINE,
  CLOUD_CONNECTOR_NOT_CONFIGURED_LINE,
  CLOUD_IMPORT_BODY,
  CLOUD_IMPORT_HINT,
  CLOUD_IMPORT_TITLE,
  CLOUD_MERGE_SCOPE_NOTE,
  CLOUD_SYNC_NOT_LIVE_LINE,
  cloudImportCtaLabel,
  cloudImportOutcomeLine,
} from '../services/cloudImport';
import { importFilesIntoLibrary } from '../services/cloudImportDevice';

interface ProviderState {
  configured: boolean;
  connected: boolean;
  syncing: boolean;
  lastSynced: string | null;
}

const EMPTY: ProviderState = {
  configured: false,
  connected: false,
  syncing: false,
  lastSynced: null,
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const CloudSyncScreen: React.FC = () => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [dropbox, setDropbox] = useState<ProviderState>(EMPTY);
  const [gdrive, setGdrive] = useState<ProviderState>(EMPTY);
  const [connecting, setConnecting] = useState<CloudProvider | null>(null);
  // The provider whose import run is in flight (its card shows the spinner).
  const [importing, setImporting] = useState<CloudProvider | null>(null);

  const refresh = useCallback(async () => {
    const [dbConnected, dbLast, gdConnected, gdLast] = await Promise.all([
      providerConnected('dropbox'),
      getLastSyncedAt('dropbox'),
      providerConnected('gdrive'),
      getLastSyncedAt('gdrive'),
    ]);
    setDropbox({
      configured: isDropboxConfigured(),
      connected: dbConnected,
      syncing: false,
      lastSynced: dbLast,
    });
    setGdrive({
      configured: isGDriveConfigured(),
      connected: gdConnected,
      syncing: false,
      lastSynced: gdLast,
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * IMPORT FILES FROM THE USER'S OWN PICKER (v39 fix 2). The picker is the phone's,
   * so Dropbox and Google Drive are sources inside it; every picked file is copied
   * into the Library by the Library's own import path. The outcome is always
   * reported — a cancelled or failed pick is never a silent no-op.
   */
  const handleImport = useCallback(
    async (provider: CloudProvider) => {
      const label = provider === 'dropbox' ? 'Dropbox' : 'Google Drive';
      setImporting(provider);
      try {
        const outcome = await importFilesIntoLibrary();
        if (!outcome.cancelled) {
          await refresh();
        }
        Alert.alert(`Import from ${label}`, cloudImportOutcomeLine(outcome));
      } catch (e) {
        Alert.alert(`Import from ${label}`, friendlyCloudError(e));
      } finally {
        setImporting(null);
      }
    },
    [refresh]
  );

  const handleConnect = useCallback(
    async (provider: CloudProvider) => {
      setConnecting(provider);
      try {
        const tokens =
          provider === 'dropbox'
            ? await connectDropbox()
            : await connectGDrive();
        if (tokens) {
          await refresh();
          Alert.alert(
            'Connected',
            `${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'} is connected. Press Sync Now to run the sync pass.`
          );
        }
        // tokens === null → user cancelled the browser flow; nothing to do.
      } catch (e) {
        Alert.alert('Connection failed', friendlyCloudError(e));
      } finally {
        setConnecting(null);
      }
    },
    [refresh]
  );

  const handleDisconnect = useCallback(
    (provider: CloudProvider) => {
      const label = provider === 'dropbox' ? 'Dropbox' : 'Google Drive';
      Alert.alert(
        `Disconnect ${label}?`,
        'Your files stay in your library; sync will stop until you reconnect.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: async () => {
              if (provider === 'dropbox') {
                await disconnectDropbox();
              } else {
                await disconnectGDrive();
              }
              await refresh();
            },
          },
        ]
      );
    },
    [refresh]
  );

  const handleSyncNow = useCallback(
    async (provider: CloudProvider) => {
      const label = provider === 'dropbox' ? 'Dropbox' : 'Google Drive';
      const patch = (syncing: boolean) =>
        provider === 'dropbox'
          ? setDropbox((s) => ({ ...s, syncing }))
          : setGdrive((s) => ({ ...s, syncing }));
      patch(true);
      try {
        const report = await syncCloud(provider);
        await refresh();
        const summary = [
          report.pulled > 0 ? `${report.pulled} pulled` : '',
          report.updated > 0 ? `${report.updated} updated` : '',
          report.uploaded > 0 ? `${report.uploaded} uploaded` : '',
          report.skipped > 0 ? `${report.skipped} skipped` : '',
        ]
          .filter(Boolean)
          .join(', ');
        const details = [
          summary ? `Synced: ${summary}.` : 'Everything is already in sync.',
          report.note ? `\n${report.note}` : '',
          report.errors.length > 0
            ? `\n${report.errors.length} file(s) had problems: ${report.errors
                .slice(0, 3)
                .join('; ')}`
            : '',
        ].join('');
        Alert.alert(`Sync complete (${label})`, details);
      } catch (e) {
        Alert.alert(`Sync failed (${label})`, friendlyCloudError(e));
      } finally {
        patch(false);
      }
    },
    [refresh]
  );

  const renderProvider = (
    provider: CloudProvider,
    state: ProviderState,
    label: string,
    icon: keyof typeof Ionicons.glyphMap
  ) => {
    const syncing = state.syncing || connecting === provider;
    const busy = importing === provider;
    const canConnect = state.configured && !state.connected && !syncing;
    const canDisconnect = state.connected && !syncing;
    return (
      <View style={styles.providerCard}>
        <View style={styles.providerHeader}>
          <View style={styles.providerIcon}>
            <Ionicons name={icon} size={22} color={theme.accent} />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>{label}</Text>
            {/* The status line states what this build can do with the provider —
                never a claim the user can catch the app out on. */}
            <Text style={styles.providerStatus}>
              {state.configured
                ? CLOUD_CONNECTOR_CONFIGURED_LINE
                : CLOUD_CONNECTOR_NOT_CONFIGURED_LINE}
            </Text>
            {state.configured && state.connected && (
              <Text style={styles.providerMeta}>
                Last synced: {formatTimestamp(state.lastSynced)}
              </Text>
            )}
          </View>
          {syncing ? (
            <ActivityIndicator color={theme.accent} />
          ) : canConnect ? (
            <Pressable
              style={({ pressed }) => [styles.connectButton, pressed && styles.pressed]}
              onPress={() => handleConnect(provider)}
            >
              <Text style={styles.connectButtonText}>Connect</Text>
            </Pressable>
          ) : canDisconnect ? (
            <Pressable
              style={({ pressed }) => [styles.disconnectButton, pressed && styles.pressed]}
              onPress={() => handleDisconnect(provider)}
            >
              <Text style={styles.disconnectButtonText}>Disconnect</Text>
            </Pressable>
          ) : null}
        </View>

        {/* THE REAL ACTION, ALWAYS PRESENT (v39 fix 2). It needs no app key, no
            account and no network code of ours: the phone's own picker carries
            Dropbox / Google Drive as sources, and what the user picks lands in the
            Library. This is why the card is never dead. */}
        <Pressable
          style={({ pressed }) => [styles.importButton, pressed && !busy && styles.pressed]}
          disabled={busy}
          onPress={() => handleImport(provider)}
          accessibilityRole="button"
          accessibilityLabel={cloudImportCtaLabel(
            provider === 'dropbox' ? 'dropbox' : 'gdrive'
          )}
          accessibilityHint="Opens your phone's file picker and copies the scores you pick into your Library"
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="cloud-download" size={16} color="#fff" />
          )}
          <Text style={styles.importButtonText}>
            {busy
              ? 'Importing…'
              : cloudImportCtaLabel(provider === 'dropbox' ? 'dropbox' : 'gdrive')}
          </Text>
        </Pressable>
        <Text style={styles.importHint}>{CLOUD_IMPORT_HINT}</Text>

        {state.configured ? (
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              (!state.connected || syncing) && styles.syncButtonDisabled,
              pressed && state.connected && !syncing && styles.pressed,
            ]}
            disabled={!state.connected || syncing}
            onPress={() => handleSyncNow(provider)}
          >
            {syncing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="sync" size={16} color="#fff" />
            )}
            <Text style={styles.syncButtonText}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{CLOUD_IMPORT_TITLE}</Text>
        <Text style={styles.heroText}>{CLOUD_IMPORT_BODY}</Text>
        {/* What is NOT in this build, said plainly — the old hero claimed a
            merging, last-wins sync the app does not run. */}
        <Text style={styles.heroNote}>{CLOUD_SYNC_NOT_LIVE_LINE}</Text>
      </View>

      {renderProvider('dropbox', dropbox, 'Dropbox', 'logo-dropbox')}
      {renderProvider('gdrive', gdrive, 'Google Drive', 'logo-google')}

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Notes</Text>
        <Text style={styles.noteText}>
          • Imported files are copied into NoteSnap on this device and open
          offline — your cloud copy is not moved or changed.
        </Text>
        <Text style={styles.noteText}>
          • Scanned scores stay one file per page, and an imported page comes in
          as its own item.
        </Text>
        <Text style={styles.noteText}>• {CLOUD_MERGE_SCOPE_NOTE}</Text>
      </View>
    </ScrollView>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 16,
    gap: 14,
  },
  hero: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 2,
  },
  heroTitle: {
    color: '#eaeaff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroText: {
    color: '#a0a0b8',
    fontSize: 14,
    lineHeight: 20,
  },
  heroNote: {
    color: '#8a8ab0',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  /* The always-available import action (v39 fix 2) — the card's real door. */
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f3460',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 10,
    paddingVertical: 10,
  },
  importButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  importHint: {
    color: '#8a8ab0',
    fontSize: 12,
    lineHeight: 17,
  },
  providerCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  providerIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    color: '#eaeaff',
    fontSize: 16,
    fontWeight: '700',
  },
  providerStatus: {
    color: '#e94560',
    fontSize: 13,
    marginTop: 1,
  },
  providerMeta: {
    color: '#8a8ab0',
    fontSize: 12,
    marginTop: 2,
  },
  connectButton: {
    backgroundColor: '#e94560',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  connectButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  disconnectButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  disconnectButtonText: {
    color: '#e94560',
    fontWeight: '700',
    fontSize: 14,
  },
  hintBox: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 8,
    padding: 10,
  },
  hintText: {
    color: '#8a8ab0',
    fontSize: 12,
    lineHeight: 17,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e94560',
    borderRadius: 10,
    paddingVertical: 10,
  },
  syncButtonDisabled: {
    backgroundColor: '#2a2a4a',
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.75,
  },
  noteBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    marginTop: 2,
  },
  noteTitle: {
    color: '#eaeaff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  noteText: {
    color: '#8a8ab0',
    fontSize: 13,
    lineHeight: 19,
  },
});
