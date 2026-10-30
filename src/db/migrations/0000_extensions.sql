-- Recherche accent-insensible. Doit précéder la table pages : sa colonne
-- générée search_vector appelle f_unaccent dès sa création.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
-- unaccent() est STABLE (il dépend du dictionnaire chargé), donc refusé dans
-- une colonne générée. Ce wrapper fige le dictionnaire et se déclare IMMUTABLE.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
