# Guanyin English edition

`guanyin.en.json` is a complete, offline presentation catalog for the **same 100
IDs** as `guanyin.json`. The Chinese catalog remains the source for random draws,
semantic tags, reasoning, citations, and saved evidence. Language switching never
draws another lot. English UI users see the English verse and can expand the
Chinese source for comparison.

## Editorial policy

The English wording is an original translation of this repository's Chinese
edition. It is not an official temple edition or a certified scholarly
translation. It was written by the coding assistant from the supplied Chinese
text; it was not generated using local Qwen. Public bilingual materials were
consulted for terminology and edition comparison. No external site's complete
English collection was copied, and no claim is made that two external editions
were individually checked for every line of all 100 lots.

Titles, grades, four verse lines, the explanatory commentary, ritual counsel,
and all six topic readings are included. Stories are **abridged English
retellings**, explicitly labeled in the UI; the complete Chinese stories remain
available alongside them. This is a limitation of this edition, not a claim to
word-for-word completeness of the stories. The traditional references to birth
sex, medical outcomes, ritual remedies, and ancestral graves remain attributed
to the historical reading rather than asserted as verified predictions.

`Upper auspicious`, `Middle balanced`, and `Middle inauspicious` preserve the
actual grades 上吉, 中平, 中凶 of this repository, even where another website uses
different grading. Names use pinyin, with familiar courtesy names retained.
The golden crow and jade rabbit represent the sun and moon; the Dragon Gate and
plucking cassia retain their traditional images of transformation and distinction.
`Jieyue` is explanatory commentary; `xianji` is traditional counsel, not a separate
AI response. The English static catalog does not translate the personalized
Chinese rule-engine/LLM interpretation or normalize English user questions.

## Sources consulted for comparison

- Chinese base text: [`guanyin.json`](guanyin.json), identified by the SHA-256 of
  its parsed JSON in the generated catalog.
- [Master Sean Chan, lot 1](https://www.masterseanchan.com/guanyin-oracle/lot-1/):
  bilingual verse, title, and the division between poem, commentary, and story.
- [Cantian, 100-lot index](https://www.cantian.ai/en/oracle/guan-yin): useful for
  names and sequence comparison; its verse and story variants are not substituted
  for this repository's text.
- [KnowYourBaZi, collection overview](https://knowyourbazi.com/en/guanyinqian/):
  explicitly identifies its own English readings and AI-generated content; used
  as a comparison, not as authoritative or licensed source text.
- [Tianjidu, collection index](https://www.yivua.com/en/guanyin/): illustrates a
  different poem/title/grade edition. Number alone does not establish equivalence.

No universally authoritative English edition was established by these sources.
Specialist review would be needed to describe this edition as academically
verified. Automated checks establish structural coverage and ID correspondence,
not literary or historical infallibility.

## Textual notes

The supplied Chinese text includes apparent transmission errors and legendary
history. English follows that text without silently replacing whole lots with
another edition. In particular:

- 1: 急速兆速 is unclear; it is identified as such in the commentary.
- 6: the bronze-bird verse and several commentary phrases are obscure; the
  ambiguity is retained rather than replaced by a different tiger/bird edition.
- 12: 击人双足 is obscure. Tiger/rabbit imagery is not converted into a guaranteed
  year or date.
- 47: the old-age examination story conflicts with historical chronology.
- 54: 南山只是锄 is textually awkward; the literal hoe/ground image is retained.
- 63: the Chinese story contains only its title; no narrative is invented.
- 71: 不出重重 and 振放中开 are obscure; the commentary is translated conservatively.
- 78: 白涕汤 appears corrupt; the water/broth image is approximate and does not
  pretend to establish a corrected Chinese reading.
- 81: 咸淳 is a Song reign era, inconsistent with the Tang poet Wang Bo. The story
  flags the chronology rather than repeating it as fact.
- 83: Li Yuan's accession was at Chang'an, not Taiyuan as the base story claims.
- 90: the name 苇佩 and the supplied short allusion are uncertain; an alternative
  edition's personal name or narrative is not inserted.
- 95: Cao Pi is conflated with the later Cao Huan; the English story flags this.
- 97: several verse characters are corrupt. The image of repeatedly trying to
  gather an illusion is a conservative reading, not an established emendation.

## Maintenance and verification

Author verse/commentary/story changes in `guanyin.en.editorial.json`. The
controlled phrase translations in `guanyin.en.glossary.json` cover recurring
formulae; prose entries in the assembly script have individually written topic
translations. The assembly step makes no network or model calls:

```sh
node scripts/build-guanyin-en.mjs
node scripts/build-guanyin-en.mjs --check
npm test -- --run tests/guanyin-translation.test.ts tests/guanyin.test.ts
```

The script rejects missing editorial rows and untranslated formulae. Runtime
validation rejects missing/duplicate/out-of-range IDs, verses other than four
lines, empty fields, incomplete topic readings, and Chinese left in English
fields. Tests compare the source fingerprint and verify that locale changes and
API draws retain the original Chinese evidence and identical lot IDs. A future
Chinese source change requires deliberate translation review and regeneration.
