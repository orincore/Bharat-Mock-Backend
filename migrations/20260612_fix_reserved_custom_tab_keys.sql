-- Custom tabs must never use the reserved tab slugs ('overview', 'mock-tests',
-- 'previous-papers', 'question-papers') — those URLs belong to the page template's
-- built-in tabs. Older tabs could end up with one (e.g. a tab created as
-- "Previous Papers", later renamed to "Previous Year pdf", kept tab_key
-- 'previous-papers' and shadowed the reserved Previous Papers tab on
-- /ssc-cgl-exam/previous-papers).
--
-- Re-derive the key from the tab's current title. The backend now rejects
-- reserved keys on create/update, so this cannot reoccur.

UPDATE subcategory_custom_tabs
SET tab_key = trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'))
WHERE tab_key IN ('overview', 'mock-tests', 'previous-papers', 'question-papers')
  AND trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'))
      NOT IN ('overview', 'mock-tests', 'previous-papers', 'question-papers', '');

UPDATE category_custom_tabs
SET tab_key = trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'))
WHERE tab_key IN ('overview', 'mock-tests', 'previous-papers', 'question-papers')
  AND trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'))
      NOT IN ('overview', 'mock-tests', 'previous-papers', 'question-papers', '');
