"""Basic BaZi knowledge, read from data files (bazi/data/basics/*.json).

The data files are generated, not written: `python -m bazi.research.build_basics` parses them out of the original texts in the
project knowledge base (data/knowledge_sources_complete) and records, for every fact, the page, chapter and the
verbatim stretch it came from. The few things the books do not hold are in `conventions.json`, by hand, with reasons.

One reader per kind of knowledge; the code that does the calculating (calc/, diagnosis/) imports from here and holds
no table of its own:

    stems_branches   the ten stems and twelve branches: order, element, yin/yang, contract keys
    elements         which element generates / controls which
    hidden_stems     the stems each branch hides, in order of qi (the convention in force is named in the data)
    ten_gods         the ten gods as a function of element relation and polarity
    solar_terms      the twenty-four terms and the twelve that open a month
    sexagenary       the sixty-cycle and the rules that place month and hour stems (五虎遁, 五鼠遁), anchors
    luck_rules       the numbers behind the luck cycles

1.1 does not depend on the 1.2 rule base, so these files are kept apart from it; test_rules_data checks that the
two agree where they state the same fact.
"""
