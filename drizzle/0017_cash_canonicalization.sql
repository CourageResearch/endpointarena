insert into "market_actors" ("id", "actor_type", "user_id", "display_name", "created_at", "updated_at")
select
  md5("users"."id" || ':human:' || clock_timestamp()::text || random()::text),
  'human',
  "users"."id",
  nullif(btrim("users"."name"), ''),
  now(),
  now()
from "users"
left join "market_actors"
  on "market_actors"."user_id" = "users"."id"
where "market_actors"."id" is null;
--> statement-breakpoint

update "market_actors"
set
  "display_name" = nullif(btrim("users"."name"), ''),
  "updated_at" = now()
from "users"
where "market_actors"."actor_type" = 'human'
  and "market_actors"."user_id" = "users"."id"
  and ("market_actors"."display_name" is null or btrim("market_actors"."display_name") = '')
  and nullif(btrim("users"."name"), '') is not null;
--> statement-breakpoint

insert into "market_accounts" ("id", "actor_id", "starting_cash", "cash_balance", "created_at", "updated_at")
select
  md5("market_actors"."id" || ':account:' || clock_timestamp()::text || random()::text),
  "market_actors"."id",
  case
    when "users"."tweet_verified_at" is not null then 10::real
    else 5::real
  end,
  case
    when "users"."tweet_verified_at" is not null then 10::real
    else 5::real
  end,
  now(),
  now()
from "market_actors"
join "users"
  on "users"."id" = "market_actors"."user_id"
left join "market_accounts"
  on "market_accounts"."actor_id" = "market_actors"."id"
where "market_actors"."actor_type" = 'human'
  and "market_accounts"."id" is null;
--> statement-breakpoint

with preserved_human_actors as (
  select distinct "market_actions"."actor_id"
  from "market_actions"
  where "market_actions"."action_source" = 'human'
    and "market_actions"."status" = 'ok'

  union

  select distinct "market_positions"."actor_id"
  from "market_positions"
  join "prediction_markets"
    on "prediction_markets"."id" = "market_positions"."market_id"
  where "prediction_markets"."status" = 'OPEN'
    and ("market_positions"."yes_shares" > 0 or "market_positions"."no_shares" > 0)
)
update "market_accounts"
set
  "starting_cash" = case
    when "users"."tweet_verified_at" is not null then 10::real
    else 5::real
  end,
  "cash_balance" = case
    when "users"."tweet_verified_at" is not null then 10::real
    else 5::real
  end,
  "updated_at" = now()
from "market_actors"
join "users"
  on "users"."id" = "market_actors"."user_id"
left join preserved_human_actors
  on preserved_human_actors."actor_id" = "market_actors"."id"
where "market_accounts"."actor_id" = "market_actors"."id"
  and "market_actors"."actor_type" = 'human'
  and preserved_human_actors."actor_id" is null;
--> statement-breakpoint

alter table "users" drop constraint if exists "users_points_balance_check";
--> statement-breakpoint

alter table "users" drop column if exists "points_balance";
--> statement-breakpoint

alter table "users" drop column if exists "last_points_refill_at";
