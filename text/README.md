# Localization (`text/`)

Every user-visible string in the Demographics mod is a `LOC_*` tag defined here and
resolved at runtime by `Locale.compose` (via the `t()` helper in
`ui/core/demographics-i18n.js`). There is **no hardcoded display English in the `.js`**
— to change what a player reads, edit the `<Text>` in these files, not the code.

## Files

| File | Contents |
|------|----------|
| `en_us/ModText.xml` | **Source of truth.** Authoritative English for every tag. |
| `de_de/`, `es_es/`, `fr_fr/`, `it_it/`, `ja_jp/`, `ko_kr/`, `pl_pl/`, `pt_br/`, `ru_ru/`, `zh_cn/` | One `ModText.xml` per language. |

The modinfo registers all 11 via `<UpdateText>` (`demographics.modinfo`).

## Two file shapes

`en_us` uses an `EnglishText` block with `Row`:

```xml
<Database>
  <EnglishText>
    <Row Tag="LOC_DEMOGRAPHICS_TITLE"><Text>Demographics</Text></Row>
  </EnglishText>
</Database>
```

Every other locale uses a `LocalizedText` block with `Replace` + a `Language` attribute:

```xml
<Database>
  <LocalizedText>
    <Replace Tag="LOC_DEMOGRAPHICS_TITLE" Language="de_DE"><Text>Demografie</Text></Replace>
  </LocalizedText>
</Database>
```

**`Language` attribute ≠ folder name.** Use the value below verbatim — note `zh_cn`:

| Folder | `Language=` | Folder | `Language=` |
|--------|-------------|--------|-------------|
| `de_de` | `de_DE` | `pl_pl` | `pl_PL` |
| `es_es` | `es_ES` | `pt_br` | `pt_BR` |
| `fr_fr` | `fr_FR` | `ru_ru` | `ru_RU` |
| `it_it` | `it_IT` | `zh_cn` | **`zh_Hans_CN`** |
| `ja_jp` | `ja_JP` | `ko_kr` | `ko_KR` |

## The tag-parity invariant

**Every locale file must contain exactly the same set of tags as `en_us`** (currently
907). The engine loads a separate DB per language, so a tag missing from `fr_fr` renders
as the raw `LOC_...` string for French players. Keep the sets identical.

## Placeholder text is expected

Tag-parity is the hard rule; *translation* is a later pass. A non-English entry may hold
**English placeholder text** copied from `en_us` while awaiting translation — this is
normal, not a bug. To find what still needs translating in a locale, compare its `<Text>`
values against `en_us` (identical English text = untranslated placeholder).

## Adding a new string

1. Add `<Row Tag="LOC_DEMOGRAPHICS_..."><Text>…</Text></Row>` to `en_us/ModText.xml`.
2. Add a matching `<Replace Tag="…" Language="…"><Text>…</Text></Replace>` to **all 10**
   other locales (English placeholder is fine to start).
3. Reference it from code as `t("LOC_DEMOGRAPHICS_...")`.

**Substitution:** args passed to `t()` fill positional `{N_Name}` placeholders, e.g.
`t("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", 3)` → `<Text>Player {1_Pid}</Text>` → "Player 3".
Keep the `{N_...}` tokens intact (and in a natural position for the language) when translating.

**Metric names** are special: a metric's displayed name comes from
`LOC_DEMOGRAPHICS_METRIC_<ID>` (uppercased id), with an optional fuller chart title at
`LOC_DEMOGRAPHICS_METRIC_<ID>_TITLE`. The `label`/`title` strings in
`ui/metrics/demographics-metrics*.js` are only dev fallbacks — translate the LOC key.

## Base-game strings are NOT here

A few tags the mod displays (e.g. `LOC_CITY_NAME_UNSET`, `LOC_RESOURCECLASS_*`,
`LOC_CIVILIZATION_*`) are **owned by the base game** and deliberately not redefined here —
the engine already ships them in every language. They are registered in
`BASE_GAME_LOC_KEYS` / `BASE_GAME_LOC_PREFIXES` in `ui/core/demographics-i18n.js`; a tooling
check can use `isBaseGameLoc()` to tell "base-game key" apart from "missing mod key".

## Quick parity check

```sh
cd .. # mod root
en=$(grep -oE 'Tag="[^"]+"' text/en_us/ModText.xml | sort -u)
for loc in de_de es_es fr_fr it_it ja_jp ko_kr pl_pl pt_br ru_ru zh_cn; do
  diff <(echo "$en") <(grep -oE 'Tag="[^"]+"' text/$loc/ModText.xml | sort -u) \
    >/dev/null && echo "$loc OK" || echo "$loc DRIFT"
done
```
