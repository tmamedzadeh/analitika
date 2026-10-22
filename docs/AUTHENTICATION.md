# Authentication rollout

## Deployment order

1. Keep `DATABASE_URL_MIGRATE` and `DATABASE_URL` pointed at this project's configured PostgreSQL database.
2. Inspect the migration journal and run `bun run db:check-drift` before changing an existing database. The configured live project already has migrations 0000–0023; do not reapply them. For a new installation, `bun run db:migrate` applies pending forward-only migrations; authentication tables were introduced in 0013.
3. With `DATABASE_URL` still pointing at that target, run `bun run auth:create-admin` in an interactive terminal. The command asks for a username, one of the existing clearance values (`open`, `secret`, `top_secret`, `special`), and a password twice without echoing it. It refuses to bootstrap if an active administrator already exists.
4. Deploy the new application version after the migration and administrator creation succeed. Remove `DEMO_BASIC_AUTH` from runtime configuration; the application no longer reads it. Keep independent Vercel Deployment Protection settings as configured.

The CLI does not print the password, its hash, or the database URL. It uses the project's Bun scripts and `DATABASE_URL`.

## Accounts and access

Administrators create regular users in **Ayarlar → İstifadəçilər**, choose a clearance, reset passwords, and deactivate or reactivate accounts. Deactivation is a soft delete so historical document ownership remains intact. It revokes that user's sessions. The last active administrator and the current administrator cannot be deactivated through the UI.

Roles control administrative actions; clearance controls access to classified documents. Administrators have no automatic clearance override. The enforced order is `open < secret < top_secret < special`: a user can read documents at or below their clearance. The SQL predicate reads the active user's current clearance alongside each document query, so ownership, role, and stale session claims do not raise that ceiling. Document management permissions are evaluated separately.

Users change their own password in Ayarlar after entering the current password. Other sessions are revoked. Administrative password resets revoke all sessions for the target user. Login sessions expire after eight hours, use an HttpOnly SameSite=Lax cookie (Secure in production), and are stored in the database by token hash.

Document and brief attachments are streamed through authenticated application routes. Each read rechecks the session and owning record; document attachments also recheck the current clearance. The API does not return long-lived S3 download URLs.

## Migration status

Forward-only migrations through `0023_reconcile_legacy_constraint_names` are applied to the configured project DB (24 entries). All 15 application tables have RLS enabled and client/PUBLIC grants revoked; the trusted server PostgreSQL connection enforces application authorization. Historical migrations remain immutable. See `release/LIVE_DB_RESUME.json` and the current hardening audit for timestamped evidence. Owner/admin never overrides content clearance.

External AI defaults to open-only. V1 questions have no separate classification input, so external query embedding, reranking and generation conservatively use the active user's live clearance, as history already does. Higher-clearance users retain local lexical source search; external processing requires an approved classification policy. A nonempty policy reference is configuration, not proof of approval.

New image uploads use user-scoped temporary keys. Save validates bounded bytes, MIME and signature and writes a new server-only committed object. Reusing the temporary signed PUT or discarding its key cannot change the committed attachment. Existing committed corpus keys are unchanged.
