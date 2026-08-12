/**
 * CloudSyncScreen — Phase 4b.
 *
 * Connects/disconnects Dropbox and Google Drive, runs Sync Now, and shows the
 * last-synced time. When the owner hasn't supplied OAuth credentials yet, the
 * relevant row shows an honest "not configured" state naming the env vars.
 */
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
  const [dropbox, setDropbox] = useState<ProviderState>(EMPTY);
  const [gdrive, setGdrive] = useState<ProviderState>(EMPTY);
  const [connecting, setConnecting] = useState<CloudProvider | null>(null);

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
            `${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'} is connected. Press Sync Now to merge your library.`
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
    const canConnect = state.configured && !state.connected && !syncing;
    const canDisconnect = state.connected && !syncing;
    return (
      <View style={styles.providerCard}>
        <View style={styles.providerHeader}>
          <View style={styles.providerIcon}>
            <Ionicons name={icon} size={22} color="#e94560" />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>{label}</Text>
            <Text style={styles.providerStatus}>
              {!state.configured
                ? 'Not configured yet'
                : state.connected
                ? 'Connected'
                : 'Not connected'}
            </Text>
            {state.configured && state.connected && (
              <Text style={styles.providerMeta}>
                Last synced: {formatTimestamp(state.lastSynced)}
              </Text>
            )}
          </View>
          {syncing ? (
            <ActivityIndicator color="#e94560" />
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

        {!state.configured && (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              {provider === 'dropbox'
                ? 'Connect is unavailable until the owner adds EXPO_PUBLIC_DROPBOX_APP_KEY (and EXPO_PUBLIC_DROPBOX_APP_SECRET) to the build.'
                : 'Connect is unavailable until the owner adds EXPO_PUBLIC_GOOGLE_CLIENT_ID (and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) to the build.'}
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.syncButton,
            (!state.configured || !state.connected || syncing) && styles.syncButtonDisabled,
            pressed && state.connected && !syncing && styles.pressed,
          ]}
          disabled={!state.configured || !state.connected || syncing}
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
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Keep your library everywhere</Text>
        <Text style={styles.heroText}>
          Connect a cloud service to back up your sheet music and pull files
          from it into your library. Sync merges by file name and size —
          two-way, last-wins on conflict.
        </Text>
      </View>

      {renderProvider('dropbox', dropbox, 'Dropbox', 'logo-dropbox')}
      {renderProvider('gdrive', gdrive, 'Google Drive', 'logo-google')}

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Notes</Text>
        <Text style={styles.noteText}>
          • Files sync into the app’s “NotesSnap” folder (created
          automatically).
        </Text>
        <Text style={styles.noteText}>
          • Scanned scores sync one page per file and come back as separate
          scanned items.
        </Text>
        <Text style={styles.noteText}>
          • Sync needs a network connection; your library always stays
          available offline.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
