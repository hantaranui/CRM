# CRM Grist Widget

Widget CRM minimal pour Grist.

## Installation dans Grist

1. Publier ce dossier sur GitHub Pages, Vercel ou un autre hebergeur statique.
2. Dans Grist, ajouter un widget `Custom`.
3. Coller l'URL publique du `index.html`.
4. Choisir `Full document access`.

Au premier lancement, le widget cree automatiquement les tables `CRM_*`.

## Fonctionnalites V1

- fiche client/prospect ;
- pipeline Kanban ;
- dashboard de chiffres cles ;
- historique ;
- taches ouvertes ;
- interlocuteurs ;
- page Parametres ;
- ajout d'etapes Kanban ;
- ajout de membres d'equipe.

## Tables creees

- `CRM_Organisations`
- `CRM_Contacts`
- `CRM_Taches`
- `CRM_Interactions`
- `CRM_Etapes`
- `CRM_Priorites`
- `CRM_Referents`
- `CRM_Notifications`
- `CRM_Config`

## Important

Le widget peut fonctionner en apercu local avec des donnees de demonstration, mais il ne lit/ecrit dans Grist que lorsqu'il est ouvert comme widget Grist.
