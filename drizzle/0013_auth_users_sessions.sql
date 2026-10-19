CREATE TYPE "user_role" AS ENUM ('admin', 'user');
--> statement-breakpoint
CREATE TABLE "app_users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" "user_role" DEFAULT 'user' NOT NULL,
  "clearance" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "app_users_username_check" CHECK (
    username = lower(btrim(username)) AND char_length(username) BETWEEN 1 AND 50
  ),
  CONSTRAINT "app_users_clearance_check" CHECK (
    clearance IN ('open', 'secret', 'top_secret', 'special')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_username_unique_idx" ON "app_users" USING btree ("username");
--> statement-breakpoint
CREATE INDEX "app_users_role_active_idx" ON "app_users" USING btree ("role", "active");
--> statement-breakpoint
CREATE TABLE "app_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "app_sessions_user_id_app_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_unique_idx" ON "app_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "app_sessions_user_idx" ON "app_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "auth_login_attempts" (
  "key" text PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "auth_login_attempts_nonnegative_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX "auth_login_attempts_window_idx" ON "auth_login_attempts" USING btree ("window_start");
