-- Notify every administrator when a vendor transitions an order to ready for pickup.
-- The notification audience trigger classifies "New order ..." notifications as admin,
-- keeping this event in the admin inbox even when an account has multiple roles.

BEGIN;

CREATE OR REPLACE FUNCTION private.notify_admins_vendor_pickup_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admin_user_id uuid;
  order_number_value text;
  shop_name_value text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'ready_for_pickup'
     OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT o.order_number
    INTO order_number_value
  FROM public.orders AS o
  WHERE o.id = NEW.order_id;

  SELECT s.shop_name
    INTO shop_name_value
  FROM public.seller_profiles AS s
  WHERE s.id = NEW.seller_id;

  FOR admin_user_id IN
    SELECT ur.user_id
    FROM public.user_roles AS ur
    WHERE ur.role = 'admin'::public.app_role
  LOOP
    INSERT INTO public.notifications (
      user_id,
      kind,
      title,
      body,
      related_order_id
    )
    VALUES (
      admin_user_id,
      'order'::public.notification_kind,
      'New order ' || COALESCE(order_number_value, NEW.order_id::text) || ' ready for pickup',
      COALESCE(shop_name_value, 'A vendor') || ' marked the order ready for pickup. Please arrange collection.',
      NEW.order_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_admins_vendor_pickup_ready()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vendor_pickup_ready_admin_notification
  ON public.vendor_order_pickups;

CREATE TRIGGER vendor_pickup_ready_admin_notification
  AFTER UPDATE OF status ON public.vendor_order_pickups
  FOR EACH ROW
  WHEN (NEW.status = 'ready_for_pickup' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_admins_vendor_pickup_ready();

COMMIT;
