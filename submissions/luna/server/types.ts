import type { Request } from 'express'

export type Role = 'member' | 'librarian'

export interface PublicUser {
  id: string
  email: string
  name: string
  role: Role
}

export interface AuthenticatedRequest extends Request {
  user?: PublicUser
  sessionToken?: string
}

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser
      sessionToken?: string
    }
  }
}

export interface BookRecord {
  id: string
  catalogCode: string
  isbn: string | null
  title: string
  author: string
  description: string
  genre: string
  language: string
  publicationYear: number
  location: {
    id: string
    name: string
    city: string
  }
  available: boolean
  averageRating?: number | null
  reviewCount?: number
}
