> Mise à jour du 5 octobre 2026 : retour au fonctionnement d’origine — l’utilisateur se connecte avec ses identifiants CAS de l’URCA et le serveur récupère le flux CELCAT. Le mode « import d’un fichier XML dans le navigateur » est abandonné. **Autorisation de l’université pour ce relais CAS : à confirmer avant publication.** `SESSION_SECRET` (≥ 32 caractères), `APP_ORIGIN` (HTTPS) et un `CELCAT_XML_URL` HTTPS valide sont requis en production.

# Mon emploi du temps · INSPÉ

Application **Vue 3 et JavaScript**, construite avec Vite. Un serveur Node.js / Express assure la connexion CAS à l’URCA et sert l’application et l’API sur le **port 3000**. Aucun TypeScript dans le code du projet.

## En local

Node.js 22.12 ou plus récent est nécessaire.

```sh
npm ci
# Seulement si .env.local n’existe pas encore :
cp .env.example .env.local
openssl rand -base64 32
```

Copier la clé générée dans `SESSION_SECRET` de `.env.local`, puis :

```sh
npm run dev
```

Ouvrir http://localhost:3000 et se connecter avec ses identifiants URCA. Le fichier `.env.local` existant a été conservé pendant la migration.

```sh
npm run check  # tests du calendrier / parseur / session et compilation Vue
npm run build
npm start      # production : HTTPS nécessaire pour la connexion
```

## Emploi du temps et correction des jours

CELCAT peut représenter les dates par un numéro de jour (`day`, 0 = lundi), un masque de semaines (`rawweeks`, Y/N) et des semaines de référence (`span`, date / rawix / alleventweeks). Le nouveau parseur développe chaque occurrence au lieu d’utiliser la première date d’une période comme date de tous les cours. Il accepte aussi les dates explicites françaises et ISO et les ressources imbriquées.

La vue Semaine affiche les sept jours, y compris les jours sans cours. Sur petit écran, elle défile horizontalement ; la vue Jour propose les sept boutons de sélection. Les boutons de semaine mettent également à jour le jour sélectionné. Un sélecteur de date permet de rejoindre une semaine éloignée.

## Données traitées (état réel du code)

- Identifiant et mot de passe : reçus par `POST /api/auth/login`, relayés au CAS, utilisés en mémoire le temps de la requête ; jamais écrits sur disque, dans un cookie ou dans les journaux.
- Session : cookies CAS/CELCAT chiffrés (JWE A256GCM) dans le cookie `edt_session` du navigateur, 6 h maximum ; le serveur ne garde en mémoire que `jti` + échéance (révocation à la déconnexion, à l’expiration de la session CAS ou au redémarrage).
- Planning : récupéré à la connexion et à chaque actualisation, analysé en mémoire, renvoyé au navigateur, jamais stocké côté serveur ni dans le stockage local.
- Journaux applicatifs : uniquement type d’événement, code et date pour les erreurs 5xx. Compteurs anti-abus par IP en mémoire (15 min / 1 min).

Le nombre de jours reçus est affiché près de la synchronisation. Si le résultat réel reste incomplet, ouvrir `/api/edt?debug=1` après connexion : cette route protégée renvoie le XML reçu. Ne pas publier ce fichier : il peut contenir des noms et des données de planning. Le fonctionnement avec le flux privé doit encore être confirmé avec une session URCA réelle ; les tests automatisés utilisent des exemples représentatifs.

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
4. Dans Environment, définir les variables ci-dessous. Générer une nouvelle clé pour le serveur avec `openssl rand -base64 32`.

```dotenv
NODE_ENV=production
PORT=3000
SESSION_SECRET=REMPLACER_PAR_UNE_CLE_ALEATOIRE
APP_ORIGIN=https://edt.theo-birost.fr
CELCAT_XML_URL=https://celcat.example.test/groupes/flux.xml
LOG_RETENTION_DAYS=3
```

Aucune liste d’hôtes à configurer : les hôtes autorisés sont dérivés de `CELCAT_XML_URL` (HTTPS uniquement) — l’hôte exact du flux, son domaine parent et les sous-domaines (pour `celcat.example.test` : `example.test` et `*.example.test`). Tout autre hôte, HTTP, adresse IP ou domaine parent trop large (`fr`, `com`, `co.uk`…) est refusé, ainsi que les redirections 307/308 après envoi des identifiants ; le journal indique alors « hôte de redirection non autorisé : <hôte> ».

5. Dans Domains, ajouter `edt.theo-birost.fr`, **Container Port 3000**, et activer HTTPS. Le DNS de ce domaine doit pointer vers le serveur Dokploy.
6. Lancer Deploy. Le conteneur compile Vue, démarre Express et expose `/api/health` pour le contrôle de santé. Aucune base de données ni volume n’est nécessaire.
7. Activer Auto Deploy pour redéployer les prochains push GitHub. La CI fournit une vérification supplémentaire ; Auto Deploy n’attend pas nécessairement sa réussite.

Le secret est une variable d’exécution, jamais un argument de build ni une variable `VITE_*`. Le serveur refuse de démarrer en production avec un secret absent ou trop court. La session dure six heures : cookies CELCAT chiffrés, cookie httpOnly, Secure en production et SameSite strict. Le mot de passe n’est pas enregistré.

Documentation officielle : [Applications Dokploy](https://docs.dokploy.com/docs/core/applications), [Domaines Dokploy](https://docs.dokploy.com/docs/core/domains).

### Docker en local

```sh
docker compose --env-file .env.local up --build
```

Le conteneur utilise le mode production : le test de connexion nécessite un accès HTTPS via un proxy. Pour travailler en HTTP local, utiliser `npm run dev`.

### Diagnostic

- **Un seul jour reçu** : vérifier le nombre de jours affiché et le XML authentifié. Si le flux source ne publie qu’une journée, le client ne peut pas inventer les suivantes.
- **Erreur 502** : vérifier que le serveur peut joindre le CAS et CELCAT ; une structure XML non reconnue peut aussi demander un ajustement du parseur.
- **Connexion perdue immédiatement** : vérifier HTTPS, le secret et la taille du cookie de session.
- **Le serveur ne démarre pas** : vérifier Node 22.12+ et `SESSION_SECRET` en production.

## Corrections de préparation à la production

- Login limité à **5 requêtes par 15 minutes par IP**, actualisation à 30/minute. Réponse HTTP 429 avec délai de réessai.
- Sessions : registre serveur en mémoire (identifiant `jti` du JWE). La déconnexion révoque immédiatement le jeton, même copié ; un redémarrage ou un changement de `SESSION_SECRET` invalide toutes les sessions (reconnexion demandée).
- Fournisseur : redirections suivies manuellement et validées (HTTPS + hôtes autorisés), 307/308 après envoi des identifiants refusés, réponses amont plafonnées (`CELCAT_MAX_BYTES`, 5 Mo par défaut), occurrences plafonnées (`CELCAT_MAX_COURSES`), entités XML personnalisées refusées.
- Les limiteurs et le registre de sessions sont en mémoire : utiliser **une seule réplique**. Pour plusieurs répliques, prévoir un stockage partagé (Redis) avant d’augmenter ce nombre. Un redémarrage remet les compteurs à zéro.
- Ajouter `APP_ORIGIN=https://edt.theo-birost.fr` dans Dokploy. Les POST d’une autre origine ou sans en-tête `Origin` sont refusés en production, le cookie reste Secure et les en-têtes de sécurité sont activés.
- `TRUSTED_PROXIES` doit contenir uniquement les IP/CIDR effectivement utilisés par Traefik. Vide = les en-têtes d’IP transmis ne sont pas utilisés (limitation partagée derrière le proxy). Ne jamais définir une confiance globale. Ne pas exposer directement le port 3000 sur Internet ; router par le domaine Dokploy (le Compose publie le port sur `127.0.0.1` seulement, conteneur en lecture seule, capacités retirées, journaux Docker bornés à 3 × 10 Mo).
- `/api/edt?debug=1` est disponible uniquement en développement, après connexion. En production, ce paramètre renvoie le JSON normal.
- Erreurs client génériques, diagnostic serveur minimal sans données de session, expiration des appels CELCAT après 30 secondes, arrêt propre avec limite de dix secondes.
- Polices incluses dans le build, sans Google Fonts externe. Le formulaire passe en premier sur mobile.
- `/mentions-legales`, `/confidentialite` et vraie 404 HTTP en production. Les champs juridiques incomplets sont volontairement visibles en local : **les compléter avant publication**.

### Pages légales à compléter

Les variables `LEGAL_*` de `.env.example` alimentent les pages à l’exécution. Compléter la dénomination et forme juridique, l’adresse, le contact public, l’immatriculation, la TVA et le capital si applicables, et le directeur de publication. Vérifier la base légale retenue pour ce service et la région réelle du VPS. `LOG_RETENTION_DAYS` (défaut du code : 30 ; exemple : 3) sert uniquement à afficher la durée dans la politique de confidentialité : l’application n’écrit aucun fichier de journal et ne purge rien. La rotation/suppression des journaux d’infrastructure (Traefik, Dokploy, Docker) se configure séparément et n’est pas garantie par cette variable.

### Recette Dokploy à faire au moment de publier

1. Construire l’image via la CI ou `docker build -t edt:test .`.
2. Paramétrer le domaine HTTPS (port interne 3000), APP_ORIGIN, SESSION_SECRET et le proxy de confiance.
3. Vérifier A/AAAA et le certificat, puis HTTP → HTTPS depuis un autre réseau.
4. Vérifier le healthcheck `/api/health` et la Restart Policy dans Advanced. Le `restart` du fichier Compose ne s’applique pas à une application Dokploy déployée par Dockerfile.
5. Tester la connexion réelle, les horaires contre le XML source, la reconnexion, la 404 et un redémarrage. Aucun mot de passe de test ne doit être committé.
6. Lancer Lighthouse sur la version déployée et sur l’agenda après connexion. Le site est volontairement non indexable : le SEO n’est pas un objectif de score.

Les tests API utilisent un faux service CELCAT local : ils valident les mécanismes HTTP, **pas les horaires universitaires réels**. `npm run check` construit puis lance tous les tests ; `npm test` seul suppose que le dossier `dist` a déjà été construit.

### Résultats locaux de préparation

La page de connexion du build production a obtenu **100 en performance, 100 en accessibilité et 96 en bonnes pratiques** avec Lighthouse mobile. Cette mesure locale ne couvre ni le réseau du VPS ni l’agenda après authentification réelle. Le script `scripts/lighthouse-local.js` reproduit la mesure avec un Chrome installé (`CHROME_PATH` si nécessaire) et écrit le rapport dans le dossier temporaire système.

Le questionnaire complet à remplir avant publication se trouve dans `QUESTIONNAIRE-PUBLICATION.md`.

### Images et affichage mobile

Les variantes WebP sont générées avec `npm run images:optimize` depuis `assets/source/forest.png`. Les fichiers de `src/assets` doivent être versionnés : Vite les nomme avec une empreinte et le serveur leur applique un cache public d’un an. Les réponses privées de l’API restent sans cache et sans compression. La bannière mobile pèse environ 29 Ko, contre 2,99 Mo pour la source.

Sur téléphone, l’agenda ouvre la journée et la vue semaine empile les jours. Vérifications locales effectuées à 320, 390, 430 et 1280 pixels, avec un planning fictif. `node scripts/mobile-preview.js` sert ce planning uniquement pour les contrôles locaux ; ce script ne fait pas partie du conteneur de production.
