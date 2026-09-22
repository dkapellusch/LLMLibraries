'use strict';

// --- tiny utilities -----------------------------------------------------------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  me: null,
  locations: [],
  browse: { q: '', location: '', order: 'recent', total: 0, books: [], more: true },
};

let viewGen = 0;

// --- api ---------------------------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (!opts.quiet401) {
      toast('Sign in to continue.', 'err');
      location.hash = '#/login';
    }
    throw new Error('Not signed in');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const d = await res.json();
      if (d && d.error) message = d.error;
    } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toast(message, kind) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' toast-err' : '');
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3700);
}

// --- presentation helpers ------------------------------------------------------

function hashHue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function monogram(title) {
  const words = String(title)
    .replace(/^(the|a|an|de|la|le|les|el|von|van)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0] || 'B')[0]).toUpperCase();
}

function coverHTML(book, cls = 'cover') {
  const hue = hashHue(book.title + '|' + book.author);
  const img = book.cover
    ? `<img src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  return `<div class="${cls}" style="--h:${hue}"><span class="cover-mono">${esc(monogram(book.title))}</span>${img}</div>`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysLeft(iso) {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
}

function skeleton(n) {
  let out = '';
  for (let i = 0; i < n; i++)
    out += '<div class="skel-card"><div class="sk sk-cover"></div><div class="sk skel-line"></div><div class="sk skel-line" style="width:60%"></div></div>';
  return out;
}

function notFoundHTML(sub) {
  return `
  <div class="empty">
    <div class="empty-title">Page not found</div>
    <p class="empty-sub">${esc(sub || 'This shelf is empty.')}</p>
    <a class="btn btn-ghost" href="#/">Back to the catalog</a>
  </div>`;
}

// --- chrome ---------------------------------------------------------------------

function renderUser() {
  const box = $('#site-user');
  if (!state.me) {
    box.innerHTML = '<a class="btn btn-ghost btn-sm" href="#/login">Sign in</a>';
    return;
  }
  const initial = (state.me.name.trim()[0] || 'M').toUpperCase();
  box.innerHTML = `
  <span class="chip" title="${esc(state.me.email)}">
    <span class="chip-avatar">${esc(initial)}</span>
    ${esc(state.me.name)}
  </span>
  <button class="btn btn-ghost btn-sm" data-action="logout">Sign out</button>`;
}

// --- login -------------------------------------------------------------------------

function viewLogin() {
  const view = $('#view');
  view.innerHTML = `
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-brand">
        <div class="login-name">Aldbury</div>
        <div class="login-sub">Private Library</div>
      </div>
      <div class="form-error" id="login-error" hidden></div>
      <form id="login-form" novalidate>
        <label class="field" id="name-field" hidden>
          <span>Full name</span>
          <input name="name" autocomplete="name" maxlength="80">
        </label>
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" minlength="8" required>
        </label>
        <button class="btn btn-primary btn-block" type="submit" id="login-submit">Sign in</button>
      </form>
      <button class="link login-alt" type="button" id="login-toggle">New member? Apply for admission</button>
    </div>
  </div>`;

  let register = false;
  const form = $('#login-form');
  const err = $('#login-error');
  const nameField = $('#name-field');
  const submit = $('#login-submit');
  const toggle = $('#login-toggle');

  toggle.addEventListener('click', () => {
    register = !register;
    nameField.hidden = !register;
    form.password.autocomplete = register ? 'new-password' : 'current-password';
    submit.textContent = register ? 'Apply for admission' : 'Sign in';
    toggle.textContent = register ? 'Already a member? Sign in' : 'New member? Apply for admission';
    err.hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email.includes('@')) return (err.textContent = 'Enter a valid email address.'), (err.hidden = false);
    if (password.length < 8) return (err.textContent = 'Passwords are at least 8 characters.'), (err.hidden = false);
    if (register && form.name.value.trim().length < 2) return (err.textContent = 'Enter your full name.'), (err.hidden = false);
    submit.disabled = true;
    try {
      const body = { email, password };
      if (register) body.name = form.name.value.trim();
      await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      state.me = await api('/api/me');
      renderUser();
      toast(register ? 'Welcome to Aldbury.' : `Welcome back, ${state.me.name.split(' ')[0]}.`);
      if (location.hash === '#/') route();
      else location.hash = '#/';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  form.email.focus();
}

// --- browse -------------------------------------------------------------------------

function browseParams(reset) {
  const b = state.browse;
  const p = new URLSearchParams({ limit: '24' });
  if (b.q) p.set('q', b.q);
  if (b.location) p.set('location', b.location);
  if (b.order !== 'recent') p.set('order', b.order);
  if (!reset && b.books.length) p.set('offset', String(b.books.length));
  return p;
}

function viewBrowse() {
  const b = state.browse;
  const view = $('#view');
  view.innerHTML = `
  <div class="browse-head">
    <h1 class="page-title">The Catalog</h1>
    <p class="page-sub" id="browse-count">Counting the shelves…</p>
  </div>
  <div class="toolbar">
    <div class="searchbar">
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <circle cx="7.5" cy="7.5" r="5.75" stroke="currentColor" stroke-width="1.5"/>
        <path d="M12 12l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input id="q" type="search" placeholder="Search title, author, or description" autocomplete="off" spellcheck="false" value="${esc(b.q)}">
      <kbd class="search-kbd" aria-hidden="true">/</kbd>
    </div>
    <div class="toolbar-side">
      <div class="segmented" id="loc-seg" role="tablist" aria-label="Room"></div>
      <select id="order" class="select" aria-label="Sort order">
        <option value="recent"${b.order === 'recent' ? ' selected' : ''}>Recently added</option>
        <option value="title"${b.order === 'title' ? ' selected' : ''}>Title A–Z</option>
        <option value="author"${b.order === 'author' ? ' selected' : ''}>Author A–Z</option>
        <option value="year"${b.order === 'year' ? ' selected' : ''}>Earliest first</option>
      </select>
    </div>
  </div>
  <div class="grid" id="grid" aria-busy="true"></div>
  <div id="browse-empty" class="empty" hidden>
    <div class="empty-title">Nothing on these shelves</div>
    <p class="empty-sub">Try a broader search, or look in another room.</p>
    <button class="btn btn-ghost" data-action="clear-browse">Clear filters</button>
  </div>
  <div class="more-row"><button class="btn btn-ghost" id="more" type="button">Load more volumes</button></div>`;

  let deb;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      b.q = e.target.value.trim();
      refreshBrowse();
    }, 300);
  });
  $('#order').addEventListener('change', (e) => {
    b.order = e.target.value;
    refreshBrowse();
  });
  $('#loc-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    b.location = btn.dataset.loc;
    refreshBrowse();
  });
  $('#more').addEventListener('click', () => {
    loadBrowse(false).catch((ex) => toast(ex.message, 'err'));
  });

  renderBrowse();
  if (!b.books.length) refreshBrowse();
}

async function refreshBrowse() {
  const b = state.browse;
  b.books = [];
  b.more = true;
  const grid = $('#grid');
  if (grid) {
    grid.classList.add('is-loading');
    grid.innerHTML = skeleton(6);
  }
  try {
    await loadBrowse(true);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    const g = $('#grid');
    if (g) g.classList.remove('is-loading');
  }
  renderBrowse();
}

async function loadBrowse(reset) {
  const b = state.browse;
  const data = await api(`/api/books?${browseParams(reset)}`);
  b.total = data.total;
  b.books = (reset ? [] : b.books).concat(data.books);
  b.more = b.books.length < b.total;
  renderBrowse();
}

function renderBrowse() {
  const b = state.browse;
  const seg = $('#loc-seg');
  if (seg) {
    const items = [{ id: '', name: 'All rooms' }, ...state.locations];
    seg.innerHTML = items
      .map(
        (l) =>
          `<button class="seg-btn${b.location === String(l.id) ? ' on' : ''}" data-loc="${l.id}" type="button" role="tab">${esc(l.name)}</button>`
      )
      .join('');
  }
  const count = $('#browse-count');
  if (count) count.textContent = `${b.total.toLocaleString('en-GB')} ${b.total === 1 ? 'volume' : 'volumes'} in the collection`;
  const more = $('#more');
  if (more) more.hidden = !b.more;
  const empty = $('#browse-empty');
  if (empty) empty.hidden = b.books.length > 0;
  const grid = $('#grid');
  if (grid && !grid.classList.contains('is-loading')) grid.innerHTML = b.books.map(cardHTML).join('');
}

function cardHTML(book) {
  const loc = book.location ? `${esc(book.location.name)} · ${esc(book.shelf)}` : esc(book.shelf || '');
  const rating = book.review_count
    ? `<span class="book-card-rating">${'★'.repeat(Math.round(book.rating))} ${book.rating.toFixed(1)} · ${book.review_count}</span>`
    : '<span class="book-card-rating">No reviews</span>';
  return `
  <a class="book-card" href="#/book/${book.id}">
    ${coverHTML(book)}
    <div class="book-card-body">
      <div class="book-card-title">${esc(book.title)}</div>
      <div class="book-card-meta">${esc(book.author)} · ${book.year}</div>
      <div class="book-card-loc">${loc}</div>
      <div class="book-card-foot">
        <span class="avail ${book.available ? 'avail-in' : 'avail-out'}">${book.available ? 'Available' : 'On loan'}</span>
        ${rating}
      </div>
    </div>
  </a>`;
}

// --- book detail -------------------------------------------------------------------

async function openBook(id) {
  const gen = viewGen;
  const view = $('#view');
  view.innerHTML = '<div class="book-loading">Opening the catalog…</div>';
  let book;
  try {
    book = await api(`/api/books/${id}`);
  } catch {
    if (gen === viewGen) view.innerHTML = notFoundHTML('This volume could not be found.');
    return;
  }
  if (gen !== viewGen) return;
  let reviews = { total: 0, rows: [] };
  try {
    reviews = await api(`/api/books/${id}/reviews?limit=100`);
  } catch {}
  if (gen !== viewGen) return;
  view.innerHTML = bookPageHTML(book, reviews);
  wireBook(book, reviews);
}

function bookPageHTML(book, reviews) {
  const me = state.me;
  const mine = book.mine;
  const renewalsLeft = mine ? book.max_renewals - mine.renewals : 0;

  let status = '';
  let actions = '';
  if (mine && mine.status === 'active') {
    const dl = daysLeft(mine.due_at);
    status =
      (dl < 0
        ? `<span class="avail overdue">Overdue — was due ${fmtDate(mine.due_at)}</span>`
        : `<span class="avail avail-mine">On your shelf · due ${fmtDate(mine.due_at)}</span>`) +
      `<span class="side-note">${renewalsLeft} renewal${renewalsLeft === 1 ? '' : 's'} remaining</span>`;
    actions =
      `<button class="btn btn-ghost" data-book-action="renew" type="button"${renewalsLeft === 0 ? ' disabled' : ''}>Renew</button>` +
      '<button class="btn btn-danger" data-book-action="return" type="button">Return to the library</button>';
  } else if (mine && mine.status === 'queued') {
    status =
      '<span class="avail avail-out">On the waiting list</span>' +
      `<span class="side-note">Position ${mine.position} in the queue</span>`;
    actions = '<button class="btn btn-ghost" data-book-action="cancel" type="button">Leave the queue</button>';
  } else if (book.available) {
    status = '<span class="avail avail-in">Available on the shelf</span>';
    actions = me
      ? '<button class="btn btn-primary" data-book-action="reserve" type="button">Reserve this volume</button>'
      : '<a class="btn btn-primary" href="#/login">Sign in to reserve</a>';
  } else {
    status =
      '<span class="avail avail-out">On loan</span>' +
      (book.queue
        ? `<span class="side-note">${book.queue} ${book.queue === 1 ? 'member' : 'members'} ahead in the queue</span>`
        : '');
    actions = me
      ? '<button class="btn btn-ghost" data-book-action="reserve" type="button">Join the queue</button>'
      : '<a class="btn btn-ghost" href="#/login">Sign in to join the queue</a>';
  }

  const specs = [
    ['Author', book.author],
    ['Year', String(book.year)],
    ['Edition', book.edition],
    ['Condition', book.condition],
    ['Room', book.location && book.location.name],
    ['Shelf', book.shelf],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="spec-row"><div class="spec-label">${esc(k)}</div><div class="spec-value">${esc(v)}</div></div>`)
    .join('');

  const own = me ? reviews.rows.find((r) => r.user_id === me.id) : null;
  const list = reviews.rows.length
    ? reviews.rows.map(reviewHTML).join('')
    : '<div class="res-empty">No reviews yet — the first impression is yours to set.</div>';
  const form = me
    ? reviewFormHTML(own)
    : '<p class="side-note" style="margin:0 0 20px"><a class="link" href="#/login">Sign in</a> to leave a review.</p>';

  return `
  <div class="book-page">
    <a class="back-link" href="#/">← Catalog</a>
    <div class="book-layout">
      <div>
        <h1 class="book-title">${esc(book.title)}</h1>
        <p class="book-byline">${esc(book.author)} · ${book.year}</p>
        <p class="book-desc">${esc(book.description)}</p>
        <div class="spec">${specs}</div>
        <h2 class="section-title">Reviews <span class="count">${reviews.total}</span></h2>
        ${form}
        <div class="review-list">${list}</div>
      </div>
      <aside class="book-side">
        <div class="side-card card">${coverHTML(book)}</div>
        <div class="side-card card">
          ${status}
          <div class="side-actions">${actions}</div>
        </div>
      </aside>
    </div>
  </div>`;
}

function reviewHTML(r) {
  const own = state.me && r.user_id === state.me.id;
  return `
  <article class="review">
    <header>
      <span class="review-name">${esc(r.name)}</span>
      ${own ? '<span class="tag">You</span>' : ''}
      <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
      <time>${fmtDate(r.created_at)}</time>
      ${own ? '<button class="link" data-book-action="edit" type="button">Edit</button>' : ''}
    </header>
    <p>${esc(r.body)}</p>
  </article>`;
}

function reviewFormHTML(own) {
  const value = own ? own.rating : 0;
  return `
  <form class="card review-form" id="review-form">
    <div class="star-pick" role="radiogroup" aria-label="Rating">
      ${[1, 2, 3, 4, 5]
        .map((n) => `<button class="star-btn${n <= value ? ' on' : ''}" type="button" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${n <= value ? '★' : '☆'}</button>`)
        .join('')}
    </div>
    <textarea name="body" placeholder="Share your reading…" required minlength="3" maxlength="2000">${own ? esc(own.body) : ''}</textarea>
    <div class="form-row">
      <button class="btn btn-primary" type="submit">${own ? 'Save changes' : 'Post review'}</button>
    </div>
  </form>`;
}

function paintStars(el, value) {
  el.querySelectorAll('.star-btn').forEach((b) => {
    const n = Number(b.dataset.star);
    b.classList.toggle('on', n <= value);
    b.textContent = n <= value ? '★' : '☆';
  });
}

function wireBook(book, reviews) {
  const me = state.me;
  const id = book.id;
  const own = me ? reviews.rows.find((r) => r.user_id === me.id) : null;
  let starValue = own ? own.rating : 0;

  const pick = $('.star-pick');
  if (pick) {
    paintStars(pick, starValue);
    pick.addEventListener('click', (e) => {
      const btn = e.target.closest('.star-btn');
      if (!btn) return;
      starValue = Number(btn.dataset.star);
      paintStars(pick, starValue);
    });
  }

  const form = $('#review-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!starValue) return toast('Choose a star rating first.', 'err');
      const body = form.body.value.trim();
      if (body.length < 3) return toast('A review needs at least a few words.', 'err');
      try {
        if (own) await api(`/api/reviews/${own.id}`, { method: 'PUT', body: { rating: starValue, body } });
        else await api(`/api/books/${id}/reviews`, { method: 'POST', body: { rating: starValue, body } });
        toast(own ? 'Review updated.' : 'Review posted.');
        openBook(id);
      } catch (ex) {
        toast(ex.message, 'err');
      }
    });
  }

  $('.book-page').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-book-action]');
    if (!btn) return;
    const act = btn.dataset.bookAction;
    if (act === 'edit') {
      const ta = $('#review-form textarea');
      if (ta) {
        ta.scrollIntoView({ block: 'center' });
        ta.focus();
      }
      return;
    }
    const mine = book.mine;
    try {
      if (act === 'reserve') {
        const r = await api(`/api/books/${id}/reserve`, { method: 'POST' });
        toast(r.status === 'active' ? `Reserved — due ${fmtDate(r.due_at)}.` : `On the queue — position ${r.position}.`);
      } else if (act === 'renew') {
        const r = await api(`/api/reservations/${mine.id}/renew`, { method: 'POST' });
        toast(`Renewed — due ${fmtDate(r.due_at)}.`);
      } else if (act === 'return') {
        await api(`/api/reservations/${mine.id}/return`, { method: 'POST' });
        toast('Returned to the shelf.');
      } else if (act === 'cancel') {
        await api(`/api/reservations/${mine.id}`, { method: 'DELETE' });
        toast('Queue position released.');
      }
      openBook(id);
    } catch (ex) {
      toast(ex.message, 'err');
    }
  });
}

// --- reservations --------------------------------------------------------------------

function resRow(book, main, actions) {
  return `
  <div class="res-row">
    ${coverHTML(book, 'cover cover-sm')}
    <div>
      <a class="res-title" href="#/book/${book.id}">${esc(book.title)}</a>
      ${main}
    </div>
    <div class="res-actions">${actions}</div>
  </div>`;
}

async function viewReservations() {
  if (!state.me) {
    location.hash = '#/login';
    return;
  }
  const gen = viewGen;
  const view = $('#view');
  view.innerHTML = '<div class="book-loading">Gathering your loans…</div>';
  let active = [];
  let queued = [];
  let returned = [];
  try {
    [active, queued, returned] = await Promise.all([
      api('/api/reservations?status=active'),
      api('/api/reservations?status=queued'),
      api('/api/reservations?status=returned'),
    ]);
  } catch (e) {
    if (gen === viewGen) view.innerHTML = notFoundHTML('Something went wrong gathering your reservations.');
    return;
  }

  const meta = (r) => `<div class="res-meta">${esc(r.book.author)} · ${esc(r.book.location)}${r.book.shelf ? ` · ${esc(r.book.shelf)}` : ''}</div>`;

  const activeRows = active
    .map((r) => {
      const dl = daysLeft(r.due_at);
      const left = r.max_renewals - r.renewals;
      const status =
        dl < 0
          ? `<span class="res-meta overdue">Overdue — was due ${fmtDate(r.due_at)}</span>`
          : `<span class="res-meta">Due ${fmtDate(r.due_at)} · ${left} renewal${left === 1 ? '' : 's'} left</span>`;
      return resRow(
        r.book,
        meta(r) + status,
        `<button class="btn btn-ghost btn-sm" data-res-action="renew" data-res-id="${r.id}"${left === 0 ? ' disabled' : ''}>Renew</button>
         <button class="btn btn-danger btn-sm" data-res-action="return" data-res-id="${r.id}">Return</button>`
      );
    })
    .join('');

  const queuedRows = queued
    .map((r) =>
      resRow(
        r.book,
        meta(r) + `<span class="res-meta">Position ${r.position} · placed ${fmtDate(r.placed_at)}</span>`,
        `<button class="btn btn-ghost btn-sm" data-res-action="cancel" data-res-id="${r.id}">Cancel</button>`
      )
    )
    .join('');

  const returnedRows = returned
    .map((r) => resRow(r.book, meta(r) + `<span class="res-meta">Due date ${fmtDate(r.due_at)}</span>`, ''))
    .join('');

  if (gen !== viewGen) return;
  view.innerHTML = `
  <div class="res-page">
    <div class="browse-head">
      <h1 class="page-title">Your Reservations</h1>
      <p class="page-sub">Loans, queue positions, and history.</p>
    </div>
    <section class="res-section">
      <h2 class="section-title">On loan</h2>
      ${activeRows || '<div class="res-empty">Nothing on loan at the moment.</div>'}
    </section>
    <section class="res-section">
      <h2 class="section-title">Waiting</h2>
      ${queuedRows || '<div class="res-empty">No books on the waiting list.</div>'}
    </section>
    <section class="res-section">
      <h2 class="section-title">Returned <span class="count">${returned.length}</span></h2>
      ${returnedRows || '<div class="res-empty">No returned books yet.</div>'}
    </section>
  </div>`;

  $('.res-page').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-res-action]');
    if (!btn) return;
    const id = Number(btn.dataset.resId);
    try {
      if (btn.dataset.resAction === 'renew') {
        const r = await api(`/api/reservations/${id}/renew`, { method: 'POST' });
        toast(`Renewed — due ${fmtDate(r.due_at)}.`);
      } else if (btn.dataset.resAction === 'return') {
        await api(`/api/reservations/${id}/return`, { method: 'POST' });
        toast('Returned to the shelf.');
      } else if (btn.dataset.resAction === 'cancel') {
        await api(`/api/reservations/${id}`, { method: 'DELETE' });
        toast('Queue position released.');
      }
      viewReservations();
    } catch (ex) {
      toast(ex.message, 'err');
    }
  });
}

// --- routing ------------------------------------------------------------------------------

async function route() {
  viewGen++;
  const path = (location.hash || '#/').replace(/^#/, '') || '/';
  window.scrollTo(0, 0);
  let m;
  if (path === '/login') return state.me ? (location.hash = '#/') : viewLogin();
  if ((m = path.match(/^\/book\/(\d+)$/))) return openBook(Number(m[1]));
  if (path === '/reservations') return state.me ? viewReservations() : (location.hash = '#/login');
  if (path === '/') return viewBrowse();
  $('#view').innerHTML = notFoundHTML();
}

// --- global wiring -------------------------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (act === 'logout') {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    state.me = null;
    renderUser();
    toast('Signed out.');
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  } else if (act === 'clear-browse') {
    state.browse.q = '';
    state.browse.location = '';
    const q = $('#q');
    if (q) q.value = '';
    refreshBrowse();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key !== '/') return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  const q = $('#q');
  if (q) {
    e.preventDefault();
    q.focus();
    q.select();
  }
});

window.addEventListener('hashchange', route);

async function init() {
  const [me, locations] = await Promise.all([
    api('/api/me', { quiet401: true }).catch(() => null),
    api('/api/locations').catch(() => []),
  ]);
  state.me = me;
  state.locations = Array.isArray(locations) ? locations : [];
  renderUser();
  route();
}
init();
