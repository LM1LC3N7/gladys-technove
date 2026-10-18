// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature and status names, the status
// of the integration, the answers of the button and the command errors.
// -----------------------------------------------------------------------------

import { FEATURES, STATUS } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('TechnoVE station', 'Borne TechnoVE');

export const FEATURE_NAMES = {
  [FEATURES.STATUS]: both('Status', 'État'),
  [FEATURES.CONNECTOR]: both('Connector', 'Connecteur'),
  [FEATURES.CHARGING_STATE]: both('Charging state', 'État de charge'),
  [FEATURES.POWER]: both('Power (estimated)', 'Puissance (estimée)'),
  [FEATURES.CURRENT]: both('Current', 'Courant'),
  [FEATURES.VOLTAGE_IN]: both('Input voltage', "Tension d'entrée"),
  [FEATURES.VOLTAGE_OUT]: both('Output voltage', 'Tension de sortie'),
  [FEATURES.SESSION_ENERGY]: both('Energy of the session', 'Énergie de la session'),
  [FEATURES.MAX_CURRENT]: both('Maximum current', 'Courant maximal'),
  [FEATURES.CHARGING_ENABLED]: both('Charging allowed', 'Charge autorisée'),
  [FEATURES.AUTO_CHARGE]: both('Automatic charging', 'Charge automatique'),
  [FEATURES.SHARING_MODE]: both('Load sharing', 'Partage de charge'),
  [FEATURES.SHARING_CONFLICT]: both('Load sharing conflict', 'Conflit de partage de charge'),
  [FEATURES.START]: both('Start charging', 'Démarrer la charge'),
  [FEATURES.STOP]: both('Stop charging', 'Arrêter la charge'),
  [FEATURES.SET_MAX_CURRENT]: both('Set the maximum current', 'Régler le courant maximal'),
};

export const STATUS_NAMES = {
  [STATUS.UNPLUGGED]: both('Unplugged', 'Débranchée'),
  [STATUS.PLUGGED_WAITING]: both('Plugged in, waiting', 'Branchée, en attente'),
  [STATUS.PLUGGED_CHARGING]: both('Charging', 'En charge'),
  [STATUS.VENTILATION_REQUIRED]: both(
    'Charging (ventilation required)',
    'En charge (ventilation requise)',
  ),
  [STATUS.PILOT_FAULT]: both('Pilot fault', 'Défaut du pilote'),
  [STATUS.EVSE_FAULT]: both('Station fault', 'Défaut de la borne'),
  [STATUS.GROUND_FAULT]: both('Ground fault', 'Défaut de terre'),
  [STATUS.OUT_OF_ACTIVATION_PERIOD]: both(
    'Outside the activation period',
    "Hors période d'activation",
  ),
  [STATUS.HIGH_TARIFF_PERIOD]: both('High-tariff period', 'Période de tarif élevé'),
  [STATUS.UNKNOWN]: both('Unknown state', 'État inconnu'),
  [STATUS.OFFLINE]: both('Station unreachable', 'Borne injoignable'),
};

/** The integration status, the button and the logs a user may read. */
export const T = {
  noAddress: both(
    'Enter the IP address of your TechnoVE station, then save.',
    "Saisissez l'adresse IP de votre borne TechnoVE, puis enregistrez.",
  ),
  invalid: (entries) =>
    both(
      `Address not understood, ignored: ${entries.join(', ')}.`,
      `Adresse non comprise, ignorée : ${entries.join(', ')}.`,
    ),
  connecting: both('Reading the station…', 'Lecture de la borne…'),
  connected: (summary) => both(`Connected. ${summary.en}`, `Connecté. ${summary.fr}`),
  unreachable: (list, wait) =>
    both(
      `No answer from ${list} (next try in ${wait.en}). Check the address and that the station is on the network.`,
      `Pas de réponse de ${list} (nouvel essai dans ${wait.fr}). Vérifiez l'adresse et que la borne est sur le réseau.`,
    ),
  rateLimited: (wait) =>
    both(
      `The station asks to slow down (HTTP 429): pause of ${wait.en}.`,
      `La borne demande de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  noId: both(
    'The station answered without a valid MAC address: it cannot be added.',
    'La borne a répondu sans adresse MAC valable : elle ne peut pas être ajoutée.',
  ),
  test: {
    cooldown: both('Tested less than 10 s ago.', 'Testé il y a moins de 10 s.'),
    busy: both(
      'A read is in progress, try again in a moment.',
      'Une lecture est en cours, réessayez dans un instant.',
    ),
  },
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: both(
    'Commands are disabled: turn on "Allow the commands" in the configuration of the integration.',
    "Les commandes sont désactivées : activez « Autoriser les commandes » dans la configuration de l'intégration.",
  ),
  unknownStation: both(
    'This station is not read by the integration (address missing or not answering).',
    "Cette borne n'est pas lue par l'intégration (adresse absente ou sans réponse).",
  ),
  otherStation: both(
    'Another station answers at this address now: command refused, not sent.',
    'Une autre borne répond maintenant à cette adresse : commande refusée, non envoyée.',
  ),
  badButton: both('A button only accepts the value 1.', "Un bouton n'accepte que la valeur 1."),
  badCurrent: both(
    'The maximum current must be a whole number of amperes.',
    "Le courant maximal doit être un nombre entier d'ampères.",
  ),
  outOfBounds: (min, max) =>
    both(
      `The maximum current must be between ${min} and ${max} A for this station: not sent.`,
      `Le courant maximal doit être entre ${min} et ${max} A pour cette borne : non envoyé.`,
    ),
  unknownBounds: both(
    'The station did not give its rated current: command refused, not sent.',
    "La borne n'a pas donné son courant nominal : commande refusée, non envoyée.",
  ),
  paused: (wait) =>
    both(
      `The station asked to slow down: commands paused for ${wait.en}.`,
      `La borne a demandé de ralentir : commandes en pause pendant ${wait.fr}.`,
    ),
  stillRunning: both(
    'Another command of this station is still running: not sent.',
    'Une autre commande de cette borne est encore en cours : non envoyée.',
  ),
  tooSlow: both(
    'The station answered too slowly to send the command in time: not sent.',
    'La borne a répondu trop lentement pour envoyer la commande à temps : non envoyée.',
  ),
  unknownState: (reason) =>
    both(
      `The state of the station could not be read just before (${reason}): command not sent.`,
      `L'état de la borne n'a pas pu être relu juste avant (${reason}) : commande non envoyée.`,
    ),
  missing: both(
    'The station did not give the state this command needs: not sent.',
    "La borne n'a pas donné l'état dont cette commande a besoin : non envoyée.",
  ),
  autoCharge: both(
    'Automatic charging is on: starting and stopping are refused (turn it off in the TechnoVE app). Not sent.',
    "La charge automatique est activée : démarrer et arrêter sont refusés (désactivez-la dans l'application TechnoVE). Non envoyée.",
  ),
  fault: (status) =>
    both(
      `The station reports "${status.en}": charging is not started. Not sent.`,
      `La borne signale « ${status.fr} » : la charge n'est pas démarrée. Non envoyée.`,
    ),
  unknownStatus: both(
    'The state of the station is unknown: charging is not started. Not sent.',
    "L'état de la borne est inconnu : la charge n'est pas démarrée. Non envoyée.",
  ),
  sharingMode: both(
    'Load sharing is on: the maximum current is set by the sharing, not here. Not sent.',
    'Le partage de charge est activé : le courant maximal est fixé par le partage, pas ici. Non envoyé.',
  ),
  notSent: (reason) =>
    both(
      `The station could not be reached (${reason}): command not sent.`,
      `La borne n'a pas pu être jointe (${reason}) : commande non envoyée.`,
    ),
  refused: (reason) =>
    both(
      `The station refused the command (${reason}).`,
      `La borne a refusé la commande (${reason}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the state of the station in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez l'état de la borne dans quelques secondes.`,
    ),
};

/** The one-line summary of a station: "TechnoVE 3a4f: Charging, 7200 W, maximum 32 A". */
export function summaryOf({ name, status, power, maxCurrent }) {
  const parts = [STATUS_NAMES[status] ?? STATUS_NAMES[STATUS.UNKNOWN]];
  const en = [parts[0].en];
  const fr = [parts[0].fr];
  if (power !== undefined) {
    en.push(`${power} W`);
    fr.push(`${power} W`);
  }
  if (maxCurrent !== undefined) {
    en.push(`maximum ${maxCurrent} A`);
    fr.push(`maximum ${maxCurrent} A`);
  }
  return both(`${name}: ${en.join(', ')}.`, `${name} : ${fr.join(', ')}.`);
}
