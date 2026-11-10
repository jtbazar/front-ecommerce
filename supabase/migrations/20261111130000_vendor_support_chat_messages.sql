-- Threaded two-way chat for vendor support tickets.
CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('seller','admin')),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_ticket_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.support_ticket_messages TO authenticated;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;

CREATE POLICY support_ticket_messages_read_participants
ON public.support_ticket_messages FOR SELECT TO authenticated
USING (
  public.current_user_is_admin()
  OR EXISTS (
    SELECT 1 FROM public.support_tickets t
    JOIN public.seller_profiles s ON s.id = t.seller_id
    WHERE t.id = support_ticket_messages.ticket_id
      AND s.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY support_ticket_messages_insert_participants
ON public.support_ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND (
    (sender_role = 'admin' AND public.current_user_is_admin())
    OR (
      sender_role = 'seller'
      AND EXISTS (
        SELECT 1 FROM public.support_tickets t
        JOIN public.seller_profiles s ON s.id = t.seller_id
        WHERE t.id = support_ticket_messages.ticket_id
          AND s.user_id = (SELECT auth.uid())
      )
    )
  )
);

CREATE INDEX support_ticket_messages_ticket_created_idx
ON public.support_ticket_messages(ticket_id, created_at ASC);

CREATE OR REPLACE FUNCTION private.touch_support_ticket_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.support_tickets SET updated_at = now() WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.touch_support_ticket_from_message() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER support_ticket_message_touch_ticket
AFTER INSERT ON public.support_ticket_messages
FOR EACH ROW EXECUTE FUNCTION private.touch_support_ticket_from_message();
