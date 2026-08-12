-- Append-only enforcement for audit_log (FR-GOV-004, design.md §10.2).
--
-- Hand-written because Drizzle cannot express triggers. The hash chain detects
-- tampering after the fact; this trigger prevents it in the first place. Both
-- are required: the chain alone would let a determined actor rewrite history
-- and recompute every downstream hash.

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted % on seq %)',
    TG_OP, COALESCE(OLD.seq, -1);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_no_update ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_no_update
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_immutable();
--> statement-breakpoint

-- Truncate bypasses row-level triggers entirely, so it needs its own guard.
DROP TRIGGER IF EXISTS audit_no_truncate ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_no_truncate
BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
