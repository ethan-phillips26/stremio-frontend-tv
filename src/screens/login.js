import { h } from '../ui.js';
import { Grid } from '../focus.js';
import * as core from '../core.js';
import * as text from '../text.js';

export class Login {
  constructor(a, { onDone }) {
    this.name = 'login'; this.a = a; this.onDone = onDone; this.email = ''; this.pass = ''; this.busy = false;
    this.fEmail = text.fieldItem('Email', { get: () => this.email, set: (v) => (this.email = v), onSubmit: () => this.grid.set(1, 0) }, { placeholder: 'you@example.com' });
    this.fPass = text.fieldItem('Password', { get: () => this.pass, set: (v) => (this.pass = v), secret: true, onSubmit: () => this.submit() }, { placeholder: 'Password' });
    this.msg = h('div', { class: 'login-msg' });
    this.signIn = { el: h('div', { class: 'dbtn primary' }, h('span', {}, 'Sign In')), onSelect: () => this.submit() };
    this.skip = { el: h('div', { class: 'dbtn' }, h('span', {}, 'Not Now')), onSelect: () => { try { localStorage.setItem('skipLogin', '1'); } catch (_) {} this.done(); } };
    this.kb = text.keyboardRows({ compact: true });
    this.el = h('div', { class: 'login' }, h('div', { class: 'login-panel' },
      h('h1', {}, 'Sign in to Stremio'),
      h('p', { class: 'login-sub' }, 'Your library, progress and addons come with you. Type with the keys below, or on your phone.'),
      h('div', { class: 'login-fields' }, this.fEmail.el, this.fPass.el), this.kb.el, this.msg,
      h('div', { class: 'd-actions' }, this.signIn.el, this.skip.el)));
    this.grid = new Grid([[this.fEmail], [this.fPass], ...this.kb.rows, [this.signIn, this.skip]], { aim: (dir, nr, from) => (from && from.el.classList.contains('field') ? 0 : undefined) });
  }
  onShow() { this.a.wall('#4b3a8a', '#0d0f24'); this.grid.set(0, 0); }
  async submit() {
    if (this.busy) return;
    if (!this.email.trim() || !this.pass) { this.msg.textContent = 'Enter your email and password.'; this.msg.className = 'login-msg err'; return; }
    this.busy = true; this.msg.className = 'login-msg'; this.msg.textContent = 'Signing in…';
    const email = this.email.trim(), pass = this.pass;
    this.pass = ''; this.fPass.render();          // never keep the password around longer than the request
    const r = await core.login(email, pass);
    this.busy = false;
    if (r.ok) { try { localStorage.removeItem('skipLogin'); } catch (_) {} this.done(); }
    else { this.msg.className = 'login-msg err'; this.msg.textContent = r.error === 'User not found' ? 'No Stremio account with that email.' : /pass/i.test(r.error) ? 'That password is not right.' : r.error; this.grid.set(1, 0); }
  }
  done() { text.setTarget(null); this.onDone && this.onDone(); }
  destroy() { text.setTarget(null); }
}
