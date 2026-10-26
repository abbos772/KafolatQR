# KafolatQR — Project Rules

## Project Overview

KafolatQR is a SaaS MVP for electronics sellers to issue digital warranty cards with QR codes.

**Goals:**
- Frontend: React, Vite, TypeScript
- Auth & Database: Supabase Auth + PostgreSQL
- Row Level Security (RLS) enforces authorization at the database level
- Public QR verification reveals only explicitly approved warranty information
- UI language: Uzbek first, with structure for Russian localization later
- Responsive layout for desktop and mobile

## Engineering Rules

1. **Inspect the repository before making changes.**
2. **Work in small, reviewable steps.**
3. Do NOT deploy, purchase services, delete data, reset databases, or run destructive commands without explicit user approval.
4. Never request, print, commit, or expose secrets.
5. Never put the Supabase service-role key in client-side code or any `VITE_` environment variable.
6. Do NOT disable security checks or Row Level Security to make a feature work.
7. Use environment variables, input validation, meaningful errors, and TypeScript types.
8. Prefer simple dependencies — explain why each additional dependency is necessary.
9. Do NOT claim tests passed unless you actually ran them and observed the result.
10. Ask for approval before changing the database schema in a destructive or backwards-incompatible way.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Type-check & build | `npm run build` |
| Lint | `npm run lint` |

## Tech Stack

- React 19 + Vite 8 + TypeScript 6
- Supabase (Auth + PostgreSQL)
- No state management library until proven necessary
- No CSS framework until proven necessary — use CSS modules or plain CSS
