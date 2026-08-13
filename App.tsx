import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator, Dimensions } from 'react-native';
import { TabNavigator } from './src/navigation/TabNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PdfViewerScreen } from './src/screens/PdfViewerScreen';
import { ScannedViewerScreen } from './src/screens/ScannedViewerScreen';
import { ScanScoreScreen } from './src/screens/ScanScoreScreen';
import { CloudSyncScreen } from './src/screens/CloudSyncScreen';
import { MetronomeScreen } from './src/screens/MetronomeScreen';
import {
  hasCompletedOnboarding,
  saveOnboardingAnswers,
} from './src/services/storage';
import type { OnboardingAnswers, RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: '#16213e' },
  headerTintColor: '#e94560',
  headerTitleStyle: { fontWeight: '700' as const },
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: '#1a1a2e' },
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
          backgroundColor: '#1a1a2e',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎵</Text>
        <ActivityIndicator size="large" color="#e94560" />
        <Text
          style={{
            color: '#a0a0b8',
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
        <StatusBar style="light" />
        <OnboardingScreen
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="auto" />
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
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
