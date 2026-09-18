-- Enable pgvector for semantic-search embeddings (Prompt 2 domain schema).
-- Neon supports pgvector; creating the extension here keeps later
-- embedding-table migrations independent of extension setup.
CREATE EXTENSION IF NOT EXISTS "vector";
