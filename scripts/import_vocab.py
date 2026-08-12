#!/usr/bin/env python3
"""Import frequency-ranked Spanish vocabulary into words-imported.js.

This is the ETL step behind js/words-imported.js. It is *not* something the
running app needs (the app only reads the generated .js file) -- it's kept
here so the import is reproducible and so it's easy to pull in more words
later (raise --target) without re-doing the research from scratch.

Data sources (see the README's "Credits" section for the full attribution):
  - frequency.csv  -- Spanish word-frequency ranking, CC-BY-SA 3.0, from
    https://github.com/doozan/spanish_data (itself built on
    https://github.com/hermitdave/FrequencyWords, MIT)
  - es-en.data     -- Spanish headword -> English Wiktionary gloss data,
    CC-BY-SA, from the same doozan/spanish_data repo (built from
    https://en.wiktionary.org)

Usage:
    # 1. Fetch the two source files (not checked into this repo -- see the
    #    License note below on why you'd want a fresh copy anyway):
    curl -sSL -o data/frequency.csv \\
      https://raw.githubusercontent.com/doozan/spanish_data/master/frequency.csv
    curl -sSL -o data/es-en.data \\
      https://raw.githubusercontent.com/doozan/spanish_data/master/es-en.data

    # 2. Dump the current hand-curated + already-imported word list, so this
    #    script can skip anything already in the deck:
    node -e "import('../js/words.js').then(({WORDS}) => \\
      process.stdout.write(JSON.stringify(WORDS)))" > data/existing_words.json

    # 3. Run the import (writes js/words-imported.js directly):
    python3 scripts/import_vocab.py --target 900

License note: this script filters out archaic/regional/vulgar senses and
prefers short, current-usage glosses, but it's still an automated pick of
"the first clean gloss" -- always worth spot-checking a sample of the output
before committing a much larger --target than before.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# 1. Parse es-en.data into headword -> [{pos, g, glosses: [{text, q}]}]
# ---------------------------------------------------------------------------


def parse_es_en_data(path):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    blocks = content.split("_____\n")
    entries = {}
    for b in blocks:
        lines = b.split("\n")
        if not lines or not lines[0].strip():
            continue
        headword = lines[0].strip()
        pos_blocks = []
        current = None
        for line in lines[1:]:
            m_pos = re.match(r"^pos:\s*(.*)$", line)
            m_field = re.match(r"^\s+(\w+):\s*(.*)$", line)
            if m_pos:
                current = {"pos": m_pos.group(1).strip(), "g": None, "glosses": []}
                pos_blocks.append(current)
            elif m_field and current is not None:
                field, value = m_field.group(1), m_field.group(2)
                if field == "gloss":
                    current["glosses"].append({"text": value, "q": None})
                elif field == "q" and current["glosses"]:
                    current["glosses"][-1]["q"] = value
                elif field == "g":
                    current["g"] = value
        if pos_blocks:
            entries.setdefault(headword, []).extend(pos_blocks)
    return entries


BAD_GLOSS_PATTERNS = re.compile(
    r"\b(form of|misspelling of|alternative (spelling|form) of|obsolete|archaic|"
    r"dialectal|superseded|nonstandard|eye dialect|pronunciation spelling|"
    r"initialism of|abbreviation of|clipping of|contraction of|"
    r"superlative of|comparative of|diminutive of|augmentative of|"
    r"plural of|feminine of|masculine of|synonym of|"
    r"^having (the|a|lies)|^the (quality|state) of|^characterized by|"
    r"^one (who|that))",
    re.IGNORECASE,
)
# Qualifiers that mean "this sense is not standard current usage" -- skip the
# gloss entirely rather than import it with a misleadingly plain-looking card.
BAD_QUALIFIER_PATTERNS = re.compile(
    r"\b(vulgar|offensive|derogatory|slur|ethnic slur|obsolete|archaic|dialectal|"
    r"regional|regionalism|nonstandard|rare|dated|historical)\b",
    re.IGNORECASE,
)
UNHELPFUL_QUALIFIER_WORDS = {
    "countable", "uncountable", "chiefly", "especially", "often", "sometimes",
    "generally", "mostly", "usually", "somewhat", "figuratively",
    "figurative", "literally", "also", "transitive", "intransitive", "reflexive",
}
LEADING_ARTICLE = re.compile(r"^(el|la|los|las|un|una|unos|unas)\s+", re.IGNORECASE)


def strip_article(text):
    return LEADING_ARTICLE.sub("", text).strip()


def useful_qualifier(q):
    if not q:
        return None
    words = {w.strip().lower() for w in re.split(r"[,;]|\bor\b", q) if w.strip()}
    if words <= UNHELPFUL_QUALIFIER_WORDS:
        return None
    # Some qualifiers are a long list of regions/registers (e.g. "also
    # vocative, South America, Central America, Caribbean, Spain,
    # colloquial") -- keep just the first couple of terms for a clean
    # one-line subheading rather than the full list.
    terms = [w.strip() for w in re.split(r"[,;]", q) if w.strip()]
    if len(q) > 30 and len(terms) > 2:
        return ", ".join(terms[:2])
    return q


def _try_gloss(gloss):
    """Return (primary, context) for one gloss entry, or None if unusable."""
    text = gloss["text"]
    if text.startswith("("):
        # Leading parenthetical is usually a taxonomic/technical tag
        # ("(Thuja) thuja") rather than something worth cleaning up.
        return None
    if BAD_GLOSS_PATTERNS.search(text):
        return None
    if gloss["q"] and BAD_QUALIFIER_PATTERNS.search(gloss["q"]):
        return None
    # Drop a trailing usage-note bracket, e.g. "to hope [+direct object...]"
    text = re.sub(r"\s*\[.*$", "", text).strip()
    # Strip a parenthetical explanation suffix like "dog (# The species ...)"
    text = re.sub(r"\s*\(#.*?\)\s*$", "", text)
    text = re.sub(r"\s*\([^()]*\)\s*$", "", text).strip()
    if not text:
        return None
    # Take just the first comma/semicolon-separated alternative as the
    # primary English gloss; keep it short for a flashcard front.
    primary = re.split(r"[;,]", text)[0].strip()
    primary = re.sub(r"^(a|an|the)\s+", "", primary, flags=re.IGNORECASE)
    if not primary or len(primary) > 30:
        return None
    context = useful_qualifier(gloss["q"].strip()) if gloss["q"] else None
    return primary, context


def clean_gloss(pos_block):
    """Return (en, context) for the best usable gloss in a pos block, or None."""
    candidates = [_try_gloss(g) for g in pos_block["glosses"]]
    candidates = [c for c in candidates if c is not None]
    if not candidates:
        return None
    if pos_block["pos"] == "v":
        # Verb glosses conventionally read as "to VERB" -- prefer one of
        # those over an oddly-phrased alternate sense if both are present.
        infinitive = next((c for c in candidates if c[0].lower().startswith("to ")), None)
        if infinitive:
            return infinitive
    return candidates[0]


# ---------------------------------------------------------------------------
# 2. Parse frequency.csv
# ---------------------------------------------------------------------------


def parse_frequency(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


POS_MAP = {"n": "vocabulary", "adj": "adjectives", "adv": "adverbs", "v": "verbs"}
WANTED_WIKT_POS = {"n": "n", "adj": "adj", "adv": "adv", "v": "v"}


def build_existing_lookup(existing):
    existing_es = {w["es"] for w in existing}
    existing_es_lower = {w["es"].lower() for w in existing}
    # Hand-curated entries mostly include the article ("el pollo"); the
    # frequency list gives bare lemmas ("pollo"). Compare article-stripped
    # forms too, or every noun would double up against its own hand-curated
    # twin.
    existing_es_stripped = {strip_article(w["es"]).lower() for w in existing}
    # Also dedupe on English gloss: if the hand-curated deck already has a
    # card fronted "vacation", don't add a second one for a near-synonym
    # Spanish form (singular/plural, a synonym headword, etc.) that the
    # es-text dedup above wouldn't catch.
    existing_en_lower = set()
    for w in existing:
        for part in re.split(r"\s*/\s*", w["en"]):
            existing_en_lower.add(re.sub(r"\s*\([^)]*\)\s*$", "", part).strip().lower())
    return existing_es, existing_es_lower, existing_es_stripped, existing_en_lower


def import_words(freq_rows, es_en, existing, target_count):
    existing_es, existing_es_lower, existing_es_stripped, existing_en_lower = (
        build_existing_lookup(existing)
    )

    results = []
    seen_es_this_batch = set()
    seen_en_this_batch = {}
    stats = {"skipped_no_gloss": 0, "skipped_dup": 0, "skipped_bad_pos": 0}

    for row in freq_rows:
        if len(results) >= target_count:
            break
        pos = row["pos"]
        if pos not in POS_MAP:
            stats["skipped_bad_pos"] += 1
            continue
        lemma = row["spanish"]
        if (
            lemma in existing_es
            or lemma.lower() in existing_es_lower
            or lemma.lower() in existing_es_stripped
            or lemma in seen_es_this_batch
        ):
            stats["skipped_dup"] += 1
            continue

        pos_blocks = es_en.get(lemma) or es_en.get(lemma.lower())
        if not pos_blocks:
            stats["skipped_no_gloss"] += 1
            continue

        # Prefer a pos_block whose Wiktionary POS matches the frequency
        # list's POS tag (loose match, since tagging conventions differ).
        wanted_wikt_pos = WANTED_WIKT_POS[pos]
        candidates = [pb for pb in pos_blocks if pb["pos"] == wanted_wikt_pos] or pos_blocks

        gloss_result = None
        for pb in candidates:
            gloss_result = clean_gloss(pb)
            if gloss_result:
                break
        if not gloss_result and candidates is not pos_blocks:
            # The preferred-POS block(s) had nothing usable (e.g. only
            # awkward definitional phrasing) -- fall back to any other POS
            # block for this headword rather than giving up on a perfectly
            # common word.
            for pb in pos_blocks:
                gloss_result = clean_gloss(pb)
                if gloss_result:
                    break
        if not gloss_result:
            stats["skipped_no_gloss"] += 1
            continue

        en, qualifier = gloss_result
        en_key = en.lower()
        if seen_en_this_batch.get(en_key, 0) >= 1 or en_key in existing_en_lower:
            # Already have a card (imported or hand-curated) fronted with
            # this exact English gloss; skip to avoid near-duplicate
            # flashcard fronts (a real second sense would be added by hand
            # with context, as elsewhere in words.js).
            stats["skipped_dup"] += 1
            continue

        entry = {"en": en, "es": lemma, "category": POS_MAP[pos], "type": "word"}
        if qualifier:
            entry["context"] = qualifier

        results.append(entry)
        seen_es_this_batch.add(lemma)
        seen_en_this_batch[en_key] = seen_en_this_batch.get(en_key, 0) + 1

    return results, stats


def js_string(s):
    return json.dumps(s, ensure_ascii=False)


def write_js_module(entries, out_path):
    lines = [
        '// Auto-generated vocabulary import -- see README "Credits" section.',
        "//",
        "// Sourced from https://github.com/doozan/spanish_data (CC-BY-SA), which",
        "// itself combines:",
        '//   - Wiktionary (en.wiktionary.org) English glosses for Spanish headwords',
        "//   - hermitdave/FrequencyWords (github.com/hermitdave/FrequencyWords) word",
        "//     frequency rankings, derived from OpenSubtitles",
        "//",
        "// Regenerate with: python3 scripts/import_vocab.py --target N",
        "// (see that script's docstring for the full pipeline). Picks the",
        "// highest-frequency Spanish nouns/adjectives/adverbs not already covered",
        "// by the hand-curated entries in words.js, with the first clean,",
        "// current-usage Wiktionary gloss for each. Archaic, regional-slang, and",
        "// vulgar/offensive senses are filtered out in favor of a plainer sense",
        "// or skipping the word entirely.",
        "",
        "export const RAW_IMPORTED_WORDS = [",
    ]
    for e in entries:
        fields = [f"en: {js_string(e['en'])}", f"es: {js_string(e['es'])}", f"category: {js_string(e['category'])}"]
        if "context" in e:
            fields.append(f"context: {js_string(e['context'])}")
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=int, default=900, help="how many new words to import")
    parser.add_argument("--data-dir", default=str(REPO_ROOT / "scripts" / "data"), help="dir with frequency.csv/es-en.data/existing_words.json")
    parser.add_argument("--out", default=str(REPO_ROOT / "js" / "words-imported.js"), help="output .js path")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    es_en = parse_es_en_data(data_dir / "es-en.data")
    freq_rows = parse_frequency(data_dir / "frequency.csv")
    existing = json.loads((data_dir / "existing_words.json").read_text(encoding="utf-8"))

    entries, stats = import_words(freq_rows, es_en, existing, args.target)

    print(f"collected: {len(entries)}", file=sys.stderr)
    for key, value in stats.items():
        print(f"{key}: {value}", file=sys.stderr)

    write_js_module(entries, Path(args.out))
    print(f"wrote {len(entries)} entries to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
