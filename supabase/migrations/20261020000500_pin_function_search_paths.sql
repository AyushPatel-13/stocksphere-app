-- StockSphere · Pin search_path on helper functions
--
-- Supabase's security advisor (lint 0011, function_search_path_mutable)
-- flagged the two helper functions from 20261019000100_profiles.sql. Neither
-- reads a table — one compares a name to a fixed list, the other sets
-- updated_at := now() — so an empty search_path changes no behaviour and
-- removes any chance of a caller's search_path redirecting them.
--
-- Applied to the StockSphere project on 2026-10-20. Safe to re-run.

alter function public.is_reserved_username(text) set search_path = '';
alter function public.touch_updated_at() set search_path = '';
