/**
 * LibraryHeaderActions — THE LIBRARY TAB'S TWO HEADER BUTTONS (designer spec §2).
 *
 * The spec's rule for this header is "one +, one meaning": every way to bring music
 * in starts from the ONE 44 dp filled HUM circle, 48 dp left of the cog, with an
 * 18 dp `+` in PILL_ON. It replaces the scattered add/import affordances the Library
 * used to show (an "Import file" button and a "Scan score" button above the list).
 *
 * The second button is NOT new: it is the Cloud Sync glyph that already lived in
 * this header (the Library item menu tells users to "tap the cloud icon at the top
 * of the Library"), moved here unchanged so this header has exactly one owner.
 * Without it, the item menu's own instruction would point at nothing.
 *
 * Colours come from the spec's role map (services/addMusicSheet → addMusicPalette),
 * so this file carries no hex of its own and both themes need only the token swap.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { useThemeMode } from '../services/themeStore';
import {
  ADD_MUSIC_BUTTON_LABEL,
  ADD_MUSIC_SPEC,
  addMusicPalette,
} from '../services/addMusicSheet';

export interface LibraryHeaderActionsProps {
  /** Opens the "+ Add music" sheet — the Library owns that sheet's state. */
  onOpenAddMusic: () => void;
}

export const LibraryHeaderActions: React.FC<LibraryHeaderActionsProps> = ({ onOpenAddMusic }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tokens } = useThemeMode();
  const palette = addMusicPalette(tokens);
  return (
    <View style={styles.headerActions}>
      {/* THE ONE + : a 44 dp filled HUM circle with an 18 dp PILL_ON glyph. */}
      <Pressable
        onPress={onOpenAddMusic}
        accessibilityRole="button"
        accessibilityLabel={ADD_MUSIC_BUTTON_LABEL}
        accessibilityHint="Scan, upload or browse for music"
        style={({ pressed }) => [styles.addButton, { backgroundColor: palette.HUM }, pressed && styles.pressed]}
        hitSlop={2}
        testID="library-add-music"
      >
        <Ionicons name="add" size={ADD_MUSIC_SPEC.addGlyphDp} color={palette.PILL_ON} />
      </Pressable>
      {/* The Cloud Sync entry that was already in this header. */}
      <Pressable
        onPress={() => navigation.getParent()?.navigate('CloudSync')}
        accessibilityRole="button"
        accessibilityLabel="Cloud sync"
        style={({ pressed }) => [styles.cloudButton, pressed && styles.pressed]}
        hitSlop={8}
        testID="library-cloud-sync"
      >
        <Ionicons name="cloud-upload" size={22} color={palette.HUM} />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  /* 44 dp circle + a 4 dp gap = the + sits 48 dp from the cog's leading edge. */
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudButton: { minWidth: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
