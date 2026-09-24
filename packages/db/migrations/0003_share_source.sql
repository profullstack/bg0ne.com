-- The original, so a share can show before as well as after.
--
-- Nullable on purpose. An upload larger than the cap is still worth sharing as a
-- result; it just loses its "before". A share that refused to exist because the
-- source was big would trade the thing somebody asked for against the garnish.
--
-- The source expires with the rest of the row. It is the more sensitive of the two
-- images -- the cutout has had its background removed, the original has not -- and
-- it lives behind the same single unguessable id, so nothing here widens who can
-- see it, only what they see.
alter table shares
  add column source              bytea,
  add column source_content_type text,
  add column source_width        int,
  add column source_height       int;
