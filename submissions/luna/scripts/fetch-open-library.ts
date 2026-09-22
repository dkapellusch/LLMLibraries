import fs from 'node:fs'
import path from 'node:path'

const queries = [
  'subject:fiction',
  'subject:history',
  'subject:science',
  'subject:philosophy',
  'subject:art',
  'subject:poetry',
  'subject:travel',
  'subject:biography',
]
const limit = 1000
const fields = ['key', 'title', 'author_name', 'first_publish_year', 'isbn', 'subject', 'number_of_pages_median', 'language', 'cover_i'].join(',')

type OpenLibraryDoc = {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  subject?: string[]
  number_of_pages_median?: number
  language?: string[]
  cover_i?: number
}

type SourceBook = {
  sourceKey: string
  title: string
  author: string
  firstPublishYear: number
  isbn: string | null
  subjects: string[]
  pages: number | null
  language: string
  coverId: number | null
}

function isUsable(doc: OpenLibraryDoc): doc is OpenLibraryDoc & Required<Pick<OpenLibraryDoc, 'key' | 'title' | 'author_name'>> {
  return Boolean(doc.key && doc.title?.trim() && doc.author_name?.[0]?.trim())
}

async function fetchQuery(query: string): Promise<OpenLibraryDoc[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: '0', fields, sort: 'editions' })
  const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
    headers: { 'User-Agent': 'LibraryLuna/1.0 (catalog import; https://openlibrary.org)' },
  })
  if (!response.ok) throw new Error(`Open Library returned ${response.status} for ${query}`)
  const payload = await response.json() as { docs?: OpenLibraryDoc[] }
  return payload.docs ?? []
}

const records = new Map<string, SourceBook>()
for (const query of queries) {
  console.log(`Fetching ${query}…`)
  for (const doc of await fetchQuery(query)) {
    if (!isUsable(doc) || records.has(doc.key)) continue
    records.set(doc.key, {
      sourceKey: doc.key,
      title: doc.title.trim(),
      author: doc.author_name[0].trim(),
      firstPublishYear: Number.isInteger(doc.first_publish_year) ? doc.first_publish_year! : 1900,
      isbn: doc.isbn?.find((value) => /^\d{10}(\d{3})?$/.test(value)) ?? null,
      subjects: (doc.subject ?? []).filter(Boolean).slice(0, 6),
      pages: Number.isInteger(doc.number_of_pages_median) ? doc.number_of_pages_median! : null,
      language: doc.language?.[0] ?? 'eng',
      coverId: Number.isInteger(doc.cover_i) ? doc.cover_i! : null,
    })
  }
}

const output = path.resolve(process.cwd(), 'server/catalog-source.json')
fs.writeFileSync(output, `${JSON.stringify([...records.values()].slice(0, 6000), null, 2)}\n`)
console.log(`Wrote ${records.size} real Open Library work records to ${output}`)
