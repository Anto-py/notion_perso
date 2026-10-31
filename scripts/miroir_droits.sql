-- Rôle de la consultation du miroir (scripts/miroir_consulter.sh) : lit tout,
-- n'écrit que ses sessions. Purge de la corbeille et nettoyage des médias
-- échouent donc sans rien effacer, ni en base ni sur le disque (la ligne media
-- part avant le fichier). Rejoué après chaque restauration par miroir.sh : une
-- base restaurée sans ACL ne porte aucun droit.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'notion_miroir_lecteur') THEN
    CREATE ROLE notion_miroir_lecteur LOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO notion_miroir_lecteur;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO notion_miroir_lecteur;
GRANT INSERT, UPDATE, DELETE ON sessions TO notion_miroir_lecteur;
