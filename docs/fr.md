# TechnoVE pour Gladys

Affiche votre borne de recharge **TechnoVE** (bornes québécoises i-Series,
s-Series) dans Gladys, par son **API locale** : sans cloud, sans compte,
directement sur votre réseau.

> **API non officielle, module jamais testé avec une vraie borne.**
> Sans lien avec TechnoVE. Il parle à l'API locale de la borne comme la bibliothèque python-technove
> (utilisée par Home Assistant). TechnoVE peut la changer sans prévenir.

## Ce que vous obtenez

Un appareil par borne avec :

| Fonctionnalité              | Contenu                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| État                        | Débranchée, Branchée en attente, En charge, défauts, hors période d'activation, tarif élevé |
| Connecteur                  | Libre, occupé, en défaut ou indisponible (catégorie « borne de recharge » de Gladys)        |
| État de charge              | En charge, véhicule branché, en pause (charge non autorisée), inactif                       |
| Puissance (estimée)         | En W : courant × tension de sortie (la borne ne donne pas la puissance)                     |
| Courant                     | En A                                                                                        |
| Tension d'entrée, de sortie | En V                                                                                        |
| Énergie de la session       | En kWh, un simple capteur                                                                   |
| Courant maximal             | En A, le réglage actuel de la borne                                                         |
| Charge autorisée            | Oui / non                                                                                   |
| Charge automatique          | Oui / non (réglée dans l'application TechnoVE)                                              |
| Partage de charge           | Oui / non, et « conflit de partage de charge » : en lecture seule                           |
| Démarrer la charge          | Bouton (commandes autorisées seulement)                                                     |
| Arrêter la charge           | Bouton (commandes autorisées seulement)                                                     |
| Régler le courant maximal   | Liste de 8 A au courant nominal de la borne (commandes autorisées seulement)                |

Lecture toutes les 30 secondes par défaut (de 10 s à 10 min, réglable).

**Énergie** : l'énergie de la session est un **simple capteur**, jamais un
index : elle n'entre pas dans l'onglet Énergie de Gladys (la borne est déjà
comptée par votre compteur principal). Aucune consommation journalière n'est
publiée.

## Installation

1. Donnez à la borne une **adresse IP fixe** dans votre box ou routeur.
2. Installez l'intégration depuis le store de Gladys.
3. Dans sa configuration, saisissez l'**adresse IP de la borne** (plusieurs
   bornes en partage de charge : séparées par des virgules, quatre au plus).
4. Enregistrez, puis ajoutez la borne depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** lit chaque borne une fois (au plus toutes
les 10 secondes). L'API locale n'a pas de mot de passe : toute machine de
votre réseau peut la lire, Gladys comprise.

## Commandes (désactivées par défaut)

« Démarrer la charge », « Arrêter la charge » et « Régler le courant
maximal » refusent toute commande tant que l'option **Autoriser les
commandes** est désactivée. Activée :

- **Démarrer** autorise la charge (le véhicule charge dès qu'il le demande) ;
  refusé si la borne signale un défaut ou un état inconnu ;
- **Arrêter** interdit la charge ;
- **Courant maximal** : de 8 A au courant nominal que la borne annonce
  (`maxStationCurrent`), en ampères entiers.

Démarrer et arrêter sont refusés quand la **charge automatique** est activée
(réglage de l'application TechnoVE) ; le courant maximal est refusé en
**partage de charge** (c'est le partage qui le fixe).

Ce sont des **boutons** et une **liste**, jamais des interrupteurs : un
« éteins tout » (depuis Gladys, Google Home, Alexa ou HomeKit) ne les touche
pas. Une scène peut les déclencher, mais seulement par une action
explicite, et seulement si les commandes sont autorisées. Attention : le
chat IA de Gladys (MCP) peut créer et lancer une telle scène : tant que les
commandes sont autorisées, il peut démarrer ou arrêter la charge.

Avant chaque commande, l'intégration **relit la borne** et décide sur cette
lecture seule ; l'option est revérifiée juste avant l'envoi. Une commande
inutile (déjà dans cet état) n'est pas envoyée. Une commande qui ne peut pas
partir dans les 3,5 secondes est refusée sans être envoyée. Si la borne ne
confirme pas (silence, erreur 5xx), Gladys affiche « Commande envoyée, sans
confirmation » : vérifiez l'état, relu 5 puis 20 secondes plus tard. Une
commande à la fois par borne : une autre est refusée tout de suite, sauf un
**arrêt**, jamais bloqué : il attend la commande en cours au plus le temps
de son échéance, puis part ; il est renvoyé une fois quand elle se termine,
et un démarrage pas encore parti s'efface devant lui.

## Erreurs et limites

- **Borne injoignable** : seuls le connecteur (« indisponible ») et l'état
  (« Borne injoignable ») changent ; la puissance, le courant, l'état de
  charge et les autres valeurs gardent leur dernière valeur (un « en
  charge » peut rester affiché : regardez l'état). Une borne retirée de la
  configuration, ou qui n'a jamais répondu depuis le démarrage, s'affiche de
  même sur son appareil, et l'écran de configuration la nomme. Nouvel essai
  après 30 s, 1, 2 puis 5 minutes, jamais plus vite que l'intervalle.
- **429 (trop de requêtes)**, peu probable sur une borne locale : pause de
  1 minute à 6 heures pour tout (lectures, bouton, commandes), jamais plus
  courte que l'intervalle de rafraîchissement, gardée dans `/data` après un
  redémarrage.
- La **puissance est estimée** (courant × tension, facteur de puissance
  supposé 1) : la borne ne la donne pas.
- Ni la planification (heures creuses / tarif élevé), ni la charge
  automatique, ni le pourcentage de charge maximal ne se changent depuis
  Gladys.
- Les journaux ne contiennent jamais le texte des réponses de la borne.

## Crédits

Portage de [python-technove](https://github.com/Moustachauve/pytechnove)
(Christophe Gagnier, MIT, version 2.1.3), dont le code de requête s'inspire
de python-wled (Franck Nijhof, MIT). Licence Apache-2.0.
