// Informations publiques de l’entreprise, complétées par l’éditeur le 08/09/2026.
// Source de remplacement (Societe.com inaccessible) :
// https://entreprises.lefigaro.fr/monsieur-theo-birost-10/entreprise-108892993
export const legalDefaults = {
  LEGAL_PUBLISHER: 'Théo Birost — Birost Web',
  // Coordonnées et régime TVA publiés sur https://birostweb.fr/mentions-legales.html
  LEGAL_CONTACT: 'contact@theo-birost.fr',
  LEGAL_VAT: 'Non applicable, article 293 B du CGI — franchise en base de TVA',
  LEGAL_STATUS: 'Entrepreneur individuel (EI)',
  LEGAL_ADDRESS: '6 rue Georges Guynemer, 10450 Bréviandes, France',
  LEGAL_DIRECTOR: 'Théo Birost',
  LEGAL_REGISTRATION: 'SIREN 108 892 993 — SIRET 108 892 993 00016',
  LEGAL_CAPITAL: 'Non applicable — entrepreneur individuel',
  LOG_RETENTION_DAYS: '30',
};
export const legalValue = (key, fallback = '') => process.env[key] || legalDefaults[key] || fallback;
