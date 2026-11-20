# Supabase migration history

These timestamped SQL files reconstruct the 21 migrations already recorded by the connected Supabase project in `supabase_migrations.schema_migrations`.

Each SQL body was copied from the recorded `statements` for its applied version. This pull request changes repository migration files only; it does not execute SQL against Supabase or modify production data.

Before any future `supabase db push`, `db reset`, or migration deployment:
1. Review the complete diff.
2. Run `supabase migration list` against the intended project and confirm all 21 versions are reported as applied.
3. Confirm there are no pending migrations or drift warnings.

Never reset the production database to reconcile migration history.
