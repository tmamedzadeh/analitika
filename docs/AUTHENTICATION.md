# Authentication rollout

## Deployment order

1. Keep `DATABASE_URL_MIGRATE` and `DATABASE_URL` pointed at this project's configured PostgreSQL database.
2. Run `bun run db:migrate`. This is forward-only migration `0013_auth_users_sessions`; it adds user, session, and login-rate-limit tables and does not modify existing document or brief rows.
3. With `DATABASE_URL` still pointing at that target, run `bun run auth:create-admin` in an interactive terminal. The command asks for a username, one of the existing clearance values (`open`, `secret`, `top_secret`, `special`), and a password twice without echoing it. It refuses to bootstrap if an active administrator already exists.
4. Deploy the new application version after the migration and administrator creation succeed. Remove `DEMO_BASIC_AUTH` from runtime configuration; the application no longer reads it. Keep independent Vercel Deployment Protection settings as configured.

The CLI does not print the password, its hash, or the database URL. It uses the project's Bun scripts and `DATABASE_URL`.

## Accounts and access

Administrators create regular users in **Ayarlar → İstifadəçilər**, choose a clearance, reset passwords, and deactivate or reactivate accounts. Deactivation is a soft delete so historical document ownership remains intact. It revokes that user's sessions. The last active administrator and the current administrator cannot be deactivated through the UI.

Roles control administrative actions; clearance controls access to classified documents. Administrators have no automatic clearance override. The enforced order is `open < secret < top_secret < special`: a user can read documents at or below their clearance. The SQL predicate reads the active user's current clearance alongside each document query, so ownership, role, and stale session claims do not raise that ceiling. Document management permissions are evaluated separately.

Users change their own password in Ayarlar after entering the current password. Other sessions are revoked. Administrative password resets revoke all sessions for the target user. Login sessions expire after eight hours, use an HttpOnly SameSite=Lax cookie (Secure in production), and are stored in the database by token hash.

Document and brief attachments are streamed through authenticated application routes. Each read rechecks the session and owning record; document attachments also recheck the current clearance. The API does not return long-lived S3 download URLs.

## Migration status

Forward-only migrations through `0018_remove_retired_features_and_tags` have been applied to the configured PostgreSQL database. The Drizzle journal has 19 entries. Direct catalog verification confirmed that document request and document-user ACL tables are absent, `documents.tags` is absent, and the existing document, chunk, embedding, brief, and query-history tables remain. The current user's clearance continues to cap document access regardless of role or ownership.
