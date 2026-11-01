// Propriétés des bases : types, valeurs, filtre, tri, regroupement Kanban.
// Module pur, importé par le serveur (validation, migration des valeurs)
// comme par le navigateur (affichage, filtre, tri, confirmation avant une
// perte de valeurs). Les vues et la configuration sont dans views.ts.
// Formats jsonb : BRAINSTORMING §3-4.
//
// Point d'entrée unique : le code vit dans quatre modules, chacun ne
// dépendant que des précédents (schema, puis format, puis values, puis views).
export * from "./property_schema";
export * from "./property_format";
export * from "./property_values";
export * from "./property_views";
