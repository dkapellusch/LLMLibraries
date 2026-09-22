import catalog from './catalog-source.json' with { type: 'json' }

export type RealBook = {
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

export const realBooks = catalog as RealBook[]
