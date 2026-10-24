<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo.svg">
    <img src="assets/brand/logo-dark.svg" alt="AgentQL" width="420">
  </picture>
</p>

# AgentQL

[![CI](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml)
[![Release](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml/badge.svg)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/OpenSkye-Labs/agentQL?label=version&color=blue)](https://github.com/OpenSkye-Labs/agentQL/releases/latest)

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.de.md">Deutsch</a> · Français
</p>

<p align="center"><sub>Cette traduction peut avoir du retard sur le README anglais ; la version anglaise fait foi.</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="Démonstration d'AgentQL : parcourir une table, diagramme ER, exécuter une requête, demander un graphique à l'agent, approuver ou refuser une écriture, tableau de bord" width="960">
  <br>
  <sub>Démonstration sur le jeu de données de démo intégré : navigation, diagramme ER, requête, demande d'un graphique à l'agent, écriture soumise à votre approbation, tableau de bord.</sub>
</p>

Un client de bases de données natif et multiplateforme, avec un agent intégré. Pensez TablePlus / DBeaver, plus un
assistant capable de lire votre schéma, d'exécuter des requêtes, d'optimiser du SQL et de construire des tableaux de
bord — avec **votre** clé d'API Claude ou OpenAI, ou votre abonnement **Claude Code** / **Codex (ChatGPT)** existant.

Construit avec Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) et React 19 + TypeScript.

## Bases de données

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

Connexion par hôte/identifiants ou par URL, avec SSL (require / verify-ca / verify-full, certificats client) et via un
tunnel SSH (agent, fichier de clé ou mot de passe). Les mots de passe sont stockés dans le trousseau du système.

## Points forts

- **Éditeur de requêtes** — CodeMirror avec coloration adaptée au dialecte et complétion à partir du schéma.
  `Ctrl/⌘+Enter` exécute l'instruction sous le curseur ; les scripts multi-instructions renvoient un résultat par
  instruction ; EXPLAIN / EXPLAIN ANALYZE.
- **Grille** — virtualisée, navigable au clavier, inspecteur de cellule, copie en TSV/JSON, export CSV/JSON/SQL.
- **Navigateur de tables** — filtre (WHERE), tri, pagination, modifications en ligne transformées en SQL relisible
  et appliqué en une seule transaction ; vue structure avec index, clés étrangères et DDL.
- **Redis** — navigateur de clés basé sur SCAN avec visionneuses typées, TTL et une console. **MongoDB** —
  find/aggregate, vue JSON ou tableau, édition/insertion/suppression de documents, informations sur les collections.
- **Assistant** — diffuse ses réponses en streaming, appelle des outils (schéma, run_sql, explain, graphiques),
  demande votre approbation avant toute écriture, affiche les graphiques directement dans la conversation et propose
  des tableaux de bord complets que vous pouvez enregistrer et rafraîchir automatiquement.
- **Sécurité** — les connexions en lecture seule et les lectures de l'agent sont imposées _par la base de données_
  (transactions READ ONLY / `PRAGMA query_only`), pas seulement par analyse du texte SQL.

## À quoi ça ressemble

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="Grille virtualisée parcourant une table de commandes de 182 k lignes"><br><sub><b>Grille</b> · virtualisée, pilotée au clavier, les modifications en ligne deviennent du SQL relisible, navigation par clic sur les clés étrangères, badges d'environnement.</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="Diagramme ER du schéma public"><br><sub><b>Diagramme ER</b> · mis en page automatiquement à partir du catalogue en direct ; cliquez sur une table pour l'ouvrir, export SVG/PNG. Diff de schéma avec copie en migration juste à côté.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="Éditeur SQL avec complétion tenant compte des alias et résultats"><br><sub><b>Éditeur</b> · complétion tenant compte des alias, suggestions de JOIN à partir des clés étrangères, exécution de l'instruction sous le curseur, EXPLAIN, raccourcis vim, extraits, versions des requêtes enregistrées.</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="Assistant inspectant le schéma, exécutant du SQL et renvoyant un graphique"><br><sub><b>Agent</b> · inspecte le schéma, écrit et exécute du SQL, explique le résultat et renvoie un graphique que vous pouvez épingler à un tableau de bord. Chaque étape est visible.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="L'agent demandant une approbation avant d'exécuter un UPDATE"><br><sub><b>Les écritures exigent votre approbation</b> · les lectures s'exécutent dans un contexte en lecture seule imposé par la base de données (transactions READ ONLY sur Postgres et MySQL, <code>PRAGMA query_only</code> sur SQLite) ; une écriture s'arrête sur une carte d'approbation affichant l'instruction exacte.</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="Tableau de bord avec quatre graphiques dont un ajouté par l'agent"><br><sub><b>Tableaux de bord</b> · graphiques issus de vos requêtes ou de celles de l'agent, rafraîchissement automatique, et l'agent peut proposer un tableau de bord complet.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Navigateur de clés Redis avec le thème Dracula"><br><sub><b>Redis et MongoDB aussi</b> · navigateur de clés basé sur SCAN avec console, find/aggregate Mongo et édition de documents. Dix thèmes, Dracula illustré ici ; le mode « suivre le système » fonctionne sous Linux, macOS et Windows.</sub></td>
  </tr>
</table>

### À quel point est-ce agentique ?

L'assistant est un agent qui utilise des outils, pas une zone de texte qui colle du SQL. À chaque tour, il peut lister
les tables, décrire les colonnes et les clés étrangères, exécuter du SQL en lecture seule, expliquer un plan, créer un
graphique, proposer un tableau de bord, parcourir Redis ou interroger MongoDB, et il montre chaque étape avec la
requête exécutée et les lignes obtenues. Les garde-fous sont imposés en dessous du modèle, pas dans le prompt : les
lectures s'exécutent dans un contexte en lecture seule imposé par la base de données (transactions `READ ONLY` sur
Postgres et MySQL, `PRAGMA query_only` sur SQLite), les écritures s'arrêtent sur une carte d'approbation avec
l'instruction exacte, chaque connexion peut restreindre les schémas et tables visibles par l'agent, et chaque
instruction SQL qu'il exécute est consignée dans l'historique de requêtes habituel avec l'étiquette `agent`. Il
fonctionne avec votre clé Anthropic ou OpenAI, n'importe quel point de terminaison compatible OpenAI comme Ollama, ou
votre abonnement Claude Code ou Codex CLI existant via un point de terminaison MCP local.

## Installation

Téléchargez l'installeur pour votre plateforme depuis la [dernière version](https://github.com/OpenSkye-Labs/agentQL/releases/latest) :
macOS (Apple Silicon et Intel), Windows et Linux (`.deb`, `.rpm`, `.AppImage`). L'application vérifie les mises à
jour au démarrage et les installe sur place.

## Compiler depuis les sources

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Sous Linux, il faut les prérequis habituels de Tauri (webkit2gtk 4.1, gtk3, libssl). Voir `docs/TESTING.md` pour les
conteneurs de bases de données jetables et les tests des pilotes en conditions réelles.

## Fournisseurs d'IA

Paramètres → Fournisseurs d'IA. Ajoutez un ou plusieurs des éléments suivants :

- API Anthropic (clé), API OpenAI (clé), tout point de terminaison compatible OpenAI (Ollama, OpenRouter, Groq, …)
- Claude Code CLI ou Codex CLI — réutilise la session dont vous disposez déjà ; l'application expose ses outils de
  base de données au CLI via un point de terminaison MCP local protégé par jeton, de sorte que les approbations et les
  cartes d'outils fonctionnent de la même manière.

Les écritures de l'agent sont désactivées par défaut ; une fois activées, chaque instruction exige toujours une
approbation dans la conversation.

## Contribuer

Les pull requests sont les bienvenues. [CONTRIBUTING.md](CONTRIBUTING.md) décrit les branches, les vérifications et
la manière dont les versions sont publiées.

## Politique de signature du code

Les builds de release sont produits uniquement par le [workflow de release](.github/workflows/release.yml) public de
ce dépôt. Les installeurs Windows doivent être signés via [SignPath.io](https://signpath.io) avec un certificat de la
[SignPath Foundation](https://signpath.org) (demande en cours). Les artefacts de mise à jour sont en outre signés avec
la clé minisign du projet, et l'application vérifie cette signature avant d'installer une mise à jour.

- Committers et relecteurs : [@aindong](https://github.com/aindong)
- Approbateurs : [@aindong](https://github.com/aindong)

## Politique de confidentialité

AgentQL ne transmet aucune information à d'autres systèmes en réseau, sauf à la demande expresse de l'utilisateur ou
de la personne qui l'installe ou l'exploite. En pratique, il se connecte à :

- les bases de données et hôtes SSH que vous ajoutez comme connexions, lorsque vous les utilisez ;
- le fournisseur d'IA que vous configurez (Anthropic, OpenAI, un point de terminaison compatible OpenAI, ou votre
  Claude Code / Codex CLI local), uniquement lorsque vous envoyez un message à l'assistant ;
- `github.com`, une fois au démarrage, pour vérifier si une version plus récente existe.

Aucune télémétrie, aucune donnée d'analyse ni aucun rapport de plantage n'est envoyé. Les identifiants sont stockés
dans le trousseau du système ou, à défaut, dans un fichier local du répertoire de données de l'application.

## Licence

[MIT](LICENSE).

## Documentation

`CLAUDE.md` (guide du dépôt) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
