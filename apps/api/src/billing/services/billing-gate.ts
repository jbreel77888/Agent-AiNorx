import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';
import { getCreditAccount } from '../repositories/credit-accounts';
import { isPerSeatAccount, MINIMUM_CREDIT_FOR_RUN } from './tiers';

type BillingGateReason =
  | 'subscription_required'
  | 'insufficient_credits'
  | 'no_account';

export interface BillingGateOk {
  ok: true;
}

export interface BillingGateBlocked {
  ok: false;
  reason: BillingGateReason;
  balance: number;
  message: string;
}

export async function checkBillingActive(accountId: string): Promise<BillingGateOk | BillingGateBlocked> {
  // Self-hosted / billing-disabled deploys treat every account as billing-active.
  // No subscription, no credit balance, no 402 — the entire wallet pipeline is
  // dormant on this deploy.
  if (!config.KORTIX_BILLING_INTERNAL_ENABLED) {
    return { ok: true };
  }

  // Phase 5: Monthly subscription model — if the account has an active
  // subscription, they're in. No per-usage credit checks.
  // This simplifies the gate: subscription = access, no subscription = blocked.
  // The free plan (price $0) counts as an active subscription.
  const account = await getCreditAccount(accountId);
  if (!account) {
    return {
      ok: false,
      reason: 'no_account',
      balance: 0,
      message: 'No account found. Complete account setup first.',
    };
  }

  // Check for active subscription (Stripe or free plan)
  const hasActiveSub =
    !!account.stripeSubscriptionId &&
    account.stripeSubscriptionStatus !== 'canceled' &&
    account.stripeSubscriptionStatus !== 'unpaid';

  // Legacy accounts with credit balance can still use the platform
  const balance = Number(account.balance ?? 0);

  if (hasActiveSub) return { ok: true };
  if (balance >= MINIMUM_CREDIT_FOR_RUN) return { ok: true };

  // No subscription and no credits → need to subscribe
  return {
    ok: false,
    reason: 'subscription_required',
    balance,
    message: 'Subscribe to a plan to start using VaelorX. Plans start at $0/mo.',
  };
}

export async function assertBillingActive(accountId: string): Promise<void> {
  const result = await checkBillingActive(accountId);
  if (result.ok) return;
  throw new HTTPException(402, {
    message: result.message,
    res: new Response(
      JSON.stringify({
        error: result.message,
        code: result.reason,
        balance: result.balance,
        account_id: accountId,
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    ),
  });
}
