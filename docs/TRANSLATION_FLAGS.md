# Translation flags

Owner request (2026-11-11): "in cms, translated text should be flagable by selection, a word or a sentence".

## 1. Where

The editor of a saved page or post that has a version in the other language (same `translation_key`). The
flaggable fields are the title, the summary/excerpt, the body and a card post's slide heading and text.
Selecting text shows a small "Flag translation" / «الإبلاغ عن الترجمة» popover (Tab from the field
reaches it; Esc closes it).

## 2. A flag

`translation_flags` (migrations/0017) holds:

- **the span**: the quote, up to 32 characters before and after it, and its offsets
  (`src/lib/translation-flags/anchor.ts`, the W3C TextQuote + TextPosition selectors). `resolveAnchor`
  finds it again after edits elsewhere, text inserted above, reflowed whitespace and repeated words
  (the context decides between repeats). Once the flagged words themselves change it returns null.
- **the source span**, best effort: the same sentence of the matching paragraph of the other version
  when both have as many sentences, else the paragraph (matched by position), else the whole field.
- **the reason**: wrong meaning, wrong term, Islamic term or honorific, Qur'an or hadith wording,
  grammar or style, other. There is also an optional suggested correction and a note.
- who flagged it, and when. Every change is written to `translation_flag_events` (created, resolved,
  dismissed, reopened, alternatives asked, added to glossary).

## 3. Seeing and fixing

- The flagged spans are tinted **and** underlined by a layer drawn over each field (it is aria-hidden and
  never relies on colour alone). Each field with flags points to a note through `aria-describedby`.
- The "Translation flags" card is the keyboard list. It offers: show in text (selects the span), apply
  suggestion, re-translate selection, add to glossary, mark resolved, dismiss. Resolved and dismissed
  flags stay as history and can be reopened.
- The posts and pages lists show an "N open" badge.
- **Apply suggestion** and **Re-translate selection** replace the span in the field. A **manual edit**
  of flagged words asks, in an in-app dialog when the field loses focus, whether to mark the flag
  resolved. All three resolve the flag only when the post is **saved** (`src/admin/client/save-hooks.ts`);
  until then the flag shows "Resolves when you save".
- **Re-translate selection** makes one synchronous call through the AI provider layer (the `translate`
  route, Workers AI by default). It sends the source span, the translation's paragraph with the span
  marked ⟦…⟧, the reason and the glossary, and gets back 2–3 alternatives. It counts toward the monthly
  budget, is limited to 20 calls per user per 10 minutes, and is logged in `ai_usage` as feature
  `retranslate`.

## 4. Glossary

`translation_glossary`: source term → target term per direction. Machine translation
(`src/lib/ai/runner.ts`) and re-translate add to their prompt the entries whose source term occurs in
the text, at most 60, compared without tashkeel or case. A glossary change is part of the translation
dedupe key. A flag with reason "wrong term" or "Islamic term" and a correction can be **Add to
glossary**. The `/glossary` screen opens with the newest terms listed and searches as you type.
Editors and admins add terms. Admins delete them (soft delete, restorable for 30 days, then purged by
the 30-minute cron) and restore them.

## 5. Qur'an

Qur'an is never machine-translated. A flag is marked Qur'an when the editor ticks "This is Qur'an", or
when the span or its source sentence carries ﴿ ﴾, «قال تعالى», an Arabic `[سورة: آية]` reference or a
"Quran 2:255"-style reference, or when the span sits inside ﴿ … ﴾. A Qur'an flag gets **Use official
text** instead of re-translate. That button opens the ayah on quran.com (or a quran.com search), and the
API refuses alternatives for it (409, before any model call).

**Gap:** the quran.com (Quran Foundation API) flow from AlUmmahNow
`docs/specs/TRANSCRIPTION-TRANSLATION.md` §5.5 is not in the CMS yet. Until it is, the editor copies a
recognised translation and its edition name from quran.com. Later, "Use official text" should insert
the QF reference and translation by id.

## 6. Roles

Editors (Moderator) and admins flag, resolve, dismiss, reopen, re-translate and add to the glossary.
A scholar (writer) can flag their own posts and see their flags, but cannot resolve them or use the
glossary.

## 7. Tests

- `test/node/translation-flags-anchor.test.ts`: anchoring and re-anchoring after edits, alignment,
  Qur'an detection.
- `test/worker/translation-flags.test.ts`: API, roles, audit, list badge, alternatives with a mocked
  Workers AI, glossary soft delete and purge, glossary in the translation prompt.
- `e2e/local/translation-flags.local.spec.ts`: select → flag → glossary → apply → save resolves;
  re-translate; the edit prompt. Mock AI only.
