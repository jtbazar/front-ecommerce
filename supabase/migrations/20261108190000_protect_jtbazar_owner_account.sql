-- Permanently protect the JTBazar owner account from suspension and deletion.
CREATE OR REPLACE FUNCTION public.prevent_jtbazar_owner_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.id = '74f4ccd5-04b0-485e-b776-eab4c2ca1371'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'The JTBazar owner account cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_jtbazar_owner_auth_delete ON auth.users;
CREATE TRIGGER protect_jtbazar_owner_auth_delete
BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_jtbazar_owner_delete();

CREATE OR REPLACE FUNCTION public.prevent_jtbazar_owner_suspension()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id = '74f4ccd5-04b0-485e-b776-eab4c2ca1371'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'The JTBazar owner account cannot be suspended.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_jtbazar_owner_suspension ON public.account_suspensions;
CREATE TRIGGER protect_jtbazar_owner_suspension
BEFORE INSERT OR UPDATE ON public.account_suspensions
FOR EACH ROW EXECUTE FUNCTION public.prevent_jtbazar_owner_suspension();
