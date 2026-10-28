/**
 * Irregular English forms -> base form. Hand-written (WordNet's exception lists are not in the
 * npm package we build from). Used as `exceptions` for baseForms().
 * An exact dictionary hit always wins over this table ("found", "lay" are headwords too).
 */

// base: [past, past participle, ...other forms]
const VERBS: Record<string, string[]> = {
  arise: ["arose", "arisen"], awake: ["awoke", "awoken"], be: ["am", "is", "are", "was", "were", "been", "being"],
  bear: ["bore", "borne", "born"], beat: ["beaten"], become: ["became"], begin: ["began", "begun"], bend: ["bent"],
  bind: ["bound"], bite: ["bit", "bitten"], bleed: ["bled"], blow: ["blew", "blown"], break: ["broke", "broken"],
  breed: ["bred"], bring: ["brought"], build: ["built"], burn: ["burnt"], buy: ["bought"], catch: ["caught"],
  choose: ["chose", "chosen"], cling: ["clung"], come: ["came"], creep: ["crept"], deal: ["dealt"], dig: ["dug"],
  do: ["did", "done", "does", "doing"], draw: ["drew", "drawn"], dream: ["dreamt"], drink: ["drank", "drunk"],
  drive: ["drove", "driven"], eat: ["ate", "eaten"], fall: ["fell", "fallen"], feed: ["fed"], feel: ["felt"],
  fight: ["fought"], find: ["found"], flee: ["fled"], fling: ["flung"], fly: ["flew", "flown"],
  forbid: ["forbade", "forbidden"], forget: ["forgot", "forgotten"], forgive: ["forgave", "forgiven"],
  freeze: ["froze", "frozen"], get: ["got", "gotten"], give: ["gave", "given"], go: ["went", "gone", "goes", "going"],
  grind: ["ground"], grow: ["grew", "grown"], hang: ["hung"], have: ["had", "has", "having"], hear: ["heard"],
  hide: ["hid", "hidden"], hold: ["held"], keep: ["kept"], kneel: ["knelt"], know: ["knew", "known"], lay: ["laid"],
  lead: ["led"], lean: ["leant"], leap: ["leapt"], learn: ["learnt"], leave: ["left"], lend: ["lent"],
  lie: ["lay", "lain", "lying"], light: ["lit"], lose: ["lost"], make: ["made"], mean: ["meant"], meet: ["met"],
  pay: ["paid"], ride: ["rode", "ridden"], ring: ["rang", "rung"], rise: ["rose", "risen"], run: ["ran"], say: ["said"],
  see: ["saw", "seen"], seek: ["sought"], sell: ["sold"], send: ["sent"], sew: ["sewn"], shake: ["shook", "shaken"],
  shine: ["shone"], shoot: ["shot"], show: ["shown"], shrink: ["shrank", "shrunk"], sing: ["sang", "sung"],
  sink: ["sank", "sunk"], sit: ["sat"], sleep: ["slept"], slide: ["slid"], speak: ["spoke", "spoken"], speed: ["sped"],
  spend: ["spent"], spin: ["spun"], spring: ["sprang", "sprung"], stand: ["stood"], steal: ["stole", "stolen"],
  stick: ["stuck"], sting: ["stung"], stride: ["strode", "stridden"], strike: ["struck"], swear: ["swore", "sworn"],
  sweep: ["swept"], swim: ["swam", "swum"], swing: ["swung"], take: ["took", "taken"], teach: ["taught"],
  tear: ["tore", "torn"], tell: ["told"], think: ["thought"], throw: ["threw", "thrown"], understand: ["understood"],
  wake: ["woke", "woken"], wear: ["wore", "worn"], weave: ["wove", "woven"], weep: ["wept"], win: ["won"],
  wind: ["wound"], withdraw: ["withdrew", "withdrawn"], write: ["wrote", "written"],
};

const NOUNS: Record<string, string[]> = {
  child: ["children"], man: ["men"], woman: ["women"], foot: ["feet"], tooth: ["teeth"], goose: ["geese"],
  mouse: ["mice"], louse: ["lice"], person: ["people"], ox: ["oxen"], criterion: ["criteria"],
  phenomenon: ["phenomena"], datum: ["data"], analysis: ["analyses"], basis: ["bases"], crisis: ["crises"],
  hypothesis: ["hypotheses"], thesis: ["theses"], diagnosis: ["diagnoses"], parenthesis: ["parentheses"],
  index: ["indices"], appendix: ["appendices"], matrix: ["matrices"], vertex: ["vertices"], curriculum: ["curricula"],
  medium: ["media"], bacterium: ["bacteria"], alumnus: ["alumni"], cactus: ["cacti"], fungus: ["fungi"],
  nucleus: ["nuclei"], radius: ["radii"], stimulus: ["stimuli"], syllabus: ["syllabi"], knife: ["knives"],
  life: ["lives"], wife: ["wives"], leaf: ["leaves"], wolf: ["wolves"], shelf: ["shelves"], half: ["halves"],
  calf: ["calves"], loaf: ["loaves"], thief: ["thieves"], self: ["selves"], elf: ["elves"], scarf: ["scarves"],
};

const ADJ: Record<string, string[]> = {
  good: ["better", "best"], well: ["better", "best"], bad: ["worse", "worst"], far: ["further", "furthest", "farther", "farthest"],
  little: ["less", "least"], much: ["more", "most"], many: ["more", "most"], old: ["elder", "eldest"],
};

export const IRREGULAR: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const table of [VERBS, NOUNS, ADJ]) {
    for (const [base, forms] of Object.entries(table)) for (const f of forms) if (!(f in out)) out[f] = base;
  }
  return out;
})();
