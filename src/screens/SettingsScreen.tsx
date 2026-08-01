/**
 * SettingsScreen — subscription management and account settings.
 *
 * For free users, shows the current plan and upgrade options.
 * Upgrade buttons open Stripe Payment Links directly via expo-web-browser —
 * no API call, no server-side key needed.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { getNotificationEnabled, setNotificationEnabled } from '../services/storage';
import { scheduleDailyStreakNudge, cancelStreakNudge } from '../services/notifications';

// Stripe Payment Links (live, no API key needed)
const PAYMENT_LINKS = {
  proMonthly: 'https://buy.stripe.com/3cI28tfBL0ZJ8h7gIX04804',
  proYearly: 'https://buy.stripe.com/00wdRb1KV37RfJz64j04803',
  family: 'https://buy.stripe.com/00wdRb4X7fUDdBr50f04805',
} as const;

type LoadingLink = string | null;

export const SettingsScreen: React.FC = () => {
  const [loadingLink, setLoadingLink] = useState<LoadingLink>(null);
  const [currentPlan] = useState<'free' | 'pro' | 'family'>('free');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    getNotificationEnabled().then(setNotificationsEnabled);
  }, []);

  const toggleNotifications = useCallback(async () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    await setNotificationEnabled(next);
    if (next) await scheduleDailyStreakNudge();
    else await cancelStreakNudge();
  }, [notificationsEnabled]);

  const handleUpgrade = useCallback(async (paymentLink: string) => {
    setLoadingLink(paymentLink);
    try {
      const result = await WebBrowser.openBrowserAsync(paymentLink);

      if (result.type === 'cancel') {
        // User closed the browser without completing — no action needed
      }
      // On success, Stripe redirects to success_url which closes the browser.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Checkout Error', message);
    } finally {
      setLoadingLink(null);
    }
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* ── Current Plan ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Plan</Text>
        <View style={styles.planCard}>
          <Text style={styles.planEmoji}>
            {currentPlan === 'pro' ? '⭐' : currentPlan === 'family' ? '👨‍👩‍👧‍👦' : '🎵'}
          </Text>
          <Text style={styles.planName}>
            {currentPlan === 'pro'
              ? 'NoteSnap Pro'
              : currentPlan === 'family'
              ? 'NoteSnap Family'
              : 'NoteSnap Free'}
          </Text>
          <Text style={styles.planStatus}>
            {currentPlan === 'free'
              ? '5 recognitions / month'
              : 'Unlimited recognitions'}
          </Text>
        </View>
      </View>

      {/* ── Upgrade Options (shown for free users) ── */}
      {currentPlan === 'free' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upgrade</Text>
          <Text style={styles.sectionSubtitle}>
            You're on the free plan — 5 recognitions/month.{'\n'}
            Upgrade anytime for unlimited access.
          </Text>

          {/* Pro Monthly */}
          <TouchableOpacity
            style={styles.upgradeCard}
            onPress={() => handleUpgrade(PAYMENT_LINKS.proMonthly)}
            disabled={loadingLink !== null}
            activeOpacity={0.7}
          >
            <View style={styles.upgradeInfo}>
              <Text style={styles.upgradeName}>Pro Monthly</Text>
              <Text style={styles.upgradePrice}>$4.99 / month</Text>
              <Text style={styles.upgradeFeature}>
                ✓ Unlimited recognitions{'\n'}
                ✓ Grade/difficulty levels{'\n'}
                ✓ Advanced recommendations{'\n'}
                ✓ Custom app skins{'\n'}
                ✓ Cloud sync & sharing{'\n'}
                ✓ No ads anywhere
              </Text>
            </View>
            {loadingLink === PAYMENT_LINKS.proMonthly ? (
              <ActivityIndicator color="#e94560" size="small" />
            ) : (
              <View style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnText}>Subscribe</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Pro Yearly */}
          <TouchableOpacity
            style={[styles.upgradeCard, styles.upgradeCardHighlight]}
            onPress={() => handleUpgrade(PAYMENT_LINKS.proYearly)}
            disabled={loadingLink !== null}
            activeOpacity={0.7}
          >
            <View style={styles.bestValueBadge}>
              <Text style={styles.bestValueText}>BEST VALUE</Text>
            </View>
            <View style={styles.upgradeInfo}>
              <Text style={styles.upgradeName}>Pro Yearly</Text>
              <Text style={styles.upgradePrice}>$39.99 / year</Text>
              <Text style={styles.upgradeSavings}>Save 33% vs monthly</Text>
              <Text style={styles.upgradeFeature}>
                All Pro features, billed annually.
              </Text>
            </View>
            {loadingLink === PAYMENT_LINKS.proYearly ? (
              <ActivityIndicator color="#e94560" size="small" />
            ) : (
              <View style={[styles.upgradeBtn, styles.upgradeBtnPrimary]}>
                <Text style={styles.upgradeBtnTextPrimary}>Subscribe</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Family Plan */}
          <TouchableOpacity
            style={styles.upgradeCard}
            onPress={() => handleUpgrade(PAYMENT_LINKS.family)}
            disabled={loadingLink !== null}
            activeOpacity={0.7}
          >
            <View style={styles.upgradeInfo}>
              <Text style={styles.upgradeName}>Family / Teacher</Text>
              <Text style={styles.upgradePrice}>$9.99 / month</Text>
              <Text style={styles.upgradeFeature}>
                ✓ Up to 5 accounts{'\n'}
                ✓ Shared History libraries{'\n'}
                ✓ All Pro features included{'\n'}
                ✓ Perfect for families & music teachers
              </Text>
            </View>
            {loadingLink === PAYMENT_LINKS.family ? (
              <ActivityIndicator color="#e94560" size="small" />
            ) : (
              <View style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnText}>Subscribe</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Practice reminders</Text>
        <View style={styles.infoCard}>
          <View style={styles.reminderRow}>
            <View style={styles.reminderCopy}>
              <Text style={styles.reminderTitle}>Daily streak nudge</Text>
              <Text style={styles.infoText}>At 6:00 PM, remind me if I have not practiced.</Text>
            </View>
            <TouchableOpacity onPress={toggleNotifications} style={[styles.toggle, notificationsEnabled && styles.toggleOn]} accessibilityRole="switch" accessibilityState={{ checked: notificationsEnabled }}>
              <Text style={styles.toggleText}>{notificationsEnabled ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Billing Info ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Billing</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            • Cancel anytime — one tap, no hassle{'\n'}
            • Free plan available with 5 recognitions/month{'\n'}
            • No commitments — you're in control{'\n'}
            • Payment processed securely by Stripe
          </Text>
        </View>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e94560',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#a0a0b8',
    marginBottom: 16,
    lineHeight: 20,
  },

  reminderRow: { flexDirection: 'row', alignItems: 'center' },
  reminderCopy: { flex: 1, marginRight: 12 },
  reminderTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  toggle: { backgroundColor: '#3a3a5c', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  toggleOn: { backgroundColor: '#e94560' },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  // Current Plan
  planCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  planEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  planStatus: {
    fontSize: 14,
    color: '#a0a0b8',
  },

  // Upgrade Cards
  upgradeCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    flexDirection: 'row',
    alignItems: 'center',
  },
  upgradeCardHighlight: {
    borderColor: '#e94560',
    borderWidth: 2,
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#e94560',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  bestValueText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  upgradeInfo: {
    flex: 1,
    marginRight: 12,
  },
  upgradeName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  upgradePrice: {
    fontSize: 15,
    color: '#c0c0d0',
    fontWeight: '600',
    marginBottom: 2,
  },
  upgradeSavings: {
    fontSize: 13,
    color: '#4ecdc4',
    fontWeight: '600',
    marginBottom: 6,
  },
  upgradeFeature: {
    fontSize: 13,
    color: '#a0a0b8',
    lineHeight: 20,
  },
  upgradeBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  upgradeBtnPrimary: {
    backgroundColor: '#e94560',
  },
  upgradeBtnText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
  },
  upgradeBtnTextPrimary: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Billing info
  infoCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  infoText: {
    fontSize: 14,
    color: '#a0a0b8',
    lineHeight: 22,
  },

  bottomSpacer: {
    height: 40,
  },
});
