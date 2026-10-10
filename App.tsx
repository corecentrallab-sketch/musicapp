import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DefaultTheme as NavigationDefaultTheme,
  DarkTheme as NavigationDarkTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator, Dimensions } from 'react-native';
import { TabNavigator } from './src/navigation/TabNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PdfViewerScreen } from './src/screens/PdfViewerScreen';
import { ScannedViewerScreen } from './src/screens/ScannedViewerScreen';
import { ScanScoreScreen } from './src/screens/ScanScoreScreen';
import { CloudSyncScreen } from './src/screens/CloudSyncScreen';
import { MetronomeScreen } from './src/screens/MetronomeScreen';
import { NotationEditorScreen } from './src/screens/NotationEditorScreen';
// THE PRACTICE-VIDEO SURFACE (owner GO 10-10, backlog a49fbe2d): the record mode
// (camera + the existing audio recorder, one Stop) and the playback/overlay
// surface. History mounts it in place for its own rows; this route is the
// Practice Tools door.
import { PracticeVideoScreen } from './src/screens/PracticeVideoScreen';
import { AudioUnavailableChip } from './src/components/AudioUnavailableChip';
// The app's light/dark choice (v33 §F2, made APP-WIDE in v34b: owner FAIL item 6
// — "Light button only works on one page, the settings page"). The provider is
// mounted HERE, at the repo root and OUTSIDE NavigationContainer, so the container
// itself, every screen, every modal and the status bar all read the ONE mode. The
// palette + resolver live in src/services/theme.ts, the React binding in
// src/services/themeStore.ts, the per-screen repaint in src/services/themeApply.ts.
import { ThemeModeProvider, useThemeMode } from './src/services/themeStore';
import {
  hasCompletedOnboarding,
  saveOnboardingAnswers,
} from './src/services/storage';
import type { OnboardingAnswers, RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * THE PRACTICE-VIDEO ROUTE (owner GO 10-10, backlog a49fbe2d). A tiny wrapper so
 * the screen keeps its plain props (`rowId` / `onClose`): the route hands it the
 * optional row the caller named — a History row plays back, no row films a new
 * take — and closes it with the stack's own back.
 */
function PracticeVideoRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'PracticeVideo'>) {
  const params = route.params as { rowId?: string } | undefined;
  return (
    <PracticeVideoScreen rowId={params?.rowId ?? null} onClose={() => navigation.goBack()} />
  );
}

/**
 * The navigation container's own theme (react-navigation). It paints the gaps
 * between screens and the default background of a screen without one, so leaving
 * it light is what produced a white flash on a dark app — and leaving it dark is
 * what kept a light app dark. Built from the SAME tokens as every screen.
 */
function navigationTheme(mode: string, theme: {
  background: string;
  surface: string;
  text: string;
  border: string;
  accent: string;
  subtext: string;
}): NavigationTheme {
  const base = mode === 'light' ? NavigationDefaultTheme : NavigationDarkTheme;
  return {
    ...base,
    dark: mode !== 'light',
    colors: {
      ...base.colors,
      primary: theme.accent,
      background: theme.background,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      notification: theme.accent,
    },
  };
}

/**
 * The app shell — everything that depends on the chosen theme. It is a separate
 * component because it READS the theme, and only a component under the provider
 * can do that (the root App is the provider itself).
 */
function AppShell() {
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // The chosen palette (v33 §F2 → v34b app-wide). `theme` repaints the loading
  // view, the stack headers/footers, the status bar and the container; the
  // screens do the same with their own useThemedStyles binding.
  const { mode, tokens: theme } = useThemeMode();
  const statusBarStyle = mode === 'light' ? 'dark' : 'light';
  useEffect(() => {
    (async () => {
      const completed = await hasCompletedOnboarding();
      setShowOnboarding(!completed);
      setLoading(false);
    })();
  }, []);
  // Tablet support: devices >=600dp (tablets) get full rotation so sheet music
  // can be read in landscape; phones stay portrait for the tuned one-handed UX.
  useEffect(() => {
    const { width, height } = Dimensions.get('window');
    const isTablet = Math.min(width, height) >= 600;
    (async () => {
      try {
        if (isTablet) {
          await ScreenOrientation.unlockAsync();
        } else {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP
          );
        }
      } catch {
        // Orientation lock is best-effort; never block startup on it.
      }
    })();
  }, []);
  const handleOnboardingComplete = async (answers: OnboardingAnswers) => {
    await saveOnboardingAnswers(answers);
    setShowOnboarding(false);
  };
  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
  };
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎵</Text>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text
          style={{
            color: theme.subtext,
            marginTop: 16,
            fontSize: 16,
          }}
        >
          Loading NoteSnap...
        </Text>
      </View>
    );
  }
  if (showOnboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar style={statusBarStyle} />
        <OnboardingScreen
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      </SafeAreaProvider>
    );
  }
  // The stack's own chrome, from the same tokens as the screens: header fill =
  // surface, title/back tint = accent, an empty screen's body = surfaceAlt.
  const stackScreenOptions = {
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.accent,
    headerTitleStyle: { fontWeight: '700' as const, color: theme.text },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: theme.surfaceAlt },
  };
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme(mode, theme)}>
        <StatusBar style={statusBarStyle} />
        <Stack.Navigator screenOptions={stackScreenOptions}>
          <Stack.Screen
            name="Tabs"
            component={TabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PdfViewer"
            component={PdfViewerScreen}
            options={{ title: 'PDF' }}
          />
          <Stack.Screen
            name="ScannedViewer"
            component={ScannedViewerScreen}
            options={{ title: 'Scanned score' }}
          />
          <Stack.Screen
            name="ScanScore"
            component={ScanScoreScreen}
            options={{ title: 'Scan score' }}
          />
          <Stack.Screen
            name="CloudSync"
            component={CloudSyncScreen}
            options={{ title: 'Cloud sync' }}
          />
          <Stack.Screen
            name="Metronome"
            component={MetronomeScreen}
            options={{ title: 'Metronome' }}
          />
          <Stack.Screen
            name="NotationEditor"
            component={NotationEditorScreen}
            options={{ title: 'Notation editor' }}
          />
          <Stack.Screen
            name="PracticeVideo"
            component={PracticeVideoRoute}
            options={{ title: 'Record your practice' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      {/*
        THE VISIBLE AUDIO FAILURE (v34 fix 1c). Every audio path (the History take
        player, the tone preview, the session setup, the recorder) reports to
        services/audioDiagnostics, and this chip is the ONE place that renders it —
        "Audio unavailable: <reason>" with a ✕ that dismisses it. It renders
        nothing while the audio stack is healthy, is absolutely positioned with
        `pointerEvents="box-none"`, and never blocks a touch: the owner's v33 pass
        could not say WHY the app was quiet, and this is the answer on screen.
      */}
      <AudioUnavailableChip />
    </SafeAreaProvider>
  );
}

export default function App() {
  // ONE provider over the whole app (v34b). Every screen, the navigation
  // container, the status bar and the audio chip read the mode from here, so the
  // Settings toggle repaints the WHOLE app live — the owner's FAIL item 6.
  return (
    <ThemeModeProvider>
      <AppShell />
    </ThemeModeProvider>
  );
}
