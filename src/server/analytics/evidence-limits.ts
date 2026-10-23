export const EVIDENCE_CHUNK_LIMIT = 20;
// Previous baseline: 10 x 1,800-character chunks plus formatted metadata.
// Short chunks can use more slots without doubling the generation input.
export const EVIDENCE_CONTEXT_CHAR_LIMIT = 22_000;
export const EVIDENCE_CONTEXT_BYTE_LIMIT = 44_000;
