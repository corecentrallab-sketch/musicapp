/**
 * PlanScreen — THE MONEY SURFACE, moved out of Settings (Settings pass, change A).
 *
 * WHY IT EXISTS: Settings was doing three jobs at once — the shop, the practice
 * dashboard and settings — and three of its nine sections were money (Your Plan,
 * Upgrade, Billing). The owner called Settings the weakest of the app's five
 * pages and approved moving the money onto its own surface. v48's conversion
 * layer needs a Plan surface anyway.
 *
 * THIS IS A RELOCATION, NOT A REDESIGN. Every card, every string, every price ID
 * and the disclosure placement came across VERBATIM from
 * src/screens/SettingsScreen.tsx. Nothing here invents a price, a plan name, a
 * billing period or a claim:
 *
 *   • the three live one-time Stripe prices, their tier names, the "Buy once"
 *     CTA and the Billing bullets are imported from services/v471PlanPrices —
 *     the ONE module that owns them (a guard in scripts/v471PlanPrices.test.ts
 *     and scripts/v48SettingsPass.test.ts asserts this file renders the table
 *     and holds no price literal of its own);
 *   • the copy says ONE-TIME everywhere and never "/mo", "monthly", "yearly",
 *     "subscription" or a trial — the live prices are `type: one_time` and the
 *     account has no recurring price at all;
 *   • recognition is never paywalled: this screen sells a cap lift, nothing else.
 *
 * THE ANALYTICS SURVIVED THE MOVE (v47.2 → here, same event names, same payload
 * shape). Losing them silently would blind the only conversion data we have:
 *
 *   plans_view  { hosted: boolean }        fired once when this surface is
 *                                          actually SEEN (mounted and the
 *                                          entitlement check finished) — never on
 *                                          a Settings mount, never per render.
 *   upgrade_tap { tier, opened }           fired after the checkout call: `tier`
 *                                          is the plan table's own stable key
 *                                          (never a Stripe identifier) and
 *                                          `opened` is true only when a real
 *                                          checkout URL came back and the
 *                                          browser opened.
 *
 * BACK: this is a plain stack route (App.tsx → Stack.Screen name="Plan"), so
 * React Navigation pops it itself — no hardware-back handler belongs here (the
 * first class of surface in services/backExitContract).
 *
 * Upgrade flow (unchanged):
 *   1. Tap a plan → POST /api/create-checkout-session with the device id
 *   2. Open the returned Stripe Checkout URL in a browser
 *   3. On return, poll GET /api/entitlement until the webhook grants Pro
 *   4. Persist the Pro state locally and show the unlocked-plan UI
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { checkEntitlement, createCheckoutSession } from '../services/api';
import { track } from '../services/analytics';
import { getDeviceId } from '../services/device';
import { getProState, saveProState, type ProState } from '../services/storage';
import { useThemeMode, useThemedStyles } from '../services/themeStore';
import {
  BILLING_NOTES,
  LIVE_PRICES,
  PLAN_CTA_LABEL,
  PLAN_SECTION_SUBTITLE,
  PURCHASE_DONE_BODY,
  PURCHASE_DONE_TITLE,
  planTierLabel,
  planTierSub,
} from '../services/v471PlanPrices';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

/**
 * The entitlement API's plan id, shown as a name. Deliberately a PREFIX match:
 * the server owns those ids, and none of them is copy the user should read.
 */
const planDisplayName = (plan: string): string =>
  plan.indexOf('family') >= 0 ? 'NoteSnap Family' : 'NoteSnap Pro';

type LoadingPlan = string | null;

export const PlanScreen: React.FC = () => {
  const [loadingPlan, setLoadingPlan] = useState<LoadingPlan>(null);
  const [proState, setProState] = useState<ProState>({
    isPro: false,
    plan: null,
    currentPeriodEnd: null,
  });
  const [checking, setChecking] = useState(true);
  const { tokens: theme } = useThemeMode();
  const { styles } = useThemedStyles(baseStyles);

  // The cached entitlement first (instant, honest), then the server's answer —
  // the webhook may have landed since the app last looked.
  useEffect(() => {
    (async () => {
      try {
        const cached = await getProState();
        setProState(cached);
        const deviceId = await getDeviceId();
        const fresh = await checkEntitlement(deviceId);
        setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
        await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
      } catch {
        // Offline or a server hiccup — keep the cached state rather than guess.
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const refreshEntitlement = useCallback(async (deviceId: string): Promise<boolean> => {
    const fresh = await checkEntitlement(deviceId);
    setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    return fresh.pro;
  }, []);

  const handleUpgrade = useCallback(async (priceId: string) => {
    setLoadingPlan(priceId);
    // v47.2 upgrade_tap — WHICH tier, and whether checkout actually OPENED. The
    // tier is the plan table's own stable key (never a Stripe identifier) and
    // "opened" is set only when a real checkout URL came back and the browser
    // opened: a tap that errors is counted as a tap that errored.
    const tier = LIVE_PRICES.find((plan) => plan.id === priceId)?.key ?? 'unknown';
    try {
      const deviceId = await getDeviceId();
      const checkoutUrl = await createCheckoutSession(priceId, deviceId);
      await WebBrowser.openBrowserAsync(checkoutUrl);
      track('upgrade_tap', { tier, opened: true });

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
        // A PURCHASE, not a subscription: the live prices are one_time, so
        // nothing here may claim a plan is "active" or that anything renews.
        Alert.alert(PURCHASE_DONE_TITLE, PURCHASE_DONE_BODY);
      }
    } catch (err) {
      track('upgrade_tap', { tier, opened: false });
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Checkout Error', message);
    } finally {
      setLoadingPlan(null);
    }
  }, [refreshEntitlement]);

  // v47.2 plans_view — fired when the plans/upgrade block is ACTUALLY SEEN (this
  // surface is mounted and the entitlement check has finished), never per render
  // and never from a Settings mount. That is the demand signal the subscription
  // decision needs.
  useEffect(() => {
    if (checking) return;
    track('plans_view', { hosted: proState.isPro });
  }, [checking, proState.isPro]);

  const planLabel = proState.plan ? planDisplayName(proState.plan) : null;

  /**
   * The screen's colours, resolved from the chosen theme — the same binding every
   * other screen reads (services/themeStore), so this surface repaints with the
   * rest of the app and the light theme is the token swap.
   */
  const themed = {
    screen: { backgroundColor: theme.background },
    title: { color: theme.accent },
    subtitle: { color: theme.subtext },
    strong: { color: theme.text },
    card: { backgroundColor: theme.surface, borderColor: theme.border },
  };

  return (
    <ScrollView style={[styles.container, themed.screen]} contentContainerStyle={styles.content}>
      {/* ── Current Plan ── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themed.title]}>Your Plan</Text>
        <View style={[styles.planCard, themed.card]}>
          {checking ? (
            <ActivityIndicator color={theme.accent} size="small" />
          ) : (
            <>
              <Text style={styles.planEmoji}>{proState.isPro ? '⭐' : '🎵'}</Text>
              <Text style={[styles.planName, themed.strong]}>
                {proState.isPro ? planLabel ?? 'NoteSnap Pro' : 'NoteSnap Free'}
              </Text>
              <Text style={[styles.planStatus, themed.subtitle]}>
                {proState.isPro ? 'Unlimited recognitions' : '5 recognitions a month'}
              </Text>
              {/* The old "Renews <date>" line is gone: the live prices are
                  one_time — nothing renews, so nothing may say so. */}
            </>
          )}
        </View>
      </View>

      {/* ── Upgrade Options (shown for free users) ── */}
      {!checking && !proState.isPro && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, themed.title]}>Upgrade</Text>
          <Text style={[styles.sectionSubtitle, themed.subtitle]}>{PLAN_SECTION_SUBTITLE}</Text>

          {LIVE_PRICES.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.upgradeCard, themed.card, plan.highlight && styles.upgradeCardHighlight]}
              onPress={() => handleUpgrade(plan.id)}
              disabled={loadingPlan !== null}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${plan.name}, ${plan.priceLabel}`}
            >
              <View style={styles.upgradeInfo}>
                <Text style={[styles.upgradeName, themed.strong]}>{plan.name}</Text>
                <Text style={[styles.upgradePrice, themed.subtitle]}>{plan.priceLabel}</Text>
                <Text style={[styles.upgradeFeature, themed.subtitle]}>{plan.feature}</Text>
              </View>
              {loadingPlan === plan.id ? (
                <ActivityIndicator color={theme.accent} size="small" />
              ) : (
                <View style={[styles.upgradeBtn, plan.highlight && styles.upgradeBtnPrimary]}>
                  <Text style={[styles.upgradeBtnText, plan.highlight && styles.upgradeBtnTextPrimary]}>
                    {PLAN_CTA_LABEL}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Billing Info ── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themed.title]}>Billing</Text>
        <View style={[styles.infoCard, themed.card]}>
          {BILLING_NOTES.map((note) => (
            <Text key={note} style={[styles.infoText, themed.subtitle]}>
              • {note}
            </Text>
          ))}
        </View>
      </View>

      {/* The honest tail, for a user who is already Pro: what they bought. */}
      {!checking && proState.isPro && (
        <Text style={[styles.infoText, themed.subtitle]}>{planTierSub(true)}</Text>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

// Layout only — every colour arrives from the resolved theme tokens at the call
// site (the same convention as the rest of the app). The card copy, the CTAs and
// the plan names are NOT here: they live in services/v471PlanPrices.
const baseStyles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#e94560', marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, color: '#a0a0b8', marginBottom: 16, lineHeight: 20 },

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
  planEmoji: { fontSize: 40, marginBottom: 8 },
  planName: { fontSize: 20, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  planStatus: { fontSize: 14, color: '#a0a0b8' },

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
  upgradeCardHighlight: { borderColor: '#e94560', borderWidth: 2 },
  upgradeInfo: { flex: 1, minWidth: 0, marginRight: 12 },
  upgradeName: { fontSize: 17, fontWeight: '700', color: '#ffffff', marginBottom: 2 },
  upgradePrice: { fontSize: 15, color: '#c0c0d0', fontWeight: '600', marginBottom: 2 },
  upgradeFeature: { fontSize: 13, color: '#a0a0b8', lineHeight: 20 },
  upgradeBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e94560',
    // The CTA is the measured side of the row: the copy beside it flexes and the
    // card GROWS vertically at a raised font scale (no fixed height anywhere).
    flexShrink: 0,
    alignSelf: 'center',
  },
  upgradeBtnPrimary: { backgroundColor: '#e94560' },
  upgradeBtnText: { color: '#e94560', fontSize: 14, fontWeight: '700' },
  upgradeBtnTextPrimary: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  // Billing info
  infoCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  infoText: { fontSize: 14, color: '#a0a0b8', lineHeight: 22 },
  bottomSpacer: { height: 40 },
});
