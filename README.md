> Mise à jour du 4 octobre 2026 : le relais CAS/CELCAT est supprimé faute d’autorisation universitaire démontrée. L’application importe désormais un export XML CELCAT uniquement dans le navigateur, sans identifiant universitaire ni envoi du fichier au serveur. Aucun `SESSION_SECRET`, `CAS_ALLOWED_HOSTS` ou `CELCAT_XML_URL` n’est nécessaire ; `/api/auth/*` et `/api/edt` répondent 410. Ne pas réactiver ce relais sans accord documenté de l’université.

# Mon emploi du temps · INSPÉ

Application **Vue 3 et JavaScript**, construite avec Vite. Un serveur Node.js / Express sert l’application statique, les pages légales et `/api/health` sur le **port 3000** ; le planning XML est importé et analysé dans le navigateur. Aucun TypeScript dans le code du projet.

## En local

Node.js 22.12 ou plus récent est nécessaire.

```sh
npm ci
# Seulement si .env.local n’existe pas encore :
cp .env.example .env.local
npm run dev
```

Ouvrir http://localhost:3000 et importer un export XML CELCAT (2 Mo maximum). Le fichier n’est pas envoyé au serveur.

```sh
npm run check  # tests du calendrier / parseur / HTTP et compilation Vue
npm run build
npm start      # production : APP_ORIGIN en HTTPS requis
```

## Emploi du temps et correction des jours

CELCAT peut représenter les dates par un numéro de jour (`day`, 0 = lundi), un masque de semaines (`rawweeks`, Y/N) et des semaines de référence (`span`, date / rawix / alleventweeks). Le nouveau parseur développe chaque occurrence au lieu d’utiliser la première date d’une période comme date de tous les cours. Il accepte aussi les dates explicites françaises et ISO et les ressources imbriquées.

La vue Semaine affiche les sept jours, y compris les jours sans cours. Sur petit écran, elle défile horizontalement ; la vue Jour propose les sept boutons de sélection. Les boutons de semaine mettent également à jour le jour sélectionné. Un sélecteur de date permet de rejoindre une semaine éloignée.

Le nombre de jours reçus est affiché près de la synchronisation. Si le résultat réel reste incomplet, examiner localement le fichier XML importé. Ne pas publier ce fichier : il peut contenir des noms et des données de planning. Le fonctionnement avec un export réel doit encore être confirmé ; les tests automatisés utilisent des exemples représentatifs.

## GitHub : créer le dépôt

Créer un dépôt vide sur https://github.com/new (sans README généré), puis depuis ce dossier :

```sh
git init -b main
git add .
git commit -m "Migration Vue JavaScript et calendrier CELCAT"
git remote add origin https://github.com/TON-COMPTE/TON-DEPOT.git
git push -u origin main
```

Remplacer l’URL par celle du dépôt. `.env.local`, tous les autres secrets `.env*`, les dépendances et les dossiers de compilation sont exclus ; `.env.example` reste versionné. La CI GitHub lance les tests, la compilation et la construction Docker.

## Dokploy : première application

1. Connecter GitHub dans Dokploy, puis créer un projet et une **Application**.
2. Choisir GitHub comme source, sélectionner le dépôt et la branche `main`, avec le chemin de construction `/`.
3. Choisir **Dockerfile** comme type de build, fichier `Dockerfile` à la racine.
4. Dans Environment, définir les variables ci-dessous (aucun secret n’est nécessaire). Supprimer les anciennes variables `SESSION_SECRET`, `CAS_ALLOWED_HOSTS`, `CELCAT_XML_URL` et `CELCAT_MAX_BYTES` si elles existent.

```dotenv
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://edt.theo-birost.fr
```

5. Dans Domains, ajouter `edt.theo-birost.fr`, **Container Port 3000**, et activer HTTPS. Le DNS de ce domaine doit pointer vers le serveur Dokploy.
6. Lancer Deploy. Le conteneur compile Vue, démarre Express et expose `/api/health` pour le contrôle de santé. Aucune base de données ni volume n’est nécessaire.
7. Activer Auto Deploy pour redéployer les prochains push GitHub. La CI fournit une vérification supplémentaire ; Auto Deploy n’attend pas nécessairement sa réussite.

Aucune session, aucun cookie applicatif et aucun mot de passe : le planning reste en mémoire dans l’onglet.

Documentation officielle : [Applications Dokploy](https://docs.dokploy.com/docs/core/applications), [Domaines Dokploy](https://docs.dokploy.com/docs/core/domains).

### Docker en local

```sh
docker compose --env-file .env.local up --build
```

Le conteneur utilise le mode production (APP_ORIGIN HTTPS requis). Pour travailler en HTTP local, utiliser `npm run dev`.

### Diagnostic

- **Un seul jour reçu** : vérifier le nombre de jours affiché et le XML importé. Si l’export ne contient qu’une journée, le client ne peut pas inventer les suivantes.
- **Fichier refusé** : export de plus de 2 Mo, XML invalide, entités personnalisées ou plus de 20000 occurrences ; une structure non reconnue peut demander un ajustement du parseur.
- **Le serveur ne démarre pas** : vérifier Node 22.12+ et `APP_ORIGIN` en HTTPS en production.

## Corrections de préparation à la production

- Import local : fichier limité à 2 Mo, validé par `fast-xml-parser`, entités XML personnalisées refusées, occurrences plafonnées à 20000, affichage par interpolation Vue (aucun `innerHTML`) ; champs enseignants, équipes et notes retirés.
- Relais CAS/CELCAT supprimé : `/api/auth/*` et `/api/edt` répondent 410 sans cookie.
- Ajouter `APP_ORIGIN=https://edt.theo-birost.fr` dans Dokploy. Les POST d’une autre origine ou sans en-tête `Origin` sont refusés en production et les en-têtes de sécurité sont activés.
- `TRUSTED_PROXIES` doit contenir uniquement les IP/CIDR effectivement utilisés par Traefik. Vide = les en-têtes d’IP transmis ne sont pas utilisés (limitation partagée derrière le proxy). Ne jamais définir une confiance globale. Ne pas exposer directement le port 3000 sur Internet ; router par le domaine Dokploy (le Compose publie le port sur `127.0.0.1` seulement, conteneur en lecture seule, capacités retirées, journaux Docker bornés à 3 × 10 Mo).
- Erreurs client génériques, diagnostic serveur minimal, arrêt propre avec limite de dix secondes.
- Polices incluses dans le build, sans Google Fonts externe. Le formulaire passe en premier sur mobile.
- `/mentions-legales`, `/confidentialite` et vraie 404 HTTP en production. Les champs juridiques incomplets sont volontairement visibles en local : **les compléter avant publication**.

### Pages légales à compléter

Les variables `LEGAL_*` de `.env.example` alimentent les pages à l’exécution. Compléter la dénomination et forme juridique, l’adresse, le contact public, l’immatriculation, la TVA et le capital si applicables, et le directeur de publication. Vérifier la base légale retenue pour ce service et la région réelle du VPS. `LOG_RETENTION_DAYS` est une déclaration : configurer aussi la rotation et la suppression effectives des journaux dans l’infrastructure.

### Recette Dokploy à faire au moment de publier

1. Construire l’image via la CI ou `docker build -t edt:test .`.
2. Paramétrer le domaine HTTPS (port interne 3000), APP_ORIGIN et le proxy de confiance.
3. Vérifier A/AAAA et le certificat, puis HTTP → HTTPS depuis un autre réseau.
4. Vérifier le healthcheck `/api/health` et la Restart Policy dans Advanced. Le `restart` du fichier Compose ne s’applique pas à une application Dokploy déployée par Dockerfile.
5. Tester l’import d’un export réel, les horaires contre le XML source, la 404 et un redémarrage. Aucun export réel ne doit être committé.
6. Lancer Lighthouse sur la version déployée et sur l’agenda après import. Le site est volontairement non indexable : le SEO n’est pas un objectif de score.

Les tests valident le parseur sur des exemples et les mécanismes HTTP, **pas les horaires universitaires réels**. `npm run check` construit puis lance tous les tests ; `npm test` seul suppose que le dossier `dist` a déjà été construit.

### Résultats locaux de préparation

La page de connexion du build production a obtenu **100 en performance, 100 en accessibilité et 96 en bonnes pratiques** avec Lighthouse mobile. Cette mesure date de l’ancienne page de connexion CAS ; elle est à refaire avec l’écran d’import. Le script `scripts/lighthouse-local.js` reproduit la mesure avec un Chrome installé (`CHROME_PATH` si nécessaire) et écrit le rapport dans le dossier temporaire système.

Le questionnaire complet à remplir avant publication se trouve dans `QUESTIONNAIRE-PUBLICATION.md`.

### Images et affichage mobile

Les variantes WebP sont générées avec `npm run images:optimize` depuis `assets/source/forest.png`. Les fichiers de `src/assets` doivent être versionnés : Vite les nomme avec une empreinte et le serveur leur applique un cache public d’un an. Les réponses privées de l’API restent sans cache et sans compression. La bannière mobile pèse environ 29 Ko, contre 2,99 Mo pour la source.

Sur téléphone, l’agenda ouvre la journée et la vue semaine empile les jours. Vérifications locales effectuées à 320, 390, 430 et 1280 pixels, avec un planning fictif.
