-- Include all delivered COD orders in the reconciliation queue, including those where the driver has not yet entered a cash amount.
create or replace function public.admin_list_driver_cash_reconciliation()
returns table(assignment_id uuid,order_id uuid,order_number text,customer_name text,driver_user_id uuid,driver_name text,
  payment_method text,order_total numeric,collected_amount numeric,reconciled_amount numeric,reconciled_at timestamptz,
  reconciliation_note text,delivered_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select a.id,o.id,o.order_number::text,o.customer_name::text,a.driver_user_id,coalesce(d.full_name::text,'Driver'),
   o.payment_method::text,o.total,a.cod_collected_amount,a.cash_reconciled_amount,a.cash_reconciled_at,
   a.cash_reconciliation_note,a.delivered_at
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 left join public.driver_applications d on d.user_id=a.driver_user_id
 where a.status='delivered' and o.payment_method='cod'::public.payment_method
 order by (a.cash_reconciled_at is null) desc,a.delivered_at desc limit 500;
end;
$$;

create or replace function public.admin_get_driver_delivery_proof_path(p_assignment_id uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_path text;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 select delivery_proof_path into v_path from public.driver_assignments where id=p_assignment_id;
 return v_path;
end;
$$;
revoke all on function public.admin_get_driver_delivery_proof_path(uuid) from public,anon;
grant execute on function public.admin_get_driver_delivery_proof_path(uuid) to authenticated;