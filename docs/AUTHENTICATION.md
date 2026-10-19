# Authentication rollout

## Deployment order

1. Point `DATABASE_URL_MIGRATE` at the intended PostgreSQL database and `DATABASE_URL` at the same application database. Confirm those targets before running the migration command.
2. Run `bun run db:migrate`. This is forward-only migration `0013_auth_users_sessions`; it adds user, session, and login-rate-limit tables and does not modify existing document or brief rows.
3. With `DATABASE_URL` still pointing at that target, run `bun run auth:create-admin` in an interactive terminal. The command asks for a username, one of the existing clearance values (`open`, `secret`, `top_secret`, `special`), and a password twice without echoing it. It refuses to bootstrap if an active administrator already exists.
4. Deploy the new application version after the migration and administrator creation succeed. Remove `DEMO_BASIC_AUTH` from runtime configuration; the application no longer reads it. Keep independent Vercel Deployment Protection settings as configured.

The CLI does not print the password, its hash, or the database URL. It uses the project's Bun scripts and `DATABASE_URL`; do not run it against an unverified target.

## Accounts and access

Administrators create regular users in **Ayarlar → İstifadəçilər**, choose a clearance, reset passwords, and deactivate or reactivate accounts. Deactivation is a soft delete so historical document/request ownership remains intact. It revokes that user's sessions. The last active administrator and the current administrator cannot be deactivated through the UI.

Roles control administrative actions; clearance controls access to classified documents. Administrators have no automatic clearance override. Because the existing code contained classification values but no documented hierarchy, document access currently allows `open` plus the exact assigned clearance. It does not infer that one classified value includes another. Define and review the classification policy before changing this rule.

Users change their own password in Ayarlar after entering the current password. Other sessions are revoked. Administrative password resets revoke all sessions for the target user. Login sessions expire after eight hours, use an HttpOnly SameSite=Lax cookie (Secure in production), and are stored in the database by token hash.

Document, request, and brief attachments are streamed through authenticated application routes. Each read rechecks the session and owning record; document attachments also recheck the current clearance. The API does not return long-lived S3 download URLs.

## Migration status

Forward-only migration 0013_auth_users_sessions has been applied to the configured PostgreSQL database. Verification found the auth tables, 14 Drizzle journal entries, and one active administrator. DATABASE_URL and DATABASE_URL_MIGRATE resolve to the same database and PostgreSQL cluster. Existing document and brief rows were preserved; requests with the legacy requester_id = admin remain visible to an active administrator. The first administrator has been created; the configured application can proceed to deployment.
