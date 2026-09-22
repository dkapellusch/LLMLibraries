import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from './components/Icons'
import { demoBooks, demoLocations } from './data/demo'
import { createReservation, getBook, getCatalog, getLoans, getLocations, getReservations, login, logout as logoutSession, renewLoan, getStoredUser, storeUser } from './lib/api'
import type { Book, LibraryUser, Loan, LocationAvailability, Reservation, View } from './types'
import './styles.css'

function formatDate(value: string): string {
  const parsed = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

function initials(title: string): string {
  return title.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

function bookTitle(book?: Book): string {
  return book?.title ?? 'Untitled volume'
}

function Cover({ book, size = 'regular' }: { book: Book; size?: 'small' | 'regular' | 'large' }) {
  return (
    <div className={`book-cover book-cover--${book.coverTone} book-cover--${size}`} aria-label={`Cover of ${book.title}`}>
      <span className="cover-rule" />
      <span className="cover-initials">{initials(book.title)}</span>
      <span className="cover-title">{book.title}</span>
      <span className="cover-author">{book.author.split(' · ')[0]}</span>
    </div>
  )
}

function Rating({ value, count, compact = false }: { value: number; count?: number; compact?: boolean }) {
  return (
    <span className={`rating ${compact ? 'rating--compact' : ''}`}>
      <span className="rating-stars" aria-label={`${value} out of 5 stars`}>★★★★★</span>
      <span>{value.toFixed(1)}</span>
      {count !== undefined && <span className="muted">({count})</span>}
    </span>
  )
}

function StatusPill({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'green' | 'amber' | 'blue' }) {
  return <span className={`status-pill status-pill--${tone}`}><span className="status-dot" />{children}</span>
}

function AppLogo() {
  return <div className="brand-mark" aria-label="Luna Library"><span className="brand-sun" /><span className="brand-word">luna<span>library</span></span></div>
}

function NavItem({ icon, label, active, onClick, count }: { icon: IconName; label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button className={`nav-item ${active ? 'nav-item--active' : ''}`} onClick={onClick}>
      <Icon name={icon} size={19} />
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  )
}

function Sidebar({ view, setView, user, onLogout, reservationsCount }: { view: View; setView: (view: View) => void; user: LibraryUser; onLogout: () => void; reservationsCount: number }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <AppLogo />
        <div className="collection-label"><span className="collection-dot" />Private collection</div>
      </div>

      <nav className="main-nav" aria-label="Main navigation">
        <p className="nav-heading">Workspace</p>
        <NavItem icon="archive" label="Catalog" active={view === 'catalog'} onClick={() => setView('catalog')} />
        <NavItem icon="bookmark" label="My library" active={view === 'library'} onClick={() => setView('library')} count={reservationsCount} />
        <NavItem icon="pin" label="Locations" active={view === 'locations'} onClick={() => setView('locations')} />
      </nav>

      <div className="sidebar-note">
        <Icon name="globe" size={18} />
        <div><strong>4 reading rooms</strong><span>Across three cities</span></div>
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-user" onClick={onLogout} title="Sign out">
          <span className="avatar avatar--small">{user.initials}</span>
          <span className="sidebar-user-copy"><strong>{user.name}</strong><span>Member since 2022</span></span>
          <Icon name="logout" size={17} />
        </button>
        <button className="quiet-button settings-button"><Icon name="settings" size={18} />Settings</button>
      </div>
    </aside>
  )
}

function Topbar({ view, locationId, locations, setLocationId, user, onMenu }: { view: View; locationId: string; locations: LocationAvailability[]; setLocationId: (id: string) => void; user: LibraryUser; onMenu: () => void }) {
  const titles: Record<View, string> = { catalog: 'Catalog', library: 'My library', locations: 'Locations' }
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" size={21} /></button>
      <div className="breadcrumbs"><span>Luna Library</span><Icon name="chevron-right" size={15} /><strong>{titles[view]}</strong></div>
      <div className="topbar-actions">
        <label className="location-select">
          <Icon name="pin" size={16} />
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} aria-label="Choose a reading room">
            {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
          </select>
          <Icon name="chevron-down" size={15} />
        </label>
        <div className="topbar-user"><span className="avatar">{user.initials}</span><span>{user.name.split(' ')[0]}</span></div>
      </div>
    </header>
  )
}

function CatalogView({ books, total, isLoading, query, setQuery, genre, setGenre, availableOnly, setAvailableOnly, sort, setSort, onBookSelect, selectedLocationId, locations, onReset }: {
  books: Book[]
  total: number
  isLoading: boolean
  query: string
  setQuery: (value: string) => void
  genre: string
  setGenre: (value: string) => void
  availableOnly: boolean
  setAvailableOnly: (value: boolean) => void
  sort: string
  setSort: (value: string) => void
  onBookSelect: (book: Book) => void
  selectedLocationId: string
  locations: LocationAvailability[]
  onReset: () => void
}) {
  const genres = useMemo(() => Array.from(new Set(books.map((book) => book.genre))).sort(), [books])
  const filteredBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = books.filter((book) => {
      const matchesQuery = !normalizedQuery || `${book.title} ${book.author} ${book.genre} ${book.isbn}`.toLowerCase().includes(normalizedQuery)
      const matchesGenre = !genre || book.genre === genre
      const matchesAvailability = !availableOnly || book.locations.some((location) => location.id === selectedLocationId && location.available > 0)
      return matchesQuery && matchesGenre && matchesAvailability
    })

    return [...filtered].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating
      if (sort === 'year-desc') return b.year - a.year
      if (sort === 'year-asc') return a.year - b.year
      return a.title.localeCompare(b.title)
    })
  }, [availableOnly, books, genre, query, selectedLocationId, sort])

  return (
    <div className="view-stack">
      <section className="page-intro page-intro--catalog">
        <div>
          <p className="eyebrow">The collection</p>
          <h1>Find something worth keeping.</h1>
          <p className="page-lede">Five thousand volumes, thoughtfully gathered and quietly waiting.</p>
        </div>
        <div className="intro-aside"><span className="intro-aside-number">5,000</span><span>catalogued volumes</span></div>
      </section>

      <section className="catalog-toolbar" aria-label="Catalog filters">
        <label className="search-field">
          <Icon name="search" size={20} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, authors, or ISBNs" aria-label="Search the catalog" />
          {query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={16} /></button>}
          <kbd>⌘ K</kbd>
        </label>
        <div className="toolbar-row">
          <label className="select-field"><span>Genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">All genres</option>{genres.map((item) => <option value={item} key={item}>{item}</option>)}</select><Icon name="chevron-down" size={15} /></label>
          <button className={`filter-button ${availableOnly ? 'filter-button--active' : ''}`} onClick={() => setAvailableOnly(!availableOnly)}><Icon name="check" size={16} />Available here</button>
          <label className="select-field select-field--sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="title">Title</option><option value="rating">Highest rated</option><option value="year-desc">Newest</option><option value="year-asc">Oldest</option></select><Icon name="chevron-down" size={15} /></label>
          {(genre || availableOnly || query) && <button className="reset-button" onClick={onReset}>Reset</button>}
        </div>
      </section>

      <div className="results-head"><p>{isLoading ? 'Loading the collection…' : <><strong>{filteredBooks.length.toLocaleString()}</strong> {filteredBooks.length === 1 ? 'volume' : 'volumes'} <span className="muted">in your view</span></>}</p><span className="catalog-location"><Icon name="pin" size={15} />{locations.find((location) => location.id === selectedLocationId)?.name ?? 'All locations'}</span></div>

      {isLoading ? <CatalogSkeleton /> : filteredBooks.length === 0 ? <EmptyState icon="search" title="No volumes found" description="Try a broader search or clear one of the filters." action={<button className="button button--secondary" onClick={onReset}>Clear filters</button>} /> : (
        <div className="book-grid">
          {filteredBooks.slice(0, 36).map((book) => <BookCard book={book} key={book.id} onClick={() => onBookSelect(book)} />)}
        </div>
      )}
      {!isLoading && filteredBooks.length > 36 && <p className="grid-footnote">Showing the first 36 matches. Refine your search to narrow the collection.</p>}
    </div>
  )
}

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  return (
    <button className="book-card" onClick={onClick}>
      <div className="book-card-cover"><Cover book={book} /><span className={`availability-badge ${book.availableCopies > 0 ? '' : 'availability-badge--quiet'}`}>{book.availableCopies > 0 ? `${book.availableCopies} available` : 'On loan'}</span></div>
      <div className="book-card-copy">
        <div className="book-card-heading"><h3>{book.title}</h3><Icon name="chevron-right" size={17} /></div>
        <p className="book-author">{book.author}</p>
        <div className="book-card-meta"><span>{book.year}</span><span className="meta-separator">·</span><span>{book.genre}</span></div>
        <Rating value={book.rating} count={book.reviewCount} compact />
      </div>
    </button>
  )
}

function CatalogSkeleton() {
  return <div className="book-grid">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton skeleton-cover" /><div className="skeleton skeleton-line skeleton-line--wide" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line skeleton-line--short" /></div>)}</div>
}

function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span><h2>{title}</h2><p>{description}</p>{action}</div>
}

function BookDetailView({ book, locations, selectedLocationId, onBack, onReserve, reservationAction, hasReservation }: { book: Book; locations: LocationAvailability[]; selectedLocationId: string; onBack: () => void; onReserve: (locationId: string) => void; reservationAction: string | null; hasReservation: (bookId: string) => boolean }) {
  const selectedLocation = book.locations.find((location) => location.id === selectedLocationId) ?? book.locations[0]
  const reserved = hasReservation(book.id)

  return (
    <div className="view-stack book-detail-view">
      <button className="back-button" onClick={onBack}><Icon name="arrow-left" size={18} />Back to catalog</button>
      <section className="book-detail-hero">
        <div className="detail-cover-wrap"><Cover book={book} size="large" /><div className="detail-cover-caption"><Icon name="lock" size={14} />Private collection item</div></div>
        <div className="book-detail-copy">
          <p className="eyebrow">{book.format} <span className="eyebrow-divider">/</span> {book.shelf}</p>
          <h1>{book.title}</h1>
          <p className="detail-author">{book.author}</p>
          <div className="detail-rating"><Rating value={book.rating} count={book.reviewCount} /><span className="rating-note">Community rating</span></div>
          <p className="detail-description">{book.description}</p>
          <div className="detail-facts"><div><span>Published</span><strong>{book.year}</strong></div><div><span>Pages</span><strong>{book.pages}</strong></div><div><span>Language</span><strong>{book.language}</strong></div><div><span>ISBN</span><strong>{book.isbn}</strong></div></div>
          <div className="detail-actions"><button className="button button--primary" onClick={() => onReserve(selectedLocation.id)} disabled={reservationAction !== null}>{reservationAction === selectedLocation.id ? <><Icon name="loader" size={17} className="spin" />Saving…</> : reserved ? <><Icon name="check" size={17} />Reserved</> : <><Icon name="bookmark" size={17} />Reserve this copy</>}</button><button className="icon-button" aria-label="Save book"><Icon name="bookmark" size={19} /></button></div>
        </div>
      </section>

      <section className="detail-lower-grid">
        <div className="detail-section"><div className="section-heading"><div><p className="eyebrow">Collection notes</p><h2>About this volume</h2></div><Icon name="info" size={19} /></div><p className="detail-long-copy">This copy is part of the Luna Library’s {book.genre.toLowerCase()} room. It has been reviewed by our collection team for condition, provenance, and fit within the wider archive. Members may request it for use in any of our reading rooms.</p><div className="provenance-row"><span><Icon name="archive" size={17} />{book.shelf}</span><span><Icon name="clock" size={17} />Usually ready in 1 day</span></div></div>
        <div className="detail-section availability-section"><div className="section-heading"><div><p className="eyebrow">Access</p><h2>Availability by room</h2></div><span className="muted">{book.copies} copies</span></div><div className="availability-list">{book.locations.map((location) => <AvailabilityRow key={location.id} location={location} isSelected={location.id === selectedLocationId} reserved={reserved} loading={reservationAction === location.id} onReserve={() => onReserve(location.id)} />)}</div></div>
      </section>

      <section className="reviews-section"><div className="section-heading"><div><p className="eyebrow">Member notes</p><h2>Reviews from the reading room</h2></div><span className="review-summary"><Rating value={book.rating} count={book.reviewCount} /></span></div>{book.reviews.length ? <div className="review-list">{book.reviews.map((review) => <article className="review-card" key={review.id}><div className="review-meta"><span className="avatar avatar--review">{review.initials}</span><div><strong>{review.author}</strong><span>{review.date}</span></div><span className="review-stars">{'★'.repeat(review.rating)}</span></div><p>“{review.body}”</p></article>)}</div> : <div className="subtle-empty">No member reviews yet. Be the first to leave a note after your visit.</div>}</section>
    </div>
  )
}

function AvailabilityRow({ location, isSelected, reserved, loading, onReserve }: { location: LocationAvailability; isSelected: boolean; reserved: boolean; loading: boolean; onReserve: () => void }) {
  const hasCopy = location.available > 0
  return <div className={`availability-row ${isSelected ? 'availability-row--selected' : ''}`}><div className="availability-main"><span className={`location-icon ${hasCopy ? 'location-icon--open' : ''}`}><Icon name="pin" size={17} /></span><div><strong>{location.name}</strong><span>{location.city} · {location.hours}</span></div></div><div className="availability-action"><span className={`availability-count ${hasCopy ? 'availability-count--open' : ''}`}>{hasCopy ? `${location.available} ready` : 'Checked out'}</span><button className="text-button" onClick={onReserve} disabled={loading}>{loading ? 'Saving…' : reserved && isSelected ? 'Reserved' : hasCopy ? 'Reserve' : 'Join waitlist'}<Icon name="arrow-right" size={15} /></button></div></div>
}

function LibraryView({ loans, reservations, books, locations, isRenewing, onRenew, onBookSelect }: { loans: Loan[]; reservations: Reservation[]; books: Book[]; locations: LocationAvailability[]; isRenewing: string | null; onRenew: (loan: Loan) => void; onBookSelect: (book: Book) => void }) {
  const bookById = (id: string) => books.find((book) => book.id === id) ?? demoBooks.find((book) => book.id === id)
  return <div className="view-stack"><section className="page-intro"><div><p className="eyebrow">Your reading room</p><h1>My library</h1><p className="page-lede">Keep an eye on the books currently making their way through your week.</p></div><div className="intro-aside intro-aside--compact"><span className="intro-aside-number">{loans.length + reservations.length}</span><span>active items</span></div></section><div className="library-grid"><section className="panel"><div className="section-heading"><div><p className="eyebrow">In your care</p><h2>Loans</h2></div><span className="section-count">{loans.length}</span></div>{loans.length ? <div className="loan-list">{loans.map((loan) => <LoanRow key={loan.id} loan={loan} book={bookById(loan.bookId)} isRenewing={isRenewing === loan.id} onRenew={() => onRenew(loan)} onBookSelect={onBookSelect} />)}</div> : <EmptyState icon="bookmark" title="Nothing on loan" description="Browse the catalog and find a volume for your next reading session." />}</section><section className="panel"><div className="section-heading"><div><p className="eyebrow">In the queue</p><h2>Reservations</h2></div><span className="section-count">{reservations.length}</span></div>{reservations.length ? <div className="reservation-list">{reservations.map((reservation) => <ReservationRow key={reservation.id} reservation={reservation} book={bookById(reservation.bookId)} locations={locations} onBookSelect={onBookSelect} />)}</div> : <EmptyState icon="calendar" title="No reservations" description="Reserve a book and choose the room that suits you." />}</section></div><section className="library-note"><Icon name="lock" size={17} /><div><strong>A considered collection</strong><span>Your loans are held for 21 days. Renew twice when no other member is waiting.</span></div><Icon name="arrow-right" size={17} /></section></div>
}

function LoanRow({ loan, book, isRenewing, onRenew, onBookSelect }: { loan: Loan; book?: Book; isRenewing: boolean; onRenew: () => void; onBookSelect: (book: Book) => void }) {
  if (!book) return null
  const canRenew = loan.renewalCount < loan.maxRenewals
  return <article className="loan-row"><button className="mini-cover-button" onClick={() => onBookSelect(book)}><Cover book={book} size="small" /></button><div className="loan-copy"><button className="link-heading" onClick={() => onBookSelect(book)}>{book.title}</button><span>{book.author}</span><div className="loan-date"><Icon name="calendar" size={15} />Due {formatDate(loan.dueDate)}</div></div><div className="loan-action"><StatusPill tone={loan.status === 'Due soon' ? 'amber' : 'green'}>{loan.status}</StatusPill><button className="button button--small button--secondary" disabled={!canRenew || isRenewing} onClick={onRenew}>{isRenewing ? <Icon name="loader" size={15} className="spin" /> : <Icon name="refresh" size={15} />} {canRenew ? 'Renew' : 'Renewed'}</button><span className="renewal-note">{loan.renewalCount}/{loan.maxRenewals} renewals</span></div></article>
}

function ReservationRow({ reservation, book, locations, onBookSelect }: { reservation: Reservation; book?: Book; locations: LocationAvailability[]; onBookSelect: (book: Book) => void }) {
  if (!book) return null
  const location = locations.find((item) => item.id === reservation.pickupLocationId)
  return <article className="reservation-row"><button className="mini-cover-button" onClick={() => onBookSelect(book)}><Cover book={book} size="small" /></button><div className="reservation-copy"><button className="link-heading" onClick={() => onBookSelect(book)}>{book.title}</button><span>{book.author}</span><div className="loan-date"><Icon name="pin" size={15} />{location?.name ?? 'Reading room'}</div></div><div className="reservation-action"><StatusPill tone={reservation.status === 'Ready for pickup' ? 'blue' : 'neutral'}>{reservation.status}</StatusPill><span className="queue-note">{reservation.queuePosition === 1 ? 'Next in line' : `Position ${reservation.queuePosition}`} · hold until {formatDate(reservation.expiresAt)}</span></div></article>
}

function LocationsView({ locations, selectedLocationId, setLocationId }: { locations: LocationAvailability[]; selectedLocationId: string; setLocationId: (id: string) => void }) {
  const selected = locations.find((location) => location.id === selectedLocationId) ?? locations[0]
  return <div className="view-stack"><section className="page-intro"><div><p className="eyebrow">Come in, stay awhile</p><h1>Reading rooms</h1><p className="page-lede">Each location has its own character. Your membership travels with you.</p></div><div className="intro-aside intro-aside--compact"><span className="intro-aside-number">{locations.length}</span><span>open rooms</span></div></section><section className="location-feature"><div className="location-feature-copy"><span className="location-feature-kicker"><span className="live-dot" />Selected room</span><h2>{selected.name}</h2><p>{selected.address}, {selected.city}</p><div className="location-feature-facts"><span><Icon name="clock" size={17} />{selected.hours}</span><span><Icon name="archive" size={17} />{selected.available.toLocaleString()} available here</span></div><button className="button button--primary"><Icon name="arrow-right" size={17} />Plan a visit</button></div><div className="room-illustration" aria-hidden="true"><div className="room-window" /><div className="room-shelf room-shelf--one" /><div className="room-shelf room-shelf--two" /><div className="room-lamp" /></div></section><section className="location-grid">{locations.map((location) => <button className={`location-card ${location.id === selectedLocationId ? 'location-card--selected' : ''}`} key={location.id} onClick={() => setLocationId(location.id)}><div className="location-card-top"><span className="location-card-index">0{locations.indexOf(location) + 1}</span>{location.id === selectedLocationId && <StatusPill tone="green">Selected</StatusPill>}</div><h3>{location.name}</h3><p>{location.address}</p><div className="location-card-bottom"><span><Icon name="clock" size={15} />{location.hours.replace('Open until ', 'Until ')}</span><span>{location.distance}</span></div></button>)}</section></div>
}

function LoginView({ onLogin }: { onLogin: (user: LibraryUser) => void }) {
  const [email, setEmail] = useState('alex@lunalibrary.test')
  const [password, setPassword] = useState('luna-demo')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const response = await login(email, password)
      storeUser(response.user)
      onLogin(response.user)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'We could not sign you in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="login-shell"><div className="login-atmosphere"><AppLogo /><div className="login-manifesto"><p className="eyebrow">A private library for curious people</p><h1>Make room for a slower kind of reading.</h1><p>Rare books, thoughtful company, and a place to return to.</p></div><div className="login-stack" aria-hidden="true"><div className="stack-book stack-book--back" /><div className="stack-book stack-book--middle" /><div className="stack-book stack-book--front"><span>luna</span></div></div><span className="login-atmosphere-caption">A collection in progress · Est. 2022</span></div><main className="login-panel"><div className="login-card"><div className="login-card-heading"><p className="eyebrow">Welcome back</p><h2>Sign in to Luna</h2><p>Access your loans, reservations, and reading rooms.</p></div><form onSubmit={handleSubmit} className="login-form"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<div className="password-field"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={6} required /><Icon name="lock" size={16} /></div></label>{error && <div className="form-error"><Icon name="info" size={17} />{error}</div>}<button className="button button--primary button--full" type="submit" disabled={isSubmitting}>{isSubmitting ? <><Icon name="loader" size={17} className="spin" />Signing in…</> : 'Continue to the collection'}<Icon name="arrow-right" size={17} /></button></form><div className="login-divider"><span>Demo member</span><span className="muted">alex@lunalibrary.test · luna-demo</span></div><p className="login-demo"><Icon name="info" size={15} />Your session is private and stored in a secure HTTP-only cookie.</p></div><p className="login-footer">By continuing, you agree to our member guidelines and care policy.</p></main></div>
}

function App() {
  const [user, setUser] = useState<LibraryUser | null>(() => getStoredUser())
  const [view, setView] = useState<View>('catalog')
  const [locationId, setLocationId] = useState('loc-nyc')
  const [locations, setLocations] = useState<LocationAvailability[]>(demoLocations)
  const [books, setBooks] = useState<Book[]>([])
  const [libraryBooks, setLibraryBooks] = useState<Book[]>([])
  const [catalogTotal, setCatalogTotal] = useState(5000)
  const [loans, setLoans] = useState<Loan[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [selectedBookDetail, setSelectedBookDetail] = useState<Book | undefined>()
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [availableOnly, setAvailableOnly] = useState(false)
  const [sort, setSort] = useState('title')
  const [isLoading, setIsLoading] = useState(true)
  const [isRenewing, setIsRenewing] = useState<string | null>(null)
  const [reservationAction, setReservationAction] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const storedLocation = user?.defaultLocationId
    if (storedLocation) setLocationId(storedLocation)
  }, [user?.defaultLocationId])

  useEffect(() => {
    let mounted = true
    Promise.all([getLocations(), getLoans(), getReservations()]).then(([rooms, activeLoans, activeReservations]) => {
      if (!mounted) return
      setLocations(rooms)
      setLoans(activeLoans)
      setReservations(activeReservations)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const ids = Array.from(new Set([...loans.map((loan) => loan.bookId), ...reservations.map((reservation) => reservation.bookId)]))
    if (!ids.length) { setLibraryBooks([]); return }
    let mounted = true
    Promise.all(ids.map((id) => getBook(id))).then((details) => {
      if (mounted) setLibraryBooks(details.filter((detail): detail is Book => Boolean(detail)))
    })
    return () => { mounted = false }
  }, [loans, reservations])

  useEffect(() => {
    let mounted = true
    const timer = window.setTimeout(() => {
      setIsLoading(true)
      getCatalog({ query, genre, availableOnly, locationId }).then((catalog) => {
        if (!mounted) return
        setBooks(catalog.books)
        setCatalogTotal(catalog.total)
      }).finally(() => mounted && setIsLoading(false))
    }, 180)
    return () => { mounted = false; window.clearTimeout(timer) }
  }, [availableOnly, genre, locationId, query])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectedBook = selectedBookDetail ?? (selectedBookId ? books.find((book) => book.id === selectedBookId) ?? demoBooks.find((book) => book.id === selectedBookId) : undefined)

  function handleViewChange(nextView: View) {
    setView(nextView)
    setSelectedBookId(null)
    setSelectedBookDetail(undefined)
  }

  function handleSelectBook(book: Book) {
    setSelectedBookId(book.id)
    setSelectedBookDetail(book)
    setView('catalog')
    getBook(book.id).then((detail) => detail && setSelectedBookDetail(detail))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleRenew(loan: Loan) {
    setIsRenewing(loan.id)
    try {
      const updated = await renewLoan(loan.id, loan)
      setLoans((current) => current.map((item) => item.id === loan.id ? updated : item))
      setNotice('Loan renewed through October 23.')
    } catch {
      setNotice('We could not renew that loan. Please try again.')
    } finally {
      setIsRenewing(null)
    }
  }

  async function handleLogout() {
    try { await logoutSession() } finally {
      storeUser(null)
      setUser(null)
    }
  }

  async function handleReserve(bookId: string, pickupLocationId: string) {
    if (reservations.some((reservation) => reservation.bookId === bookId)) {
      setNotice('That volume is already in your reservations.')
      return
    }
    setReservationAction(pickupLocationId)
    try {
      const reservation = await createReservation(bookId, pickupLocationId)
      setReservations((current) => [reservation, ...current])
      setNotice('Reservation added to your library.')
    } catch {
      setNotice('We could not save that reservation. Please try again.')
    } finally {
      setReservationAction(null)
    }
  }

  function resetFilters() {
    setQuery('')
    setGenre('')
    setAvailableOnly(false)
  }

  if (!user) return <LoginView onLogin={(nextUser) => { setUser(nextUser); setView('catalog') }} />

  return <div className="app-shell"><Sidebar view={view} setView={handleViewChange} user={user} onLogout={handleLogout} reservationsCount={reservations.length} /><div className="page-shell"><Topbar view={view} locationId={locationId} locations={locations} setLocationId={setLocationId} user={user} onMenu={() => document.body.classList.toggle('sidebar-open')} /><main className="main-content">{selectedBook ? <BookDetailView book={selectedBook} locations={locations} selectedLocationId={locationId} onBack={() => { setSelectedBookId(null); setSelectedBookDetail(undefined) }} onReserve={(pickupLocationId) => handleReserve(selectedBook.id, pickupLocationId)} reservationAction={reservationAction} hasReservation={(bookId) => reservations.some((reservation) => reservation.bookId === bookId)} /> : view === 'catalog' ? <CatalogView books={books} total={catalogTotal} isLoading={isLoading} query={query} setQuery={setQuery} genre={genre} setGenre={setGenre} availableOnly={availableOnly} setAvailableOnly={setAvailableOnly} sort={sort} setSort={setSort} onBookSelect={handleSelectBook} selectedLocationId={locationId} locations={locations} onReset={resetFilters} /> : view === 'library' ? <LibraryView loans={loans} reservations={reservations} books={[...books, ...libraryBooks]} locations={locations} isRenewing={isRenewing} onRenew={handleRenew} onBookSelect={handleSelectBook} /> : <LocationsView locations={locations} selectedLocationId={locationId} setLocationId={setLocationId} />}</main></div>{notice && <div className="toast"><span className="toast-icon"><Icon name="check" size={16} /></span>{notice}</div>}</div>
}

export default App
