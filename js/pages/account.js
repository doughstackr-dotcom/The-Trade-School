// Account: session status, plan, subscribe / manage billing, sign in & out.
// Default signed-out view is Sign in; Create account swaps in via toggle or
// #account.signup (auth-gate deep-link). Return-after-login via
// access.rememberReturn / consumeReturn.
import { h, icon, toast } from '../core/ui.js';
import { PLANS, FREE_IDS } from '../config.js';
import * as access from '../core/access.js';

const CHECKOUT_PENDING = true;

function levelLabel(level) {
  if (level === 'advanced') return 'Advanced';
  if (level === 'beginner') return 'Beginner';
  if (level === 'free') return 'Free';
  return 'Signed out';
}

function goAfterAuth(ctx) {
  const ret = access.consumeReturn();
  if (ret) {
    ctx.navigate(ret);
    return true;
  }
  return false;
}

function kids(...nodes) {
  return nodes.filter((n) => n != null && n !== false);
}

export default {
  mount(root, ctx) {
    const body = h('div', { class: 'account-body' });
    const formWrap = h('div', { class: 'account-forms', 'aria-live': 'polite' });
    const msg = h('p', { class: 'muted account__msg', role: 'status' }, '');
    const mode = (ctx.param || ctx.route?.param || '').toLowerCase(); // 'signup' | 'signin' | ''
    const preferSignup = mode === 'signup' || mode === 'sign-up';
    const preferReset = mode === 'reset' || mode === 'recovery';
    // Local view so toggle can swap without a full remount; URL stays in sync.
    let view = preferReset ? 'reset' : preferSignup ? 'signup' : 'signin';

    function syncHash() {
      const target = view === 'signup' ? 'account.signup' : view === 'reset' ? 'account.reset' : 'account';
      const want = `#${target}`;
      if (location.hash === want) return;
      try {
        // replaceState avoids hashchange remount while keeping deep-links shareable.
        history.replaceState(null, '', want);
      } catch {
        /* ignore */
      }
    }

    function setView(next) {
      if (next !== 'signin' && next !== 'signup' && next !== 'reset') return;
      view = next;
      syncHash();
      paint();
    }

    function renderSignInForm() {
      return h('form', {
        class: 'card account-card account-card--auth',
        id: 'account-signin',
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            msg.textContent = 'Signing in…';
            const res = await access.signIn({
              email: String(fd.get('email') || '').trim(),
              password: String(fd.get('password') || ''),
            });
            if (!res.ok) {
              msg.textContent = res.error || 'Could not sign in';
              toast(res.error || 'Could not sign in', { type: 'warn' });
              return;
            }
            toast('Signed in', { type: 'info' });
            if (!goAfterAuth(ctx)) paint();
          },
        },
      },
        h('label', { class: 'field' },
          h('span', null, 'Email'),
          h('input', {
            type: 'email', name: 'email', required: true, class: 'input',
            autocomplete: 'email', 'aria-label': 'Email',
          })),
        h('label', { class: 'field' },
          h('span', null, 'Password'),
          h('input', {
            type: 'password', name: 'password', required: true, class: 'input',
            autocomplete: 'current-password', 'aria-label': 'Password', minlength: '6',
          })),
        h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Sign in'),
        h('p', { class: 'account__switch' },
          h('span', { class: 'muted' }, 'New here?'),
          ' ',
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm account__switch-btn',
            on: { click: () => setView('signup') },
          }, 'Create account'),
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm account__switch-btn',
            on: { click: () => setView('reset') },
          }, 'Forgot password?')),
      );
    }

    function renderSignUpForm() {
      return h('form', {
        class: 'card account-card account-card--auth',
        id: 'account-signup',
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const password = String(fd.get('password') || '');
            const confirm = String(fd.get('confirm') || '');
            if (password !== confirm) {
              msg.textContent = 'Passwords do not match';
              toast('Passwords do not match', { type: 'warn' });
              return;
            }
            msg.textContent = 'Creating account…';
            const res = await access.signUp({
              email: String(fd.get('email') || '').trim(),
              password,
              displayName: String(fd.get('displayName') || '').trim() || undefined,
            });
            if (!res.ok) {
              msg.textContent = res.error || 'Could not sign up';
              toast(res.error || 'Could not sign up', { type: 'warn' });
              return;
            }
            if (res.needsConfirmation) {
              toast('Confirm your email to finish sign-up', { type: 'info', duration: 6000 });
              setView('signin');
              msg.textContent = 'Check your email to confirm, then sign in.';
            } else {
              toast('Account created', { type: 'info' });
              if (!goAfterAuth(ctx)) paint();
            }
          },
        },
      },
        h('label', { class: 'field' },
          h('span', null, 'Display name'),
          h('input', {
            type: 'text', name: 'displayName', class: 'input',
            autocomplete: 'nickname', 'aria-label': 'Display name',
            placeholder: 'Optional',
          })),
        h('label', { class: 'field' },
          h('span', null, 'Email'),
          h('input', {
            type: 'email', name: 'email', required: true, class: 'input',
            autocomplete: 'email', 'aria-label': 'Email',
          })),
        h('label', { class: 'field' },
          h('span', null, 'Password'),
          h('input', {
            type: 'password', name: 'password', required: true, class: 'input',
            autocomplete: 'new-password', 'aria-label': 'Password', minlength: '6',
          })),
        h('label', { class: 'field' },
          h('span', null, 'Confirm password'),
          h('input', {
            type: 'password', name: 'confirm', required: true, class: 'input',
            autocomplete: 'new-password', 'aria-label': 'Confirm password', minlength: '6',
          })),
        h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Create account'),
        h('p', { class: 'account__switch' },
          h('span', { class: 'muted' }, 'Already have an account?'),
          ' ',
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm account__switch-btn',
            on: { click: () => setView('signin') },
          }, 'Sign in')),
      );
    }

    function renderResetForm() {
      return h('form', {
        class: 'card account-card account-card--auth',
        id: 'account-reset',
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            msg.textContent = 'Sending recovery email.';
            const res = await access.sendPasswordReset(String(fd.get('email') || '').trim());
            if (!res.ok) {
              msg.textContent = res.error || 'Could not send recovery email';
              toast(res.error || 'Could not send recovery email', { type: 'warn', duration: 5000 });
              return;
            }
            msg.textContent = 'Check your email for the password recovery link.';
            toast('Check your email for the recovery link', { type: 'info', duration: 6000 });
          },
        },
      },
        h('label', { class: 'field' },
          h('span', null, 'Email'),
          h('input', {
            type: 'email', name: 'email', required: true, class: 'input',
            autocomplete: 'email', 'aria-label': 'Email',
          })),
        h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Send recovery link'),
        h('p', { class: 'account__switch' },
          h('span', { class: 'muted' }, 'Have your password?'),
          ' ',
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm account__switch-btn',
            on: { click: () => setView('signin') },
          }, 'Sign in')));
    }

    function renderRecoveryForm() {
      return h('form', {
        class: 'card account-card account-card--auth',
        id: 'account-update-password',
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const password = String(fd.get('password') || '');
            const confirm = String(fd.get('confirm') || '');
            if (password !== confirm) {
              msg.textContent = 'Passwords do not match';
              toast('Passwords do not match', { type: 'warn' });
              return;
            }
            msg.textContent = 'Updating password.';
            const res = await access.updatePassword(password);
            if (!res.ok) {
              msg.textContent = res.error || 'Could not update password';
              toast(res.error || 'Could not update password', { type: 'warn', duration: 5000 });
              return;
            }
            msg.textContent = 'Password updated.';
            toast('Password updated', { type: 'info' });
            paint();
            msg.textContent = 'Password updated.';
          },
        },
      },
        h('label', { class: 'field' },
          h('span', null, 'New password'),
          h('input', {
            type: 'password', name: 'password', required: true, class: 'input',
            autocomplete: 'new-password', 'aria-label': 'New password', minlength: '6',
          })),
        h('label', { class: 'field' },
          h('span', null, 'Confirm new password'),
          h('input', {
            type: 'password', name: 'confirm', required: true, class: 'input',
            autocomplete: 'new-password', 'aria-label': 'Confirm new password', minlength: '6',
          })),
        h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Update password'));
    }

    function renderSignedOut() {
      const pending = access.peekReturn();
      const returnNote = pending
        ? h('p', { class: 'account__return muted' },
          'After you sign in we will take you back to ',
          h('code', { class: 'mono' }, `#${pending}`),
          '.')
        : null;

      formWrap.replaceChildren(...kids(
        returnNote,
        h('div', { class: 'account-auth' },
          view === 'signup' ? renderSignUpForm() : view === 'reset' ? renderResetForm() : renderSignInForm()),
        msg,
      ));

      queueMicrotask(() => {
        const sel = view === 'signup'
          ? '#account-signup input[name="email"]'
          : view === 'reset'
            ? '#account-reset input[name="email"]'
          : '#account-signin input[name="email"]';
        formWrap.querySelector(sel)?.focus?.();
      });
    }

    function renderSignedIn(a) {
      if (a.recovery) {
        formWrap.replaceChildren(
          h('section', { class: 'card account-card' },
            h('p', { class: 'eyebrow' }, 'Password recovery'),
            h('h2', null, 'Choose a new password'),
            h('p', { class: 'muted' }, 'Your recovery link is active in this browser. Set a new password to finish.')),
          h('div', { class: 'account-auth' }, renderRecoveryForm()),
          msg,
        );
        queueMicrotask(() => formWrap.querySelector('#account-update-password input[name="password"]')?.focus?.());
        return;
      }
      const plan = a.level && PLANS[a.level];
      formWrap.replaceChildren(
        h('section', { class: 'card account-card' },
          h('p', { class: 'eyebrow' }, 'Signed in'),
          h('h2', null, a.user?.email || 'Member'),
          h('p', { class: 'account__plan' },
            h('span', { class: 'chip' }, levelLabel(a.level)),
            plan ? h('span', { class: 'muted' }, ` · $${plan.price}/mo`) : h('span', { class: 'muted' }, ' · Daily Challenge free')),
          h('div', { class: 'row' },
            a.level !== 'advanced'
              ? h('button', {
                type: 'button', class: 'btn btn--primary',
                disabled: CHECKOUT_PENDING,
                title: CHECKOUT_PENDING ? 'Checkout setup and live tier testing are pending.' : '',
                on: {
                  click: async () => {
                    if (CHECKOUT_PENDING) {
                      msg.textContent = 'Checkout is intentionally unavailable until Stripe and live tier access are verified.';
                      toast('Checkout testing is pending', { type: 'info', duration: 5000 });
                      return;
                    }
                    const planId = a.level === 'beginner' ? 'advanced' : 'beginner';
                    const res = await access.checkout(planId);
                    if (!res.ok) toast(res.error || 'Subscriptions not open yet', { type: 'warn', duration: 5000 });
                    else if (res.switched) { toast('Plan updated', { type: 'info' }); paint(); }
                  },
                },
              }, CHECKOUT_PENDING ? 'Checkout testing pending' : a.level === 'beginner' ? 'Upgrade to Advanced' : 'Get Beginner')
              : null,
            h('button', {
              type: 'button', class: 'btn btn--ghost',
              'aria-label': 'Manage billing in Stripe portal',
              on: {
                click: async () => {
                  const res = await access.openBillingPortal();
                  if (!res.ok) toast(res.error || 'Subscriptions not open yet', { type: 'warn', duration: 5000 });
                },
              },
            }, icon('compass', { size: 14 }), 'Manage billing'),
            h('button', {
              type: 'button', class: 'btn btn--ghost',
              on: {
                click: async () => {
                  await access.signOut();
                  toast('Signed out', { type: 'info' });
                  paint();
                },
              },
            }, 'Sign out'),
          ),
        ),
        h('section', { class: 'card' },
          h('h3', null, 'Free modules'),
          h('ul', { class: 'lesson-list' },
            FREE_IDS.map((id) => {
              const e = ctx.registry?.findEntry?.(id);
              if (!e) return null;
              return h('li', null, h('a', { href: `#${e.type === 'game' ? 'g' : 'l'}.${e.id}` }, e.title));
            }),
          ),
          h('p', { class: 'row' },
            h('a', { class: 'btn btn--ghost', href: '#dashboard' }, 'Dashboard'),
            h('a', { class: 'btn btn--ghost', href: '#beginner' }, 'Beginner on Dashboard')),
        ),
        msg,
      );
    }

    function paint() {
      const a = access.getAccess();
      // Already signed in with a pending return (e.g. session restored after gate redirect).
      if (a.user && !a.recovery && goAfterAuth(ctx)) return;
      const signupMode = !a.user && view === 'signup';
      const resetMode = !a.user && view === 'reset';
      shell.classList.toggle('account--gate', !a.user);
      body.replaceChildren(...kids(
        a.user ? h('p', { class: 'eyebrow' }, 'Account') : null,
        h('h1', null, a.recovery ? 'Update password' : resetMode ? 'Reset password' : signupMode ? 'Create your account' : a.user ? 'Your account' : 'Sign in'),
        h('p', { class: 'lead' },
          a.recovery
            ? 'Enter a new password to complete account recovery. Educational use only - not financial advice.'
            : resetMode
              ? 'Enter your email and we will send a password recovery link if the account exists.'
              : signupMode
            ? 'Beginner and Advanced lessons need an account first. Checkout stays unavailable until Stripe and live tier access are verified. Educational use only - not financial advice.'
            : a.user
              ? 'Plan status and billing live here. Educational use only - not financial advice.'
              : 'Sign in with email and password to open free account content. Beginner and Advanced lessons stay locked until the right plan is active. Educational use only - not financial advice.')),
      );
      msg.textContent = '';
      if (a.user) renderSignedIn(a);
      else renderSignedOut();
    }

    const shell = h('div', { class: 'container account' }, body, formWrap);
    root.append(shell);
    let unsub = null;
    access.ready.then(() => {
      paint();
      unsub = access.onChange(() => {
        // Prefer return-to over re-painting account when a pending hash exists.
        if (access.getAccess().user && access.peekReturn()) {
          goAfterAuth(ctx);
          return;
        }
        paint();
      });
    });
    return () => { if (unsub) unsub(); };
  },
};

