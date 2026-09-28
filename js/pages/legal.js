// #terms · #privacy — DRAFT legal pages for the owner to review with a qualified professional
// before launch. legalDoc(kind) is also shown in a dialog from the sign-up form.
import { h, icon } from '../core/ui.js';
import { PLANS, CONTACT_EMAIL } from '../config.js';

const UPDATED = '27 September 2026';
const price = (p) => `$${PLANS[p].price.toFixed(2)}`;

function contact() {
  return CONTACT_EMAIL
    ? h('a', { href: `mailto:${CONTACT_EMAIL}`, 'data-no-route': '' }, CONTACT_EMAIL)
    : h('span', { class: 'legal__placeholder' }, '[contact email — to be added]');
}

function section(title, ...paras) {
  return h('section', { class: 'legal__section' },
    h('h2', null, title),
    ...paras.map((p) => (Array.isArray(p) ? h('ul', null, p.map((li) => h('li', null, li))) : typeof p === 'string' ? h('p', null, p) : p)));
}

function draftBanner() {
  return h('div', { class: 'callout callout--warn legal__draft', role: 'note' },
    icon('info', { size: 18 }),
    h('p', null, h('strong', null, 'Draft — review with a qualified professional before launch. '),
      'This text is a starting point written for the site owner. It is not legal advice and has not been reviewed by a lawyer.'));
}

function terms() {
  return [
    section('1. Who we are',
      h('p', null, 'The Trade School ("we", "us") is an educational website that teaches how traders read price charts through lessons, games and simulations. [Legal name, registered address and company number — to be added.] Contact: ', contact(), '.')),
    section('2. Educational content only — not financial advice',
      'Everything on this site is general education. Nothing here is investment, financial, tax or legal advice, or a recommendation to buy or sell any security, currency or crypto-asset. Textbook charts use generated prices; real-market charts show past data, which never predicts future results. Trading involves risk, including the loss of more than you invest in some products. Make your own decisions and consider independent professional advice.'),
    section('3. Your account',
      [
        'You need an account to use the free unit, the Pattern Library, the Setup Playbook and progress sync. Keep your password private; you are responsible for activity on your account.',
        'Give us a real email address. We use it to confirm your account, sign you in by link, reset your password and send receipts and important service notices.',
        'You must be old enough to enter a contract where you live (and at least [minimum age — to be decided]).',
      ]),
    section('4. Subscriptions and billing',
      [
        `Plans: Beginner (${price('beginner')} per month) opens every Beginner lesson and game; Advanced (${price('advanced')} per month) opens everything in Beginner plus every Advanced lesson and game. Prices are in US dollars.`,
        'Payments are processed by Stripe. We never see or store your full card number.',
        'Auto-renewal: a subscription renews automatically every month and is charged to your payment method until you cancel.',
        'Plan changes: switching between Beginner and Advanced takes effect immediately and is prorated for the rest of the billing month.',
        'Failed payments: if a renewal fails, Stripe retries it; access may pause if the payment still fails. [Grace period — to be confirmed.]',
        'Price changes: we will tell you before a price change applies to your subscription. [Notice period — to be confirmed.]',
      ]),
    section('5. Cancellation',
      'You can cancel at any time from Account → Manage billing. Cancelling stops future renewals; you keep access until the end of the period you have already paid for.'),
    section('6. Refunds',
      h('p', { class: 'legal__placeholder-block' }, '[Refund policy — to be written by the owner. State whether partial months are refunded, how to ask for a refund, and any statutory cooling-off rights that apply to your customers (for example in the EU and UK). Stripe requires a visible refund and cancellation policy.]')),
    section('7. Acceptable use',
      'Do not copy, resell, scrape or redistribute the lessons, games or charts; do not share your account; do not try to get around the paywall or attack the service.'),
    section('8. Availability and changes',
      'We work to keep the site available but cannot promise it will always be uninterrupted or error-free. We may improve, change or retire lessons and games over time. Real-market data comes from third-party providers and may be delayed, incomplete or unavailable.'),
    section('9. Liability',
      h('p', { class: 'legal__placeholder-block' }, '[Limitation of liability, governing law and disputes — to be written with your lawyer for your jurisdiction.]')),
    section('10. Changes to these terms',
      'We may update these terms. If a change matters, we will tell you by email or on the site before it takes effect.'),
  ];
}

function privacy() {
  return [
    section('Who is responsible',
      h('p', null, 'The Trade School is responsible for the personal data described here. [Legal name and address — to be added.] Questions or requests: ', contact(), '.')),
    section('What we store',
      [
        'Account: your email address and the display name you choose.',
        'Progress: your XP, level, finished lessons, game scores and stars, badges, Daily Challenge streak and where you left off, so it follows you across devices.',
        'Subscription status: which plan you have, whether it is active, when it renews or ends. Payments are processed by Stripe; we store your Stripe customer and subscription IDs, never your card details.',
        'Technical data: our hosting and database providers keep standard server logs (such as IP address and time of request) for security and troubleshooting.',
      ]),
    section('What stays on your device',
      'Settings such as theme and sound, and your progress before you create an account, are kept in your browser\'s local storage. Signing out removes your account\'s progress from the device and keeps the progress you had before you signed in.'),
    section('Why we use it',
      [
        'To provide your account, sign you in and keep your progress in sync (to perform our contract with you).',
        'To take payments and manage your subscription through Stripe (contract).',
        'To keep the service secure and working (legitimate interests).',
        'To send essential service emails (confirmation, sign-in links, password resets, receipts). We do not send marketing email without your consent.',
      ]),
    section('Who processes it for us',
      [
        'Supabase — account sign-in, database and file storage (region: United States).',
        'Stripe — payments and the billing portal.',
        '[Email provider used for account emails — to be added.]',
        '[Website host — to be added.]',
        'Google Fonts — the site loads its typefaces from Google, which receives your IP address when the fonts load.',
      ]),
    section('How long we keep it',
      h('p', { class: 'legal__placeholder-block' }, '[Retention periods — to be decided. For example: account and progress until you delete your account; billing records as long as tax law requires.]')),
    section('Your rights',
      h('p', null, 'Depending on where you live, you can ask to access, correct, export or delete your data, and object to or restrict some uses. Email ', contact(), '. You can also complain to your local data-protection authority.')),
    section('Cookies and similar storage',
      'We do not use advertising or tracking cookies. The site uses your browser\'s local storage for your session, settings and progress, which is necessary for it to work.'),
    section('Children',
      'The Trade School is not directed at children. [Minimum age — to be decided with your lawyer.]'),
    section('Changes',
      'We will update this page when our practices change and tell you about important changes.'),
  ];
}

/** The document body for 'terms' | 'privacy'. opts.compact: no page chrome (for dialogs). */
export function legalDoc(kind, { compact = false } = {}) {
  const isPrivacy = kind === 'privacy';
  return h('article', { class: ['legal__doc', compact && 'legal__doc--compact', 'prose'] },
    draftBanner(),
    h('p', { class: 'faint t-14' }, `Last updated: ${UPDATED} (draft)`),
    ...(isPrivacy ? privacy() : terms()));
}

export default {
  id: 'legal',
  mount(root, ctx) {
    const kind = ctx.param === 'privacy' || ctx.route?.param === 'privacy' ? 'privacy' : 'terms';
    root.append(h('div', { class: 'legal container container--read' },
      h('p', { class: 'eyebrow' }, 'Legal'),
      h('h1', { class: 'legal__title' }, kind === 'privacy' ? 'Privacy policy' : 'Terms of service'),
      h('nav', { class: 'legal__switch row row--sm', 'aria-label': 'Legal pages' },
        h('a', { class: ['chip', kind === 'terms' && 'chip--accent'], href: '#terms', 'aria-current': kind === 'terms' ? 'page' : null }, 'Terms'),
        h('a', { class: ['chip', kind === 'privacy' && 'chip--accent'], href: '#privacy', 'aria-current': kind === 'privacy' ? 'page' : null }, 'Privacy')),
      legalDoc(kind)));
  },
};
