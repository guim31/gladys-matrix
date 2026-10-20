# Matrix

Parlez à Gladys depuis [Matrix](https://matrix.org), la messagerie ouverte et décentralisée (Element,
FluffyChat, Cinny…), comme avec le robot Telegram de Gladys : posez une question, lancez une scène,
recevez les messages de Gladys. L'intégration écrit aussi dans des salons Matrix depuis vos scènes, et
lance des scènes quand un message ou une commande comme `!lumieres off` est écrit dans un salon qu'elle
surveille. Elle utilise un compte robot dédié, sur votre propre serveur (Synapse, Conduit, conduwuit,
Dendrite…) ou sur un serveur public comme matrix.org.

> **Développée sans le matériel : vos retours sont les bienvenus.** L'intégration a été testée contre un
> vrai serveur Conduit 0.10, mais pas dans un vrai Gladys ni avec tous les clients Matrix. Dites ce qui
> marche et ce qui ne marche pas dans les [issues](https://github.com/guim31/gladys-matrix/issues) ou sur
> le [forum Gladys](https://community.gladysassistant.com).

## Ce qu'il vous faut

- Gladys Assistant **5.1.0** ou plus récent.
- Un **compte Matrix dédié au robot** (par exemple `@gladys:example.org`), sur un serveur que Gladys peut
  joindre : votre serveur sur le réseau local, ou un serveur public sur Internet. N'utilisez pas votre
  compte personnel : le robot répond en son nom.
- **Des salons sans chiffrement de bout en bout.** Le robot ne lit pas les salons chiffrés (Element chiffre
  par défaut les salons privés et les messages directs : désactivez l'option à la création du salon, elle
  ne se change plus ensuite).
- L'adresse Matrix de chaque personne autorisée à parler au robot, comme `@alice:example.org`.

## Mise en place

1. Créez le compte du robot (sur matrix.org : une inscription ordinaire ; sur votre serveur : comme les
   autres comptes).
2. Dans Gladys, **Intégrations → Matrix → Configuration** :
   - **Adresse du serveur Matrix** : l'API client du serveur, par exemple `https://matrix.org` ou
     `http://192.168.1.20:8008`. Pour un serveur derrière son nom de domaine, c'est souvent `https://matrix.`
     suivi du domaine.
   - **Identifiant du robot** et **Mot de passe du robot** : le robot se connecte une fois et garde son jeton
     d'accès dans les données de l'intégration. Ou remplissez **Jeton d'accès (au lieu du mot de passe)**
     avec un jeton du compte du robot : l'identifiant et le mot de passe ne servent alors pas.
   - **Personnes autorisées** : les adresses Matrix que le robot écoute, séparées par des virgules. **Vide,
     le robot ne répond à personne** : il ignore les messages et les invitations de tous ceux qui ne sont
     pas dans cette liste.
   - **Salons surveillés** : les salons dont les messages lancent des scènes, par alias
     (`#maison:example.org`) ou par identifiant (`!abc…:example.org`, dans les paramètres du salon,
     « Avancé »), séparés par des virgules. Invitez d'abord le robot dans un salon privé : il rejoint seul
     les salons de cette liste.
   - **Préfixe des commandes** : `!` par défaut.
   - **Langue du robot** : la langue de ce que le robot écrit avant qu'une personne soit liée.
3. Cliquez sur **Tester la connexion** : le compte rendu donne le compte du robot, les salons surveillés
   rejoints et le nombre de personnes autorisées. L'état de connexion de la page le dit aussi.

### Lier votre compte Matrix pour parler à Gladys

Chaque utilisateur de Gladys qui veut parler à Gladys depuis Matrix le fait une fois :

1. Dans Matrix, créez un **salon privé sans chiffrement** et invitez-y le robot (personnes autorisées
   seulement : le robot ignore les invitations des autres). Il le rejoint aussitôt.
2. Dans Gladys, **Intégrations → Matrix → Configuration**, bloc « Lier mon compte » : cliquez sur
   **Générer un code de liaison**.
3. Envoyez le code (8 caractères) au robot dans ce salon. Le robot confirme : votre compte Matrix est lié à
   votre utilisateur Gladys. Vous pouvez le délier depuis le même bloc.

## Ce que fait le robot

- **Dans un salon privé** (tout salon où se trouve le robot et qui n'est pas un salon surveillé) : il
  transmet vos messages à Gladys, avec l'autorité de l'utilisateur Gladys lié, exactement comme le robot
  Telegram : « Quelle température fait-il au salon ? », « Éteins les lumières ». Les réponses de Gladys
  reviennent dans ce salon. Les messages que Gladys vous envoie (l'action de scène **Envoyer un message**,
  les messages système) y arrivent aussi, Markdown rendu. Si Gladys écrit à une personne liée avant toute
  conversation, le robot ouvre avec elle un salon privé non chiffré. Une image de caméra envoyée par une
  scène arrive en image.
- **Dans un salon surveillé** : chaque message d'une personne autorisée lance le déclencheur **Message
  Matrix reçu**, et un message qui commence par le préfixe lance aussi **Commande Matrix reçue**. Le robot
  n'y répond jamais de lui-même : la suite dépend de vos scènes.
- **Ce qu'il ignore** : toute personne non autorisée, ses propres messages, les modifications d'un
  message, les avis (ce qu'écrivent les autres robots), et les messages de plus de 5 minutes au moment où
  il les lit (écrits pendant que Gladys ou le robot était arrêté : un « !ouvrir garage » d'il y a deux
  heures ne s'exécute pas maintenant).
- **Dans un salon chiffré** : il ne peut pas lire le message et le dit une fois dans ce salon.

## Tableau de bord

Le widget **Matrix** montre si le robot est connecté, son compte, les salons surveillés où il se trouve,
les 5 derniers messages reçus dans les salons surveillés (auteur, texte, date) et un bouton **Tester la
connexion**. Les conversations privées avec Gladys n'y figurent jamais : tous ceux qui voient le tableau de
bord voient le widget.

## Scènes

### Déclencheurs

- **Message Matrix reçu** : une personne autorisée a écrit dans un salon surveillé. Filtres (vide =
  n'importe lequel) : **Salon** (écrit comme dans la configuration, par exemple `#maison:example.org`) et
  **Expéditeur** (`@alice:example.org`). Variables : Message, Expéditeur, Salon, Identifiant du salon.
- **Commande Matrix reçue** : une personne autorisée a écrit une commande dans un salon surveillé : le
  préfixe, puis un mot, puis d'éventuels arguments, par exemple `!lumieres off cuisine`. Filtre
  **Commande** : le mot **sans le préfixe, en minuscules** (`lumieres`) ; et Salon, Expéditeur.
  Variables : Commande (`lumieres`), Arguments (`off cuisine`), Message, Expéditeur, Salon, Identifiant du
  salon. Le même message lance aussi **Message Matrix reçu**.
- **Connexion Matrix perdue** : le robot ne joint plus le serveur Matrix, depuis une minute, ou ses
  identifiants sont refusés. Variable : Erreur. Lancé une fois, jusqu'au retour de la connexion.
- **Connexion Matrix rétablie** : le robot joint de nouveau le serveur après une perte de connexion.
  Variable : Compte du robot.

### Actions

- **Envoyer un message Matrix** : écrit un message dans un salon, par alias ou identifiant. Le message
  accepte les variables de scène et le Markdown (`**gras**`, `_italique_`, listes, liens). **Discret
  (avis, sans alerte)** envoie un avis, que les clients Matrix affichent sans alerte. Le robot doit être
  dans le salon, ou pouvoir y entrer (invité, ou salon public). Résultats : Envoyé (oui/non),
  Identifiant de l'événement, Erreur. Un message raté n'arrête pas la scène : testez **Envoyé** par une
  condition si besoin.

Pour écrire à un utilisateur de Gladys plutôt qu'à un salon, utilisez l'action **Envoyer un message** de
Gladys : elle atteint son compte Matrix lié.

### Idées de scènes

- **Garage par commande** : déclencheur **Commande Matrix reçue**, commande `garage`, salon
  `#maison:example.org` ; puis une condition sur la variable Arguments égale à `fermer`, et l'action qui
  ferme le garage.
- **Sonnette dans le salon de la famille** : déclencheur sur la sonnette, puis **Envoyer un message
  Matrix** dans `#maison:example.org` : « On a sonné à {{ heure }} », suivi de l'action du cœur qui envoie
  l'image de la caméra à un utilisateur.
- **Alerte quand le robot est coupé** : déclencheur **Connexion Matrix perdue**, puis une notification par
  un autre canal (Gotify, ntfy, SMS) avec la variable Erreur.

## Dépannage

- **« pas de serveur Matrix à cette adresse »** : l'adresse est celle de l'API client, pas la page du
  client web Element. Ouvrez `https://<adresse>/_matrix/client/versions` dans un navigateur : il doit
  répondre une liste de versions.
- **« identifiant ou mot de passe du robot refusé »** : vérifiez-les en vous connectant avec le compte du
  robot dans Element. Un compte protégé par authentification unique (SSO) seulement n'a pas de mot de
  passe : utilisez un jeton d'accès.
- **« jeton d'accès refusé »** : le jeton a été révoqué (déconnexion de cette session) ou a expiré.
  Saisissez-en un nouveau, ou l'identifiant et le mot de passe.
- **Un salon surveillé n'est pas rejoint** : l'état de la page et le test le nomment. Invitez le robot dans
  le salon (ou rendez-le public), puis enregistrez de nouveau la configuration.
- **Le robot ne me répond pas** : votre adresse Matrix est-elle dans **Personnes autorisées**, écrite
  exactement (avec le `@` et le serveur) ? Le salon est-il sans chiffrement ? Dans un salon privé, votre
  compte est-il lié (le robot vous donne alors la marche à suivre) ?
- **Une commande ne lance pas la scène** : le filtre Commande est le mot sans le préfixe, en minuscules :
  `lumieres`, pas `!Lumieres`.
- Plus de détails dans les journaux de l'intégration avec `LOG_LEVEL=debug`.

## Limites

- **Pas de chiffrement de bout en bout** : le robot ne lit et n'écrit que dans des salons non chiffrés.
  Ses messages voyagent chiffrés entre votre client, le serveur et Gladys (HTTPS), mais sont stockés
  lisibles par le serveur Matrix.
- Une personne liée à Gladys peut faire depuis Matrix tout ce que peut son utilisateur Gladys : gardez
  la liste des personnes autorisées courte, et protégez le compte du robot (mot de passe solide, jamais
  réutilisé).
- Un compte robot par Gladys. Le robot lit les messages par une écoute longue de 30 secondes : une
  commande prend effet en une seconde environ.
- Les images, fichiers et messages vocaux envoyés au robot sont ignorés ; seul le texte compte.
- Le compte du robot subit les limites de débit de son serveur : matrix.org ralentit les comptes qui
  envoient beaucoup, gardez des scènes raisonnables.
- Sans lien avec la Fondation Matrix.org. Matrix est une marque de The Matrix.org Foundation C.I.C.
