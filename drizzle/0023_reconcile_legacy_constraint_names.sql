-- Reconcile PostgreSQL's original implicit names with the current Drizzle schema.
-- Rename existing validated constraints in place; preserve data and underlying indexes.
ALTER TABLE "chunks" RENAME CONSTRAINT "chunks_document_id_fkey" TO "chunks_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "attachments_document_id_fkey" TO "attachments_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "attachments_storage_key_key" TO "attachments_storage_key_unique";
--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "attachments_size_check" TO "attachments_size_nonnegative";
--> statement-breakpoint
ALTER TABLE "eval_questions" RENAME CONSTRAINT "eval_questions_eval_set_id_fkey" TO "eval_questions_eval_set_id_eval_sets_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" RENAME CONSTRAINT "eval_results_run_id_fkey" TO "eval_results_run_id_eval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" RENAME CONSTRAINT "eval_results_question_id_fkey" TO "eval_results_question_id_eval_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_runs" RENAME CONSTRAINT "eval_runs_eval_set_id_fkey" TO "eval_runs_eval_set_id_eval_sets_id_fk";
