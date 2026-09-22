# One-shot prompt

Build a polished private library application for a collection of rare books.

The application should support:

- multiple library locations;
- member logins and registration;
- catalog search and browsing;
- reservations, queueing, returns, and renewals;
- an inventory of at least 5,000 books;
- descriptions and user reviews;
- a working full-stack experience backed by SQLite.

Choose the stack. Keep the code minimal and clean. The interface should feel
deliberately designed rather than AI-generated: readable type, strong spacing,
no tiny filler copy, and a quiet visual language inspired by Linear's
clarity. Elegance is when nothing further can be removed.

Produce the best working application you can in one attempt. Include tests,
seed data, setup instructions, and a final review pass for correctness,
cleanup, and visual polish.

## Evaluation notes

This repository preserves two one-shot submissions side by side:

- `submissions/qwen-omp` — Qwen 3.8 27B / OMP, a dependency-free Node and
  SQLite implementation with a 6,330-volume catalog and a full reservation
  lifecycle.
- `submissions/luna` — Luna Max reasoning, a React/Vite and Express
  implementation with a 5,184-volume Open Library catalog.
