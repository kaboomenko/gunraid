import type { DbOrTx } from '@gunraid/db';
import type { CargoMismatchDto } from '@gunraid/shared';
import { sql } from 'drizzle-orm';

/**
 * Сверка грузов с ledger (D39). LedgerService.reconcile() сверяет только кошельки с записями и не видит
 * места без списания, списание не того игрока или возврат не того раунда — это ловят шесть проверок ниже:
 *
 * 1. `purchase_ledger` — у платной покупки нет своей записи `cargo_entry` на −paid того же игрока и раунда;
 * 2. `entry_orphan` — запись `cargo_entry`, на которую не ссылается ни одна покупка (списание без мест);
 * 3. `refund_sum` — по (раунд, игрок) сумма `cargo_refund` ≠ сумме оплаты у раунда с возвратом и ≠ 0 у прочих;
 * 4. `refunded_at` — отметка возврата у покупки не совпадает с «раунд с возвратом и paid > 0»;
 * 5. `seats` — покупки раунда идут не подряд с места 1 или не покрывают ровно seats_sold мест;
 * 6. `price` — оплата покупки ≠ цена места раунда × мест (недоплата, бесплатные места в платном раунде: с ledger
 *    такая покупка согласована, проверки 1–5 её не видят). Цена места раунда — снимок, после открытия не меняется.
 *
 * «Раунд с возвратом» (D1) — `cancelled` или `expired` с проданными местами (минимум продаж, D36).
 * Одним запросом: зовут CargoService, часовая сверка воркера (MaintenanceService) и тесты.
 */
export async function reconcileCargo(db: DbOrTx, limit = 100): Promise<CargoMismatchDto[]> {
  const res = await db.execute(sql`
    with refund_rounds as (
      select id from cargo_rounds
      where status = 'cancelled' or (status = 'expired' and seats_sold > 0)
    ),
    expected as (
      select p.round_id::text as round_id, p.user_id, sum(p.paid) as total
      from cargo_purchases p
      where p.paid > 0 and p.round_id in (select id from refund_rounds)
      group by p.round_id, p.user_id
    ),
    actual as (
      select le.ref_id as round_id, le.user_id, sum(le.amount) as total
      from ledger_entries le
      where le.type = 'cargo_refund'
      group by le.ref_id, le.user_id
    ),
    seat_gaps as (
      select distinct s.round_id
      from (
        select p.round_id, p.seat_from,
               lag(p.seat_to) over (partition by p.round_id order by p.seat_from) as prev_to
        from cargo_purchases p
      ) s
      where s.seat_from <> coalesce(s.prev_to, 0) + 1
    )
    select * from (
      select 'purchase_ledger' as "check", p.round_id::text as "roundId",
             p.user_id::text as "userId", p.id::text as "ref"
      from cargo_purchases p
      left join ledger_entries le on le.id = p.ledger_entry_id
      where p.paid > 0 and (
        le.id is null
        or le.type <> 'cargo_entry'
        or le.amount <> -p.paid
        or le.user_id <> p.user_id
        or le.ref_type <> 'cargo_purchase'
        or le.ref_id is distinct from p.id::text
        or le.meta->>'roundId' is distinct from p.round_id::text
      )
      union all
      select 'entry_orphan', le.meta->>'roundId', le.user_id::text, le.id::text
      from ledger_entries le
      where le.type = 'cargo_entry'
        and not exists (select 1 from cargo_purchases p where p.ledger_entry_id = le.id)
      union all
      select 'refund_sum', coalesce(e.round_id, a.round_id), coalesce(e.user_id, a.user_id)::text, null
      from expected e
      full join actual a on a.round_id = e.round_id and a.user_id = e.user_id
      where coalesce(a.total, 0) <> coalesce(e.total, 0)
      union all
      select 'refunded_at', p.round_id::text, p.user_id::text, p.id::text
      from cargo_purchases p
      where (p.refunded_at is not null)
         <> (p.paid > 0 and p.round_id in (select id from refund_rounds))
      union all
      select 'seats', r.id::text, null, null
      from cargo_rounds r
      left join (
        select round_id, max(seat_to) as max_to from cargo_purchases group by round_id
      ) m on m.round_id = r.id
      where coalesce(m.max_to, 0) <> r.seats_sold or r.id in (select round_id from seat_gaps)
      union all
      select 'price', p.round_id::text, p.user_id::text, p.id::text
      from cargo_purchases p
      join cargo_rounds r on r.id = p.round_id
      where p.paid <> r.seat_price * p.count
    ) x
    limit ${limit}
  `);
  return res.rows as unknown as CargoMismatchDto[];
}
