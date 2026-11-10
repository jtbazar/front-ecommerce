-- Extend owner protection to Auth-level ban/soft-delete paths and preserve
-- at least one verified MFA factor for the owner. The existing user_roles
-- trigger already prevents owner admin-role removal.
CREATE OR REPLACE FUNCTION private.protect_jtbazar_owner_auth_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_owner_id uuid := '74f4ccd5-04b0-485e-b776-eab4c2ca1371'::uuid;
BEGIN
  IF TG_TABLE_SCHEMA = 'auth' AND TG_TABLE_NAME = 'users' THEN
    IF OLD.id = v_owner_id
       AND (
         (NEW.banned_until IS NOT NULL AND NEW.banned_until IS DISTINCT FROM OLD.banned_until)
         OR (NEW.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
       ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',
        MESSAGE='The JTBazar owner account cannot be banned or soft-deleted.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_SCHEMA = 'auth' AND TG_TABLE_NAME = 'mfa_factors' THEN
    IF OLD.user_id = v_owner_id
       AND OLD.status::text = 'verified'
       AND (
         TG_OP = 'DELETE'
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.status::text IS DISTINCT FROM 'verified'
       )
       AND NOT EXISTS (
         SELECT 1 FROM auth.mfa_factors AS f
         WHERE f.user_id = v_owner_id
           AND f.id <> OLD.id
           AND f.status::text = 'verified'
       ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',
        MESSAGE='The JTBazar owner must retain at least one verified MFA factor. Add another factor before removing this one.';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.protect_jtbazar_owner_auth_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_jtbazar_owner_auth_ban ON auth.users;
CREATE TRIGGER protect_jtbazar_owner_auth_ban
BEFORE UPDATE OF banned_until, deleted_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.protect_jtbazar_owner_auth_identity();

DROP TRIGGER IF EXISTS protect_jtbazar_owner_last_mfa_factor ON auth.mfa_factors;
CREATE TRIGGER protect_jtbazar_owner_last_mfa_factor
BEFORE DELETE OR UPDATE OF user_id, status ON auth.mfa_factors
FOR EACH ROW
EXECUTE FUNCTION private.protect_jtbazar_owner_auth_identity();
