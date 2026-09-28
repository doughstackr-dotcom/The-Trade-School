// #signin · #signup · #reset · #reset.update — accessible account forms (labels, autocomplete,
// show/hide password, inline errors with role=alert, pending states, "check your email" screens,
// magic link). Also exports the form helpers the account page reuses.
// Everything a person typed (name, email) is rendered as text, never as HTML.
import { h, icon, uid, modal, toast } from '../core/ui.js';
import { auth, MESSAGES } from '../core/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'letmein1', '11111111', 'abcdefgh', 'trading1', 'tradeschool']);

// ---------------------------------------------------------------- form helpers

/** A labelled input. → { el, input, setError(text|null), value() } */
export function field({ label, type = 'text', name, autocomplete, inputmode, hint = null, required = true, maxlength = null, value = '' }) {
  const id = uid(`f-${name}`);
  const errId = `${id}-err`;
  const hintId = hint ? `${id}-hint` : null;
  const input = h('input', {
    class: 'input', id, name, type, autocomplete, inputmode, required, maxlength,
    'aria-describedby': [hintId, errId].filter(Boolean).join(' '),
    autocapitalize: type === 'email' || type === 'password' ? 'off' : null,
    spellcheck: type === 'email' || type === 'password' ? 'false' : null,
  });
  if (value) input.value = value;
  const err = h('p', { class: 'field__error', id: errId, hidden: true });
  const el = h('div', { class: 'field auth-field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'field__hint faint', id: hintId }, hint) : null,
    err);
  const setError = (text) => {
    err.textContent = text || '';
    err.hidden = !text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', () => setError(null));
  return { el, input, setError, value: () => input.value };
}

/** Password strength 0–4 with a label. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: '' };
  if (s.length < 8) return { score: 0, label: 'Too short' };
  if (COMMON.has(s.toLowerCase())) return { score: 1, label: 'Too common' };
  let score = 1;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  if (/^(.)\1+$/.test(s)) score = 1;
  score = Math.min(4, score);
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

/** Password input with a show/hide toggle and an optional strength meter. */
export function passwordField({ label = 'Password', name = 'password', autocomplete = 'current-password', strength = false, hint = null }) {
  const f = field({ label, type: 'password', name, autocomplete, hint });
  f.input.setAttribute('minlength', strength ? '8' : '1');
  const toggle = h('button', {
    type: 'button', class: 'pw-toggle', 'aria-controls': f.input.id, 'aria-pressed': 'false', 'aria-label': 'Show password',
    on: {
      click: () => {
        const show = f.input.type === 'password';
        f.input.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        toggle.replaceChildren(icon(show ? 'eye' : 'eye', { size: 18 }), h('span', { class: 'pw-toggle__txt' }, show ? 'Hide' : 'Show'));
        toggle.classList.toggle('is-on', show);
      },
    },
  }, icon('eye', { size: 18 }), h('span', { class: 'pw-toggle__txt' }, 'Show'));
  const wrap = h('div', { class: 'pw-wrap' });
  f.input.replaceWith(wrap);
  wrap.append(f.input, toggle);
  if (strength) {
    const bar = h('span', { class: 'pw-meter__fill' });
    const txt = h('span', { class: 'pw-meter__label' });
    const meterEl = h('div', { class: 'pw-meter', 'data-score': '0', 'aria-hidden': 'true' }, h('span', { class: 'pw-meter__track' }, bar), txt);
    const live = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
    wrap.after(meterEl, live);
    let lastLabel = '';
    f.input.addEventListener('input', () => {
      const st = passwordStrength(f.input.value);
      meterEl.dataset.score = String(st.score);
      bar.style.width = `${f.input.value ? Math.max(8, st.score * 25) : 0}%`;
      txt.textContent = st.label;
      if (st.label !== lastLabel) {
        lastLabel = st.label;
        live.textContent = st.label ? `Password strength: ${st.label}` : '';
      }
    });
  }
  return f;
}

/** A form-level error / notice region. → { el, show(text, tone, extra), clear() } */
export function formAlert() {
  const el = h('div', { class: 'form-alert', role: 'alert' });
  return {
    el,
    show(text, tone = 'bad', extra = null) {
      el.replaceChildren(h('div', { class: `form-alert__box form-alert__box--${tone}` },
        icon(tone === 'good' ? 'check' : 'info', { size: 18 }),
        h('div', { class: 'form-alert__text' }, h('p', null, text), extra)));
    },
    clear() {
      el.replaceChildren();
    },
  };
}

/** Wires a <form>: preventDefault, pending state on the submit button, errors → alert. */
export function wireForm(form, submitBtn, alert, handler, { pendingLabel = 'Working…' } = {}) {
  const idle = [...submitBtn.childNodes];
  let busy = false;
  form.setAttribute('novalidate', '');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    alert.clear();
    busy = true;
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), pendingLabel);
    form.setAttribute('aria-busy', 'true');
    try {
      await handler();
    } catch (err) {
      alert.show(err?.message || MESSAGES.failed, 'bad', err?.extra || null);
    } finally {
      busy = false;
      if (submitBtn.isConnected) {
        submitBtn.disabled = form.dataset.locked === '1';
        submitBtn.removeAttribute('aria-busy');
        submitBtn.replaceChildren(...idle);
      }
      form.removeAttribute('aria-busy');
    }
  });
}

class FieldError extends Error {}

function validateEmail(f) {
  const v = f.value().trim();
  if (!v) {
    f.setError('Enter your email address.');
    throw new FieldError('Check the highlighted field.');
  }
  if (!EMAIL_RE.test(v)) {
    f.setError('That does not look like an email address.');
    throw new FieldError('Check the highlighted field.');
  }
  return v;
}

function focusFirst(root) {
  let fine = true;
  try {
    fine = matchMedia('(pointer: fine)').matches;
  } catch {
    fine = true;
  }
  if (!fine) return;
  requestAnimationFrame(() => root.querySelector('input:not([type="checkbox"])')?.focus({ preventScroll: true }));
}

function offlineNote() {
  return h('div', { class: 'callout callout--warn auth-offline', role: 'status' },
    icon('info', { size: 18 }),
    h('p', null, h('strong', null, 'Accounts are unavailable right now. '), 'The free lessons, games and glossary still work. Please try again in a little while.'));
}

function flashNote(f) {
  if (!f) return null;
  return h('div', { class: `form-alert__box form-alert__box--${f.tone === 'good' ? 'good' : f.tone === 'info' ? 'info' : 'bad'} auth-flash`, role: 'status' },
    icon(f.tone === 'good' ? 'check' : 'info', { size: 18 }), h('p', { class: 'form-alert__text' }, f.text));
}

/** Mock mode only: the latest test email for an address, with its link. */
function mockInbox(email, type) {
  const box = h('div', { class: 'mock-inbox', hidden: true });
  const render = () => {
    const mails = auth.mock?.inbox(email) || [];
    const m = mails.find((x) => !type || x.type === type) || mails[0];
    box.hidden = !m;
    if (!m) return;
    box.replaceChildren(
      h('p', { class: 'mock-inbox__title' }, icon('info', { size: 14 }), 'Test inbox (mock mode)'),
      h('p', { class: 'faint t-14' }, `To: ${m.to} · ${m.type === 'signup' ? 'Confirm your email' : m.type === 'recovery' ? 'Reset your password' : 'Your sign-in link'}`),
      h('a', { class: 'btn btn--sm', href: m.link, 'data-no-route': '', 'data-action': 'open-test-link' }, 'Open the link in this email'));
  };
  render();
  return box;
}

function checkEmail({ title, text, email, type, extra = null }) {
  return h('div', { class: 'auth-done', 'data-state': 'check-email' },
    h('div', { class: 'auth-done__icon', 'aria-hidden': 'true' }, icon('check', { size: 28 })),
    h('h2', { class: 'auth-done__title', tabindex: '-1' }, title),
    h('p', { class: 'muted' }, text),
    email ? h('p', { class: 'auth-done__email mono' }, email) : null,
    extra,
    auth.isMock ? mockInbox(email, type) : null);
}

/** The Terms / Privacy text in a dialog (so a half-filled sign-up form is not lost). */
async function showLegal(kind) {
  try {
    const mod = await import('./legal.js');
    modal({ title: kind === 'privacy' ? 'Privacy policy (draft)' : 'Terms of service (draft)', size: 'wide', body: mod.legalDoc(kind, { compact: true }), actions: [{ label: 'Close', primary: true }] });
  } catch (err) {
    console.error(err);
  }
}

function shell(title, sub, ...kids) {
  return h('div', { class: 'auth container' },
    h('div', { class: 'auth__card card card--raised' },
      h('header', { class: 'auth__head' },
        h('a', { class: 'auth__brand', href: '#home', 'aria-label': 'The Trade School home' }, icon('candle', { size: 22 })),
        h('h1', { class: 'auth__title' }, title),
        sub ? h('p', { class: 'muted auth__sub' }, sub) : null),
      ...kids));
}

function afterSignIn(ctx) {
  const to = auth.takeReturnTo();
  ctx.navigate(to || 'account');
}

function signedInCard(ctx) {
  return h('div', { class: 'auth-done' },
    h('p', null, 'You are signed in as ', h('strong', null, auth.displayName), '.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => afterSignIn(ctx) } }, 'Continue', icon('arrow-right', { size: 16 })),
      h('a', { class: 'btn', href: '#account' }, 'Your account')));
}

// ---------------------------------------------------------------- pages

function signInPage(root, ctx) {
  const flash = auth.consumeFlash();
  let magic = false;
  const alert = formAlert();
  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const pw = passwordField({ label: 'Password', autocomplete: 'current-password' });
  const forgot = h('a', { class: 'auth__forgot', href: '#reset' }, 'Forgot password?');
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block btn--lg', 'data-action': 'submit' }, 'Sign in');
  const modeBtn = h('button', { type: 'button', class: 'link-btn auth__switch', 'data-action': 'magic-toggle' });
  const form = h('form', { class: 'auth__form stack', 'aria-label': 'Sign in' }, alert.el, email.el, pw.el, forgot, submit);
  const body = h('div', { class: 'auth__body' }, flashNote(flash), form, h('div', { class: 'auth__alt' }, modeBtn));

  const setMode = (m) => {
    magic = m;
    pw.el.hidden = m;
    forgot.hidden = m;
    pw.input.required = !m;
    submit.replaceChildren(m ? 'Email me a sign-in link' : 'Sign in');
    modeBtn.replaceChildren(icon(m ? 'shield' : 'spark', { size: 15 }), m ? 'Use my password instead' : 'Email me a sign-in link instead');
    alert.clear();
  };
  modeBtn.addEventListener('click', () => setMode(!magic));
  setMode(false);

  wireForm(form, submit, alert, async () => {
    let addr;
    try {
      addr = validateEmail(email);
      if (!magic && !pw.value()) {
        pw.setError('Enter your password.');
        throw new FieldError('Check the highlighted field.');
      }
    } catch (err) {
      if (err instanceof FieldError) throw err;
      throw err;
    }
    if (magic) {
      await auth.signInWithMagicLink(addr);
      body.replaceChildren(checkEmail({
        title: 'Check your email',
        text: 'We sent a sign-in link to the address below. Open it on this device to sign in; it works once and expires soon.',
        email: addr,
        type: 'magiclink',
        extra: h('button', { type: 'button', class: 'link-btn', on: { click: () => signInPage(clear(root), ctx) } }, icon('arrow-left', { size: 14 }), 'Back to sign in'),
      }));
      body.querySelector('.auth-done__title')?.focus();
      return;
    }
    try {
      await auth.signIn({ email: addr, password: pw.value() });
    } catch (err) {
      if (err?.code === 'email_not_confirmed') {
        err.extra = h('button', { type: 'button', class: 'btn btn--sm', on: { click: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await auth.resendConfirmation(addr);
            alert.show('We sent a new confirmation link. Check your inbox (and the spam folder).', 'good', auth.isMock ? mockInbox(addr, 'signup') : null);
          } catch (e2) {
            alert.show(e2.message);
          }
        } } }, 'Resend confirmation email');
      }
      throw err;
    }
    toast(`Welcome back, ${auth.displayName}!`, { type: 'good' });
    afterSignIn(ctx);
  }, { pendingLabel: 'Signing in…' });

  const page = shell('Welcome back', 'Sign in to pick up where you left off on any device.',
    body,
    h('p', { class: 'auth__foot' }, 'New here? ', h('a', { href: '#signup' }, 'Create a free account')));
  root.append(page);
  return { form, submit, page };
}

function clear(el) {
  el.replaceChildren();
  return el;
}

function signUpPage(root, ctx) {
  const alert = formAlert();
  const name = field({ label: 'Display name', name: 'display_name', autocomplete: 'nickname', maxlength: 60, hint: 'Shown on your account. You can change it later.' });
  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const pw = passwordField({ label: 'Password', autocomplete: 'new-password', strength: true, name: 'new-password', hint: 'At least 8 characters. Longer is stronger; mix in numbers or symbols.' });
  const agreeId = uid('agree');
  const agreeErr = h('p', { class: 'field__error', id: `${agreeId}-err`, hidden: true });
  const agree = h('input', { type: 'checkbox', id: agreeId, name: 'agree', required: true, 'aria-describedby': `${agreeId}-err` });
  const legalLink = (kind, text) => h('a', { href: `#${kind}`, 'data-no-route': '', on: { click: (e) => {
    e.preventDefault();
    showLegal(kind);
  } } }, text);
  const agreeRow = h('div', { class: 'auth-check' },
    agree,
    h('label', { for: agreeId }, 'I agree to the ', legalLink('terms', 'Terms of service'), ' and the ', legalLink('privacy', 'Privacy policy'), '.'),
    agreeErr);
  agree.addEventListener('change', () => {
    agreeErr.hidden = true;
    agree.removeAttribute('aria-invalid');
  });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block btn--lg', 'data-action': 'submit' }, 'Create free account');
  const form = h('form', { class: 'auth__form stack', 'aria-label': 'Create your free account' }, alert.el, name.el, email.el, pw.el, agreeRow, submit);
  const body = h('div', { class: 'auth__body' }, form);

  wireForm(form, submit, alert, async () => {
    const errors = [];
    const display = name.value().trim();
    if (!display) {
      name.setError('Choose a display name.');
      errors.push(name);
    }
    let addr = null;
    try {
      addr = validateEmail(email);
    } catch {
      errors.push(email);
    }
    const pass = pw.value();
    if (pass.length < 8) {
      pw.setError('Use at least 8 characters.');
      errors.push(pw);
    }
    if (!agree.checked) {
      agreeErr.textContent = 'Please agree to the Terms and Privacy policy to create an account.';
      agreeErr.hidden = false;
      agree.setAttribute('aria-invalid', 'true');
      errors.push({ input: agree });
    }
    if (errors.length) {
      errors[0].input.focus();
      throw new FieldError(errors.length > 1 ? 'Check the highlighted fields.' : 'Check the highlighted field.');
    }
    const res = await auth.signUp({ email: addr, password: pass, displayName: display });
    if (!res.needsConfirmation) {
      toast('Your account is ready. Welcome!', { type: 'good' });
      afterSignIn(ctx);
      return;
    }
    let cool = 0;
    const resend = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'resend' }, 'Resend email');
    const note = h('p', { class: 'faint t-14', role: 'status' });
    resend.addEventListener('click', async () => {
      if (cool) return;
      resend.disabled = true;
      try {
        await auth.resendConfirmation(addr);
        note.textContent = 'Sent again. It can take a minute to arrive; check the spam folder too.';
      } catch (err) {
        note.textContent = err.message;
      }
      cool = 30;
      const t = setInterval(() => {
        cool -= 1;
        resend.textContent = cool > 0 ? `Resend email (${cool}s)` : 'Resend email';
        if (cool <= 0) {
          clearInterval(t);
          resend.disabled = false;
        }
      }, 1000);
    });
    body.replaceChildren(checkEmail({
      title: 'Check your email',
      text: 'We sent a confirmation link to the address below. Open it to finish creating your account; you will come straight back here, signed in.',
      email: addr,
      type: 'signup',
      extra: h('div', { class: 'stack stack--sm' },
        h('div', { class: 'row row--sm' }, resend,
          h('button', { type: 'button', class: 'btn btn--sm btn--ghost', on: { click: () => signUpPage(clear(root), ctx) } }, 'Use a different email')),
        note),
    }));
    body.querySelector('.auth-done__title')?.focus();
  }, { pendingLabel: 'Creating your account…' });

  root.append(shell('Create your free account', 'Free forever: unit 1, the Daily Challenge, the Pattern Library, the Setup Playbook and progress sync. No card needed.',
    body,
    h('p', { class: 'auth__foot' }, 'Already have an account? ', h('a', { href: '#signin' }, 'Sign in'))));
  return { form, submit };
}

function resetPage(root) {
  const alert = formAlert();
  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block btn--lg', 'data-action': 'submit' }, 'Email me a reset link');
  const form = h('form', { class: 'auth__form stack', 'aria-label': 'Reset your password' }, alert.el, email.el, submit);
  const body = h('div', { class: 'auth__body' }, flashNote(auth.consumeFlash()), form);
  wireForm(form, submit, alert, async () => {
    const addr = validateEmail(email);
    await auth.sendPasswordReset(addr);
    body.replaceChildren(checkEmail({
      title: 'Check your email',
      text: 'If an account uses the address below, we sent it a link to choose a new password. Open it on this device; it works once and expires soon.',
      email: addr,
      type: 'recovery',
    }));
    body.querySelector('.auth-done__title')?.focus();
  }, { pendingLabel: 'Sending…' });
  root.append(shell('Reset your password', 'Enter the email you signed up with and we will send you a link.',
    body,
    h('p', { class: 'auth__foot' }, 'Remembered it? ', h('a', { href: '#signin' }, 'Sign in'))));
  return { form, submit };
}

async function resetUpdatePage(root, ctx) {
  const flash = auth.consumeFlash();
  const loading = h('p', { class: 'muted', role: 'status' }, 'Checking your reset link…');
  root.append(loading);
  await auth.ready;
  loading.remove();
  if (!auth.user) {
    root.append(shell('Choose a new password', null,
      h('div', { class: 'auth__body' },
        flashNote(flash),
        h('p', { class: 'muted' }, 'This page opens from the link in your password-reset email. Links work once, expire after a while, and only in the browser where you asked for them.'),
        h('a', { class: 'btn btn--primary btn--block', href: '#reset' }, 'Send me a new link'))));
    return null;
  }
  const alert = formAlert();
  const pw = passwordField({ label: 'New password', name: 'new-password', autocomplete: 'new-password', strength: true, hint: 'At least 8 characters.' });
  const pw2 = passwordField({ label: 'Confirm new password', name: 'confirm-password', autocomplete: 'new-password' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block btn--lg', 'data-action': 'submit' }, 'Save new password');
  const form = h('form', { class: 'auth__form stack', 'aria-label': 'Choose a new password' }, alert.el, pw.el, pw2.el, submit);
  wireForm(form, submit, alert, async () => {
    if (pw.value().length < 8) {
      pw.setError('Use at least 8 characters.');
      pw.input.focus();
      throw new FieldError('Check the highlighted field.');
    }
    if (pw.value() !== pw2.value()) {
      pw2.setError('The two passwords do not match.');
      pw2.input.focus();
      throw new FieldError('Check the highlighted field.');
    }
    await auth.updatePassword(pw.value());
    toast('Password updated. You are signed in.', { type: 'good' });
    ctx.navigate(auth.takeReturnTo() || 'account');
  }, { pendingLabel: 'Saving…' });
  root.append(shell('Choose a new password', null,
    h('div', { class: 'auth__body' },
      flashNote(flash),
      h('p', { class: 'muted' }, 'Signed in as ', h('strong', null, auth.user.email), '.'),
      form)));
  focusFirst(root);
  return { form, submit };
}

export default {
  id: 'auth',
  async mount(root, ctx) {
    const which = ctx.param || ctx.route?.param || 'signin';
    const holder = h('div', { class: 'auth-page', 'data-auth': which });
    root.append(holder);
    // Load the account backend (Supabase or mock) while the form renders.
    const prep = auth.prepare();

    if (which === 'reset.update') {
      await resetUpdatePage(holder, ctx);
    } else {
      await auth.ready;
      if (auth.user && which !== 'reset') {
        holder.append(shell(which === 'signup' ? 'You already have an account' : 'You are signed in', null, signedInCard(ctx)));
      } else if (which === 'signup') {
        signUpPage(holder, ctx);
      } else if (which === 'reset') {
        resetPage(holder);
      } else {
        signInPage(holder, ctx);
      }
      focusFirst(holder);
    }

    const markOffline = () => {
      if (auth.mode !== 'offline' || holder.querySelector('.auth-offline')) return;
      const body = holder.querySelector('.auth__body');
      if (!body) return;
      body.prepend(offlineNote());
      holder.querySelectorAll('form').forEach((f) => {
        f.dataset.locked = '1';
        f.querySelectorAll('input, button').forEach((el) => {
          el.disabled = true;
        });
      });
    };
    prep.then(markOffline);
    markOffline();
    const off = auth.on('change', ({ reason } = {}) => {
      if (reason === 'mode') markOffline();
    });
    return () => off();
  },
};
