/**
 * SettingsScreen — subscription management and account settings.
 *
 * Upgrade flow (no hardcoded payment links — the old buy.stripe.com URLs pointed
 * at a foreign Stripe account and are gone):
 *   1. Tap a plan → POST /api/create-checkout-session with the device id
 *   2. Open the returned Stripe Checkout URL in a browser
 *   3. On return, poll GET /api/entitlement until the webhook grants Pro
 *   4. Persist the Pro state locally and show the active-plan UI
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
import { getNotificationEnabled, setNotificationEnabled, getProState, saveProState, type ProState } from '../services/storage';
import { scheduleDailyStreakNudge, cancelStreakNudge } from '../services/notifications';
import { createCheckoutSession, checkEntitlement } from '../services/api';
import { getDeviceId } from '../services/device';

// Owner-account Stripe price IDs (USD). These are public identifiers passed to
// our own API — the API is what creates the Checkout session on the owner's
// Stripe account, so money always lands in the right place.
const PLANS = [
  {
    id: 'price_1U3SEFBbnDObsY4ujb2zxBSs', // NoteSnap Pro — Monthly $4.99
    name: 'Pro Monthly',
    price: '$4.99 / month',
    feature:
      '✓ Unlimited recognitions\n✓ Grade/difficulty levels\n✓ Advanced recommendations\n✓ Custom app skins\n✓ Cloud sync & sharing\n✓ No ads anywhere',
  },
  {
    id: 'price_1U3SEKBbnDObsY4usDGDFNPQ', // NoteSnap Pro — Yearly $39.99
    name: 'Pro Yearly',
    price: '$39.99 / year',
    savings: 'Save 33% vs monthly',
    feature: 'All Pro features, billed annually.',
    highlight: true,
  },
  {
    id: 'price_1U3SEKBbnDObsY4uVrnJDIyg', // NoteSnap Family/Teacher $9.99
    name: 'Family / Teacher',
    price: '$9.99 / month',
    feature:
      '✓ Up to 5 accounts\n✓ Shared History libraries\n✓ All Pro features included\n✓ Perfect for families & music teachers',
  },
] as const;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

const PLAN_LABELS: Record<string, string> = {
  'pro-monthly': 'NoteSnap Pro',
  'pro-yearly': 'NoteSnap Pro',
  family: 'NoteSnap Family',
};

type LoadingPlan = string | null;

export const SettingsScreen: React.FC = () => {
  const [loadingPlan, setLoadingPlan] = useState<LoadingPlan>(null);
  const [proState, setProState] = useState<ProState>({
    isPro: false,
    plan: null,
    currentPeriodEnd: null,
  });
  const [checking, setChecking] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    getNotificationEnabled().then(setNotificationsEnabled);
    (async () => {
      try {
        const cached = await getProState();
        setProState(cached);
        // Refresh entitlement from the server (webhook may have landed since).
        const deviceId = await getDeviceId();
        const fresh = await checkEntitlement(deviceId);
        setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
        await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
      } catch {
        // Offline or server hiccup — keep the cached state.
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const toggleNotifications = useCallback(async () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    await setNotificationEnabled(next);
    if (next) await scheduleDailyStreakNudge();
    else await cancelStreakNudge();
  }, [notificationsEnabled]);

  const refreshEntitlement = useCallback(async (deviceId: string): Promise<boolean> => {
    const fresh = await checkEntitlement(deviceId);
    setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    return fresh.pro;
  }, []);

  const handleUpgrade = useCallback(async (priceId: string) => {
    setLoadingPlan(priceId);
    try {
      const deviceId = await getDeviceId();
      const checkoutUrl = await createCheckoutSession(priceId, deviceId);
      await WebBrowser.openBrowserAsync(checkoutUrl);

      // User is back — poll the server until the webhook grants the entitlement
      // (webhooks usually land within seconds; give it up to 30s).
      const startedAt = Date.now();
      let pro = false;
      while (!pro && Date.now() - startedAt < POLL_MAX_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          pro = await refreshEntitlement(deviceId);
        } catch {
          // transient failure — keep polling
        }
      }
      if (pro) {
        Alert.alert('Welcome to Pro!', 'Your subscription is active. Enjoy unlimited recognitions.');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Checkout Error', message);
    } finally {
      setLoadingPlan(null);
    }
  }, [refreshEntitlement]);

  const planLabel = proState.plan ? PLAN_LABELS[proState.plan] ?? 'NoteSnap Pro' : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* ── Current Plan ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Plan</Text>
        <View style={styles.planCard}>
          {checking ? (
            <ActivityIndicator color="#e94560" size="small" />
          ) : (
            <>
              <Text style={styles.planEmoji}>
                {proState.isPro ? '⭐' : '🎵'}
              </Text>
              <Text style={styles.planName}>
                {proState.isPro ? planLabel ?? 'NoteSnap Pro' : 'NoteSnap Free'}
              </Text>
              <Text style={styles.planStatus}>
                {proState.isPro
                  ? 'Unlimited recognitions'
                  : '5 recognitions / month'}
              </Text>
              {proState.isPro && proState.currentPeriodEnd && (
                <Text style={styles.planRenews}>
                  Renews {new Date(proState.currentPeriodEnd).toLocaleDateString()}
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      {/* ── Upgrade Options (shown for free users) ── */}
      {!checking && !proState.isPro && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upgrade</Text>
          <Text style={styles.sectionSubtitle}>
            You're on the free plan — 5 recognitions/month.{'\n'}
            Upgrade anytime for unlimited access.
          </Text>

          {PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.upgradeCard, plan.highlight && styles.upgradeCardHighlight]}
              onPress={() => handleUpgrade(plan.id)}
              disabled={loadingPlan !== null}
              activeOpacity={0.7}
            >
              {plan.highlight && (
                <View style={styles.bestValueBadge}>
                  <Text style={styles.bestValueText}>BEST VALUE</Text>
                </View>
              )}
              <View style={styles.upgradeInfo}>
                <Text style={styles.upgradeName}>{plan.name}</Text>
                <Text style={styles.upgradePrice}>{plan.price}</Text>
                {plan.savings && (
                  <Text style={styles.upgradeSavings}>{plan.savings}</Text>
                )}
                <Text style={styles.upgradeFeature}>{plan.feature}</Text>
              </View>
              {loadingPlan === plan.id ? (
                <ActivityIndicator color="#e94560" size="small" />
              ) : (
                <View style={[styles.upgradeBtn, plan.highlight && styles.upgradeBtnPrimary]}>
                  <Text style={[styles.upgradeBtnText, plan.highlight && styles.upgradeBtnTextPrimary]}>
                    Subscribe
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
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
    minHeight: 110,
    justifyContent: 'center',
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
  planRenews: {
    fontSize: 13,
    color: '#4ecdc4',
    marginTop: 6,
    fontWeight: '600',
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
