ALTER TABLE documents
  ADD COLUMN chunk_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT documents_chunk_count_nonnegative CHECK (chunk_count >= 0);

UPDATE documents AS document
SET chunk_count = (
  SELECT count(*)::integer
  FROM chunks
  WHERE chunks.document_id = document.id
);

ALTER TABLE info_requests
  DROP CONSTRAINT IF EXISTS info_requests_answer_document_id_documents_id_fk;

ALTER TABLE info_requests
  DROP CONSTRAINT IF EXISTS info_requests_answer_document_id_fkey;

ALTER TABLE info_requests
  ADD CONSTRAINT info_requests_answer_document_id_documents_id_fk
  FOREIGN KEY (answer_document_id) REFERENCES documents(id) ON DELETE SET NULL;
