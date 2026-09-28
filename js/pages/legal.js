// Legal pages: /privacy (Privacy Policy), /terms (Terms of Service), /refunds (Refund &
// Cancellation Policy). Public — no paywall. Owner-specific values come from LEGAL in
// js/config.js; nothing here is hard-coded per owner.
//
// NOTE FOR THE OWNER: this text is a plain-language template written to match how the app
// actually works (Supabase email accounts, localStorage progress, Stripe subscriptions,
// affiliate links, Vercel hosting, cookieless analytics). It is not legal advice — have it
// reviewed by a qualified lawyer for your business and jurisdiction before relying on it.
import { h, icon } from '../core/ui.js';
import { LEGAL, PLANS } from '../config.js';

const DOCS = {
  privacy: { title: 'Privacy Policy', eyebrow: 'Legal', build: privacyDoc },
  terms: { title: 'Terms of Service', eyebrow: 'Legal', build: termsDoc },
  refunds: { title: 'Refund & Cancellation Policy', eyebrow: 'Billing', build: refundsDoc },
};

const REQUIRED = ['contactEmail', 'jurisdiction'];

function isLocalHost() {
  try {
    const n = location.hostname;
    return n === 'localhost' || n === '127.0.0.1' || n === '::1' || n === '[::1]';
  } catch {
    return false;
  }
}

function missingValues() {
  return REQUIRED.filter((k) => LEGAL[k] == null || String(LEGAL[k]).trim() === '');
}

function business() {
  return LEGAL.businessName || 'The Trade School';
}

function effectiveDate() {
  const raw = LEGAL.effectiveDate;
  if (!raw) return null;
  const d = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(raw);
  try {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return String(raw);
  }
}

/** "email us at x" (link) or a neutral fallback when no address is configured. */
function contact() {
  const email = LEGAL.contactEmail && String(LEGAL.contactEmail).trim();
  if (email) return h('a', { href: `mailto:${email}`, 'data-no-route': '' }, email);
  return 'the contact details published on this site';
}

function price(id) {
  const p = PLANS[id];
  return p ? `$${p.price.toFixed(2)} ${p.currency || 'USD'} per ${p.interval || 'month'}` : 'the price shown at checkout';
}

const p = (...kids) => h('p', null, ...kids);
const ul = (...items) => h('ul', null, items.map((i) => h('li', null, ...[].concat(i))));
const sec = (title, ...kids) => h('section', { class: 'legal__section' }, h('h2', null, title), ...kids);
const strong = (t) => h('strong', null, t);

// ------------------------------------------------------------------ Privacy

function privacyDoc() {
  const biz = business();
  return [
    p(`This policy explains what information ${biz} (“we”, “us”) collects when you use this website and app, why, and the choices you have. `
      + 'We collect as little as we need to run the school.'),
    sec('Information we collect',
      ul(
        [strong('Account details. '), 'If you create an account we store your email address, a securely hashed password, an optional display name, '
          + 'and basic account metadata (for example when the account was created). Accounts are run on Supabase, our authentication and database provider.'],
        [strong('Learning progress. '), 'Your XP, completed lessons, game scores, badges and settings (theme, sound) are saved in your browser’s '
          + 'local storage on your device. If you are signed in, we may also store a copy with your account so it can follow you between devices.'],
        [strong('Subscription and payment information. '), 'Payments are processed by Stripe. We never see or store your full card number. '
          + 'We receive and keep a Stripe customer ID, your plan, subscription status and billing dates so we know what you have access to.'],
        [strong('Usage analytics. '), 'We use Vercel Web Analytics, which is cookieless: it records aggregated page views (the page, referrer, '
          + 'browser/device type and country derived from your IP address) without cookies and without building a profile that identifies you '
          + 'across sites. It is not loaded when the site runs locally.'],
        [strong('Technical data. '), 'Like any website, our hosting provider (Vercel) and service providers process your IP address and '
          + 'request details (for example in server logs) to deliver pages, keep the service secure and prevent abuse.'],
      )),
    sec('How we use it',
      ul(
        'To create and secure your account and sign you in.',
        'To unlock the lessons and games included in your plan and to manage your subscription.',
        'To save your progress and settings.',
        'To understand, in aggregate, which pages are used so we can improve the school.',
        'To send essential service emails (for example sign-up confirmation or password reset). We do not send marketing email without your consent.',
        'To comply with legal obligations and enforce our Terms.',
      )),
    sec('Cookies and local storage',
      p('We do not use advertising or tracking cookies. The app uses your browser’s local storage and session storage to remember your progress, '
        + 'settings, where to return after signing in, and — when you sign in — your login session. Clearing your browser data removes them. '
        + 'Stripe may set its own cookies on its checkout and billing pages, which are covered by Stripe’s privacy policy.')),
    sec('Service providers we share data with',
      p('We do not sell your personal information and we do not share it for cross-context behavioural advertising. '
        + 'We share it only with providers that help us run the service, under their own privacy and security terms:'),
      ul(
        [strong('Supabase'), ' — accounts, authentication and database.'],
        [strong('Stripe'), ' — subscription checkout, billing and the customer portal.'],
        [strong('Vercel'), ' — website hosting and cookieless Web Analytics.'],
        [strong('Google Fonts'), ' — web fonts are loaded from Google’s servers, which receive your IP address and browser details.'],
        [strong('Market-data providers'), ' — real-market charts are fetched through our server, so these providers do not receive your personal information.'],
      ),
      p('We may also disclose information if required by law or to protect the rights, safety and security of our users or the service.')),
    sec('Affiliate links',
      p('Our Platforms page contains affiliate / referral links. When you click one you leave our site; the partner may use cookies or other tracking '
        + 'to attribute your sign-up to us. Their handling of your data is governed by their own privacy policies.')),
    sec('How long we keep it',
      p('We keep account and progress data while your account is open. When you ask us to delete your account we delete or anonymise its data, '
        + 'except billing records we must keep for tax and accounting purposes (typically several years). Local-storage data stays on your device until you clear it.')),
    sec('Your rights and choices',
      p('Depending on where you live (including under the California Consumer Privacy Act and the EU/UK GDPR), you may have the right to access, '
        + 'correct, download or delete your personal information, and to object to or restrict certain processing. '
        + 'We will not discriminate against you for exercising these rights. To make a request, contact us at ', contact(),
        '. We may need to verify your identity before acting on a request. You can cancel a subscription at any time from the Account page.')),
    sec('Security',
      p('Data is sent over HTTPS, passwords are hashed by our authentication provider and database access is restricted per user. '
        + 'No system is perfectly secure, so please use a strong, unique password.')),
    sec('Children',
      p(`${biz} is not directed at children under 13 and we do not knowingly collect their personal information. `
        + 'Paid subscriptions require you to be an adult who can enter a binding contract, or to have a parent or guardian’s permission. '
        + 'If you believe a child has given us personal information, contact us and we will delete it.')),
    sec('International users',
      p('Our service providers may process data in the United States and other countries. By using the service you understand that your information may be '
        + 'transferred to and processed in countries with different data-protection laws than your own.')),
    sec('Changes to this policy',
      p('We may update this policy. We will change the effective date above and, for significant changes, give notice in the app or by email.')),
    sec('Contact',
      p('Questions or requests about privacy: ', contact(), '.')),
  ];
}

// ------------------------------------------------------------------ Terms

function termsDoc() {
  const biz = business();
  const law = LEGAL.jurisdiction && String(LEGAL.jurisdiction).trim();
  return [
    p(`These Terms of Service (“Terms”) govern your use of ${biz} website and app (the “Service”). By creating an account, `
      + 'subscribing or otherwise using the Service you agree to these Terms and to our ', h('a', { href: '/privacy' }, 'Privacy Policy'),
    '. If you do not agree, do not use the Service.'),
    sec('1. Educational use only — not financial advice',
      p(strong(`${biz} provides general educational content about reading price charts and trading concepts. It is not financial, investment, tax or legal advice, `
        + 'and nothing in the Service is a recommendation to buy, sell or hold any security, currency, crypto-asset or other instrument.')),
      p('Charts in lessons and games are either generated (simulated) or historical/delayed market data used for practice. Results in games and simulations '
        + 'do not predict real results. Trading involves substantial risk of loss. Make your own decisions and consider a licensed professional before investing.')),
    sec('2. No guarantee',
      p('We do not guarantee any trading outcome, profit, skill level, pass rate or that the content is complete, current or error-free. '
        + 'Market data may be delayed, incomplete or inaccurate.')),
    sec('3. Accounts',
      p('You must give a valid email address and keep your password secure. You are responsible for activity on your account. '
        + 'You must be old enough to form a binding contract where you live (or have a parent or guardian’s permission) to buy a subscription. '
        + 'One account is for one person; do not share paid access.')),
    sec('4. Subscriptions and billing',
      ul(
        `Beginner costs ${price('beginner')} and Advanced costs ${price('advanced')}, plus any applicable taxes. Prices shown at checkout apply.`,
        'Subscriptions renew automatically each billing period until you cancel. Payments are processed by Stripe; by subscribing you authorise recurring charges to your payment method.',
        'You can cancel online at any time from the Account page (Manage billing → Stripe customer portal). Cancellation stops the next renewal; you keep access until the end of the period you have paid for.',
        ['Payments are non-refundable except as set out in our ', h('a', { href: '/refunds' }, 'Refund & Cancellation Policy'), ' or where required by law.'],
        'If you switch between plans, Stripe may apply a prorated charge or credit for the rest of the billing period.',
        'We may change prices for future billing periods with advance notice. Price changes do not affect a period you have already paid for.',
      )),
    sec('5. Free content',
      p('Some content is available without paying. We may change what is free, or add, change or remove lessons, games and features at any time.')),
    sec('6. Acceptable use',
      ul(
        'Do not copy, resell, redistribute or scrape paid content, or share it outside your account.',
        'Do not attempt to bypass access controls, disrupt the Service or access other users’ data.',
        'Do not use the Service for anything unlawful.',
      ),
      p('We may suspend or close accounts that break these Terms.')),
    sec('7. Intellectual property',
      p(`The Service and its content (text, charts, games, design and code) belong to ${biz} or its licensors. `
        + 'Your subscription gives you a personal, non-transferable licence to use it for your own learning while your access is active.')),
    sec('8. Third-party services and affiliate links',
      p('The Service links to third-party sites, including brokers and trading platforms on our Platforms page. Some are affiliate links for which we may earn a commission. '
        + 'We do not control and are not responsible for third-party services; your use of them is governed by their terms, and listing them is not a recommendation.')),
    sec('9. Disclaimer of warranties',
      p('The Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose, '
        + 'accuracy and non-infringement, to the fullest extent permitted by law.')),
    sec('10. Limitation of liability',
      p(`To the fullest extent permitted by law, ${biz} will not be liable for any trading or investment losses, lost profits, or indirect, incidental, special, `
        + 'consequential or punitive damages arising from your use of the Service. Our total liability for any claim relating to the Service is limited to '
        + 'the amount you paid us in the 12 months before the claim. Some jurisdictions do not allow certain limitations, so they may not apply to you.')),
    sec('11. Changes to these Terms',
      p('We may update these Terms. We will change the effective date above and, for material changes, give notice in the app or by email. '
        + 'Continuing to use the Service after changes take effect means you accept them.')),
    sec('12. Governing law',
      p(law
        ? `These Terms are governed by the laws of ${law}, without regard to conflict-of-law rules, and disputes will be handled by the courts located there, `
          + 'unless the law where you live gives you the right to bring claims locally.'
        : `These Terms are governed by the laws of the place where ${biz} is established, unless the law where you live gives you the right to bring claims locally.`)),
    sec('13. Contact',
      p('Questions about these Terms: ', contact(), '.')),
  ];
}

// ------------------------------------------------------------------ Refunds

function refundsDoc() {
  return [
    p('Subscriptions to the Beginner plan (', price('beginner'), ') and the Advanced plan (', price('advanced'),
      ') renew automatically every month until you cancel.'),
    sec('Cancel anytime, online',
      p('You can cancel online at any time — no email or phone call needed. Sign in, open ', h('a', { href: '/account' }, 'Account'),
        ', choose ', strong('Manage billing'), ' and cancel in the Stripe customer portal. The portal also lets you update your payment method and see invoices.'),
      p('Cancellation stops future renewals. You keep access to your plan until the end of the billing period you have already paid for; after that your account '
        + 'returns to the free tier and your saved progress stays.')),
    sec('No refunds for partial periods',
      p('Payments are non-refundable. We do not give partial or pro-rated refunds for unused time in a billing period, or for periods in which you did not use the Service, '
        + 'except where required by law.')),
    sec('Plan changes',
      p('If you upgrade from Beginner to Advanced (or switch back), Stripe adjusts your bill with a prorated charge or credit for the rest of the current period.')),
    sec('Billing problems',
      p('If you were charged in error — for example charged twice, or charged after you cancelled — contact us at ', contact(),
        ' with the email on your account and we will look into it and correct genuine billing errors.')),
    sec('Your legal rights',
      p('Nothing in this policy limits any rights you have under consumer-protection law where you live.')),
  ];
}

// ------------------------------------------------------------------ page

function devNotice(missing) {
  return h('div', { class: 'callout callout--warn legal__dev-notice', role: 'note' },
    icon('info', { size: 18 }),
    h('div', null,
      h('p', null, h('strong', null, 'Owner setup (visible on localhost only): '),
        `LEGAL.${missing.join(' and LEGAL.')} ${missing.length > 1 ? 'are' : 'is'} not set in js/config.js. `
        + 'Neutral fallback wording is shown until then.'),
      h('p', { class: 'muted' }, 'This legal text is a template — have it reviewed by a qualified lawyer before launch.')));
}

export default {
  id: 'legal',
  mount(root, ctx) {
    const page = ctx?.route?.page;
    const doc = DOCS[page] || DOCS.privacy;
    const missing = missingValues();
    if (missing.length) {
      console.warn(`[legal] LEGAL.${missing.join(', LEGAL.')} not set in js/config.js — legal pages use fallback wording.`);
    }
    const date = effectiveDate();
    const others = Object.entries(DOCS).filter(([k]) => k !== page);

    root.append(h('div', { class: 'container container--read legal' },
      h('header', { class: 'page-head legal__head' },
        h('p', { class: 'eyebrow' }, doc.eyebrow),
        h('h1', null, doc.title),
        date ? h('p', { class: 'muted legal__date' }, `Effective ${date}`) : null),
      missing.length && isLocalHost() ? devNotice(missing) : null,
      h('article', { class: 'prose legal__body' }, doc.build()),
      h('nav', { class: 'legal__more', 'aria-label': 'Other policies' },
        others.map(([k, d]) => h('a', { href: `/${k}` }, d.title)))));
  },
};
