const app = document.querySelector('#app');
const dialogRoot = document.querySelector('#dialog-root');
const memberMenu = document.querySelector('#member-menu');
const toastRoot = document.querySelector('#toast-root');

const state = {
  bootstrap: null,
  q: '',
  location: '',
  subject: '',
  page: 1,
  activeBook: null
};

const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const plural = (n, word) => `${Number(n).toLocaleString()} ${word}${Number(n) === 1 ? '' : 's'}`;
const shortDate = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const initials = (name) => name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  toastRoot.append(item);
  setTimeout(() => item.remove(), 3600);
}

function setActiveNav(view) {
  document.querySelectorAll('[data-nav]').forEach((link) => link.classList.toggle('active', link.dataset.nav === view));
}

function renderMember() {
  const member = state.bootstrap?.member;
  memberMenu.innerHTML = member
    ? `<button class="member-button signed-in" data-action="account"><span class="avatar">${esc(initials(member.name))}</span><span class="member-name">${esc(member.name.split(' ')[0])}</span></button>`
    : '<button class="member-button" data-action="sign-in">Sign in</button>';
}

function bookCard(book) {
  const available = Number(book.available_count) > 0;
  return `<article class="book-card" data-book="${book.id}" tabindex="0" role="button" aria-label="View ${esc(book.title)} by ${esc(book.author)}">
    <div class="cover" style="--accent:${book.accent}">
      <span class="cover-title">${esc(book.title)}</span>
      <span class="cover-author">${esc(book.author)}</span>
    </div>
    <div class="card-info">
      <h3>${esc(book.title)}</h3>
      <p>${esc(book.author)} · ${book.year < 0 ? `${Math.abs(book.year)} BCE` : book.year}</p>
      <span class="availability ${available ? '' : 'wait'}">${available ? `${book.available_count} available` : `Queue ${book.queue_count || 0}`}</span>
      ${book.rating ? `<span class="rating">★ ${book.rating}</span>` : ''}
    </div>
  </article>`;
}

async function renderCatalog() {
  setActiveNav('catalog');
  app.innerHTML = '<div class="page-loading"><span class="loader"></span><p>Reading the shelves…</p></div>';
  const params = new URLSearchParams({ page: state.page });
  if (state.q) params.set('q', state.q);
  if (state.location) params.set('location', state.location);
  if (state.subject) params.set('subject', state.subject);
  const data = await api(`/api/books?${params}`);
  const b = state.bootstrap;
  app.innerHTML = `<section class="page"><div class="page-inner">
    <div class="catalog-head">
      <div>
        <p class="kicker">The private collection</p>
        <h1>Books worth<br>keeping close.</h1>
        <p class="lede">Rare editions, enduring ideas, and singular voices—gathered across four reading houses.</p>
      </div>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <input class="search" id="catalog-search" type="search" value="${esc(state.q)}" placeholder="Search by title, author, or subject" aria-label="Search the catalogue">
        ${state.q ? '<button class="clear-search" data-action="clear-search" aria-label="Clear search">×</button>' : ''}
      </div>
    </div>
    <div class="catalog-bar">
      <p class="result-count">${state.q || state.location || state.subject ? `${plural(data.total, 'result')} found` : `${Number(b.stats.titles).toLocaleString()} titles · ${Number(b.stats.volumes).toLocaleString()} volumes`}</p>
      <div class="filters">
        <select id="location-filter" aria-label="Filter by house">
          <option value="">All houses</option>
          ${b.locations.map((location) => `<option value="${location.id}" ${String(location.id) === String(state.location) ? 'selected' : ''}>${esc(location.name)}</option>`).join('')}
        </select>
        <select id="subject-filter" aria-label="Filter by subject">
          <option value="">All subjects</option>
          ${b.subjects.map((subject) => `<option value="${esc(subject)}" ${subject === state.subject ? 'selected' : ''}>${esc(subject)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${data.books.length ? `<div class="book-grid">${data.books.map(bookCard).join('')}</div>` : `<div class="empty"><h3>No titles found</h3><p>Try a broader title, author, or subject.</p><button class="button secondary" data-action="reset-filters">Clear filters</button></div>`}
    ${data.pages > 1 ? `<div class="pagination"><button data-page="${data.page - 1}" ${data.page === 1 ? 'disabled' : ''} aria-label="Previous page">←</button><span>Page ${data.page} of ${data.pages.toLocaleString()}</span><button data-page="${data.page + 1}" ${data.page === data.pages ? 'disabled' : ''} aria-label="Next page">→</button></div>` : ''}
  </div></section>`;
  document.querySelector('#catalog-search')?.focus({ preventScroll: true });
}

function renderLocations() {
  setActiveNav('locations');
  app.innerHTML = `<section class="page"><div class="page-inner">
    <div class="section-head"><div><p class="kicker">Four houses, one collection</p><h1>A place for<br>every reader.</h1></div><p class="lede">Each house has its own character. Your membership opens every door.</p></div>
    <div class="location-grid">
      ${state.bootstrap.locations.map((location, index) => `<a class="location-card" href="#catalog" data-location-link="${location.id}">
        <span class="location-no">0${index + 1}</span>
        <div><h2>${esc(location.name)}</h2><p>${esc(location.note)}</p></div>
        <div class="location-meta"><span>${esc(location.address)}</span><span>${plural(location.title_count, 'title')} →</span></div>
      </a>`).join('')}
    </div>
  </div></section>`;
}

function emptyAccount() {
  return `<div class="empty"><h3>Your shelf is waiting</h3><p>Browse the collection and request a book to begin.</p><a class="button secondary" href="#catalog">Explore the collection</a></div>`;
}

async function renderAccount() {
  setActiveNav('account');
  if (!state.bootstrap.member) {
    app.innerHTML = `<section class="page"><div class="page-inner"><div class="section-head"><div><p class="kicker">Your library</p><h1>Keep your<br>place.</h1></div><p class="lede">Sign in to see your loans, renew a book, or follow your place in a queue.</p></div>${emptyAccount()}</div></section>`;
    openAuth('login');
    return;
  }
  app.innerHTML = '<div class="page-loading"><span class="loader"></span><p>Finding your place…</p></div>';
  const data = await api('/api/account');
  const member = state.bootstrap.member;
  app.innerHTML = `<section class="page"><div class="page-inner">
    <div class="section-head"><div><p class="kicker">Member since ${new Date(member.joined_at || Date.now()).getFullYear()}</p><h1>${esc(member.name.split(' ')[0])}’s library.</h1></div><button class="text-button" data-action="logout">Sign out</button></div>
    <div class="account-summary"><div class="stat"><strong>${data.loans.length}</strong><span>Books on loan</span></div><div class="stat"><strong>${data.reservations.length}</strong><span>Active requests</span></div><div class="stat"><strong>${data.history.length}</strong><span>Books returned</span></div></div>
    <section class="account-section"><div class="account-section-title"><h2>On loan</h2><span>Three weeks, with one renewal</span></div>
      ${data.loans.length ? data.loans.map(loanRow).join('') : emptyAccount()}
    </section>
    <section class="account-section"><div class="account-section-title"><h2>Requests</h2><span>We’ll move you ahead automatically</span></div>
      ${data.reservations.length ? data.reservations.map(queueRow).join('') : '<div class="empty"><p>You have no active requests.</p></div>'}
    </section>
    ${data.history.length ? `<section class="account-section"><div class="account-section-title"><h2>Recently returned</h2></div>${data.history.map((item) => `<div class="loan-row"><div class="title-cell"><div><strong>${esc(item.title)}</strong><span>${esc(item.author)}</span></div></div><div class="loan-meta">Returned<strong>${shortDate(item.returned_at)}</strong></div><div></div><div></div></div>`).join('')}</section>` : ''}
  </div></section>`;
}

function loanRow(loan) {
  const due = new Date(loan.due_at);
  const urgent = due.getTime() - Date.now() < 4 * 86400000;
  return `<div class="loan-row">
    <div class="title-cell"><span class="mini-cover" style="--accent:${loan.accent}"></span><div><strong>${esc(loan.title)}</strong><span>${esc(loan.author)}</span></div></div>
    <div class="loan-meta">Return to<strong>${esc(loan.location)}</strong></div>
    <div class="loan-meta">${urgent ? 'Due soon' : 'Due'}<strong>${shortDate(loan.due_at)}</strong></div>
    <div class="actions"><button class="button secondary" data-renew="${loan.id}" ${loan.renewals || loan.queue_count ? 'disabled' : ''}>${loan.renewals ? 'Renewed' : loan.queue_count ? 'Requested' : 'Renew'}</button><button class="button" data-return="${loan.id}">Return</button></div>
  </div>`;
}

function queueRow(item) {
  return `<div class="loan-row">
    <div class="title-cell"><span class="mini-cover" style="--accent:${item.accent}"></span><div><strong>${esc(item.title)}</strong><span>${esc(item.author)}</span></div></div>
    <div class="loan-meta">Queue position<strong>${item.position}</strong></div><div class="loan-meta">Requested<strong>${shortDate(item.created_at)}</strong></div>
    <div class="actions"><button class="button secondary" data-cancel="${item.id}">Cancel request</button></div>
  </div>`;
}

function stars(rating) {
  return `<span class="stars" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>`;
}

async function openBook(id) {
  const book = await api(`/api/books/${id}`);
  state.activeBook = id;
  const available = Number(book.available_count) > 0;
  const relation = book.relationship || {};
  dialogRoot.innerHTML = `<div class="overlay" data-action="close-dialog"><article class="dialog" role="dialog" aria-modal="true" aria-labelledby="book-title">
    <button class="dialog-close" data-action="close-dialog" aria-label="Close">×</button>
    <div class="book-detail">
      <div class="detail-art" style="--accent:${book.accent}"><h2>${esc(book.title)}</h2><p>${esc(book.author)} · ${book.year < 0 ? `${Math.abs(book.year)} BCE` : book.year}</p></div>
      <div class="detail-copy">
        <p class="kicker">${esc(book.edition)} · ${esc(book.language)}</p>
        <h2 id="book-title">${esc(book.title)}</h2><p class="byline">by ${esc(book.author)}</p>
        <div class="tags">${book.subjects.map((subject) => `<span class="tag">${esc(subject)}</span>`).join('')}${book.rating ? `<span class="tag">★ ${book.rating} · ${plural(book.review_count, 'review')}</span>` : ''}</div>
        <p class="description">${esc(book.description)}</p>
        <div class="holdings">${book.holdings.map((holding) => `<div class="holding"><strong>${esc(holding.name)}</strong><span>Shelf ${esc(holding.shelf)}</span><span class="availability ${holding.available ? '' : 'wait'}">${holding.available ? 'Available' : 'On loan'}</span></div>`).join('')}</div>
        <div class="reserve-row"><p>${available ? 'We’ll assign an available copy for pickup.' : `${plural(book.queue_count, 'reader')} currently waiting.`}</p>
          ${relation.loan_id ? '<button class="button" disabled>Already on loan</button>' : relation.reservation_id ? '<button class="button" disabled>Request active</button>' : `<button class="button" data-reserve="${book.id}">${available ? 'Borrow this book' : 'Join the queue'}</button>`}
        </div>
        <div class="reviews-head"><h3>Reader notes</h3><button class="link-button" data-review="${book.id}">${book.reviews.some((review) => review.own) ? 'Edit your note' : 'Add a note'}</button></div>
        ${book.reviews.length ? book.reviews.map((review) => `<div class="review"><div class="review-top"><strong>${esc(review.member_name)}</strong>${stars(review.rating)}</div><p>${esc(review.body)}</p></div>`).join('') : '<div class="review"><p>No notes yet. Leave the first.</p></div>'}
      </div>
    </div>
  </article></div>`;
  dialogRoot.querySelector('.dialog-close').focus();
  document.body.style.overflow = 'hidden';
}

function closeDialog() {
  dialogRoot.innerHTML = '';
  document.body.style.overflow = '';
  state.activeBook = null;
}

function openAuth(mode = 'login') {
  const register = mode === 'register';
  dialogRoot.innerHTML = `<div class="overlay" data-action="close-dialog"><section class="dialog small auth" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <button class="dialog-close" data-action="close-dialog" aria-label="Close">×</button>
    <p class="kicker">Private membership</p><h2 id="auth-title">${register ? 'Join Sol Library' : 'Welcome back'}</h2>
    <p class="intro">${register ? 'Create your membership to borrow from all four houses.' : 'Sign in to request, renew, and review books.'}</p>
    <form id="auth-form" data-mode="${mode}">
      ${register ? '<div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required minlength="2"></div>' : ''}
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="8"></div>
      <p class="form-error" id="auth-error"></p><button class="button" type="submit">${register ? 'Create membership' : 'Sign in'}</button>
    </form>
    <p class="form-switch">${register ? 'Already a member?' : 'New to the library?'} <button class="link-button" data-auth-mode="${register ? 'login' : 'register'}">${register ? 'Sign in' : 'Join now'}</button></p>
    ${register ? '' : '<div class="demo-note"><strong>Visiting?</strong><br>Use reader@asterhouse.test with password quietbooks.</div>'}
  </section></div>`;
  dialogRoot.querySelector(register ? '#name' : '#email').focus();
  document.body.style.overflow = 'hidden';
}

function openReview(bookId) {
  if (!state.bootstrap.member) return openAuth('login');
  dialogRoot.innerHTML = `<div class="overlay" data-action="close-dialog"><section class="dialog small auth" role="dialog" aria-modal="true" aria-labelledby="review-title">
    <button class="dialog-close" data-action="close-dialog" aria-label="Close">×</button>
    <p class="kicker">Reader notes</p><h2 id="review-title">Leave a note</h2><p class="intro">Brief, candid, and useful to the next reader.</p>
    <form id="review-form" data-book-id="${bookId}">
      <div class="field"><label>Your rating</label><div class="star-picker">${[5,4,3,2,1].map((value) => `<input type="radio" id="star-${value}" name="rating" value="${value}" ${value === 5 ? 'required' : ''}><label for="star-${value}" aria-label="${value} stars">★</label>`).join('')}</div></div>
      <div class="field"><label for="review-body">Your note</label><textarea id="review-body" name="body" minlength="8" maxlength="1200" required placeholder="What stayed with you?"></textarea></div>
      <p class="form-error" id="review-error"></p><button class="button" type="submit">Publish note</button>
    </form>
  </section></div>`;
  dialogRoot.querySelector('#review-body').focus();
}

async function navigate() {
  const view = (location.hash.slice(1).split('?')[0] || 'catalog');
  try {
    if (view === 'locations') renderLocations();
    else if (view === 'account') await renderAccount();
    else await renderCatalog();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    app.innerHTML = `<div class="page"><div class="empty"><h3>We could not open this page</h3><p>${esc(error.message)}</p><button class="button secondary" data-action="retry">Try again</button></div></div>`;
  }
}

let searchTimer;
app.addEventListener('input', (event) => {
  if (event.target.id !== 'catalog-search') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = event.target.value.trim(); state.page = 1; renderCatalog();
  }, 320);
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'location-filter') { state.location = event.target.value; state.page = 1; renderCatalog(); }
  if (event.target.id === 'subject-filter') { state.subject = event.target.value; state.page = 1; renderCatalog(); }
});

app.addEventListener('click', async (event) => {
  const book = event.target.closest('[data-book]');
  if (book) return openBook(book.dataset.book);
  const page = event.target.closest('[data-page]');
  if (page && !page.disabled) { state.page = Number(page.dataset.page); await renderCatalog(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const locationLink = event.target.closest('[data-location-link]');
  if (locationLink) { state.location = locationLink.dataset.locationLink; state.page = 1; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'clear-search') { state.q = ''; state.page = 1; renderCatalog(); }
  if (action === 'reset-filters') { state.q = ''; state.location = ''; state.subject = ''; state.page = 1; renderCatalog(); }
  if (action === 'retry') navigate();
  if (action === 'logout') await logout();
  const renew = event.target.closest('[data-renew]');
  if (renew) await accountAction(`/api/loans/${renew.dataset.renew}/renew`, 'Loan renewed for two weeks.');
  const returned = event.target.closest('[data-return]');
  if (returned) await accountAction(`/api/loans/${returned.dataset.return}/return`, 'Book returned. Thank you.');
  const cancel = event.target.closest('[data-cancel]');
  if (cancel) await accountAction(`/api/reservations/${cancel.dataset.cancel}`, 'Request cancelled.', 'DELETE');
});

app.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-book]')) { event.preventDefault(); openBook(event.target.dataset.book); }
});

memberMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'sign-in') openAuth('login');
  if (action === 'account') location.hash = 'account';
});

dialogRoot.addEventListener('click', async (event) => {
  if (event.target.classList.contains('overlay') || event.target.closest('.dialog-close')) { closeDialog(); return; }
  const mode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
  if (mode) return openAuth(mode);
  const reserve = event.target.closest('[data-reserve]');
  if (reserve) {
    if (!state.bootstrap.member) return openAuth('login');
    reserve.disabled = true;
    try {
      const result = await api(`/api/books/${reserve.dataset.reserve}/reserve`, { method: 'POST', body: '{}' });
      toast(result.kind === 'loan' ? 'Book borrowed. It is now in your library.' : `You joined the queue at position ${result.position}.`);
      await openBook(reserve.dataset.reserve);
    } catch (error) { toast(error.message); reserve.disabled = false; }
  }
  const review = event.target.closest('[data-review]');
  if (review) openReview(review.dataset.review);
});

dialogRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  if (form.id === 'auth-form') {
    const values = Object.fromEntries(new FormData(form));
    const errorEl = form.querySelector('#auth-error');
    try {
      const result = await api(`/api/${form.dataset.mode}`, { method: 'POST', body: JSON.stringify(values) });
      state.bootstrap.member = result.member;
      renderMember(); closeDialog(); toast(form.dataset.mode === 'register' ? 'Membership created. Welcome to Sol.' : 'Welcome back.');
      navigate();
    } catch (error) { errorEl.textContent = error.message; submit.disabled = false; }
  }
  if (form.id === 'review-form') {
    const values = Object.fromEntries(new FormData(form));
    const errorEl = form.querySelector('#review-error');
    try {
      await api(`/api/books/${form.dataset.bookId}/reviews`, { method: 'POST', body: JSON.stringify(values) });
      toast('Your note has been published.'); await openBook(form.dataset.bookId);
    } catch (error) { errorEl.textContent = error.message; submit.disabled = false; }
  }
});

async function accountAction(path, message, method = 'POST') {
  try { await api(path, { method, body: method === 'DELETE' ? undefined : '{}' }); toast(message); await renderAccount(); }
  catch (error) { toast(error.message); }
}

async function logout() {
  await api('/api/logout', { method: 'POST', body: '{}' });
  state.bootstrap.member = null; renderMember(); toast('You are signed out.'); location.hash = 'catalog';
}

window.addEventListener('hashchange', navigate);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && dialogRoot.children.length) closeDialog(); });

try {
  state.bootstrap = await api('/api/bootstrap');
  renderMember();
  navigate();
} catch (error) {
  app.innerHTML = `<div class="page"><div class="empty"><h3>The library is unavailable</h3><p>${esc(error.message)}</p></div></div>`;
}
