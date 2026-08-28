/**
 * EditorScreen — practice-tools hub.
 *
 * The tab hosts NoteSnap's practice tools. The metronome is live; the notation
 * editor (Notation Editor v1: transpose) is now a working entry point that
 * opens the NotationEditor screen.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const EditorScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Practice Tools</Text>
      <Text style={styles.screenSubtitle}>
        Tools that help you play better — no interruptions while you practice.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate('Metronome')}
        accessibilityRole="button"
        accessibilityLabel="Metronome — keep time with tap tempo and accents"
      >
        <View style={styles.cardIcon}>
          <Ionicons name="speedometer" size={26} color="#e94560" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Metronome</Text>
          <Text style={styles.cardSubtitle}>
            Keep time with tap tempo, accent patterns, and a visual pulse.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#4a4a6a" />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => navigation.navigate('NotationEditor', {})}
        accessibilityRole="button"
        accessibilityLabel="Notation editor — transpose public-domain scores and save to library"
      >
        <View style={styles.cardIcon}>
          <Ionicons name="create" size={26} color="#e94560" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Notation editor</Text>
          <Text style={styles.cardSubtitle}>
            Transpose a public-domain score into a new key and save the copy
            to your library.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#4a4a6a" />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#eaeaff',
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    color: '#a0a0b8',
    lineHeight: 21,
    marginBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  cardPressed: {
    backgroundColor: '#1f2b52',
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardBody: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    color: '#eaeaff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 3,
  },
  cardSubtitle: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 19,
  },
});
