import { XMLParser, XMLValidator } from "fast-xml-parser";
/**
 * IMPORTANT — à lire avant de modifier ce fichier :
 *
 * Le format exact du flux XML "CELCAT Web Publisher" varie légèrement d'une
 * installation à l'autre. On ne peut pas le connaître avec certitude sans
 * avoir un vrai export sous les yeux (on ne peut pas tester avec de vrais
 * identifiants dans cet environnement).
 *
 * Ce parseur est donc volontairement TOLÉRANT : il essaie plusieurs noms de
 * champs connus pour chaque information (matière, salle, horaires...), aussi
 * bien au format "champs plats" (<matiere>...</matiere>) qu'au format
 * "ressources catégorisées" (<resources><item category="Module">...</item>)
 * qui est le plus courant chez CELCAT.
 *
 * → Si après un premier test réel certains champs sont vides ou mal
 * mappés, ajoute simplement le bon nom de balise dans les tableaux
 * `FIELD_ALIASES` ci-dessous. Utilise `GET /api/edt?debug=1` (voir route.ts)
 * pour voir le JSON brut renvoyé par le parseur XML et repérer les bons noms.
 */
const FIELD_ALIASES = {
    date: ["date", "startdate", "jour"],
    start: ["starttime", "start_time", "heuredebut", "debut"],
    end: ["endtime", "end_time", "heurefin", "fin"],
    subject: ["module", "matiere", "matière", "subject", "modulename"],
    type: ["category", "type", "eventcategory", "typecours"],
    group: ["studentgroup", "student_group", "groupe", "group"],
    room: ["room", "salle", "location"],
    staff: ["staff", "personnel", "prof", "enseignant"],
    team: ["team", "equipe", "équipe", "studentset"],
    notes: ["notes", "remarque", "remarques", "comment", "description"],
};
// Catégories possibles pour le format "resources > item[@category]"
const RESOURCE_CATEGORY_MAP = {
    module: "subject",
    modules: "subject",
    room: "room",
    rooms: "room",
    salle: "room",
    salles: "room",
    staff: "staff",
    personnel: "staff",
    "student group": "group",
    "student groups": "group",
    "student set": "team",
    "student sets": "team",
    category: "type",
};
function normalizeKey(key) {
    return key.toLowerCase().replace(/[^a-z]/g, "");
}
function findField(event, field) {
    const aliases = FIELD_ALIASES[field].map(normalizeKey);
    for (const key of Object.keys(event)) {
        if (aliases.includes(normalizeKey(key))) {
            const value = event[key];
            if (typeof value === "string")
                return value.trim();
            if (typeof value === "object" && value?.["#text"])
                return String(value["#text"]).trim();
        }
    }
    return undefined;
}
// Balises directes possibles sous <resources> dans le format CELCAT réel :
// <resources><module title="Matière"><item>...</item></module><room>...</room>...
const RESOURCE_TAG_MAP = {
    module: "subject",
    modules: "subject",
    matiere: "subject",
    room: "room",
    rooms: "room",
    salle: "room",
    salles: "room",
    staff: "staff",
    personnel: "staff",
    group: "group",
    groups: "group",
    groupe: "group",
    studentgroup: "group",
    studentgroups: "group",
    team: "team",
    teams: "team",
    equipe: "team",
    equipes: "team",
    studentset: "team",
    studentsets: "team",
};
function textOf(node) {
    if (node == null)
        return "";
    if (typeof node === "string")
        return node.trim();
    if (typeof node === "object") {
        if (typeof node["#text"] === "string")
            return node["#text"].trim();
        if (typeof node["@_text"] === "string")
            return node["@_text"].trim();
    }
    return String(node).trim();
}
function collectFromResources(event, log) {
    const result = {};
    const resources = event.resources ?? event.Resources;
    if (!resources) {
        log("  ⚠️  Pas de <resources> trouvé sur cet event.");
        return result;
    }
    // --- Format A : <resources><item category="...">valeur</item></resources> ---
    const items = resources.item ?? resources.Item ?? resources.resource ?? [];
    const itemList = Array.isArray(items) ? items : items ? [items] : [];
    for (const item of itemList) {
        if (!item)
            continue;
        const category = (item["@_category"] ?? item.category ?? "").toString().toLowerCase();
        const mapped = RESOURCE_CATEGORY_MAP[category];
        if (!mapped)
            continue;
        const text = textOf(item);
        if (!text)
            continue;
        (result[mapped] ??= []).push(text);
    }
    // --- Format B (celui du flux URCA) : <resources><module>...<item>x</item></module></resources> ---
    for (const [tagName, tagValue] of Object.entries(resources)) {
        if (tagName === "item" || tagName === "Item" || tagName === "resource")
            continue;
        if (tagName.startsWith("@_"))
            continue; // attribut, pas une sous-balise
        const mapped = RESOURCE_TAG_MAP[normalizeKey(tagName)];
        if (!mapped) {
            log(`  ⚠️  Balise <resources><${tagName}> inconnue, non mappée. Ajoute-la dans RESOURCE_TAG_MAP si utile.`);
            continue;
        }
        const container = tagValue;
        const innerItems = container?.item ?? container?.Item ?? container;
        const innerList = Array.isArray(innerItems) ? innerItems : innerItems ? [innerItems] : [];
        for (const inner of innerList) {
            const text = textOf(inner);
            if (!text)
                continue;
            (result[mapped] ??= []).push(text);
        }
    }
    return result;
}
function splitMulti(value) {
    if (!value)
        return [];
    return value
        .split(/;|,\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}
/** Convertit "07/09/2026" ou "2026-09-07" en "2026-09-07". */
function normalizeDate(raw) {
    if (!raw)
        return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw))
        return raw.slice(0, 10);
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
        const [, day, month, year] = match;
        return `${year}-${month}-${day}`;
    }
    return "";
}
function normalizeTime(raw) {
    if (!raw)
        return "";
    return /^(?:[01]\d|2[0-3]):[0-5]\d/.test(raw) ? raw.slice(0, 5) : ""; // "08:00:00" -> "08:00"
}
// Garde-fous contre un flux amont hostile ou anormal.
export const MAX_COURSES = Number((typeof process !== 'undefined' ? process.env?.CELCAT_MAX_COURSES : null) || 20000);
export function parseCelcatXml(xml) {
    const log = () => {};
    // Aucune déclaration d’entité personnalisée (expansion / XXE) n’est acceptée.
    if (typeof xml !== "string" || /<!ENTITY/i.test(xml)) throw new Error("Le flux CELCAT est invalide.");
    log("Longueur du XML reçu :", xml.length, "caractères");
    log("Premiers 300 caractères :", xml.slice(0, 300));
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        trimValues: true,
        parseTagValue: false,
    });
    let parsed;
    try {
        if (XMLValidator.validate(xml) !== true) throw new Error("XML invalide");
        parsed = parser.parse(xml);
    }
    catch (err) {
        log("❌ Échec du parsing XML :", err);
        throw new Error("Le flux CELCAT est invalide.");
    }
    log("Clés à la racine du document parsé :", Object.keys(parsed));
    // Le nœud racine peut s'appeler "timetable" (format URCA), "agenda", "calendar", "events"...
    const root = parsed.timetable ?? parsed.Timetable ?? parsed.agenda ?? parsed.calendar ?? parsed.events ?? parsed;
    if (root === parsed) {
        log("⚠️  Aucune balise racine connue (timetable/agenda/calendar/events) n'a été trouvée. " +
            "Racine utilisée = document entier, ce qui est probablement une erreur.");
    }
    else {
        log("✅ Racine détectée, clés disponibles dedans :", Object.keys(root));
    }
    let rawEvents = root.event ?? root.Event ?? [];
    if (!Array.isArray(rawEvents))
        rawEvents = rawEvents ? [rawEvents] : [];
    log(`Nombre d'<event> trouvés avant filtrage : ${rawEvents.length}`);
    if (rawEvents.length === 0) {
        log("❌ Aucun event trouvé. Vérifie que le XML contient bien des balises <event> " +
            "sous la racine détectée ci-dessus (regarde les clés loggées juste avant).");
    }
    else {
        log("Exemple du premier <event> brut (clés) :", Object.keys(rawEvents[0]));
    }
    rawEvents = expandEvents(rawEvents, root);
    if (rawEvents.length > MAX_COURSES) throw new Error("Le flux CELCAT contient trop d’événements.");
    const courses = rawEvents.filter(Boolean).map((event, index) => {
        const fromResources = collectFromResources(event, log);
        const subject = findField(event, "subject") ?? fromResources.subject?.[0] ?? "Cours";
        const type = findField(event, "type") ?? fromResources.type?.[0];
        const group = findField(event, "group") ?? fromResources.group?.join(", ");
        const rooms = fromResources.room ?? splitMulti(findField(event, "room"));
        const staff = fromResources.staff ?? splitMulti(findField(event, "staff"));
        const teams = fromResources.team ?? splitMulti(findField(event, "team"));
        const notes = findField(event, "notes");
        const course = {
            id: event["@_id"] ?? `evt-${index}`,
            date: normalizeDate(findField(event, "date")),
            start: normalizeTime(findField(event, "start")),
            end: normalizeTime(findField(event, "end")),
            subject,
            type,
            group,
            rooms,
            staff,
            teams,
            notes,
        };
        if (index < 3) {
            log(`Event #${index} mappé :`, JSON.stringify(course));
        }
        return course;
    });
    const filtered = courses.filter((c) => c.date && c.start);
    const dropped = courses.length - filtered.length;
    if (dropped > 0) {
        log(`⚠️  ${dropped} event(s) écarté(s) car "date" ou "start" est vide après normalisation. ` +
            `Vérifie les alias dans FIELD_ALIASES.date / .start si ça semble anormal.`);
    }
    const sorted = filtered.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    log(`✅ Résultat final : ${sorted.length} cours prêts à être renvoyés.`);
    if (sorted.length > 0) {
        log("Premier cours :", JSON.stringify(sorted[0]));
        log("Dernier cours :", JSON.stringify(sorted[sorted.length - 1]));
    }
    return sorted;
}

// CELCAT stocke les occurrences dans rawweeks (Y/N), et day vaut 0 pour lundi.
function expandEvents(events, root) {
    const spans = [];
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        for (const [key,value] of Object.entries(node)) {
            if (key.toLowerCase() === 'span') spans.push(...(Array.isArray(value) ? value : [value]));
            else if (key.toLowerCase() !== 'event') {
                for (const child of Array.isArray(value) ? value : [value]) visit(child);
            }
        }
    }
    visit(root);
    const weeks = new Map();
    for (const span of spans) {
        const date = normalizeDate(span['@_date']);
        const mask = String(span.alleventweeks || '');
        const indexes = [...mask].flatMap((v,i) => v === 'Y' ? [i] : []);
        if (!date || !indexes.length) continue;
        // Les spans multi-semaines ont une date de début et plusieurs bits actifs.
        const firstIndex = Number(span['@_rawix']) - 1;
        const startIndex = Number.isInteger(firstIndex) && firstIndex >= 0 ? firstIndex : indexes[0];
        for (const index of indexes) weeks.set(index, addDays(date, (index - startIndex) * 7));
    }
    let total = 0;
    return events.flatMap((event,index) => {
        if (++total > MAX_COURSES) throw new Error('Le flux CELCAT contient trop d’événements.');
        const day = Number(event.day);
        const mask = String(event.rawweeks || '');
        const dates = [];
        if (mask && Number.isInteger(day) && day >= 0 && day <= 6) {
            const anchor = weeks.entries().next().value;
            if (anchor) for (let i=0;i<mask.length;i++) if (mask[i] === 'Y') {
                if (++total > MAX_COURSES) throw new Error('Le flux CELCAT contient trop d’événements.');
                dates.push(addDays(anchor[1], (i-anchor[0])*7+day));
            }
            if (!dates.length && mask.includes('Y')) throw new Error('Semaines CELCAT non reconnues. Vérifie le XML de diagnostic.');
        } else {
            const date = normalizeDate(findField(event,'date'));
            if (date) dates.push(date);
        }
        return [...new Set(dates)].map(date => ({...event,date,'@_date':date,'@_id':`${event['@_id'] ?? index}-${date}`}));
    });
}
function addDays(iso, count) {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate()+count);
    return date.toISOString().slice(0,10);
}
