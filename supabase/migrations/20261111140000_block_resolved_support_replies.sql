-- Resolved support conversations are read-only for both participants.
-- Authorization remains enforced by participant-specific RLS checks.
DROP POLICY IF EXISTS customer_support_messages_insert_participants ON public.customer_support_messages;
CREATE POLICY customer_support_messages_insert_participants
ON public.customer_support_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.customer_support_tickets t
    WHERE t.id = customer_support_messages.ticket_id
      AND lower(t.status) NOT IN ('resolved', 'closed')
      AND (
        (sender_role = 'admin' AND private.has_role('admin'::app_role))
        OR (sender_role = 'customer' AND t.user_id = (SELECT auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS support_ticket_messages_insert_participants ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_insert_participants
ON public.support_ticket_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    JOIN public.seller_profiles s ON s.id = t.seller_id
    WHERE t.id = support_ticket_messages.ticket_id
      AND lower(t.status) NOT IN ('resolved', 'closed')
      AND (
        (sender_role = 'admin' AND private.has_role('admin'::app_role))
        OR (sender_role = 'seller' AND s.user_id = (SELECT auth.uid()))
      )
  )
);

CREATE INDEX IF NOT EXISTS customer_support_messages_sender_id_idx
ON public.customer_support_messages (sender_id);
