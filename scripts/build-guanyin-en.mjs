// Assemble checked-in editorial translations and a controlled terminology
// table. No model, network connection, or API key is used by this build step.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const source = await read("sticks/guanyin.json");
const editorial = await read("sticks/guanyin.en.editorial.json");
const glossary = await read("sticks/guanyin.en.glossary.json");
const domains = ["career", "marriage", "wealth", "health", "family", "travel"];
const levels = { "上吉": "Upper auspicious", "中平": "Middle balanced", "中凶": "Middle inauspicious" };

// These entries contain continuous modern prose rather than the terse formulae
// used elsewhere in the Chinese edition, so they have individual translations.
const prose = {
  76: {
    xianji: "The image is fish and dragons before transformation. Maintain your position and wait; when the time comes, substantial accomplishment is envisaged. Household: peace, with relatives arriving slowly. Marriage: a short delay is favored; a son is indicated in the traditional text. Career: stable, requiring steadiness. Wealth: obtainable with time. Travel: retain existing arrangements. Illness: impediments call for rest and care.",
    topics: ["Personal circumstances are stable; proceed steadily. Litigation may be prolonged: wait rather than forcing an early conclusion.", "Allow the marriage bond time; do not hurry its formation. When circumstances align it forms naturally. Prayers for protection are recommended in the traditional text.", "Resources may be obtained, but await the opportunity. Postpone transactions rather than forcing completion. Ancestral graves are associated with growing prosperity.", "Illness meets some obstruction. Rest, recuperate, and avoid mental strain.", "The household is peaceful and its affairs proceed smoothly. News from relatives is somewhat delayed. Farming matures late but brings a harvest; livestock benefit in the later period.", "Arrival comes after a delay. Maintain the existing arrangement rather than undertaking distant travel or relocation."]
  },
  84: {
    xianji: "The image is a fish out of water in the cold; avoid rash movement. Household disputes may arise: cultivate character. Marriage involves doubts about what is real; the traditional text mentions rites against harmful influences concerning children. Guard against career disputes and financial loss. Journeys meet danger and obstruction. Attend to illness promptly.",
    topics: ["Career matters may attract disputes and people acting in bad faith. Keep to your duties, avoid confrontation, and avoid major moves.", "Doubts trouble the relationship; honesty is recommended to resolve resentment. The traditional text speaks of harmful influences concerning children and recommends protective rites, prayers, and good deeds.", "Loss of resources is indicated. Avoid speculative risks, restrain expenditure, and maintain your established livelihood.", "Illness may recur. Seek medical attention early, do not conceal or ignore illness, and attend to diet and daily routine.", "Verbal disputes may arise at home. Cultivate character, avoid quarrels, and seek harmony with neighbors.", "Journeys meet repeated hazards. Postpone them or stay close to home; exercise particular care on distant journeys."]
  },
  86: {
    xianji: "The image is receiving office before the emperor. Plans accord with the heart, and the commentary ranks this among the finest lots. The traditional reading describes household well-being, a happy marriage, advancement, abundant resources, and favorable travel.",
    topics: ["Career advancement is indicated, with a benefactor's assistance, growing reputation, and substantial accomplishment.", "A happy, harmonious marriage is described as a bond ordained by heaven. The traditional text encourages making use of the occasion to form a union.", "Livelihood and resources are abundant. Both regular and incidental gains are envisaged; transactions proceed smoothly, with benefit near and far.", "Good physical condition and few ailments are indicated; old illness may improve. Use the favorable period for recuperation and maintaining strength.", "The household is healthy and prosperous, with young and old at ease. Relatives gather for happy events, adding distinction to the home.", "Travel in all directions is favorable, whether near or distant. Major discussions and important agreements are favored."]
  },
  90: {
    xianji: "The image is accomplishment and recognition, with a benefactor ahead. Joy increases; affairs and pursuits are described as favorable and smoothly fulfilled.",
    topics: ["A benefactor guides career matters. The post or undertaking sought may be attained; make use of the opportunity.", "A benefactor introduces a suitable partner. The union may form; an old bond may be renewed or a new one established.", "Resources are abundant. Regular income advances steadily; incidental gains have their time, and unexpected good news may come from afar.", "Physical well-being and gradual improvement of old illness are indicated. Use the period to recuperate and strengthen the body.", "Household affairs proceed smoothly. News from relatives approaches, and a welcome addition is envisaged. The text favors attending to the home.", "A favorable wind accompanies travel; distant routes are unobstructed. Help may be met away from home, and the return is described as peaceful."]
  },
  91: {
    xianji: "The image is an open, distinguished future: the traditional text calls affairs smoothly auspicious, with household peace, harmony in marriage, career accomplishment, ample resources, and favorable travel.",
    topics: ["The career path opens as wide as the sky. Plans have room to develop with other people's assistance.", "A marriage bond may form from mutual affection. The traditional text describes a suitable partner and encourages expressing one's feelings at an appropriate time.", "Resources are ample. Giving brings contentment; regular income grows steadily, and generosity is associated with blessing.", "Good physical condition and few serious difficulties are indicated. Appropriate care may help old illness improve.", "The household is peaceful and harmonious, without major worry. Relatives share joyful gatherings; generosity and good deeds are encouraged.", "Journeys proceed smoothly, whether near or far. The traditional reading also favors distant travel."]
  },
  100: {
    xianji: "This is the concluding or full lot, the end of the collection. Do not act rashly in any matter. Maintain constancy and await the proper time. The traditional text associates Buddhist observances and good deeds with protection.",
    topics: ["Keep to your current duties. A job change or expansion is discouraged; reconsider when circumstances mature.", "Postpone marriage negotiations. A rushed union may meet reversals; mutual consideration after marriage supports a lasting relationship.", "Seeking wealth is unfavorable, with a pronounced image of loss. Restrain spending and avoid speculative risks.", "Weakness and susceptibility to illness, including recurrence of old conditions, are indicated. Seek medical attention promptly rather than hiding illness. The traditional text also recommends good deeds and prayers.", "Maintain the household's established arrangements, avoiding major construction or relocation. Young and old are described as settled; prayers for blessings are recommended.", "Travel carries hazards. Postpone it or change the route; take particular care and prepare thoroughly for distant journeys."]
  }
};

function translateFormula(input) {
  return input.split(/[；，。]/u).filter(Boolean).map(clause => {
    const subject = Object.keys(glossary.subjects).find(key => clause.startsWith(key));
    const suffix = subject && clause.slice(subject.length);
    let phrase = subject && glossary.phrases[suffix];
    if (!subject || !phrase) throw new Error(`Untranslated clause: ${clause}`);
    if (subject === "失物" && suffix === "可见") phrase = "may be found";
    if (subject === "寻亲" && suffix === "可见") phrase = "the person sought may be met";
    return `${glossary.subjects[subject]}: ${phrase}.`;
  }).join(" ");
}

if (editorial.entries.length !== 100) throw new Error("Expected 100 editorial entries");
const byId = new Map(editorial.entries.map(entry => [entry[0], entry]));
if (byId.size !== 100) throw new Error("Duplicate editorial sign ID");
const translations = source.map(stick => {
  const entry = byId.get(stick.id);
  if (!entry || entry.length !== 5 || !levels[stick.level]) throw new Error(`Invalid editorial entry ${stick.id}`);
  const special = prose[stick.id];
  const topics = Object.fromEntries(domains.map((domain, index) => [domain, special ? special.topics[index] : translateFormula(stick.traditional.topics[domain])]));
  return {
    id: stick.id, level: levels[stick.level], title: entry[1], poem: entry[2],
    traditional: { jieyue: entry[3], xianji: special?.xianji ?? translateFormula(stick.traditional.xianji), topics, diangu: entry[4] }
  };
});
const result = {
  version: editorial.version, sourceVersion: editorial.sourceVersion, locale: "en",
  sourceSha256: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
  translationMethod: editorial.translationMethod,
  translations
};
const formatted = `${JSON.stringify(result, null, 2)}\n`;
const target = new URL("sticks/guanyin.en.json", root);
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== formatted) throw new Error("English catalog is stale: run node scripts/build-guanyin-en.mjs");
  console.log("English catalog matches all 100 source lots and editorial translations.");
} else {
  await writeFile(target, formatted);
  console.log(`Assembled 100 English lots: ${fileURLToPath(target)}`);
}
