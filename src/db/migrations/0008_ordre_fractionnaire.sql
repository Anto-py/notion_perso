-- manual_order devient une clé d'ordre fractionnaire (lib/order_key.ts), triée
-- octet par octet (COLLATE "C" : la collation de la base mêlerait majuscules
-- et minuscules). Générée puis réécrite à la main : chaque rang entier n prend
-- la clé de keyFromIndex(n), dont sync_order_key est la traduction exacte ;
-- l'ordre existant est donc conservé, égalités comprises.
CREATE FUNCTION sync_order_key(n integer) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  width integer := 1;
  span numeric := 62;
  rest numeric := n;
  result text := '';
BEGIN
  IF n < 0 THEN
    RAISE EXCEPTION 'manual_order négatif : %', n;
  END IF;
  WHILE rest >= span LOOP
    rest := rest - span;
    width := width + 1;
    span := span * 62;
  END LOOP;
  FOR i IN 1..width LOOP
    result := substr(digits, (rest % 62)::integer + 1, 1) || result;
    rest := floor(rest / 62);
  END LOOP;
  RETURN chr(ascii('a') + width - 1) || result;
END
$$;
--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "manual_order" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "manual_order" SET DATA TYPE text COLLATE "C" USING sync_order_key("manual_order");
--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "manual_order" SET DEFAULT 'a0';
--> statement-breakpoint
DROP FUNCTION sync_order_key(integer);
