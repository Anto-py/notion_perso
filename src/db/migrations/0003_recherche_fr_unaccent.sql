-- Extraits surlignés de la recherche. search_vector est calculé sur un texte
-- déjà sans accents ; ts_headline, lui, relit le texte d'origine. Avec la
-- configuration french, « Évaluation » n'y retrouve pas la racine « evalu »
-- et rien n'est surligné. fr_unaccent ôte les accents avant de raciner, et
-- retombe donc sur les mêmes racines que search_vector.
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION fr_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;
